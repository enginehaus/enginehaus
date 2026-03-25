import {
  UnifiedTask,
  StrategicDecision,
  UXRequirements,
  TechnicalPlan,
  CoordinationSession,
  CoordinationEvent,
  TaskStatus,
  TaskPriority,
  TaskType,
  SessionStatus,
  EventType,
  Project,
  ProjectStatus,
  Artifact,
  ArtifactType,
  TaskRelationship,
  TaskRelationshipType,
  TaskRelationshipSource,
  HierarchyDefinition,
  HierarchyNode,
  HierarchyEntityType,
  KnowledgeEntity,
  KnowledgeEntityType,
  KnowledgeDisposition,
  KnowledgeRelationship,
  KnowledgeRelationshipType,
  KnowledgeScope,
  AgentProfile,
  AgentCapability,
  AgentRole,
  Contribution,
  ContributionType,
  Dispatch,
  DispatchStatus,
} from '../coordination/types.js';
import {
  SourceConfig,
  IngestionJob,
  Snapshot,
} from '../ingestion/types.js';
import { StorageService } from './storage-service.js';
import type { StorageAdapter } from './storage-adapter.js';
import { safeJsonParse } from '../utils/json.js';
import type { ProjectRow, TaskRow, SessionRow, EventRow, StrategicDecisionRow, TechnicalPlanRow } from './row-types.js';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * SQLiteStorageService
 *
 * Production-ready SQLite storage implementation with:
 * - ACID transactions for data integrity
 * - Automatic schema migrations
 * - Backup on startup
 * - Efficient indexes for common queries
 */
export class SQLiteStorageService implements StorageService, StorageAdapter {
  private db: Database.Database;
  private dbPath: string;
  private dataDir: string;
  private activeProjectId: string = 'default';

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, 'enginehaus.db');

    // Database will be initialized in initialize() method
    this.db = null as any; // Temporary placeholder
  }

  async initialize(): Promise<void> {
    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // NOTE: Removed automatic backup on every initialize.
    // This was causing 670+ backup files and potential corruption.
    // Use backupDatabase() explicitly when needed (e.g., before migrations).

    // Open database connection
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL');

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create schema
    this.createSchema();
  }

  /**
   * Create a backup of the database. Uses VACUUM INTO for WAL-safe backup.
   * Only call this explicitly when needed (e.g., before migrations).
   *
   * @param rotateOld - If true, delete backups older than maxBackups (default: 5)
   */
  async backupDatabase(rotateOld: boolean = true, maxBackups: number = 5): Promise<string | null> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.dataDir, `enginehaus-backup-${timestamp}.db`);

    try {
      // Use VACUUM INTO for a consistent, WAL-safe backup
      // This creates a complete copy without the WAL file issues
      this.db.exec(`VACUUM INTO '${backupPath}'`);
      console.error(`Database backed up to: ${backupPath}`);

      // Rotate old backups if requested
      if (rotateOld) {
        await this.rotateBackups(maxBackups);
      }

      return backupPath;
    } catch (error) {
      console.error(`Failed to backup database: ${error}`);
      return null;
    }
  }

  /**
   * Delete old backups, keeping only the most recent N
   */
  private async rotateBackups(maxBackups: number): Promise<void> {
    try {
      const files = fs.readdirSync(this.dataDir)
        .filter(f => f.startsWith('enginehaus-backup-') && f.endsWith('.db'))
        .map(f => ({
          name: f,
          path: path.join(this.dataDir, f),
          mtime: fs.statSync(path.join(this.dataDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime); // newest first

      // Delete all but the newest maxBackups
      const toDelete = files.slice(maxBackups);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
      }

      if (toDelete.length > 0) {
        console.error(`Rotated ${toDelete.length} old backup(s), keeping ${maxBackups} most recent`);
      }
    } catch (error) {
      console.error(`Failed to rotate backups: ${error}`);
    }
  }

  /**
   * Health check - verify database connection is working
   * Returns detailed status for diagnostics
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    details: {
      connectionOpen: boolean;
      integrityCheck: boolean;
      walSize: number;
      tableCount: number;
      taskCount: number;
      error?: string;
    };
  }> {
    const details = {
      connectionOpen: false,
      integrityCheck: false,
      walSize: 0,
      tableCount: 0,
      taskCount: 0,
      error: undefined as string | undefined,
    };

    try {
      // Check connection is open
      if (!this.db || !this.db.open) {
        details.error = 'Database connection not open';
        return { healthy: false, details };
      }
      details.connectionOpen = true;

      // Quick integrity check (faster than full PRAGMA integrity_check)
      const quickCheck = this.db.pragma('quick_check') as Array<{ quick_check: string }>;
      details.integrityCheck = quickCheck[0]?.quick_check === 'ok';
      if (!details.integrityCheck) {
        details.error = `Integrity check failed: ${quickCheck[0]?.quick_check}`;
        return { healthy: false, details };
      }

      // Check WAL size
      const walPath = this.dbPath + '-wal';
      if (fs.existsSync(walPath)) {
        details.walSize = fs.statSync(walPath).size;
      }

      // Count tables
      const tables = this.db.prepare(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
      ).get() as { count: number };
      details.tableCount = tables.count;

      // Count tasks as a simple query test
      const tasks = this.db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
      details.taskCount = tasks.count;

      return { healthy: true, details };
    } catch (error) {
      details.error = error instanceof Error ? error.message : String(error);
      return { healthy: false, details };
    }
  }

  /**
   * Checkpoint WAL to merge changes into main database file
   * Call periodically to prevent WAL from growing too large
   */
  async checkpointWal(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'PASSIVE'): Promise<{
    success: boolean;
    walFrames: number;
    checkpointedFrames: number;
  }> {
    try {
      const result = this.db.pragma(`wal_checkpoint(${mode})`) as Array<{
        busy: number;
        log: number;
        checkpointed: number;
      }>;

      return {
        success: result[0]?.busy === 0,
        walFrames: result[0]?.log || 0,
        checkpointedFrames: result[0]?.checkpointed || 0,
      };
    } catch (error) {
      console.error(`WAL checkpoint failed: ${error}`);
      return { success: false, walFrames: 0, checkpointedFrames: 0 };
    }
  }

  /**
   * Attempt to recover from a bad connection state
   * Closes and reopens the database connection
   */
  async reconnect(): Promise<boolean> {
    try {
      // Close existing connection if open
      if (this.db && this.db.open) {
        this.db.close();
      }

      // Reopen
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      // Verify it works
      const check = await this.healthCheck();
      return check.healthy;
    } catch (error) {
      console.error(`Reconnect failed: ${error}`);
      return false;
    }
  }

  /**
   * Get database statistics for monitoring
   */
  getStats(): {
    dbPath: string;
    dbSizeBytes: number;
    walSizeBytes: number;
    isOpen: boolean;
    activeProjectId: string;
  } {
    const dbSize = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
    const walPath = this.dbPath + '-wal';
    const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;

    return {
      dbPath: this.dbPath,
      dbSizeBytes: dbSize,
      walSizeBytes: walSize,
      isOpen: this.db?.open || false,
      activeProjectId: this.activeProjectId,
    };
  }

  private createSchema(): void {
    // Create tables with proper schema
    this.db.exec(`
      -- Projects table (new for multi-project support)
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('active','archived','paused')) DEFAULT 'active',
        root_path TEXT NOT NULL,
        domain TEXT NOT NULL CHECK(domain IN ('web','mobile','api','infrastructure','ml','other')),
        tech_stack TEXT, -- JSON array
        metadata TEXT, -- JSON object
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_project_slug ON projects(slug);
      CREATE INDEX IF NOT EXISTS idx_project_status ON projects(status);

      -- Strategic Decisions
      CREATE TABLE IF NOT EXISTS strategic_decisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        impact TEXT NOT NULL,
        timeline TEXT NOT NULL,
        stakeholders TEXT NOT NULL, -- JSON array
        requirements TEXT, -- JSON object
        created_at INTEGER NOT NULL,
        created_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_strategic_created_at
        ON strategic_decisions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_strategic_project_id
        ON strategic_decisions(project_id);

      -- UX Requirements
      CREATE TABLE IF NOT EXISTS ux_requirements (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        feature TEXT NOT NULL,
        user_experience TEXT NOT NULL,
        design_pattern TEXT NOT NULL,
        progressive_disclosure TEXT,
        technical_constraints TEXT,
        response_to TEXT,
        created_at INTEGER NOT NULL,
        created_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_ux_created_at
        ON ux_requirements(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ux_project_id
        ON ux_requirements(project_id);

      -- Technical Plans
      CREATE TABLE IF NOT EXISTS technical_plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        feature TEXT NOT NULL,
        strategic_context TEXT,
        ux_context TEXT,
        technical_approach TEXT NOT NULL,
        architecture TEXT,
        estimated_effort TEXT,
        files TEXT, -- JSON array
        quality_gates TEXT, -- JSON array
        unified_tasks TEXT, -- JSON array
        created_at INTEGER NOT NULL,
        created_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_technical_created_at
        ON technical_plans(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_technical_project_id
        ON technical_plans(project_id);

      -- Tasks
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL CHECK(priority IN ('critical','high','medium','low')),
        status TEXT NOT NULL CHECK(status IN ('ready','in-progress','blocked','awaiting-human','completed')),
        type TEXT, -- Task type for quality gate variance
        tags TEXT, -- JSON array of string tags for lightweight categorization
        files TEXT, -- JSON array
        strategic_context TEXT, -- JSON object
        ux_context TEXT, -- JSON object
        technical_context TEXT, -- JSON object
        quality_requirements TEXT, -- JSON array
        implementation TEXT, -- JSON object
        checkpoint_phases TEXT, -- JSON array of phase numbers requiring human approval
        active_checkpoint_id TEXT, -- Reference to current pending checkpoint
        "references" TEXT, -- JSON array of { url, label?, type? } external references
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_by TEXT,
        assigned_to TEXT,
        last_modified_by TEXT,
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_task_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_task_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_task_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_task_project_id ON tasks(project_id);

      -- Human Checkpoints
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('phase-gate','decision-required','review-required','approval-required')),
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','timed-out')),
        phase INTEGER,
        reason TEXT NOT NULL,
        question TEXT,
        options TEXT, -- JSON array of CheckpointOption
        context TEXT,
        requested_by TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        responded_by TEXT,
        responded_at INTEGER,
        response TEXT,
        selected_option TEXT,
        decision TEXT CHECK(decision IN ('approve','reject','redirect')),
        timeout_minutes INTEGER,
        escalate_to TEXT,
        escalated_at INTEGER,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoint_task_id ON checkpoints(task_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_project_id ON checkpoints(project_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_status ON checkpoints(status);

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','completed','expired')),
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        last_heartbeat INTEGER NOT NULL,
        current_phase INTEGER,
        context TEXT NOT NULL -- JSON object
      );

      CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_session_task_id ON sessions(task_id);
      CREATE INDEX IF NOT EXISTS idx_session_project_id ON sessions(project_id);

      -- Events
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT,
        user_id TEXT NOT NULL,
        agent_id TEXT,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL -- JSON object
      );

      CREATE INDEX IF NOT EXISTS idx_event_timestamp ON events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_event_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_event_task_id ON events(task_id);
      CREATE INDEX IF NOT EXISTS idx_event_project_id ON events(project_id);

      -- Task Dependencies (blockedBy/blocks relationships)
      CREATE TABLE IF NOT EXISTS task_dependencies (
        blocker_task_id TEXT NOT NULL,
        blocked_task_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (blocker_task_id, blocked_task_id)
      );

      CREATE INDEX IF NOT EXISTS idx_dep_blocker ON task_dependencies(blocker_task_id);
      CREATE INDEX IF NOT EXISTS idx_dep_blocked ON task_dependencies(blocked_task_id);

      -- Audit Log (compliance-ready event tracking)
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'agent', 'system')),
        project_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        action TEXT NOT NULL,
        before_state TEXT,        -- JSON object
        after_state TEXT,         -- JSON object
        metadata TEXT,            -- JSON object
        ip_address TEXT,
        user_agent TEXT,
        correlation_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
      CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_log(correlation_id);

      -- Project Metadata
      CREATE TABLE IF NOT EXISTS project_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Active project tracking
      CREATE TABLE IF NOT EXISTS active_project (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        project_id TEXT NOT NULL DEFAULT 'default'
      );

      -- Insert default active project if not exists
      INSERT OR IGNORE INTO active_project (id, project_id) VALUES (1, 'default');

      -- In-flight decisions table
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        decision TEXT NOT NULL,
        rationale TEXT,
        impact TEXT,
        category TEXT CHECK(category IN ('architecture', 'tradeoff', 'dependency', 'pattern', 'other', 'thought')),
        disposition TEXT DEFAULT 'approved',
        task_id TEXT,
        project_id TEXT NOT NULL DEFAULT 'default',
        created_at INTEGER NOT NULL,
        created_by TEXT,
        scope_json TEXT,
        "references" TEXT -- JSON array of { url, label?, type? } external references
      );

      CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id);
      CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);

      -- Metrics table (local telemetry for coordination effectiveness)
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN (
          'task_claimed', 'task_completed', 'task_abandoned',
          'context_expanded', 'session_started', 'session_ended',
          'tool_called', 'quality_gate_passed', 'quality_gate_failed',
          'context_fetch_minimal', 'context_fetch_full',
          'task_reopened', 'session_feedback', 'context_repeated',
          'quality_bypass', 'learnings_surfaced', 'decisions_surfaced'
        )),
        project_id TEXT NOT NULL DEFAULT 'default',
        task_id TEXT,
        session_id TEXT,
        metadata TEXT -- JSON object with additional data (includes response_bytes for context fetches)
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_metrics_event_type ON metrics(event_type);
      CREATE INDEX IF NOT EXISTS idx_metrics_project ON metrics(project_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_task ON metrics(task_id);
      CREATE INDEX IF NOT EXISTS idx_metrics_session ON metrics(session_id);

      -- Composite indexes for common metrics query patterns
      -- Pattern: WHERE project_id = ? AND timestamp >= ? [AND event_type = ?]
      CREATE INDEX IF NOT EXISTS idx_metrics_project_timestamp
        ON metrics(project_id, timestamp DESC);
      -- Pattern: WHERE project_id = ? AND timestamp >= ? AND event_type = ?
      CREATE INDEX IF NOT EXISTS idx_metrics_project_time_type
        ON metrics(project_id, timestamp, event_type);
      -- Pattern: WHERE task_id = ? AND event_type = ? (cycle time calculations)
      CREATE INDEX IF NOT EXISTS idx_metrics_task_type
        ON metrics(task_id, event_type, timestamp);

      -- Artifacts table (link files, URLs, designs to tasks OR store content inline)
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'default',
        type TEXT NOT NULL CHECK(type IN ('design', 'doc', 'code', 'test', 'screenshot', 'url', 'reference', 'other')),
        uri TEXT NOT NULL,
        title TEXT,
        description TEXT,
        metadata TEXT, -- JSON for additional data (file size, mime type, etc.)
        created_at INTEGER NOT NULL,
        created_by TEXT,
        origin_chat_uri TEXT, -- URI to originating chat (e.g., claude.ai/chat/{id})
        evolution_history TEXT, -- JSON array of evolution entries
        parent_artifact_id TEXT, -- ID of parent artifact for forked/refined artifacts
        content TEXT, -- Actual content (text/markdown/JSON or base64 for binary)
        content_type TEXT, -- MIME type of content
        content_size INTEGER, -- Size in bytes
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
      CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created_at DESC);

      -- FTS5 virtual table for full-text search on artifacts
      CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
        id,
        title,
        description,
        content,
        content='artifacts',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS index in sync with artifacts table
      CREATE TRIGGER IF NOT EXISTS artifacts_ai AFTER INSERT ON artifacts BEGIN
        INSERT INTO artifacts_fts(rowid, id, title, description, content)
        VALUES (NEW.rowid, NEW.id, NEW.title, NEW.description, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS artifacts_ad AFTER DELETE ON artifacts BEGIN
        INSERT INTO artifacts_fts(artifacts_fts, rowid, id, title, description, content)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.description, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS artifacts_au AFTER UPDATE ON artifacts BEGIN
        INSERT INTO artifacts_fts(artifacts_fts, rowid, id, title, description, content)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.description, OLD.content);
        INSERT INTO artifacts_fts(rowid, id, title, description, content)
        VALUES (NEW.rowid, NEW.id, NEW.title, NEW.description, NEW.content);
      END;

      -- ============================================================
      -- Task Outcomes (Real-world results tracking)
      -- ============================================================

      -- Track what happened AFTER task completion (PR merge, CI, deploy)
      CREATE TABLE IF NOT EXISTS task_outcomes (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,  -- One outcome per task
        project_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'shipped', 'rejected', 'rework', 'abandoned')) DEFAULT 'pending',
        recorded_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,

        -- PR/Code Review
        pr_url TEXT,
        pr_merged INTEGER,  -- Boolean: 1 = merged, 0 = not merged
        pr_merged_at INTEGER,
        review_feedback TEXT,

        -- CI/Quality
        ci_passed INTEGER,  -- Boolean
        ci_first_try_pass INTEGER,  -- Boolean: Did CI pass on first attempt?
        test_failures INTEGER,

        -- Deployment
        deployed INTEGER,  -- Boolean
        deployed_at INTEGER,
        deploy_environment TEXT,

        -- Rework tracking
        rework_required INTEGER,  -- Boolean
        rework_reason TEXT,
        rework_task_id TEXT,

        -- Time tracking (milliseconds)
        time_to_merge INTEGER,
        time_to_production INTEGER,

        -- Feedback
        reviewer_satisfaction INTEGER CHECK(reviewer_satisfaction >= 1 AND reviewer_satisfaction <= 5),
        notes TEXT,

        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_outcomes_task ON task_outcomes(task_id);
      CREATE INDEX IF NOT EXISTS idx_outcomes_project ON task_outcomes(project_id);
      CREATE INDEX IF NOT EXISTS idx_outcomes_status ON task_outcomes(status);
      CREATE INDEX IF NOT EXISTS idx_outcomes_recorded ON task_outcomes(recorded_at DESC);
      -- Composite index for outcome analytics queries
      CREATE INDEX IF NOT EXISTS idx_outcomes_project_status ON task_outcomes(project_id, status);

      -- Session feedback table (outcome-based analytics - human input)
      CREATE TABLE IF NOT EXISTS session_feedback (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'default',
        task_id TEXT,
        productivity_rating INTEGER CHECK(productivity_rating >= 1 AND productivity_rating <= 5),
        friction_tags TEXT, -- JSON array of FrictionTag values
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_feedback_session ON session_feedback(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_feedback_project ON session_feedback(project_id);
      CREATE INDEX IF NOT EXISTS idx_session_feedback_created ON session_feedback(created_at DESC);

      -- AX Survey responses table (agent experience research)
      CREATE TABLE IF NOT EXISTS ax_survey_responses (
        id TEXT PRIMARY KEY,
        survey_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        responses TEXT NOT NULL, -- JSON object of question_id -> answer
        freeform_feedback TEXT,
        context TEXT, -- JSON object with tools_used, errors, duration, completed
        submitted_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ax_survey_session ON ax_survey_responses(session_id);
      CREATE INDEX IF NOT EXISTS idx_ax_survey_project ON ax_survey_responses(project_id);
      CREATE INDEX IF NOT EXISTS idx_ax_survey_agent ON ax_survey_responses(agent_id);
      CREATE INDEX IF NOT EXISTS idx_ax_survey_submitted ON ax_survey_responses(submitted_at DESC);

      -- ============================================================
      -- Initiatives (Outcome Tracking - link tasks to goals)
      -- ============================================================

      -- Initiatives table (goals with success criteria and outcomes)
      CREATE TABLE IF NOT EXISTS initiatives (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        success_criteria TEXT, -- What does success look like?
        status TEXT NOT NULL CHECK(status IN ('active', 'succeeded', 'failed', 'pivoted', 'abandoned')) DEFAULT 'active',
        outcome_notes TEXT, -- What actually happened?
        outcome_recorded_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_initiatives_project ON initiatives(project_id);
      CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(status);
      CREATE INDEX IF NOT EXISTS idx_initiatives_created ON initiatives(created_at DESC);

      -- Task-Initiative links (many-to-many)
      CREATE TABLE IF NOT EXISTS task_initiatives (
        task_id TEXT NOT NULL,
        initiative_id TEXT NOT NULL,
        linked_at INTEGER NOT NULL,
        contribution_notes TEXT, -- How does this task contribute?
        PRIMARY KEY (task_id, initiative_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (initiative_id) REFERENCES initiatives(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_initiatives_task ON task_initiatives(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_initiatives_initiative ON task_initiatives(initiative_id);

      -- ============================================================
      -- Task Relationships (semantic links beyond blocking dependencies)
      -- ============================================================

      -- Task relationships table (semantic associations between tasks)
      CREATE TABLE IF NOT EXISTS task_relationships (
        id TEXT PRIMARY KEY,
        source_task_id TEXT NOT NULL,
        target_task_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL CHECK(relationship_type IN ('related_to', 'part_of', 'informed_by', 'supersedes', 'similar_to', 'duplicates')),
        description TEXT,
        confidence REAL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
        source TEXT CHECK(source IN ('manual', 'inferred', 'file_overlap', 'embedding')),
        created_at INTEGER NOT NULL,
        created_by TEXT,
        UNIQUE(source_task_id, target_task_id, relationship_type),
        FOREIGN KEY (source_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (target_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_rel_source ON task_relationships(source_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_rel_target ON task_relationships(target_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_rel_type ON task_relationships(relationship_type);
      CREATE INDEX IF NOT EXISTS idx_task_rel_created ON task_relationships(created_at DESC);

      -- ============================================================
      -- Configuration Tables (for hierarchy: Org → Team → Project → User → Session)
      -- ============================================================

      -- Organization-level configuration
      CREATE TABLE IF NOT EXISTS organization_config (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL UNIQUE,
        org_name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_org_config_org ON organization_config(org_id);

      -- Team-level configuration (inherits from org)
      CREATE TABLE IF NOT EXISTS team_config (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL UNIQUE,
        team_name TEXT NOT NULL,
        org_id TEXT,
        config_json TEXT NOT NULL,
        inherit_from_org INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_team_config_team ON team_config(team_id);
      CREATE INDEX IF NOT EXISTS idx_team_config_org ON team_config(org_id);

      -- Project-level configuration (from file or database, inherits from team)
      CREATE TABLE IF NOT EXISTS project_config (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE,
        team_id TEXT,
        config_json TEXT NOT NULL,
        config_source TEXT NOT NULL CHECK(config_source IN ('file', 'database', 'default')),
        config_file_path TEXT,
        config_file_hash TEXT,
        inherit_from_team INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        synced_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_project_config_project ON project_config(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_config_team ON project_config(team_id);

      -- User preferences (inherits from project)
      CREATE TABLE IF NOT EXISTS user_config (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT,
        config_json TEXT NOT NULL,
        inherit_from_project INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, project_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_config_user ON user_config(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_config_project ON user_config(project_id);

      -- Session runtime overrides (ephemeral)
      CREATE TABLE IF NOT EXISTS session_config (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        config_overrides TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_session_config_session ON session_config(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_config_expires ON session_config(expires_at);

      -- Configuration change audit log
      CREATE TABLE IF NOT EXISTS config_audit_log (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK(scope IN ('organization', 'team', 'project', 'user', 'session')),
        scope_id TEXT NOT NULL,
        change_type TEXT NOT NULL CHECK(change_type IN ('create', 'update', 'delete', 'sync', 'reset')),
        config_path TEXT,
        old_value TEXT,
        new_value TEXT,
        changed_by TEXT,
        changed_at INTEGER NOT NULL,
        reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_config_audit_scope ON config_audit_log(scope, scope_id);
      CREATE INDEX IF NOT EXISTS idx_config_audit_changed_at ON config_audit_log(changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_config_audit_changed_by ON config_audit_log(changed_by);

      -- ============================================================================
      -- Entity Hierarchy System (Wheelhaus foundation)
      -- ============================================================================

      -- Hierarchy definitions (vocabulary per project)
      CREATE TABLE IF NOT EXISTS hierarchy_definitions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        levels TEXT NOT NULL,  -- JSON array of HierarchyLevel
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchy_definitions_project ON hierarchy_definitions(project_id);

      -- Hierarchy nodes (entity instances in the hierarchy)
      CREATE TABLE IF NOT EXISTS hierarchy_nodes (
        id TEXT PRIMARY KEY,
        hierarchy_id TEXT NOT NULL,
        level_id TEXT NOT NULL,
        parent_node_id TEXT,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('task', 'artifact', 'decision', 'virtual')),
        entity_id TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata TEXT,  -- JSON
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (hierarchy_id) REFERENCES hierarchy_definitions(id),
        FOREIGN KEY (parent_node_id) REFERENCES hierarchy_nodes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_hierarchy_nodes_hierarchy ON hierarchy_nodes(hierarchy_id);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_nodes_level ON hierarchy_nodes(level_id);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_nodes_parent ON hierarchy_nodes(parent_node_id);
      CREATE INDEX IF NOT EXISTS idx_hierarchy_nodes_entity ON hierarchy_nodes(entity_type, entity_id);

      -- Source ingestion configurations
      CREATE TABLE IF NOT EXISTS source_configs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        config TEXT,  -- JSON
        auto_sync INTEGER NOT NULL DEFAULT 0,
        sync_interval_minutes INTEGER,
        last_ingested_at INTEGER,
        hierarchy_id TEXT,
        level_mappings TEXT,  -- JSON
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (hierarchy_id) REFERENCES hierarchy_definitions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_source_configs_project ON source_configs(project_id);

      -- Ingestion jobs (history of ingestion runs)
      CREATE TABLE IF NOT EXISTS ingestion_jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'parsing', 'reconciling', 'completed', 'failed')),
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        result TEXT,  -- JSON of IngestionResult
        reconciliation_result TEXT,  -- JSON of ReconciliationResult
        error TEXT,
        FOREIGN KEY (source_id) REFERENCES source_configs(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source ON ingestion_jobs(source_id);
      CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status);

      -- Ingestion snapshots (for incremental change detection)
      CREATE TABLE IF NOT EXISTS ingestion_snapshots (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        entity_hashes TEXT NOT NULL,  -- JSON Map<sourceId, hash>
        relationship_hashes TEXT NOT NULL,  -- JSON Map<key, hash>
        FOREIGN KEY (source_id) REFERENCES source_configs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_ingestion_snapshots_source ON ingestion_snapshots(source_id, timestamp DESC);

      -- ============================================================================
      -- Knowledge Entity System (Crystallization)
      -- ============================================================================

      -- Knowledge entities (crystallized knowledge from coordination flow)
      CREATE TABLE IF NOT EXISTS knowledge_entities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('principle', 'rationale', 'pattern', 'practice', 'example')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        parent_id TEXT,  -- Self-referential for hierarchy
        disposition TEXT NOT NULL DEFAULT 'draft' CHECK(disposition IN ('draft', 'proposed', 'approved', 'deferred', 'declined', 'superseded')),
        proposed_by TEXT,
        proposed_at INTEGER,
        approved_by TEXT,  -- JSON array of approvers
        approved_at INTEGER,
        review_due_date INTEGER,
        superseded_by_id TEXT,
        source_decision_ids TEXT,  -- JSON array
        source_artifact_ids TEXT,  -- JSON array
        source_task_ids TEXT,  -- JSON array
        source_chat_uris TEXT,  -- JSON array
        tags TEXT,  -- JSON array
        scope TEXT,  -- JSON KnowledgeScope
        applicable_file_patterns TEXT,  -- JSON array of glob patterns
        usage_count INTEGER DEFAULT 0,
        last_used_at INTEGER,
        effectiveness_score REAL,  -- 0.0 to 1.0
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_by TEXT,
        version INTEGER DEFAULT 1,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (parent_id) REFERENCES knowledge_entities(id),
        FOREIGN KEY (superseded_by_id) REFERENCES knowledge_entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_project ON knowledge_entities(project_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_type ON knowledge_entities(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_disposition ON knowledge_entities(disposition);
      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_parent ON knowledge_entities(parent_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_updated ON knowledge_entities(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_entities_effectiveness ON knowledge_entities(effectiveness_score DESC);

      -- Knowledge relationships (cross-entity links beyond hierarchy)
      CREATE TABLE IF NOT EXISTS knowledge_relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL CHECK(relationship_type IN ('supports', 'contradicts', 'extends', 'alternative', 'related')),
        description TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,  -- 0.0 to 1.0, manual=1.0
        created_at INTEGER NOT NULL,
        created_by TEXT,
        FOREIGN KEY (source_id) REFERENCES knowledge_entities(id),
        FOREIGN KEY (target_id) REFERENCES knowledge_entities(id)
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_source ON knowledge_relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_target ON knowledge_relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_type ON knowledge_relationships(relationship_type);

      -- ====================================================================
      -- Component Registry (BIM for Applications)
      -- ====================================================================

      -- Components: modules, services, APIs, UI components, databases, etc.
      CREATE TABLE IF NOT EXISTS components (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN (
          'module', 'service', 'component', 'api-endpoint', 'database',
          'config', 'test-suite', 'library', 'cli', 'worker', 'middleware'
        )),
        layer TEXT CHECK(layer IN (
          'core', 'adapter', 'ui', 'api', 'storage', 'infrastructure',
          'config', 'test', 'build', 'shared'
        )),
        description TEXT,
        file_patterns TEXT,      -- JSON array of glob patterns that define this component
        entry_point TEXT,        -- Primary file path
        metadata TEXT,           -- JSON: custom fields, tech stack, etc.
        health_score REAL,       -- 0.0 to 1.0, composite score
        last_activity INTEGER,   -- Timestamp of last detected activity
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE INDEX IF NOT EXISTS idx_components_project ON components(project_id);
      CREATE INDEX IF NOT EXISTS idx_components_type ON components(type);
      CREATE INDEX IF NOT EXISTS idx_components_layer ON components(layer);
      CREATE INDEX IF NOT EXISTS idx_components_health ON components(health_score ASC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_components_project_name ON components(project_id, name);

      -- Component relationships: depends-on, implements, tests, uses
      CREATE TABLE IF NOT EXISTS component_relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN (
          'depends-on', 'implements', 'extends', 'uses', 'tests',
          'configures', 'wraps', 'exposes'
        )),
        metadata TEXT,           -- JSON: import count, coupling strength, etc.
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES components(id),
        FOREIGN KEY (target_id) REFERENCES components(id)
      );

      CREATE INDEX IF NOT EXISTS idx_comp_rel_source ON component_relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_comp_rel_target ON component_relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_comp_rel_type ON component_relationships(type);

      -- Link decisions to the components they affect
      CREATE TABLE IF NOT EXISTS component_decisions (
        component_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        PRIMARY KEY (component_id, decision_id),
        FOREIGN KEY (component_id) REFERENCES components(id),
        FOREIGN KEY (decision_id) REFERENCES decisions(id)
      );

      -- Component health events: git activity, issues, test failures, hotspots
      CREATE TABLE IF NOT EXISTS component_health_events (
        id TEXT PRIMARY KEY,
        component_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN (
          'commit', 'pr_opened', 'pr_merged', 'issue_opened', 'issue_closed',
          'test_failure', 'hotspot_detected', 'quality_gate', 'churn_spike',
          'dependency_update', 'breaking_change'
        )),
        severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'error')) DEFAULT 'info',
        description TEXT,
        metadata TEXT,           -- JSON: commit hash, PR number, etc.
        source TEXT,             -- 'git', 'github', 'ci', 'manual', 'auto-detect'
        created_at INTEGER NOT NULL,
        FOREIGN KEY (component_id) REFERENCES components(id)
      );

      CREATE INDEX IF NOT EXISTS idx_comp_health_component ON component_health_events(component_id);
      CREATE INDEX IF NOT EXISTS idx_comp_health_type ON component_health_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_comp_health_severity ON component_health_events(severity);
      CREATE INDEX IF NOT EXISTS idx_comp_health_created ON component_health_events(created_at DESC);

      -- Project relationships: shared deps, same domain, related repos
      CREATE TABLE IF NOT EXISTS project_relationships (
        id TEXT PRIMARY KEY,
        source_project_id TEXT NOT NULL,
        target_project_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN (
          'depends-on', 'shared-component', 'same-domain', 'fork-of',
          'monorepo-sibling', 'api-consumer', 'api-provider'
        )),
        description TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_project_id) REFERENCES projects(id),
        FOREIGN KEY (target_project_id) REFERENCES projects(id)
      );

      CREATE INDEX IF NOT EXISTS idx_proj_rel_source ON project_relationships(source_project_id);
      CREATE INDEX IF NOT EXISTS idx_proj_rel_target ON project_relationships(target_project_id);
      CREATE INDEX IF NOT EXISTS idx_proj_rel_type ON project_relationships(type);

      -- Agent Registry
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        agent_version TEXT,
        capabilities TEXT, -- JSON array of AgentCapability strings
        strengths TEXT,    -- JSON array of strings
        limitations TEXT,  -- JSON array of strings
        mcp_version TEXT,
        client_info TEXT,
        max_concurrent_tasks INTEGER DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','busy')),
        last_seen_at INTEGER,
        metadata TEXT,     -- JSON object
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_agent_type ON agents(agent_type);

      -- Index on sessions.agent_id (was missing)
      CREATE INDEX IF NOT EXISTS idx_session_agent_id ON sessions(agent_id);
    `);

    // Run migrations for existing databases
    this.runMigrations();
  }

  private runMigrations(): void {
    // Check if project_id columns exist and add them if missing
    const tables = ['strategic_decisions', 'ux_requirements', 'technical_plans', 'tasks', 'sessions'];

    for (const table of tables) {
      try {
        const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
        const hasProjectId = columns.some(col => col.name === 'project_id');

        if (!hasProjectId) {
          console.error(`Migrating ${table}: adding project_id column`);
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'`);
          this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_project_id ON ${table}(project_id)`);
        }
      } catch (error) {
        console.error(`Migration check for ${table} failed:`, error);
      }
    }

    // Migrate metrics table to include new event types (context_fetch_minimal, context_fetch_full)
    this.migrateMetricsTable();

    // Migrate artifacts table to include knowledge lineage fields
    this.migrateArtifactsTable();

    // Migrate tasks table for checkpoint support
    this.migrateCheckpointsTable();

    // Migrate for collaborative task mode and contributions table
    this.migrateCollaborativeMode();

    // Create dispatch queue table
    this.migrateDispatchQueue();
    this.migrateTags();
    this.migrateActorTracking();
    this.migrateReferences();
    this.migrateDecisionDisposition();

    // Note: We no longer auto-create a default project.
    // Users must explicitly create or set a project.
  }

  private migrateMetricsTable(): void {
    try {
      // Check if metrics table has the old schema by trying to insert a test event
      // If it fails with CHECK constraint, we need to recreate the table
      const testStmt = this.db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='metrics'
      `);
      const tableInfo = testStmt.get() as { sql: string } | undefined;

      // Check if metrics table needs migration (missing new event types)
      const needsMigration = tableInfo?.sql &&
        (!tableInfo.sql.includes('context_fetch_minimal') || !tableInfo.sql.includes('task_reopened') || !tableInfo.sql.includes('learnings_surfaced') || !tableInfo.sql.includes('decisions_surfaced') || !tableInfo.sql.includes('quality_bypass'));

      if (needsMigration) {
        console.error('Migrating metrics table: adding new event types');

        // Wrap in transaction — if any step fails, the old table is preserved
        const migrateMetrics = this.db.transaction(() => {
          // Clean up any leftover metrics_old from a previous failed migration
          this.db.exec('DROP TABLE IF EXISTS metrics_old');

          // Rename old table
          this.db.exec('ALTER TABLE metrics RENAME TO metrics_old');

          // Create new table with updated CHECK constraint (including outcome analytics events)
          this.db.exec(`
            CREATE TABLE metrics (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER NOT NULL,
              event_type TEXT NOT NULL CHECK(event_type IN (
                'task_claimed', 'task_completed', 'task_abandoned',
                'context_expanded', 'session_started', 'session_ended',
                'tool_called', 'quality_gate_passed', 'quality_gate_failed',
                'context_fetch_minimal', 'context_fetch_full',
                'task_reopened', 'session_feedback', 'context_repeated',
                'quality_bypass', 'learnings_surfaced', 'decisions_surfaced'
              )),
              project_id TEXT NOT NULL DEFAULT 'default',
              task_id TEXT,
              session_id TEXT,
              metadata TEXT
            )
          `);

          // Copy data from old table
          this.db.exec(`
            INSERT INTO metrics (id, timestamp, event_type, project_id, task_id, session_id, metadata)
            SELECT id, timestamp, event_type, project_id, task_id, session_id, metadata
            FROM metrics_old
          `);

          // Drop old table
          this.db.exec('DROP TABLE metrics_old');

          // Recreate indexes
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_event_type ON metrics(event_type)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_project ON metrics(project_id)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_task ON metrics(task_id)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_session ON metrics(session_id)');
        });

        migrateMetrics();
        console.error('Metrics table migration complete');
      }

      // Always ensure composite indexes exist (for performance optimization)
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_project_timestamp ON metrics(project_id, timestamp DESC)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_project_time_type ON metrics(project_id, timestamp, event_type)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_metrics_task_type ON metrics(task_id, event_type, timestamp)');
    } catch (error) {
      console.error('Metrics table migration failed:', error);
    }
  }

  private migrateArtifactsTable(): void {
    try {
      // Check if artifacts table has the new knowledge lineage columns
      const columns = this.db.pragma('table_info(artifacts)') as Array<{ name: string }>;
      const columnNames = new Set(columns.map(col => col.name));

      // Add origin_chat_uri column if missing
      if (!columnNames.has('origin_chat_uri')) {
        console.error('Migrating artifacts table: adding origin_chat_uri column');
        this.db.exec('ALTER TABLE artifacts ADD COLUMN origin_chat_uri TEXT');
      }

      // Add evolution_history column if missing
      if (!columnNames.has('evolution_history')) {
        console.error('Migrating artifacts table: adding evolution_history column');
        this.db.exec('ALTER TABLE artifacts ADD COLUMN evolution_history TEXT');
      }

      // Add parent_artifact_id column if missing
      if (!columnNames.has('parent_artifact_id')) {
        console.error('Migrating artifacts table: adding parent_artifact_id column');
        this.db.exec('ALTER TABLE artifacts ADD COLUMN parent_artifact_id TEXT');
      }

      // Add content storage columns if missing
      if (!columnNames.has('content')) {
        console.error('Migrating artifacts table: adding content column');
        this.db.exec('ALTER TABLE artifacts ADD COLUMN content TEXT');
      }
      if (!columnNames.has('content_type')) {
        console.error('Migrating artifacts table: adding content_type column');
        this.db.exec('ALTER TABLE artifacts ADD COLUMN content_type TEXT');
      }
      if (!columnNames.has('content_size')) {
        console.error('Migrating artifacts table: adding content_size column');
        this.db.exec('ALTER TABLE artifacts ADD COLUMN content_size INTEGER');
      }

      // Add index for finding children of an artifact
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts(parent_artifact_id)');

    } catch (error) {
      console.error('Artifacts table migration failed:', error);
    }
  }

  private migrateCheckpointsTable(): void {
    try {
      // Check if tasks table has checkpoint columns
      const taskColumns = this.db.pragma('table_info(tasks)') as Array<{ name: string }>;
      const taskColumnNames = new Set(taskColumns.map(col => col.name));

      // Add type column if missing (TaskType for quality gate variance)
      if (!taskColumnNames.has('type')) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN type TEXT');
      }

      // Add checkpoint_phases column if missing
      if (!taskColumnNames.has('checkpoint_phases')) {
        console.error('Migrating tasks table: adding checkpoint_phases column');
        this.db.exec('ALTER TABLE tasks ADD COLUMN checkpoint_phases TEXT');
      }

      // Add active_checkpoint_id column if missing
      if (!taskColumnNames.has('active_checkpoint_id')) {
        console.error('Migrating tasks table: adding active_checkpoint_id column');
        this.db.exec('ALTER TABLE tasks ADD COLUMN active_checkpoint_id TEXT');
      }

      // Create checkpoints table if it doesn't exist
      const checkpointTableExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='checkpoints'"
      ).get();

      if (!checkpointTableExists) {
        console.error('Creating checkpoints table');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS checkpoints (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('phase-gate','decision-required','review-required','approval-required')),
            status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','timed-out')),
            phase INTEGER,
            reason TEXT NOT NULL,
            question TEXT,
            options TEXT,
            context TEXT,
            requested_by TEXT NOT NULL,
            requested_at INTEGER NOT NULL,
            responded_by TEXT,
            responded_at INTEGER,
            response TEXT,
            selected_option TEXT,
            decision TEXT CHECK(decision IN ('approve','reject','redirect')),
            timeout_minutes INTEGER,
            escalate_to TEXT,
            escalated_at INTEGER,
            FOREIGN KEY (task_id) REFERENCES tasks(id)
          )
        `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoint_task_id ON checkpoints(task_id)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoint_project_id ON checkpoints(project_id)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoint_status ON checkpoints(status)');
      }

      // Add scope_json column to decisions table if missing
      const decisionColumns = this.db.pragma('table_info(decisions)') as Array<{ name: string }>;
      const decisionColumnNames = new Set(decisionColumns.map(col => col.name));
      if (!decisionColumnNames.has('scope_json')) {
        this.db.exec('ALTER TABLE decisions ADD COLUMN scope_json TEXT');
      }

    } catch (error) {
      console.error('Checkpoints table migration failed:', error);
    }
  }

  private migrateCollaborativeMode(): void {
    try {
      // Add mode column to tasks if missing
      const taskColumns = this.db.pragma('table_info(tasks)') as Array<{ name: string }>;
      const taskColumnNames = new Set(taskColumns.map(col => col.name));

      if (!taskColumnNames.has('mode')) {
        console.error('Migrating tasks table: adding mode column');
        this.db.exec("ALTER TABLE tasks ADD COLUMN mode TEXT DEFAULT 'exclusive'");
      }

      // Create contributions table if it doesn't exist
      const contributionsTableExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='contributions'"
      ).get();

      if (!contributionsTableExists) {
        console.error('Creating contributions table');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS contributions (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            role TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('opinion','analysis','review','suggestion','decision','other')),
            content TEXT NOT NULL,
            metadata TEXT,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_contribution_task ON contributions(task_id);
          CREATE INDEX IF NOT EXISTS idx_contribution_agent ON contributions(agent_id);
        `);
      }
    } catch (error) {
      console.error('Collaborative mode migration failed:', error);
    }
  }

  private migrateDispatchQueue(): void {
    try {
      const dispatchTableExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='dispatches'"
      ).get();

      if (!dispatchTableExists) {
        console.error('Creating dispatches table');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS dispatches (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            target_agent TEXT NOT NULL,
            dispatched_by TEXT NOT NULL,
            priority_override TEXT,
            context TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending','claimed','recalled','expired')),
            claimed_at INTEGER,
            created_at INTEGER NOT NULL,
            expires_at INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_dispatch_target_status ON dispatches(target_agent, status);
          CREATE INDEX IF NOT EXISTS idx_dispatch_task ON dispatches(task_id);
        `);
      }
    } catch (error) {
      console.error('Dispatch queue migration failed:', error);
    }
  }

  private migrateTags(): void {
    try {
      const columns = this.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
      const hasTagsColumn = columns.some(c => c.name === 'tags');
      if (!hasTagsColumn) {
        console.error('Migrating tasks table: adding tags column');
        this.db.exec('ALTER TABLE tasks ADD COLUMN tags TEXT');
      }
    } catch (error) {
      console.error('Tags migration failed:', error);
    }
  }

  private migrateActorTracking(): void {
    try {
      const columns = this.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
      const hasLastModifiedBy = columns.some(c => c.name === 'last_modified_by');
      if (!hasLastModifiedBy) {
        if (process.stderr.isTTY) {
          console.error('Migrating tasks table: adding last_modified_by column');
        }
        this.db.exec('ALTER TABLE tasks ADD COLUMN last_modified_by TEXT');
      }

      const hasVersion = columns.some(c => c.name === 'version');
      if (!hasVersion) {
        if (process.stderr.isTTY) {
          console.error('Migrating tasks table: adding version column');
        }
        this.db.exec('ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
      }
    } catch (error) {
      console.error('Actor tracking migration failed:', error);
    }
  }

  private migrateReferences(): void {
    try {
      const taskCols = this.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
      if (!taskCols.some(c => c.name === 'references')) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN "references" TEXT');
      }

      const decisionCols = this.db.prepare('PRAGMA table_info(decisions)').all() as Array<{ name: string }>;
      if (!decisionCols.some(c => c.name === 'references')) {
        this.db.exec('ALTER TABLE decisions ADD COLUMN "references" TEXT');
      }
    } catch (error) {
      console.error('References migration failed:', error);
    }
  }

  private migrateDecisionDisposition(): void {
    try {
      const cols = this.db.prepare('PRAGMA table_info(decisions)').all() as Array<{ name: string }>;
      if (!cols.some(c => c.name === 'disposition')) {
        this.db.exec("ALTER TABLE decisions ADD COLUMN disposition TEXT DEFAULT 'approved'");
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_disposition ON decisions(disposition)');
      }

      // Migrate category CHECK to include 'thought' — recreate table if needed
      const tableInfo = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='decisions'").get() as { sql: string } | undefined;
      if (tableInfo?.sql && !tableInfo.sql.includes("'thought'")) {
        const migrateDecisions = this.db.transaction(() => {
          this.db.exec('DROP TABLE IF EXISTS decisions_old');
          this.db.exec('ALTER TABLE decisions RENAME TO decisions_old');
          this.db.exec(`
            CREATE TABLE decisions (
              id TEXT PRIMARY KEY,
              decision TEXT NOT NULL,
              rationale TEXT,
              impact TEXT,
              category TEXT CHECK(category IN ('architecture', 'tradeoff', 'dependency', 'pattern', 'other', 'thought')),
              task_id TEXT,
              project_id TEXT NOT NULL DEFAULT 'default',
              created_at INTEGER NOT NULL,
              created_by TEXT,
              scope_json TEXT,
              "references" TEXT,
              disposition TEXT DEFAULT 'approved'
            )
          `);
          this.db.exec(`
            INSERT INTO decisions (id, decision, rationale, impact, category, task_id, project_id, created_at, created_by, scope_json, "references", disposition)
            SELECT id, decision, rationale, impact, category, task_id, project_id, created_at, created_by, scope_json, "references", COALESCE(disposition, 'approved')
            FROM decisions_old
          `);
          this.db.exec('DROP TABLE decisions_old');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task_id)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_created ON decisions(created_at DESC)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category)');
          this.db.exec('CREATE INDEX IF NOT EXISTS idx_decisions_disposition ON decisions(disposition)');
        });
        migrateDecisions();
        console.error('Decisions table migration complete (added thought category + disposition)');
      }
    } catch (error) {
      console.error('Decision disposition migration failed:', error);
    }
  }

  private ensureDefaultProject(): void {
    const stmt = this.db.prepare('SELECT id FROM projects WHERE id = ?');
    const existing = stmt.get('default');

    if (!existing) {
      const now = Date.now();
      const insertStmt = this.db.prepare(`
        INSERT INTO projects (id, name, slug, description, status, root_path, domain, tech_stack, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        'default',
        'Default Project',
        'default',
        'Default project for migrated data',
        'active',
        process.cwd(),
        'other',
        JSON.stringify([]),
        JSON.stringify({}),
        now,
        now
      );
      console.error('Created default project for migration');
    }
  }

  // ========================================================================
  // Project Management
  // ========================================================================

  async createProject(project: Project): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO projects
        (id, name, slug, description, status, root_path, domain, tech_stack, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      project.id,
      project.name,
      project.slug,
      project.description || null,
      project.status,
      project.rootPath,
      project.domain,
      JSON.stringify(project.techStack || []),
      JSON.stringify(project.metadata || {}),
      project.createdAt.getTime(),
      project.updatedAt.getTime()
    );
  }

  async getProject(id: string): Promise<Project | null> {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(id) as ProjectRow | undefined;

    if (!row) return null;
    return this.deserializeProject(row);
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE slug = ?');
    const row = stmt.get(slug) as ProjectRow | undefined;

    if (!row) return null;
    return this.deserializeProject(row);
  }

  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    let query = 'SELECT * FROM projects';
    const params: any[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY name ASC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as ProjectRow[];

    return rows.map(row => this.deserializeProject(row));
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    const updatedProject = { ...project, ...updates, updatedAt: new Date() };

    const stmt = this.db.prepare(`
      UPDATE projects
      SET name = ?, slug = ?, description = ?, status = ?, root_path = ?,
          domain = ?, tech_stack = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updatedProject.name,
      updatedProject.slug,
      updatedProject.description || null,
      updatedProject.status,
      updatedProject.rootPath,
      updatedProject.domain,
      JSON.stringify(updatedProject.techStack || []),
      JSON.stringify(updatedProject.metadata || {}),
      updatedProject.updatedAt.getTime(),
      id
    );
  }

  async deleteProject(id: string): Promise<void> {
    // Check if this is the active project
    const activeId = await this.getActiveProjectId();
    if (activeId === id) {
      throw new Error('Cannot delete the active project. Set a different project as active first.');
    }

    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
  }

  private deserializeProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description || undefined,
      status: row.status as ProjectStatus,
      rootPath: row.root_path,
      domain: row.domain as Project['domain'],
      techStack: safeJsonParse(row.tech_stack, []),
      metadata: safeJsonParse(row.metadata, {}),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // Active project management
  async getActiveProjectId(): Promise<string | null> {
    const stmt = this.db.prepare('SELECT project_id FROM active_project WHERE id = 1');
    const row = stmt.get() as { project_id: string } | undefined;
    return row?.project_id || null;
  }

  /**
   * Synchronous helper to get active project ID for query scoping.
   * Throws if no project is set - users must explicitly set a project.
   */
  getActiveProjectIdOrDefault(): string {
    const stmt = this.db.prepare('SELECT project_id FROM active_project LIMIT 1');
    const row = stmt.get() as { project_id: string } | undefined;
    if (!row?.project_id) {
      throw new Error('No active project. Run `enginehaus project init` or `enginehaus project active <slug>` first.');
    }
    return row.project_id;
  }

  async setActiveProjectId(projectId: string): Promise<void> {
    // Verify project exists
    const project = await this.getProject(projectId);
    if (!project) {
      // Try by slug
      const projectBySlug = await this.getProjectBySlug(projectId);
      if (!projectBySlug) {
        throw new Error(`Project not found: ${projectId}`);
      }
      projectId = projectBySlug.id;
    }

    const stmt = this.db.prepare('UPDATE active_project SET project_id = ? WHERE id = 1');
    stmt.run(projectId);
    this.activeProjectId = projectId;
  }

  async getActiveProject(): Promise<Project | null> {
    const projectId = await this.getActiveProjectId();
    if (!projectId) return null;
    return this.getProject(projectId);
  }

  // ========================================================================
  // Strategic Decisions
  // ========================================================================

  async saveStrategicDecision(decision: StrategicDecision): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO strategic_decisions
        (id, project_id, decision, rationale, impact, timeline, stakeholders, requirements, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      decision.id,
      decision.projectId,
      decision.decision,
      decision.rationale,
      decision.impact,
      decision.timeline,
      JSON.stringify(decision.stakeholders),
      JSON.stringify(decision.requirements || null),
      decision.createdAt.getTime(),
      decision.createdBy || null
    );
  }

  async getStrategicDecision(id: string): Promise<StrategicDecision | null> {
    const stmt = this.db.prepare('SELECT * FROM strategic_decisions WHERE id = ?');
    const row = stmt.get(id) as StrategicDecisionRow | undefined;

    if (!row) return null;

    return this.deserializeStrategicDecision(row);
  }

  async getRecentStrategicDecisions(limit: number, projectId?: string): Promise<StrategicDecision[]> {
    const activeProjectId = projectId || this.getActiveProjectIdOrDefault();
    const stmt = this.db.prepare(`
      SELECT * FROM strategic_decisions
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(activeProjectId, limit) as StrategicDecisionRow[];

    return rows.map(row => this.deserializeStrategicDecision(row));
  }

  private deserializeStrategicDecision(row: StrategicDecisionRow): StrategicDecision {
    return {
      id: row.id,
      projectId: row.project_id || 'default',
      decision: row.decision,
      rationale: row.rationale,
      impact: row.impact,
      timeline: row.timeline,
      stakeholders: safeJsonParse(row.stakeholders, []),
      requirements: safeJsonParse(row.requirements, undefined),
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
    };
  }

  // ========================================================================
  // UX Requirements
  // ========================================================================

  async saveUXRequirements(requirements: UXRequirements): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ux_requirements
        (id, project_id, feature, user_experience, design_pattern, progressive_disclosure,
         technical_constraints, response_to, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      requirements.id,
      requirements.projectId,
      requirements.feature,
      requirements.userExperience,
      requirements.designPattern,
      requirements.progressiveDisclosure || null,
      requirements.technicalConstraints || null,
      requirements.responseTo || null,
      requirements.createdAt.getTime(),
      requirements.createdBy || null
    );
  }

  async getUXRequirements(id: string): Promise<UXRequirements | null> {
    const stmt = this.db.prepare('SELECT * FROM ux_requirements WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.deserializeUXRequirements(row);
  }

  async getRecentUXRequirements(limit: number, projectId?: string): Promise<UXRequirements[]> {
    const activeProjectId = projectId || this.getActiveProjectIdOrDefault();
    const stmt = this.db.prepare(`
      SELECT * FROM ux_requirements
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(activeProjectId, limit) as any[];

    return rows.map(row => this.deserializeUXRequirements(row));
  }

  private deserializeUXRequirements(row: any): UXRequirements {
    return {
      id: row.id,
      projectId: row.project_id || 'default',
      feature: row.feature,
      userExperience: row.user_experience,
      designPattern: row.design_pattern,
      progressiveDisclosure: row.progressive_disclosure || undefined,
      technicalConstraints: row.technical_constraints || undefined,
      responseTo: row.response_to || undefined,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
    };
  }

  // ========================================================================
  // Technical Plans
  // ========================================================================

  async saveTechnicalPlan(plan: TechnicalPlan): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO technical_plans
        (id, project_id, feature, strategic_context, ux_context, technical_approach, architecture,
         estimated_effort, files, quality_gates, unified_tasks, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      plan.id,
      plan.projectId,
      plan.feature,
      plan.strategicContext || null,
      plan.uxContext || null,
      plan.technicalApproach,
      plan.architecture || null,
      plan.estimatedEffort || null,
      JSON.stringify(plan.files || []),
      JSON.stringify(plan.qualityGates || []),
      JSON.stringify(plan.unifiedTasks || []),
      plan.createdAt.getTime(),
      plan.createdBy || null
    );
  }

  async getTechnicalPlan(id: string): Promise<TechnicalPlan | null> {
    const stmt = this.db.prepare('SELECT * FROM technical_plans WHERE id = ?');
    const row = stmt.get(id) as TechnicalPlanRow | undefined;

    if (!row) return null;

    return this.deserializeTechnicalPlan(row);
  }

  async getRecentTechnicalPlans(limit: number, projectId?: string): Promise<TechnicalPlan[]> {
    const activeProjectId = projectId || this.getActiveProjectIdOrDefault();
    const stmt = this.db.prepare(`
      SELECT * FROM technical_plans
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(activeProjectId, limit) as TechnicalPlanRow[];

    return rows.map(row => this.deserializeTechnicalPlan(row));
  }

  private deserializeTechnicalPlan(row: TechnicalPlanRow): TechnicalPlan {
    return {
      id: row.id,
      projectId: row.project_id || 'default',
      feature: row.feature,
      strategicContext: row.strategic_context || undefined,
      uxContext: row.ux_context || undefined,
      technicalApproach: row.technical_approach,
      architecture: row.architecture || undefined,
      estimatedEffort: row.estimated_effort || undefined,
      files: safeJsonParse(row.files, []),
      qualityGates: safeJsonParse(row.quality_gates, []),
      unifiedTasks: safeJsonParse(row.unified_tasks, []),
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
    };
  }

  // ========================================================================
  // Tasks
  // ========================================================================

  async saveTask(task: UnifiedTask): Promise<void> {
    // Check if the task already exists — use UPDATE to avoid triggering
    // ON DELETE CASCADE which silently destroys artifacts, relationships,
    // dependencies, and initiative links.
    const exists = this.db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(task.id);

    if (exists) {
      const stmt = this.db.prepare(`
        UPDATE tasks SET
          project_id = ?, title = ?, description = ?, priority = ?, status = ?,
          type = ?, mode = ?, tags = ?, files = ?, strategic_context = ?, ux_context = ?,
          technical_context = ?, quality_requirements = ?, implementation = ?,
          checkpoint_phases = ?, active_checkpoint_id = ?, "references" = ?,
          created_at = ?, updated_at = ?, created_by = ?, assigned_to = ?,
          last_modified_by = ?, version = version + 1
        WHERE id = ?
      `);
      stmt.run(
        task.projectId,
        task.title,
        task.description,
        task.priority,
        task.status,
        task.type || null,
        task.mode || 'exclusive',
        task.tags && task.tags.length > 0 ? JSON.stringify(task.tags) : null,
        JSON.stringify(task.files || []),
        JSON.stringify(task.strategicContext || null),
        JSON.stringify(task.uxContext || null),
        JSON.stringify(task.technicalContext || null),
        JSON.stringify(task.qualityRequirements || []),
        JSON.stringify(task.implementation || null),
        JSON.stringify(task.checkpointPhases || null),
        task.activeCheckpoint?.id || null,
        task.references && task.references.length > 0 ? JSON.stringify(task.references) : null,
        task.createdAt.getTime(),
        task.updatedAt.getTime(),
        task.createdBy || null,
        task.assignedTo || null,
        task.lastModifiedBy || null,
        task.id
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO tasks
          (id, project_id, title, description, priority, status, type, mode, tags, files, strategic_context, ux_context,
           technical_context, quality_requirements, implementation, checkpoint_phases, active_checkpoint_id, "references",
           created_at, updated_at, created_by, assigned_to, last_modified_by, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      stmt.run(
        task.id,
        task.projectId,
        task.title,
        task.description,
        task.priority,
        task.status,
        task.type || null,
        task.mode || 'exclusive',
        task.tags && task.tags.length > 0 ? JSON.stringify(task.tags) : null,
        JSON.stringify(task.files || []),
        JSON.stringify(task.strategicContext || null),
        JSON.stringify(task.uxContext || null),
        JSON.stringify(task.technicalContext || null),
        JSON.stringify(task.qualityRequirements || []),
        JSON.stringify(task.implementation || null),
        JSON.stringify(task.checkpointPhases || null),
        task.activeCheckpoint?.id || null,
        task.references && task.references.length > 0 ? JSON.stringify(task.references) : null,
        task.createdAt.getTime(),
        task.updatedAt.getTime(),
        task.createdBy || null,
        task.assignedTo || null,
        task.lastModifiedBy || null
      );
    }
  }

  /**
   * Update a task with partial updates
   */
  // Valid status transitions — completed is terminal
  private static readonly VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
    'ready': ['in-progress', 'blocked', 'completed'],
    'in-progress': ['completed', 'ready', 'blocked', 'awaiting-human'],
    'blocked': ['ready', 'in-progress'],
    'awaiting-human': ['in-progress', 'ready'],
    'completed': [], // terminal — no transitions out
  };

  async updateTask(id: string, updates: Partial<UnifiedTask>): Promise<void> {
    const existing = await this.getTask(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    // Validate status transitions
    if (updates.status && updates.status !== existing.status) {
      const allowed = SQLiteStorageService.VALID_STATUS_TRANSITIONS[existing.status];
      if (allowed && !allowed.includes(updates.status)) {
        throw new Error(
          `Invalid status transition: ${existing.status} → ${updates.status}. ` +
          `Allowed: ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'}`
        );
      }
    }

    const updated: UnifiedTask = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    await this.saveTask(updated);
  }

  async deleteTask(id: string): Promise<void> {
    // Delete dependencies first
    const depStmt = this.db.prepare('DELETE FROM task_dependencies WHERE blocker_task_id = ? OR blocked_task_id = ?');
    depStmt.run(id, id);

    // Delete the task
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    stmt.run(id);
  }

  async getTask(id: string): Promise<UnifiedTask | null> {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as TaskRow | undefined;

    if (!row) return null;

    return this.deserializeTask(row);
  }

  async getTasks(filter: {
    status?: TaskStatus;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    projectId?: string;
    tags?: string[];
  }): Promise<UnifiedTask[]> {
    // Filter by active project unless explicitly specified
    const projectId = filter.projectId || this.getActiveProjectIdOrDefault();
    let query = 'SELECT * FROM tasks WHERE project_id = ?';
    const params: any[] = [projectId];

    if (filter.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }

    if (filter.priority) {
      query += ' AND priority = ?';
      params.push(filter.priority);
    }

    if (filter.tags && filter.tags.length > 0) {
      // Match tasks that have ANY of the specified tags (OR semantics)
      const tagConditions = filter.tags.map(() => "tags LIKE ?");
      query += ` AND tags IS NOT NULL AND (${tagConditions.join(' OR ')})`;
      for (const tag of filter.tags) {
        params.push(`%"${tag}"%`);
      }
    }

    // Sort by priority and creation date
    query += ' ORDER BY CASE priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, created_at ASC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as TaskRow[];

    return rows.map(row => this.deserializeTask(row));
  }

  async searchTasks(query: string, options?: {
    projectId?: string;
    status?: TaskStatus;
    limit?: number;
  }): Promise<UnifiedTask[]> {
    const projectId = options?.projectId || this.getActiveProjectIdOrDefault();

    // Tokenize query: split on whitespace, each token must match at least one field
    const tokens = query.trim().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return [];

    // Each token must appear in title, description, OR tags
    const tokenClauses = tokens.map(() =>
      '(title LIKE ? OR description LIKE ? OR tags LIKE ?)'
    );

    let sql = `SELECT * FROM tasks WHERE project_id = ? AND ${tokenClauses.join(' AND ')}`;
    const params: any[] = [projectId];
    for (const token of tokens) {
      const pattern = `%${token}%`;
      params.push(pattern, pattern, pattern); // title, description, tags
    }

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    sql += " ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC";

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TaskRow[];
    return rows.map(row => this.deserializeTask(row));
  }

  async getTasksCompletedSince(since: Date): Promise<UnifiedTask[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'completed'
        AND json_extract(implementation, '$.completedAt') >= ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(since.getTime()) as TaskRow[];
    return rows.map(row => this.deserializeTask(row));
  }

  private deserializeTask(row: TaskRow): UnifiedTask {
    const strategicContext = safeJsonParse<any>(row.strategic_context, undefined);
    const uxContext = safeJsonParse<any>(row.ux_context, undefined);
    const technicalContext = safeJsonParse<any>(row.technical_context, undefined);
    const implementation = safeJsonParse<any>(row.implementation, undefined);

    // Convert date strings in implementation back to Date objects
    if (implementation) {
      if (implementation.startedAt) {
        implementation.startedAt = new Date(implementation.startedAt);
      }
      if (implementation.completedAt) {
        implementation.completedAt = new Date(implementation.completedAt);
      }
    }

    // Load task dependencies
    const blockedBy = this.getBlockingTasks(row.id);
    const blocks = this.getBlockedTasks(row.id);

    return {
      id: row.id,
      projectId: row.project_id || 'default',
      title: row.title,
      description: row.description,
      priority: row.priority as TaskPriority,
      status: row.status as TaskStatus,
      type: (row.type || undefined) as TaskType | undefined,
      mode: (row.mode || 'exclusive') as import('../coordination/types.js').TaskMode,
      tags: safeJsonParse(row.tags, undefined) || undefined,
      files: safeJsonParse(row.files, []),
      strategicContext,
      uxContext,
      technicalContext,
      qualityRequirements: safeJsonParse(row.quality_requirements, []),
      implementation,
      blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      blocks: blocks.length > 0 ? blocks : undefined,
      checkpointPhases: safeJsonParse(row.checkpoint_phases, undefined) || undefined,
      references: safeJsonParse(row.references, undefined) || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      createdBy: row.created_by || undefined,
      assignedTo: row.assigned_to || undefined,
      lastModifiedBy: row.last_modified_by || undefined,
      version: row.version ?? 1,
    };
  }

  /**
   * Get task IDs that block the given task
   */
  getBlockingTasks(taskId: string): string[] {
    const stmt = this.db.prepare(
      'SELECT blocker_task_id FROM task_dependencies WHERE blocked_task_id = ?'
    );
    const rows = stmt.all(taskId) as Array<{ blocker_task_id: string }>;
    return rows.map(r => r.blocker_task_id);
  }

  /**
   * Get task IDs that are blocked by the given task
   */
  getBlockedTasks(taskId: string): string[] {
    const stmt = this.db.prepare(
      'SELECT blocked_task_id FROM task_dependencies WHERE blocker_task_id = ?'
    );
    const rows = stmt.all(taskId) as Array<{ blocked_task_id: string }>;
    return rows.map(r => r.blocked_task_id);
  }

  /**
   * Unblock tasks when a blocker task is completed.
   * For each task blocked by the completed task:
   * - Check if all other blockers are also complete
   * - If no incomplete blockers remain, change status from 'blocked' to 'ready'
   * Returns list of task IDs that were unblocked
   */
  async unblockDependentTasks(completedTaskId: string): Promise<string[]> {
    const unblocked: string[] = [];
    const blockedTaskIds = this.getBlockedTasks(completedTaskId);

    for (const blockedId of blockedTaskIds) {
      const blockedTask = await this.getTask(blockedId);
      if (!blockedTask || blockedTask.status !== 'blocked') {
        continue;
      }

      // Get all blockers for this task
      const allBlockers = this.getBlockingTasks(blockedId);

      // Check if any blockers are still incomplete
      let hasIncompleteBlocker = false;
      for (const blockerId of allBlockers) {
        const blocker = await this.getTask(blockerId);
        if (blocker && blocker.status !== 'completed') {
          hasIncompleteBlocker = true;
          break;
        }
      }

      // If no incomplete blockers, unblock the task
      if (!hasIncompleteBlocker) {
        await this.updateTask(blockedId, { status: 'ready' });
        unblocked.push(blockedId);
      }
    }

    return unblocked;
  }

  // ========================================================================
  // Sessions
  // ========================================================================

  /**
   * Atomically check for existing session and create a new one.
   * Uses a transaction to prevent race conditions in concurrent claims.
   * Returns the existing session if one blocks the claim, or null on success.
   */
  claimSessionAtomic(session: CoordinationSession): { conflict: CoordinationSession | null; existingSessionId?: string } {
    const txn = this.db.transaction(() => {
      // Check for existing active session on this task
      const existingRow = this.db.prepare(
        'SELECT * FROM sessions WHERE task_id = ? AND status = \'active\' ORDER BY last_heartbeat DESC LIMIT 1'
      ).get(session.taskId) as SessionRow | undefined;

      if (existingRow && existingRow.agent_id !== session.agentId) {
        return { conflict: this.deserializeSession(existingRow) };
      }

      // Same agent — refresh heartbeat on existing session
      if (existingRow && existingRow.agent_id === session.agentId) {
        this.db.prepare('UPDATE sessions SET last_heartbeat = ? WHERE id = ?')
          .run(Date.now(), existingRow.id);
        return { conflict: null, existingSessionId: existingRow.id };
      }

      // No conflict — create the session
      this.db.prepare(`
        INSERT OR REPLACE INTO sessions
          (id, project_id, task_id, agent_id, status, start_time, end_time, last_heartbeat, current_phase, context)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id, session.projectId, session.taskId, session.agentId,
        session.status, session.startTime.getTime(),
        session.endTime ? session.endTime.getTime() : null,
        session.lastHeartbeat.getTime(), session.currentPhase || null,
        JSON.stringify(session.context)
      );

      return { conflict: null };
    });

    return txn();
  }

  async saveSession(session: CoordinationSession): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, project_id, task_id, agent_id, status, start_time, end_time, last_heartbeat, current_phase, context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.projectId,
      session.taskId,
      session.agentId,
      session.status,
      session.startTime.getTime(),
      session.endTime ? session.endTime.getTime() : null,
      session.lastHeartbeat.getTime(),
      session.currentPhase || null,
      JSON.stringify(session.context)
    );
  }

  async getSession(id: string): Promise<CoordinationSession | null> {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | undefined;

    if (!row) return null;

    return this.deserializeSession(row);
  }

  async getActiveSessions(projectId?: string): Promise<CoordinationSession[]> {
    const activeProjectId = projectId || this.getActiveProjectIdOrDefault();
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE status = \'active\' AND project_id = ?');
    const rows = stmt.all(activeProjectId) as SessionRow[];

    return rows.map(row => this.deserializeSession(row));
  }

  /**
   * Get all sessions (including completed, expired) with optional filters
   */
  async getAllSessions(options: {
    projectId?: string;
    status?: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<CoordinationSession[]> {
    let query = 'SELECT * FROM sessions WHERE 1=1';
    const params: unknown[] = [];

    if (options.projectId) {
      query += ' AND project_id = ?';
      params.push(options.projectId);
    }

    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    if (options.agentId) {
      query += ' AND agent_id = ?';
      params.push(options.agentId);
    }

    query += ' ORDER BY start_time DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as SessionRow[];

    return rows.map(row => this.deserializeSession(row));
  }

  private deserializeSession(row: SessionRow): CoordinationSession {
    const context = safeJsonParse(row.context, {} as any);

    // Deserialize dates in context
    if (context.currentTask) {
      context.currentTask.createdAt = new Date(context.currentTask.createdAt);
      context.currentTask.updatedAt = new Date(context.currentTask.updatedAt);
      if (context.currentTask.implementation) {
        if (context.currentTask.implementation.startedAt) {
          context.currentTask.implementation.startedAt = new Date(context.currentTask.implementation.startedAt);
        }
        if (context.currentTask.implementation.completedAt) {
          context.currentTask.implementation.completedAt = new Date(context.currentTask.implementation.completedAt);
        }
      }
    }

    context.recentDecisions = context.recentDecisions.map((d: any) => ({
      ...d,
      createdAt: new Date(d.createdAt),
    }));

    context.recentUXRequirements = context.recentUXRequirements.map((r: any) => ({
      ...r,
      createdAt: new Date(r.createdAt),
    }));

    context.recentTechnicalPlans = context.recentTechnicalPlans.map((p: any) => ({
      ...p,
      createdAt: new Date(p.createdAt),
    }));

    context.activeTasks = context.activeTasks.map((t: any) => ({
      ...t,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
    }));

    context.readyTasks = context.readyTasks.map((t: any) => ({
      ...t,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
    }));

    return {
      id: row.id,
      projectId: row.project_id || 'default',
      taskId: row.task_id,
      agentId: row.agent_id,
      status: row.status as SessionStatus,
      startTime: new Date(row.start_time),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      lastHeartbeat: new Date(row.last_heartbeat),
      currentPhase: row.current_phase || undefined,
      context,
    };
  }

  /**
   * Get active session for a specific task (for conflict detection)
   */
  async getActiveSessionForTask(taskId: string): Promise<CoordinationSession | null> {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE task_id = ? AND status = \'active\' ORDER BY last_heartbeat DESC LIMIT 1'
    );
    const row = stmt.get(taskId) as SessionRow | undefined;

    if (!row) return null;

    return this.deserializeSession(row);
  }

  /**
   * Get all active sessions for an agent
   */
  async getActiveSessionsForAgent(agentId: string): Promise<CoordinationSession[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE agent_id = ? AND status = \'active\' ORDER BY last_heartbeat DESC'
    );
    const rows = stmt.all(agentId) as SessionRow[];

    return rows.map(row => this.deserializeSession(row));
  }

  /**
   * Update session heartbeat
   */
  async updateSessionHeartbeat(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(
      'UPDATE sessions SET last_heartbeat = ? WHERE id = ?'
    );
    stmt.run(Date.now(), sessionId);
  }

  /**
   * Expire stale sessions (no heartbeat within timeout)
   * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
   * @returns Number of expired sessions
   */
  async expireStaleSessions(timeoutMs: number = 5 * 60 * 1000): Promise<number> {
    const now = Date.now();
    const cutoff = now - timeoutMs;

    // 1. Close dangling sessions for already-completed tasks (regardless of heartbeat age)
    const danglingStmt = this.db.prepare(
      'UPDATE sessions SET status = \'completed\', end_time = ? WHERE status = \'active\' AND task_id IN (SELECT id FROM tasks WHERE status = \'completed\')'
    );
    const danglingResult = danglingStmt.run(now);

    // 2. Find tasks that will be orphaned by expiring their timed-out sessions
    const staleSessions = this.db.prepare(
      'SELECT task_id FROM sessions WHERE status = \'active\' AND last_heartbeat < ?'
    ).all(cutoff) as Array<{ task_id: string }>;

    // 3. Expire the timed-out sessions
    const stmt = this.db.prepare(
      'UPDATE sessions SET status = \'expired\', end_time = ? WHERE status = \'active\' AND last_heartbeat < ?'
    );
    const result = stmt.run(now, cutoff);

    // 4. Reset orphaned tasks from 'in-progress' back to 'ready'
    // Only reset if no other active session exists for the task
    if (staleSessions.length > 0) {
      const resetStmt = this.db.prepare(
        'UPDATE tasks SET status = \'ready\', updated_at = ? WHERE id = ? AND status = \'in-progress\' AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.task_id = tasks.id AND sessions.status = \'active\')'
      );
      for (const { task_id } of staleSessions) {
        resetStmt.run(now, task_id);
      }
    }

    return result.changes + danglingResult.changes;
  }

  /**
   * Complete a session
   */
  async completeSession(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(
      'UPDATE sessions SET status = \'completed\', end_time = ? WHERE id = ?'
    );
    stmt.run(Date.now(), sessionId);
  }

  /**
   * Get all sessions for a task (including expired/completed)
   */
  async getSessionsForTask(taskId: string): Promise<CoordinationSession[]> {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE task_id = ? ORDER BY start_time DESC'
    );
    const rows = stmt.all(taskId) as SessionRow[];
    return rows.map(row => this.deserializeSession(row));
  }

  // ========================================================================
  // File-Lock Conflict Detection
  // ========================================================================

  /**
   * Find active sessions that have overlapping files with the given task
   * Returns sessions where another agent is working on files that overlap with this task's files
   */
  async findFileConflicts(taskId: string, excludeAgentId?: string): Promise<Array<{
    session: CoordinationSession;
    task: UnifiedTask;
    overlappingFiles: string[];
  }>> {
    // Get the task we want to claim
    const task = await this.getTask(taskId);
    if (!task || !task.files || task.files.length === 0) {
      return []; // No files to conflict with
    }

    const taskFiles = new Set(task.files);

    // Get all active sessions (excluding our own agent if specified)
    let query = 'SELECT * FROM sessions WHERE status = \'active\'';
    const params: any[] = [];

    if (excludeAgentId) {
      query += ' AND agent_id != ?';
      params.push(excludeAgentId);
    }

    const stmt = this.db.prepare(query);
    const sessionRows = stmt.all(...params) as SessionRow[];

    const conflicts: Array<{
      session: CoordinationSession;
      task: UnifiedTask;
      overlappingFiles: string[];
    }> = [];

    for (const row of sessionRows) {
      const session = this.deserializeSession(row);

      // Get the task being worked on in this session
      const otherTask = await this.getTask(session.taskId);
      if (!otherTask || !otherTask.files || otherTask.files.length === 0) {
        continue;
      }

      // Find overlapping files
      const overlappingFiles = otherTask.files.filter(f => taskFiles.has(f));

      if (overlappingFiles.length > 0) {
        conflicts.push({
          session,
          task: otherTask,
          overlappingFiles,
        });
      }
    }

    return conflicts;
  }

  /**
   * Get all files currently being worked on by active sessions
   */
  async getLockedFiles(projectId?: string): Promise<Map<string, { taskId: string; agentId: string; sessionId: string }>> {
    const pid = projectId || this.getActiveProjectIdOrDefault();

    const stmt = this.db.prepare(`
      SELECT s.id as session_id, s.task_id, s.agent_id, t.files
      FROM sessions s
      JOIN tasks t ON s.task_id = t.id
      WHERE s.status = 'active' AND s.project_id = ?
    `);

    const rows = stmt.all(pid) as Array<{
      session_id: string;
      task_id: string;
      agent_id: string;
      files: string;
    }>;

    const lockedFiles = new Map<string, { taskId: string; agentId: string; sessionId: string }>();

    for (const row of rows) {
      const files = safeJsonParse(row.files, []);
      for (const file of files) {
        lockedFiles.set(file, {
          taskId: row.task_id,
          agentId: row.agent_id,
          sessionId: row.session_id,
        });
      }
    }

    return lockedFiles;
  }

  // ========================================================================
  // Task Dependencies
  // ========================================================================

  /**
   * Add a dependency: blockerTaskId blocks blockedTaskId
   */
  async addTaskDependency(blockerTaskId: string, blockedTaskId: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (blocker_task_id, blocked_task_id, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(blockerTaskId, blockedTaskId, Date.now());

    // Update blocked task status to 'blocked' if it was 'ready'
    const blockedTask = await this.getTask(blockedTaskId);
    if (blockedTask && blockedTask.status === 'ready') {
      await this.updateTaskStatus(blockedTaskId, 'blocked');
    }
  }

  /**
   * Remove a dependency
   */
  async removeTaskDependency(blockerTaskId: string, blockedTaskId: string): Promise<void> {
    const stmt = this.db.prepare(`
      DELETE FROM task_dependencies
      WHERE blocker_task_id = ? AND blocked_task_id = ?
    `);
    stmt.run(blockerTaskId, blockedTaskId);

    // Check if blocked task should be unblocked
    await this.checkAndUnblockTask(blockedTaskId);
  }

  /**
   * Update task status helper
   */
  private async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?
    `);
    stmt.run(status, Date.now(), taskId);
  }

  /**
   * Check if a task should be unblocked and update its status
   */
  async checkAndUnblockTask(taskId: string): Promise<boolean> {
    const blockers = this.getBlockingTasks(taskId);

    // Check if all blockers are completed
    let allBlockersCompleted = true;
    for (const blockerId of blockers) {
      const blocker = await this.getTask(blockerId);
      if (blocker && blocker.status !== 'completed') {
        allBlockersCompleted = false;
        break;
      }
    }

    // If all blockers completed (or no blockers), and task is blocked, unblock it
    const task = await this.getTask(taskId);
    if (task && task.status === 'blocked' && allBlockersCompleted) {
      await this.updateTaskStatus(taskId, 'ready');
      return true;
    }

    return false;
  }

  /**
   * When a task is completed, check and unblock all tasks it was blocking
   */
  async onTaskCompleted(taskId: string): Promise<string[]> {
    const blockedTasks = this.getBlockedTasks(taskId);
    const unblockedTasks: string[] = [];

    for (const blockedId of blockedTasks) {
      const unblocked = await this.checkAndUnblockTask(blockedId);
      if (unblocked) {
        unblockedTasks.push(blockedId);
      }
    }

    return unblockedTasks;
  }

  /**
   * Get all tasks that are blocked (have incomplete blockers)
   */
  async getBlockedTasksList(projectId?: string): Promise<UnifiedTask[]> {
    const pid = projectId || this.getActiveProjectIdOrDefault();
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? AND status = 'blocked'
      ORDER BY priority, created_at
    `);
    const rows = stmt.all(pid) as any[];
    return rows.map(row => this.deserializeTask(row));
  }

  /**
   * Get tasks that are ready and have no incomplete blockers
   */
  async getUnblockedReadyTasks(projectId?: string): Promise<UnifiedTask[]> {
    const pid = projectId || this.getActiveProjectIdOrDefault();
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? AND status = 'ready'
      ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at
    `);
    const rows = stmt.all(pid) as any[];
    return rows.map(row => this.deserializeTask(row));
  }

  // ========================================================================
  // Events
  // ========================================================================

  async saveEvent(event: CoordinationEvent): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO events
        (id, type, project_id, task_id, user_id, agent_id, timestamp, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.type,
      event.projectId,
      event.taskId || null,
      event.userId,
      event.agentId || null,
      event.timestamp.getTime(),
      JSON.stringify(event.data)
    );
  }

  async getRecentEvents(limit: number): Promise<CoordinationEvent[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as EventRow[];

    return rows.map(row => this.deserializeEvent(row));
  }

  private deserializeEvent(row: EventRow): CoordinationEvent {
    return {
      id: row.id,
      type: row.type as EventType,
      projectId: row.project_id,
      taskId: row.task_id || undefined,
      userId: row.user_id,
      agentId: row.agent_id || undefined,
      timestamp: new Date(row.timestamp),
      data: safeJsonParse(row.data, {}),
    };
  }

  // ========================================================================
  // Project Metadata
  // ========================================================================

  async getProjectMetadata(): Promise<Record<string, any>> {
    const stmt = this.db.prepare('SELECT key, value FROM project_metadata');
    const rows = stmt.all() as Array<{ key: string; value: string }>;

    const metadata: Record<string, any> = {};
    for (const row of rows) {
      try {
        metadata[row.key] = JSON.parse(row.value);
      } catch {
        metadata[row.key] = row.value;
      }
    }

    return metadata;
  }

  async saveProjectMetadata(metadata: Record<string, any>): Promise<void> {
    // Use transaction for atomic update
    const deleteStmt = this.db.prepare('DELETE FROM project_metadata');
    const insertStmt = this.db.prepare('INSERT INTO project_metadata (key, value) VALUES (?, ?)');

    const transaction = this.db.transaction(() => {
      deleteStmt.run();
      for (const [key, value] of Object.entries(metadata)) {
        insertStmt.run(key, JSON.stringify(value));
      }
    });

    transaction();
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  // ========================================================================
  // Audit Logging
  // ========================================================================

  /**
   * Log an audit event
   */
  async logAuditEvent(event: {
    eventType: string;
    actorId: string;
    actorType: 'user' | 'agent' | 'system';
    projectId: string;
    resourceType: string;
    resourceId: string;
    action: string;
    beforeState?: unknown;
    afterState?: unknown;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    correlationId?: string;
  }): Promise<{ id: string; timestamp: Date }> {
    const id = `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date();

    const stmt = this.db.prepare(`
      INSERT INTO audit_log
        (id, timestamp, event_type, actor_id, actor_type, project_id, resource_type,
         resource_id, action, before_state, after_state, metadata, ip_address,
         user_agent, correlation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      timestamp.getTime(),
      event.eventType,
      event.actorId,
      event.actorType,
      event.projectId,
      event.resourceType,
      event.resourceId,
      event.action,
      event.beforeState ? JSON.stringify(event.beforeState) : null,
      event.afterState ? JSON.stringify(event.afterState) : null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.ipAddress || null,
      event.userAgent || null,
      event.correlationId || null
    );

    return { id, timestamp };
  }

  /**
   * Query audit events with filters
   */
  async queryAuditLog(options: {
    eventTypes?: string[];
    actorId?: string;
    projectId?: string;
    resourceType?: string;
    resourceId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
  }): Promise<Array<{
    id: string;
    timestamp: Date;
    eventType: string;
    actorId: string;
    actorType: string;
    projectId: string;
    resourceType: string;
    resourceId: string;
    action: string;
    beforeState?: unknown;
    afterState?: unknown;
    metadata?: Record<string, unknown>;
  }>> {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (options.eventTypes && options.eventTypes.length > 0) {
      query += ` AND event_type IN (${options.eventTypes.map(() => '?').join(',')})`;
      params.push(...options.eventTypes);
    }

    if (options.actorId) {
      query += ' AND actor_id = ?';
      params.push(options.actorId);
    }

    if (options.projectId) {
      query += ' AND project_id = ?';
      params.push(options.projectId);
    }

    if (options.resourceType) {
      query += ' AND resource_type = ?';
      params.push(options.resourceType);
    }

    if (options.resourceId) {
      query += ' AND resource_id = ?';
      params.push(options.resourceId);
    }

    if (options.startTime) {
      query += ' AND timestamp >= ?';
      params.push(options.startTime.getTime());
    }

    if (options.endTime) {
      query += ' AND timestamp <= ?';
      params.push(options.endTime.getTime());
    }

    query += ' ORDER BY timestamp DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      eventType: row.event_type,
      actorId: row.actor_id,
      actorType: row.actor_type,
      projectId: row.project_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      action: row.action,
      beforeState: safeJsonParse<any>(row.before_state, undefined),
      afterState: safeJsonParse<any>(row.after_state, undefined),
      metadata: safeJsonParse<any>(row.metadata, undefined),
    }));
  }

  /**
   * Get audit log summary
   */
  async getAuditSummary(projectId?: string, startTime?: Date, endTime?: Date): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsByActor: Record<string, number>;
    eventsByResource: Record<string, number>;
    timeRange: { earliest: Date | null; latest: Date | null };
  }> {
    let whereClause = '1=1';
    const params: unknown[] = [];

    if (projectId) {
      whereClause += ' AND project_id = ?';
      params.push(projectId);
    }

    if (startTime) {
      whereClause += ' AND timestamp >= ?';
      params.push(startTime.getTime());
    }

    if (endTime) {
      whereClause += ' AND timestamp <= ?';
      params.push(endTime.getTime());
    }

    // Total count
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM audit_log WHERE ${whereClause}`);
    const countRow = countStmt.get(...params) as { count: number };

    // Events by type
    const byTypeStmt = this.db.prepare(`
      SELECT event_type, COUNT(*) as count FROM audit_log
      WHERE ${whereClause}
      GROUP BY event_type
    `);
    const byTypeRows = byTypeStmt.all(...params) as Array<{ event_type: string; count: number }>;
    const eventsByType: Record<string, number> = {};
    for (const row of byTypeRows) {
      eventsByType[row.event_type] = row.count;
    }

    // Events by actor
    const byActorStmt = this.db.prepare(`
      SELECT actor_id, COUNT(*) as count FROM audit_log
      WHERE ${whereClause}
      GROUP BY actor_id
    `);
    const byActorRows = byActorStmt.all(...params) as Array<{ actor_id: string; count: number }>;
    const eventsByActor: Record<string, number> = {};
    for (const row of byActorRows) {
      eventsByActor[row.actor_id] = row.count;
    }

    // Events by resource type
    const byResourceStmt = this.db.prepare(`
      SELECT resource_type, COUNT(*) as count FROM audit_log
      WHERE ${whereClause}
      GROUP BY resource_type
    `);
    const byResourceRows = byResourceStmt.all(...params) as Array<{ resource_type: string; count: number }>;
    const eventsByResource: Record<string, number> = {};
    for (const row of byResourceRows) {
      eventsByResource[row.resource_type] = row.count;
    }

    // Time range
    const timeRangeStmt = this.db.prepare(`
      SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM audit_log
      WHERE ${whereClause}
    `);
    const timeRangeRow = timeRangeStmt.get(...params) as { earliest: number | null; latest: number | null };

    return {
      totalEvents: countRow.count,
      eventsByType,
      eventsByActor,
      eventsByResource,
      timeRange: {
        earliest: timeRangeRow.earliest ? new Date(timeRangeRow.earliest) : null,
        latest: timeRangeRow.latest ? new Date(timeRangeRow.latest) : null,
      },
    };
  }

  // ============================================================================
  // In-Flight Decisions
  // ============================================================================

  /**
   * Log a decision made during implementation
   */
  async logDecision(decision: {
    decision: string;
    rationale?: string;
    impact?: string;
    category?: string;
    taskId?: string;
    projectId?: string;
    createdBy?: string;
    scope?: { layers?: string[]; patterns?: string[]; files?: string[]; tags?: string[] };
    references?: Array<{ url: string; label?: string; type?: string }>;
    disposition?: string;
  }): Promise<string> {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO decisions (id, decision, rationale, impact, category, task_id, project_id, created_at, created_by, scope_json, "references", disposition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      decision.decision,
      decision.rationale || null,
      decision.impact || null,
      decision.category || 'other',
      decision.taskId || null,
      decision.projectId || this.activeProjectId,
      Date.now(),
      decision.createdBy || null,
      decision.scope ? JSON.stringify(decision.scope) : null,
      decision.references && decision.references.length > 0 ? JSON.stringify(decision.references) : null,
      decision.disposition || 'approved'
    );
    return id;
  }

  /**
   * Get decisions with optional filters
   */
  async getDecisions(options: {
    taskId?: string;
    projectId?: string;
    category?: string;
    since?: Date;
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    impact?: string;
    category: string;
    taskId?: string;
    projectId: string;
    createdAt: Date;
    createdBy?: string;
    scope?: { layers?: string[]; patterns?: string[]; files?: string[]; tags?: string[] };
  }>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.taskId) {
      conditions.push('task_id = ?');
      params.push(options.taskId);
    }
    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.category) {
      conditions.push('category = ?');
      params.push(options.category);
    }
    if (options.since) {
      conditions.push('created_at >= ?');
      params.push(options.since.getTime());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;

    const stmt = this.db.prepare(`
      SELECT * FROM decisions ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      decision: row.decision,
      rationale: row.rationale || undefined,
      impact: row.impact || undefined,
      category: row.category,
      taskId: row.task_id || undefined,
      projectId: row.project_id,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
      scope: row.scope_json ? safeJsonParse(row.scope_json, undefined) : undefined,
      references: row.references ? safeJsonParse(row.references, undefined) : undefined,
    }));
  }

  /**
   * Get a single decision by ID
   */
  async getDecision(id: string): Promise<{
    id: string;
    decision: string;
    rationale?: string;
    impact?: string;
    category: string;
    taskId?: string;
    projectId: string;
    createdAt: Date;
    createdBy?: string;
    scope?: { layers?: string[]; patterns?: string[]; files?: string[]; tags?: string[] };
    references?: Array<{ url: string; label?: string; type?: string }>;
  } | null> {
    const stmt = this.db.prepare('SELECT * FROM decisions WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      decision: row.decision,
      rationale: row.rationale || undefined,
      impact: row.impact || undefined,
      category: row.category,
      taskId: row.task_id || undefined,
      projectId: row.project_id,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
      scope: row.scope_json ? safeJsonParse(row.scope_json, undefined) : undefined,
      references: row.references ? safeJsonParse(row.references, undefined) : undefined,
    };
  }

  /**
   * Get decisions for a specific task
   */
  async getDecisionsForTask(taskId: string): Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    impact?: string;
    category: string;
    createdAt: Date;
  }>> {
    const stmt = this.db.prepare(`
      SELECT id, decision, rationale, impact, category, created_at
      FROM decisions WHERE task_id = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(taskId) as any[];

    return rows.map(row => ({
      id: row.id,
      decision: row.decision,
      rationale: row.rationale || undefined,
      impact: row.impact || undefined,
      category: row.category,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Get draft thoughts (decisions with disposition = 'draft')
   */
  async getThoughts(options: {
    projectId?: string;
    taskId?: string;
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    decision: string;
    taskId?: string;
    projectId: string;
    createdAt: Date;
    createdBy?: string;
  }>> {
    const conditions: string[] = ["disposition = 'draft'"];
    const params: unknown[] = [];

    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.taskId) {
      conditions.push('task_id = ?');
      params.push(options.taskId);
    }

    const limit = options.limit || 50;
    const stmt = this.db.prepare(`
      SELECT id, decision, task_id, project_id, created_at, created_by
      FROM decisions
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      decision: row.decision,
      taskId: row.task_id || undefined,
      projectId: row.project_id,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
    }));
  }

  /**
   * Update the disposition of a decision (promote, discard, defer, etc.)
   */
  async updateDisposition(decisionId: string, disposition: string, category?: string): Promise<boolean> {
    if (category) {
      const stmt = this.db.prepare('UPDATE decisions SET disposition = ?, category = ? WHERE id = ?');
      const result = stmt.run(disposition, category, decisionId);
      return result.changes > 0;
    } else {
      const stmt = this.db.prepare('UPDATE decisions SET disposition = ? WHERE id = ?');
      const result = stmt.run(disposition, decisionId);
      return result.changes > 0;
    }
  }

  // ============================================================================
  // Metrics (Local Telemetry)
  // ============================================================================

  /**
   * Log a metrics event
   */
  async logMetric(event: {
    eventType: 'task_claimed' | 'task_completed' | 'task_abandoned' | 'context_expanded' |
               'session_started' | 'session_ended' | 'tool_called' | 'quality_gate_passed' | 'quality_gate_failed' |
               'context_fetch_minimal' | 'context_fetch_full' |
               'task_reopened' | 'session_feedback' | 'context_repeated' | 'quality_bypass' | 'learnings_surfaced' |
               'decisions_surfaced';
    projectId?: string;
    taskId?: string;
    sessionId?: string;
    agentId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO metrics (timestamp, event_type, project_id, task_id, session_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      Date.now(),
      event.eventType,
      event.projectId || this.activeProjectId,
      event.taskId || null,
      event.sessionId || null,
      event.metadata ? JSON.stringify(event.metadata) : null
    );
  }

  async deleteMetricsByType(eventTypes: string[]): Promise<number> {
    if (eventTypes.length === 0) return 0;
    const placeholders = eventTypes.map(() => '?').join(', ');
    const stmt = this.db.prepare(`DELETE FROM metrics WHERE event_type IN (${placeholders})`);
    const result = stmt.run(...eventTypes);
    return result.changes;
  }

  /**
   * Get metrics for a time period
   */
  async getMetrics(options: {
    projectId?: string;
    since?: Date;
    until?: Date;
    eventTypes?: string[];
  } = {}): Promise<{
    events: Array<{
      timestamp: Date;
      eventType: string;
      projectId: string;
      taskId?: string;
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }>;
    summary: {
      totalEvents: number;
      byEventType: Record<string, number>;
      byProject: Record<string, number>;
    };
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.since) {
      conditions.push('timestamp >= ?');
      params.push(options.since.getTime());
    }
    if (options.until) {
      conditions.push('timestamp <= ?');
      params.push(options.until.getTime());
    }
    if (options.eventTypes && options.eventTypes.length > 0) {
      conditions.push(`event_type IN (${options.eventTypes.map(() => '?').join(', ')})`);
      params.push(...options.eventTypes);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get events
    const eventsStmt = this.db.prepare(`
      SELECT timestamp, event_type, project_id, task_id, session_id, metadata
      FROM metrics
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT 1000
    `);
    const rows = eventsStmt.all(...params) as Array<{
      timestamp: number;
      event_type: string;
      project_id: string;
      task_id: string | null;
      session_id: string | null;
      metadata: string | null;
    }>;

    const events = rows.map(row => ({
      timestamp: new Date(row.timestamp),
      eventType: row.event_type,
      projectId: row.project_id,
      taskId: row.task_id || undefined,
      sessionId: row.session_id || undefined,
      metadata: safeJsonParse<any>(row.metadata, undefined),
    }));

    // Get summary
    const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM metrics ${whereClause}`);
    const countRow = countStmt.get(...params) as { count: number };

    const byTypeStmt = this.db.prepare(`
      SELECT event_type, COUNT(*) as count FROM metrics ${whereClause} GROUP BY event_type
    `);
    const byTypeRows = byTypeStmt.all(...params) as Array<{ event_type: string; count: number }>;
    const byEventType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byEventType[row.event_type] = row.count;
    }

    const byProjectStmt = this.db.prepare(`
      SELECT project_id, COUNT(*) as count FROM metrics ${whereClause} GROUP BY project_id
    `);
    const byProjectRows = byProjectStmt.all(...params) as Array<{ project_id: string; count: number }>;
    const byProject: Record<string, number> = {};
    for (const row of byProjectRows) {
      byProject[row.project_id] = row.count;
    }

    return {
      events,
      summary: {
        totalEvents: countRow.count,
        byEventType,
        byProject,
      },
    };
  }

  /**
   * Get raw metrics records for telemetry analysis
   */
  async getMetricsRaw(options: {
    eventType?: string;
    projectId?: string;
    sessionId?: string;
    taskId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  } = {}): Promise<Array<{
    timestamp: Date;
    eventType: string;
    projectId: string;
    taskId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.eventType) {
      conditions.push('event_type = ?');
      params.push(options.eventType);
    }
    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }
    if (options.taskId) {
      conditions.push('task_id = ?');
      params.push(options.taskId);
    }
    if (options.startTime) {
      conditions.push('timestamp >= ?');
      params.push(options.startTime.getTime());
    }
    if (options.endTime) {
      conditions.push('timestamp <= ?');
      params.push(options.endTime.getTime());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 1000;

    const stmt = this.db.prepare(`
      SELECT timestamp, event_type, project_id, task_id, session_id, metadata
      FROM metrics
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(...params, limit) as Array<{
      timestamp: number;
      event_type: string;
      project_id: string;
      task_id: string | null;
      session_id: string | null;
      metadata: string | null;
    }>;

    return rows.map(row => ({
      timestamp: new Date(row.timestamp),
      eventType: row.event_type,
      projectId: row.project_id,
      taskId: row.task_id || undefined,
      sessionId: row.session_id || undefined,
      metadata: safeJsonParse<any>(row.metadata, undefined),
    }));
  }

  /**
   * Get coordination effectiveness metrics
   */
  async getEffectivenessMetrics(options: {
    projectId?: string;
    since?: Date;
  } = {}): Promise<{
    tasksCompleted: number;
    tasksAbandoned: number;
    avgCycleTimeMs: number | null;
    contextExpansions: number;
    contextExpansionRate: number;
    sessions: number;
    avgTasksPerSession: number;
    completionRate: number;
    qualityGatePassRate: number;
    tokenEfficiency: {
      minimalFetches: number;
      minimalSufficient: number;
      minimalExpanded: number;
      fullFetches: number;
      efficiencyRate: number;
      estimatedTokensSaved: number;
    };
  }> {
    const since = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
    const projectId = options.projectId || this.activeProjectId;

    const baseConditions = 'timestamp >= ? AND project_id = ?';
    const baseParams = [since.getTime(), projectId];

    // Task counts
    const completedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics WHERE ${baseConditions} AND event_type = 'task_completed'
    `);
    const tasksCompleted = (completedStmt.get(...baseParams) as { count: number }).count;

    const abandonedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics WHERE ${baseConditions} AND event_type = 'task_abandoned'
    `);
    const tasksAbandoned = (abandonedStmt.get(...baseParams) as { count: number }).count;

    const claimedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics WHERE ${baseConditions} AND event_type = 'task_claimed'
    `);
    const tasksClaimed = (claimedStmt.get(...baseParams) as { count: number }).count;

    // Calculate average cycle time (claimed → completed)
    // Get tasks that have both claimed and completed events
    const cycleTimeStmt = this.db.prepare(`
      SELECT
        c.task_id,
        c.timestamp as claimed_at,
        (SELECT MIN(m.timestamp) FROM metrics m WHERE m.task_id = c.task_id AND m.event_type = 'task_completed' AND m.timestamp > c.timestamp) as completed_at
      FROM metrics c
      WHERE c.event_type = 'task_claimed' AND c.timestamp >= ? AND c.project_id = ? AND c.task_id IS NOT NULL
    `);
    const cycleTimes = cycleTimeStmt.all(...baseParams) as Array<{ task_id: string; claimed_at: number; completed_at: number | null }>;
    const validCycleTimes = cycleTimes.filter(ct => ct.completed_at !== null);
    const avgCycleTimeMs = validCycleTimes.length > 0
      ? validCycleTimes.reduce((sum, ct) => sum + (ct.completed_at! - ct.claimed_at), 0) / validCycleTimes.length
      : null;

    // Context expansions
    const expansionsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics WHERE ${baseConditions} AND event_type = 'context_expanded'
    `);
    const contextExpansions = (expansionsStmt.get(...baseParams) as { count: number }).count;

    // Calculate expansion rate (context_expanded / task_claimed)
    const contextExpansionRate = tasksClaimed > 0 ? contextExpansions / tasksClaimed : 0;

    // Sessions
    const sessionsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics WHERE ${baseConditions} AND event_type = 'session_started'
    `);
    const sessions = (sessionsStmt.get(...baseParams) as { count: number }).count;

    // Average tasks per session
    const avgTasksPerSession = sessions > 0 ? tasksCompleted / sessions : 0;

    // Completion rate
    const completionRate = tasksClaimed > 0 ? tasksCompleted / tasksClaimed : 0;

    // Quality gate pass rate
    const passedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics WHERE ${baseConditions} AND event_type = 'quality_gate_passed'
    `);
    const passed = (passedStmt.get(...baseParams) as { count: number }).count;

    const failedStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM metrics WHERE ${baseConditions} AND event_type = 'quality_gate_failed'
    `);
    const failed = (failedStmt.get(...baseParams) as { count: number }).count;

    const qualityGatePassRate = (passed + failed) > 0 ? passed / (passed + failed) : 1;

    // Token efficiency metrics - measure prompt savings, not response sizes
    // Key insight: A minimal fetch is "sufficient" if it wasn't followed by expand_context for the same task

    // Get all minimal fetches with their task IDs
    const minimalFetchStmt = this.db.prepare(`
      SELECT COUNT(*) as count, SUM(json_extract(metadata, '$.responseBytes')) as totalBytes
      FROM metrics WHERE ${baseConditions} AND event_type = 'context_fetch_minimal'
    `);
    const minimalFetch = minimalFetchStmt.get(...baseParams) as { count: number; totalBytes: number | null };

    // Get full context fetches (get_next_task responses)
    const fullFetchStmt = this.db.prepare(`
      SELECT COUNT(*) as count, SUM(json_extract(metadata, '$.responseBytes')) as totalBytes
      FROM metrics WHERE ${baseConditions} AND event_type = 'context_fetch_full'
    `);
    const fullFetch = fullFetchStmt.get(...baseParams) as { count: number; totalBytes: number | null };

    // Count minimal fetches that were later expanded (not sufficient)
    // A minimal fetch for a task that was followed by context_expanded for the same task
    // Use >= timestamp since expand can happen in same millisecond as minimal fetch
    const expandedMinimalStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT m1.task_id) as count
      FROM metrics m1
      WHERE ${baseConditions.replace(/project_id/g, 'm1.project_id').replace(/timestamp/g, 'm1.timestamp')}
        AND m1.event_type = 'context_fetch_minimal'
        AND m1.task_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM metrics m2
          WHERE m2.task_id = m1.task_id
            AND m2.event_type = 'context_expanded'
            AND m2.timestamp >= m1.timestamp
        )
    `);
    const expandedMinimal = expandedMinimalStmt.get(...baseParams) as { count: number };

    const minimalCount = minimalFetch.count || 0;
    const fullCount = fullFetch.count || 0;
    const minimalBytes = minimalFetch.totalBytes || 0;
    const fullBytes = fullFetch.totalBytes || 0;

    // Calculate sufficient vs expanded
    const minimalExpandedCount = expandedMinimal.count || 0;
    const minimalSufficientCount = Math.max(0, minimalCount - minimalExpandedCount);

    // Efficiency rate: what percentage of minimal fetches were sufficient?
    const efficiencyRate = minimalCount > 0
      ? Math.round((minimalSufficientCount / minimalCount) * 100)
      : 0;

    // ESTIMATE token savings based on response byte sizes
    // NOTE: These are ESTIMATES, not actual LLM token counts
    // - We don't have access to actual token counts from LLM APIs
    // - bytes/4 is a rough heuristic that works for typical code/JSON
    // - Actual token counts vary significantly based on content type
    const avgMinimalBytes = minimalCount > 0 ? minimalBytes / minimalCount : 500; // Default ~500 bytes
    const avgFullBytes = fullCount > 0 ? fullBytes / fullCount : avgMinimalBytes * 4; // Full is ~4x minimal typically

    // Estimated tokens = bytes / 4 (HEURISTIC - not actual measurement)
    const avgMinimalTokens = Math.round(avgMinimalBytes / 4);
    const avgFullTokens = Math.round(avgFullBytes / 4);
    const tokensSavedPerSufficientCall = Math.max(0, avgFullTokens - avgMinimalTokens);
    const estimatedTokensSaved = minimalSufficientCount * tokensSavedPerSufficientCall; // ESTIMATED

    return {
      tasksCompleted,
      tasksAbandoned,
      avgCycleTimeMs,
      contextExpansions,
      contextExpansionRate,
      sessions,
      avgTasksPerSession,
      completionRate,
      qualityGatePassRate,
      tokenEfficiency: {
        minimalFetches: minimalCount,
        minimalSufficient: minimalSufficientCount,
        minimalExpanded: minimalExpandedCount,
        fullFetches: fullCount,
        efficiencyRate,
        estimatedTokensSaved,
      },
    };
  }

  /**
   * Get metrics breakdown by agent
   */
  async getMetricsByAgent(options: {
    projectId?: string;
    since?: Date;
  } = {}): Promise<Array<{
    agentId: string;
    tasksClaimed: number;
    tasksCompleted: number;
    sessionsStarted: number;
  }>> {
    const since = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const projectId = options.projectId || this.activeProjectId;

    // Query metrics and extract agentId from metadata JSON
    const stmt = this.db.prepare(`
      SELECT
        json_extract(metadata, '$.agentId') as agent_id,
        event_type,
        COUNT(*) as count
      FROM metrics
      WHERE timestamp >= ? AND project_id = ?
        AND event_type IN ('task_claimed', 'task_completed', 'session_started')
        AND json_extract(metadata, '$.agentId') IS NOT NULL
      GROUP BY json_extract(metadata, '$.agentId'), event_type
    `);

    const rows = stmt.all(since.getTime(), projectId) as Array<{
      agent_id: string;
      event_type: string;
      count: number;
    }>;

    // Aggregate by agent
    const agentMap = new Map<string, {
      agentId: string;
      tasksClaimed: number;
      tasksCompleted: number;
      sessionsStarted: number;
    }>();

    for (const row of rows) {
      if (!agentMap.has(row.agent_id)) {
        agentMap.set(row.agent_id, {
          agentId: row.agent_id,
          tasksClaimed: 0,
          tasksCompleted: 0,
          sessionsStarted: 0,
        });
      }
      const agent = agentMap.get(row.agent_id)!;
      if (row.event_type === 'task_claimed') {
        agent.tasksClaimed = row.count;
      } else if (row.event_type === 'task_completed') {
        agent.tasksCompleted = row.count;
      } else if (row.event_type === 'session_started') {
        agent.sessionsStarted = row.count;
      }
    }

    return Array.from(agentMap.values()).sort((a, b) => b.tasksCompleted - a.tasksCompleted);
  }

  // ============================================================================
  // Outcome-Based Analytics
  // ============================================================================

  /**
   * Save session feedback for outcome analytics
   */
  async saveSessionFeedback(feedback: {
    id: string;
    sessionId: string;
    projectId?: string;
    taskId?: string;
    productivityRating?: number;
    frictionTags: string[];
    notes?: string;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO session_feedback (id, session_id, project_id, task_id, productivity_rating, friction_tags, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      feedback.id,
      feedback.sessionId,
      feedback.projectId || this.activeProjectId,
      feedback.taskId || null,
      feedback.productivityRating || null,
      JSON.stringify(feedback.frictionTags),
      feedback.notes || null,
      Date.now()
    );

    // Also log as metric event
    await this.logMetric({
      eventType: 'session_feedback',
      projectId: feedback.projectId,
      taskId: feedback.taskId,
      sessionId: feedback.sessionId,
      metadata: {
        productivityRating: feedback.productivityRating,
        frictionTags: feedback.frictionTags,
      },
    });
  }

  /**
   * Get session feedback for a time period
   */
  async getSessionFeedback(options: {
    projectId?: string;
    since?: Date;
    until?: Date;
  }): Promise<Array<{
    id: string;
    sessionId: string;
    projectId: string;
    taskId?: string;
    productivityRating?: number;
    frictionTags: string[];
    notes?: string;
    createdAt: Date;
  }>> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.since) {
      conditions.push('created_at >= ?');
      params.push(options.since.getTime());
    }
    if (options.until) {
      conditions.push('created_at <= ?');
      params.push(options.until.getTime());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const stmt = this.db.prepare(`
      SELECT * FROM session_feedback ${whereClause} ORDER BY created_at DESC
    `);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      projectId: row.project_id,
      taskId: row.task_id || undefined,
      productivityRating: row.productivity_rating || undefined,
      frictionTags: safeJsonParse(row.friction_tags, []),
      notes: row.notes || undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  // ============================================================================
  // Task Outcome Storage
  // ============================================================================

  /**
   * Record or update the outcome of a completed task.
   * Tracks what happened AFTER completion (PR merge, CI, deploy).
   */
  async saveTaskOutcome(outcome: {
    id: string;
    taskId: string;
    projectId?: string;
    status: 'pending' | 'shipped' | 'rejected' | 'rework' | 'abandoned';
    prUrl?: string;
    prMerged?: boolean;
    prMergedAt?: Date;
    reviewFeedback?: string;
    ciPassed?: boolean;
    ciFirstTryPass?: boolean;
    testFailures?: number;
    deployed?: boolean;
    deployedAt?: Date;
    deployEnvironment?: string;
    reworkRequired?: boolean;
    reworkReason?: string;
    reworkTaskId?: string;
    timeToMerge?: number;
    timeToProduction?: number;
    reviewerSatisfaction?: number;
    notes?: string;
  }): Promise<void> {
    const now = Date.now();
    const projectId = outcome.projectId || this.activeProjectId || 'default';

    // Use INSERT OR REPLACE to handle both create and update
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_outcomes (
        id, task_id, project_id, status, recorded_at, updated_at,
        pr_url, pr_merged, pr_merged_at, review_feedback,
        ci_passed, ci_first_try_pass, test_failures,
        deployed, deployed_at, deploy_environment,
        rework_required, rework_reason, rework_task_id,
        time_to_merge, time_to_production,
        reviewer_satisfaction, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      outcome.id,
      outcome.taskId,
      projectId,
      outcome.status,
      now,
      now,
      outcome.prUrl || null,
      outcome.prMerged !== undefined ? (outcome.prMerged ? 1 : 0) : null,
      outcome.prMergedAt ? outcome.prMergedAt.getTime() : null,
      outcome.reviewFeedback || null,
      outcome.ciPassed !== undefined ? (outcome.ciPassed ? 1 : 0) : null,
      outcome.ciFirstTryPass !== undefined ? (outcome.ciFirstTryPass ? 1 : 0) : null,
      outcome.testFailures ?? null,
      outcome.deployed !== undefined ? (outcome.deployed ? 1 : 0) : null,
      outcome.deployedAt ? outcome.deployedAt.getTime() : null,
      outcome.deployEnvironment || null,
      outcome.reworkRequired !== undefined ? (outcome.reworkRequired ? 1 : 0) : null,
      outcome.reworkReason || null,
      outcome.reworkTaskId || null,
      outcome.timeToMerge ?? null,
      outcome.timeToProduction ?? null,
      outcome.reviewerSatisfaction ?? null,
      outcome.notes || null
    );
  }

  /**
   * Get the outcome for a specific task
   */
  async getTaskOutcome(taskId: string): Promise<{
    id: string;
    taskId: string;
    projectId: string;
    status: 'pending' | 'shipped' | 'rejected' | 'rework' | 'abandoned';
    recordedAt: Date;
    updatedAt: Date;
    prUrl?: string;
    prMerged?: boolean;
    prMergedAt?: Date;
    reviewFeedback?: string;
    ciPassed?: boolean;
    ciFirstTryPass?: boolean;
    testFailures?: number;
    deployed?: boolean;
    deployedAt?: Date;
    deployEnvironment?: string;
    reworkRequired?: boolean;
    reworkReason?: string;
    reworkTaskId?: string;
    timeToMerge?: number;
    timeToProduction?: number;
    reviewerSatisfaction?: number;
    notes?: string;
  } | null> {
    const stmt = this.db.prepare('SELECT * FROM task_outcomes WHERE task_id = ?');
    const row = stmt.get(taskId) as any;

    if (!row) return null;

    return {
      id: row.id,
      taskId: row.task_id,
      projectId: row.project_id,
      status: row.status,
      recordedAt: new Date(row.recorded_at),
      updatedAt: new Date(row.updated_at),
      prUrl: row.pr_url || undefined,
      prMerged: row.pr_merged !== null ? row.pr_merged === 1 : undefined,
      prMergedAt: row.pr_merged_at ? new Date(row.pr_merged_at) : undefined,
      reviewFeedback: row.review_feedback || undefined,
      ciPassed: row.ci_passed !== null ? row.ci_passed === 1 : undefined,
      ciFirstTryPass: row.ci_first_try_pass !== null ? row.ci_first_try_pass === 1 : undefined,
      testFailures: row.test_failures ?? undefined,
      deployed: row.deployed !== null ? row.deployed === 1 : undefined,
      deployedAt: row.deployed_at ? new Date(row.deployed_at) : undefined,
      deployEnvironment: row.deploy_environment || undefined,
      reworkRequired: row.rework_required !== null ? row.rework_required === 1 : undefined,
      reworkReason: row.rework_reason || undefined,
      reworkTaskId: row.rework_task_id || undefined,
      timeToMerge: row.time_to_merge ?? undefined,
      timeToProduction: row.time_to_production ?? undefined,
      reviewerSatisfaction: row.reviewer_satisfaction ?? undefined,
      notes: row.notes || undefined,
    };
  }

  /**
   * Get completed tasks that have pending outcome records (need follow-up tracking)
   */
  async getCompletedTasksWithPendingOutcomes(projectId: string, limit: number = 5): Promise<Array<{
    taskId: string;
    taskTitle: string;
    completedAt: Date;
    outcomeId: string;
  }>> {
    const stmt = this.db.prepare(`
      SELECT t.id as task_id, t.title as task_title, t.updated_at as completed_at, o.id as outcome_id
      FROM tasks t
      JOIN task_outcomes o ON t.id = o.task_id
      WHERE t.project_id = ? AND t.status = 'completed' AND o.status = 'pending'
      ORDER BY t.updated_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(projectId, limit) as Array<{
      task_id: string;
      task_title: string;
      completed_at: number;
      outcome_id: string;
    }>;

    return rows.map(row => ({
      taskId: row.task_id,
      taskTitle: row.task_title,
      completedAt: new Date(row.completed_at),
      outcomeId: row.outcome_id,
    }));
  }

  /**
   * Get outcome metrics for a project
   */
  async getOutcomeMetrics(options: {
    projectId?: string;
    since?: Date;
    until?: Date;
  }): Promise<{
    totalOutcomes: number;
    byStatus: Record<string, number>;
    shipRate: number;  // % of outcomes that shipped
    reworkRate: number;  // % that required rework
    avgTimeToMerge?: number;  // average ms
    avgTimeToProduction?: number;  // average ms
    ciFirstTryPassRate: number;  // % of outcomes where CI passed first try
    avgReviewerSatisfaction?: number;
  }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    } else if (this.activeProjectId) {
      conditions.push('project_id = ?');
      params.push(this.activeProjectId);
    }

    if (options.since) {
      conditions.push('recorded_at >= ?');
      params.push(options.since.getTime());
    }
    if (options.until) {
      conditions.push('recorded_at <= ?');
      params.push(options.until.getTime());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get counts by status
    const countStmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM task_outcomes ${whereClause} GROUP BY status
    `);
    const countRows = countStmt.all(...params) as Array<{ status: string; count: number }>;

    const byStatus: Record<string, number> = {};
    let totalOutcomes = 0;
    for (const row of countRows) {
      byStatus[row.status] = row.count;
      totalOutcomes += row.count;
    }

    // Calculate rates
    const shipped = byStatus['shipped'] || 0;
    const rework = byStatus['rework'] || 0;
    const shipRate = totalOutcomes > 0 ? shipped / totalOutcomes : 0;
    const reworkRate = totalOutcomes > 0 ? rework / totalOutcomes : 0;

    // Get averages for time metrics
    const avgStmt = this.db.prepare(`
      SELECT
        AVG(time_to_merge) as avg_merge,
        AVG(time_to_production) as avg_prod,
        AVG(reviewer_satisfaction) as avg_satisfaction
      FROM task_outcomes ${whereClause}
    `);
    const avgRow = avgStmt.get(...params) as any;

    // CI first-try pass rate
    const ciStmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN ci_first_try_pass = 1 THEN 1 ELSE 0 END) as first_try_pass,
        SUM(CASE WHEN ci_passed IS NOT NULL THEN 1 ELSE 0 END) as total_ci
      FROM task_outcomes ${whereClause}
    `);
    const ciRow = ciStmt.get(...params) as any;
    const ciFirstTryPassRate = ciRow.total_ci > 0 ? ciRow.first_try_pass / ciRow.total_ci : 0;

    return {
      totalOutcomes,
      byStatus,
      shipRate,
      reworkRate,
      avgTimeToMerge: avgRow.avg_merge ?? undefined,
      avgTimeToProduction: avgRow.avg_prod ?? undefined,
      ciFirstTryPassRate,
      avgReviewerSatisfaction: avgRow.avg_satisfaction ?? undefined,
    };
  }

  // ============================================================================
  // AX Survey Storage
  // ============================================================================

  /**
   * Save an AX survey response
   */
  async saveAXSurveyResponse(response: {
    id: string;
    surveyId: string;
    sessionId: string;
    projectId: string;
    agentId: string;
    taskId?: string;
    responses: Record<string, unknown>;
    freeformFeedback?: string;
    context: {
      toolsUsed: string[];
      errorsEncountered: number;
      sessionDurationMs: number;
      taskCompleted: boolean;
    };
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO ax_survey_responses
        (id, survey_id, session_id, project_id, agent_id, task_id, responses, freeform_feedback, context, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      response.id,
      response.surveyId,
      response.sessionId,
      response.projectId,
      response.agentId,
      response.taskId || null,
      JSON.stringify(response.responses),
      response.freeformFeedback || null,
      JSON.stringify(response.context),
      Date.now()
    );

    // Log as audit event for tracking
    await this.logAuditEvent({
      eventType: 'quality.check_run',
      actorId: response.agentId,
      actorType: 'agent',
      projectId: response.projectId,
      resourceType: 'quality',
      resourceId: response.id,
      action: 'AX survey submitted',
      metadata: {
        checkType: 'ax_survey',
        surveyId: response.surveyId,
        sessionId: response.sessionId,
        taskId: response.taskId,
        responseCount: Object.keys(response.responses).length,
      },
    });
  }

  /**
   * Get AX survey responses for analysis
   */
  async getAXSurveyResponses(options: {
    projectId?: string;
    agentId?: string;
    surveyId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<Array<{
    id: string;
    surveyId: string;
    sessionId: string;
    projectId: string;
    agentId: string;
    taskId?: string;
    responses: Record<string, unknown>;
    freeformFeedback?: string;
    context: {
      toolsUsed: string[];
      errorsEncountered: number;
      sessionDurationMs: number;
      taskCompleted: boolean;
    };
    submittedAt: Date;
  }>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.agentId) {
      conditions.push('agent_id = ?');
      params.push(options.agentId);
    }
    if (options.surveyId) {
      conditions.push('survey_id = ?');
      params.push(options.surveyId);
    }
    if (options.since) {
      conditions.push('submitted_at >= ?');
      params.push(options.since.getTime());
    }
    if (options.until) {
      conditions.push('submitted_at <= ?');
      params.push(options.until.getTime());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = options.limit ? `LIMIT ${options.limit}` : '';

    const stmt = this.db.prepare(`
      SELECT * FROM ax_survey_responses ${whereClause} ORDER BY submitted_at DESC ${limitClause}
    `);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      surveyId: row.survey_id,
      sessionId: row.session_id,
      projectId: row.project_id,
      agentId: row.agent_id,
      taskId: row.task_id || undefined,
      responses: safeJsonParse<Record<string, unknown>>(row.responses, {}),
      freeformFeedback: row.freeform_feedback || undefined,
      context: safeJsonParse<any>(row.context, { toolsUsed: [], errorsEncountered: 0, sessionDurationMs: 0, taskCompleted: false }),
      submittedAt: new Date(row.submitted_at),
    }));
  }

  /**
   * Get raw metrics data for outcome analytics calculations
   */
  async getOutcomeRawData(options: {
    projectId: string;
    since: Date;
    until: Date;
  }): Promise<{
    tasksClaimed: number;
    tasksCompleted: number;
    tasksAbandoned: number;
    tasksReopened: number;
    tasksReworked: number;
    sessions: number;
    singleSessionCompletions: number;
    multiSessionTasks: number;
    contextFetchMinimal: number;
    contextFetchFull: number;
    contextExpansions: number;
    minimalSufficientCount: number;
    toolCalls: number;
    qualityGatePassed: number;
    qualityGateFailed: number;
    artifacts: number;
    decisions: number;
    cycleTimes: (number | null)[];
    sessionDurations: (number | null)[];
    abandonmentByReason: Record<string, number>;
  }> {
    const { projectId, since, until } = options;
    const sinceMs = since.getTime();
    const untilMs = until.getTime();

    // Helper to count events
    const countEvents = (eventType: string): number => {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM metrics
        WHERE project_id = ? AND timestamp >= ? AND timestamp <= ? AND event_type = ?
      `);
      return (stmt.get(projectId, sinceMs, untilMs, eventType) as { count: number }).count;
    };

    // Task counts
    const tasksClaimed = countEvents('task_claimed');
    const tasksCompleted = countEvents('task_completed');
    const tasksAbandoned = countEvents('task_abandoned');
    const tasksReopened = countEvents('task_reopened');

    // Session counts
    const sessions = countEvents('session_started');

    // Context metrics
    const contextFetchMinimal = countEvents('context_fetch_minimal');
    const contextFetchFull = countEvents('context_fetch_full');
    const contextExpansions = countEvents('context_expanded');

    // Tool calls
    const toolCalls = countEvents('tool_called');

    // Quality gates
    const qualityGatePassed = countEvents('quality_gate_passed');
    const qualityGateFailed = countEvents('quality_gate_failed');

    // Calculate minimal sufficient count (minimal fetches not followed by expansion)
    const expandedMinimalStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT m1.task_id) as count
      FROM metrics m1
      WHERE m1.project_id = ? AND m1.timestamp >= ? AND m1.timestamp <= ?
        AND m1.event_type = 'context_fetch_minimal'
        AND m1.task_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM metrics m2
          WHERE m2.task_id = m1.task_id
            AND m2.event_type = 'context_expanded'
            AND m2.timestamp >= m1.timestamp
        )
    `);
    const expandedMinimal = (expandedMinimalStmt.get(projectId, sinceMs, untilMs) as { count: number }).count;
    const minimalSufficientCount = Math.max(0, contextFetchMinimal - expandedMinimal);

    // Artifacts created in period
    const artifactsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM artifacts
      WHERE project_id = ? AND created_at >= ? AND created_at <= ?
    `);
    const artifacts = (artifactsStmt.get(projectId, sinceMs, untilMs) as { count: number }).count;

    // Decisions logged in period
    const decisionsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM decisions
      WHERE project_id = ? AND created_at >= ? AND created_at <= ?
    `);
    const decisions = (decisionsStmt.get(projectId, sinceMs, untilMs) as { count: number }).count;

    // Calculate rework (tasks that were completed then had activity again)
    // This is a heuristic: completed tasks that later had a task_claimed event
    const reworkStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT m1.task_id) as count
      FROM metrics m1
      WHERE m1.project_id = ? AND m1.timestamp >= ? AND m1.timestamp <= ?
        AND m1.event_type = 'task_completed'
        AND m1.task_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM metrics m2
          WHERE m2.task_id = m1.task_id
            AND m2.event_type = 'task_claimed'
            AND m2.timestamp > m1.timestamp
        )
    `);
    const tasksReworked = (reworkStmt.get(projectId, sinceMs, untilMs) as { count: number }).count;

    // Calculate session counts per task for single vs multi-session detection
    const sessionCountsStmt = this.db.prepare(`
      SELECT task_id, COUNT(*) as session_count
      FROM metrics
      WHERE project_id = ? AND timestamp >= ? AND timestamp <= ?
        AND event_type = 'session_started' AND task_id IS NOT NULL
      GROUP BY task_id
    `);
    const sessionCounts = sessionCountsStmt.all(projectId, sinceMs, untilMs) as Array<{ task_id: string; session_count: number }>;

    const singleSessionCompletions = sessionCounts.filter(sc => sc.session_count === 1).length;
    const multiSessionTasks = sessionCounts.filter(sc => sc.session_count > 1).length;

    // Calculate cycle times (claim to complete per task)
    const cycleTimeStmt = this.db.prepare(`
      SELECT
        c.task_id,
        MIN(c.timestamp) as claimed_at,
        (SELECT MIN(m.timestamp) FROM metrics m WHERE m.task_id = c.task_id AND m.event_type = 'task_completed' AND m.timestamp > c.timestamp) as completed_at
      FROM metrics c
      WHERE c.project_id = ? AND c.timestamp >= ? AND c.timestamp <= ?
        AND c.event_type = 'task_claimed' AND c.task_id IS NOT NULL
      GROUP BY c.task_id
    `);
    const cycleTimes = cycleTimeStmt.all(projectId, sinceMs, untilMs) as Array<{ task_id: string; claimed_at: number; completed_at: number | null }>;

    const cycleTimeValues = cycleTimes.map(ct =>
      ct.completed_at ? ct.completed_at - ct.claimed_at : null
    );

    // Calculate session durations
    const sessionDurationStmt = this.db.prepare(`
      SELECT
        s.session_id,
        s.timestamp as started_at,
        (SELECT MIN(e.timestamp) FROM metrics e WHERE e.session_id = s.session_id AND e.event_type = 'session_ended') as ended_at
      FROM metrics s
      WHERE s.project_id = ? AND s.timestamp >= ? AND s.timestamp <= ?
        AND s.event_type = 'session_started'
    `);
    const sessionDurationRows = sessionDurationStmt.all(projectId, sinceMs, untilMs) as Array<{ session_id: string; started_at: number; ended_at: number | null }>;

    const sessionDurations = sessionDurationRows.map(sd =>
      sd.ended_at ? sd.ended_at - sd.started_at : null
    );

    // Get abandonment breakdown by reason
    const abandonmentByReason = this.getAbandonmentByReason(projectId, sinceMs, untilMs);

    return {
      tasksClaimed,
      tasksCompleted,
      tasksAbandoned,
      tasksReopened,
      tasksReworked,
      sessions,
      singleSessionCompletions,
      multiSessionTasks,
      contextFetchMinimal,
      contextFetchFull,
      contextExpansions,
      minimalSufficientCount,
      toolCalls,
      qualityGatePassed,
      qualityGateFailed,
      artifacts,
      decisions,
      cycleTimes: cycleTimeValues,
      sessionDurations,
      abandonmentByReason,
    };
  }

  /**
   * Get abandonment counts by reason for interpretable metrics
   */
  private getAbandonmentByReason(
    projectId: string,
    sinceMs: number,
    untilMs: number
  ): Record<string, number> {
    const stmt = this.db.prepare(`
      SELECT metadata FROM metrics
      WHERE project_id = ? AND timestamp >= ? AND timestamp <= ? AND event_type = 'task_abandoned'
    `);

    const rows = stmt.all(projectId, sinceMs, untilMs) as Array<{ metadata: string | null }>;

    const reasons: Record<string, number> = {
      test: 0,
      redirect: 0,
      blocked: 0,
      stuck: 0,
      scope_change: 0,
      user_requested: 0,
      context_limit: 0,
      other: 0,
      unknown: 0, // For legacy data without reason
    };

    for (const row of rows) {
      if (!row.metadata) {
        reasons.unknown++;
        continue;
      }

      try {
        const metadata = JSON.parse(row.metadata);
        const reason = metadata.reason;
        if (reason && reasons[reason] !== undefined) {
          reasons[reason]++;
        } else {
          reasons.unknown++;
        }
      } catch {
        reasons.unknown++;
      }
    }

    return reasons;
  }

  // ============================================================================
  // Artifact Management
  // ============================================================================

  async createArtifact(artifact: Artifact): Promise<Artifact> {
    const stmt = this.db.prepare(`
      INSERT INTO artifacts (id, task_id, project_id, type, uri, title, description, metadata, created_at, created_by, evolution_history, parent_artifact_id, content, content_type, content_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      artifact.id,
      artifact.taskId,
      artifact.projectId,
      artifact.type,
      artifact.uri,
      artifact.title || null,
      artifact.description || null,
      artifact.metadata ? JSON.stringify(artifact.metadata) : null,
      artifact.createdAt.getTime(),
      artifact.createdBy || null,
      artifact.evolutionHistory ? JSON.stringify(artifact.evolutionHistory) : null,
      artifact.parentArtifactId || null,
      artifact.content || null,
      artifact.contentType || null,
      artifact.contentSize || null
    );

    return artifact;
  }

  async getArtifact(id: string): Promise<Artifact | null> {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToArtifact(row);
  }

  async getArtifactsForTask(taskId: string, type?: ArtifactType): Promise<Artifact[]> {
    let query = 'SELECT * FROM artifacts WHERE task_id = ?';
    const params: any[] = [taskId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToArtifact(row));
  }

  async getArtifactsForProject(projectId: string, type?: ArtifactType): Promise<Artifact[]> {
    let query = 'SELECT * FROM artifacts WHERE project_id = ?';
    const params: any[] = [projectId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToArtifact(row));
  }

  async updateArtifact(id: string, updates: Partial<Artifact>): Promise<Artifact | null> {
    const existing = await this.getArtifact(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.uri !== undefined) {
      fields.push('uri = ?');
      values.push(updates.uri);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.evolutionHistory !== undefined) {
      fields.push('evolution_history = ?');
      values.push(JSON.stringify(updates.evolutionHistory));
    }
    if (updates.parentArtifactId !== undefined) {
      fields.push('parent_artifact_id = ?');
      values.push(updates.parentArtifactId);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.contentType !== undefined) {
      fields.push('content_type = ?');
      values.push(updates.contentType);
    }
    if (updates.contentSize !== undefined) {
      fields.push('content_size = ?');
      values.push(updates.contentSize);
    }

    if (fields.length === 0) return existing;

    values.push(id);

    const stmt = this.db.prepare(`UPDATE artifacts SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.getArtifact(id);
  }

  async deleteArtifact(id: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM artifacts WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async deleteArtifactsForTask(taskId: string): Promise<number> {
    const stmt = this.db.prepare('DELETE FROM artifacts WHERE task_id = ?');
    const result = stmt.run(taskId);
    return result.changes;
  }

  async getArtifactChildren(parentId: string): Promise<Artifact[]> {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE parent_artifact_id = ? ORDER BY created_at ASC');
    const rows = stmt.all(parentId) as any[];
    return rows.map(row => this.rowToArtifact(row));
  }

  /**
   * Full-text search on artifacts using FTS5
   * Returns matching artifacts with relevance snippets
   */
  async searchArtifacts(options: {
    query: string;
    projectId?: string;
    type?: ArtifactType;
    limit?: number;
  }): Promise<Array<{
    artifact: Artifact;
    snippet: string;
    rank: number;
  }>> {
    const { query, projectId, type, limit = 10 } = options;

    // Escape special FTS5 characters and prepare query
    const ftsQuery = query
      .replace(/[*+\-~"()]/g, ' ')  // Remove FTS5 operators
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `"${term}"*`)  // Prefix matching with quoted terms
      .join(' OR ');

    if (!ftsQuery) {
      return [];
    }

    // Build the search query with optional filters
    // Use snippet() for relevance context and bm25() for ranking
    let sql = `
      SELECT
        a.*,
        snippet(artifacts_fts, 3, '>>>>', '<<<<', '...', 32) as snippet,
        bm25(artifacts_fts) as rank
      FROM artifacts_fts fts
      JOIN artifacts a ON fts.id = a.id
      WHERE artifacts_fts MATCH ?
    `;

    const params: any[] = [ftsQuery];

    if (projectId) {
      sql += ' AND a.project_id = ?';
      params.push(projectId);
    }

    if (type) {
      sql += ' AND a.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      return rows.map(row => ({
        artifact: this.rowToArtifact(row),
        snippet: row.snippet || '',
        rank: row.rank || 0,
      }));
    } catch (error) {
      // FTS5 might not be available or query might be invalid
      console.error('Artifact search error:', error);
      return [];
    }
  }

  private rowToArtifact(row: any): Artifact {
    return {
      id: row.id,
      taskId: row.task_id,
      projectId: row.project_id,
      type: row.type as ArtifactType,
      uri: row.uri,
      title: row.title || undefined,
      description: row.description || undefined,
      metadata: safeJsonParse<any>(row.metadata, undefined),
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
      evolutionHistory: safeJsonParse<any>(row.evolution_history, undefined),
      parentArtifactId: row.parent_artifact_id || undefined,
      content: row.content || undefined,
      contentType: row.content_type || undefined,
      contentSize: row.content_size || undefined,
    };
  }

  // ============================================================================
  // Configuration Storage Methods
  // ============================================================================

  /**
   * Get project configuration from database
   */
  async getProjectConfig(projectId: string): Promise<{
    configJson: Record<string, unknown>;
    source: 'file' | 'database' | 'default';
    filePath?: string;
    fileHash?: string;
    teamId?: string;
    inheritFromTeam: boolean;
    syncedAt?: Date;
  } | null> {
    const stmt = this.db.prepare('SELECT * FROM project_config WHERE project_id = ?');
    const row = stmt.get(projectId) as any;

    if (!row) {
      return null;
    }

    return {
      configJson: safeJsonParse(row.config_json, {}),
      source: row.config_source,
      filePath: row.config_file_path || undefined,
      fileHash: row.config_file_hash || undefined,
      teamId: row.team_id || undefined,
      inheritFromTeam: row.inherit_from_team === 1,
      syncedAt: row.synced_at ? new Date(row.synced_at) : undefined,
    };
  }

  /**
   * Save project configuration to database
   */
  async saveProjectConfig(
    projectId: string,
    config: Record<string, unknown>,
    options: {
      source: 'file' | 'database' | 'default';
      filePath?: string;
      fileHash?: string;
      teamId?: string;
      inheritFromTeam?: boolean;
    }
  ): Promise<void> {
    const now = Date.now();
    const existing = await this.getProjectConfig(projectId);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE project_config
        SET config_json = ?, config_source = ?, config_file_path = ?,
            config_file_hash = ?, team_id = ?, inherit_from_team = ?,
            updated_at = ?, synced_at = ?
        WHERE project_id = ?
      `);
      stmt.run(
        JSON.stringify(config),
        options.source,
        options.filePath || null,
        options.fileHash || null,
        options.teamId || null,
        options.inheritFromTeam !== false ? 1 : 0,
        now,
        options.source === 'file' ? now : null,
        projectId
      );
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO project_config
        (id, project_id, team_id, config_json, config_source, config_file_path,
         config_file_hash, inherit_from_team, created_at, updated_at, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        uuidv4(),
        projectId,
        options.teamId || null,
        JSON.stringify(config),
        options.source,
        options.filePath || null,
        options.fileHash || null,
        options.inheritFromTeam !== false ? 1 : 0,
        now,
        now,
        options.source === 'file' ? now : null
      );
    }
  }

  /**
   * Get session configuration overrides
   */
  async getSessionConfig(sessionId: string): Promise<Record<string, unknown> | null> {
    const stmt = this.db.prepare('SELECT config_overrides, expires_at FROM session_config WHERE session_id = ?');
    const row = stmt.get(sessionId) as any;

    if (!row) {
      return null;
    }

    // Check if expired
    if (row.expires_at && row.expires_at < Date.now()) {
      // Clean up expired config
      this.db.prepare('DELETE FROM session_config WHERE session_id = ?').run(sessionId);
      return null;
    }

    return safeJsonParse(row.config_overrides, {});
  }

  /**
   * Set session configuration overrides
   */
  async setSessionConfig(
    sessionId: string,
    overrides: Record<string, unknown>,
    expiresInMinutes?: number
  ): Promise<void> {
    const now = Date.now();
    const expiresAt = expiresInMinutes ? now + expiresInMinutes * 60 * 1000 : null;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_config (id, session_id, config_overrides, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(uuidv4(), sessionId, JSON.stringify(overrides), now, expiresAt);
  }

  /**
   * Clear session configuration
   */
  async clearSessionConfig(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM session_config WHERE session_id = ?').run(sessionId);
  }

  /**
   * Log a configuration change for audit
   * Logs to both config_audit_log (config-specific) and audit_log (main enterprise audit)
   */
  async logConfigChange(entry: {
    scope: 'organization' | 'team' | 'project' | 'user' | 'session';
    scopeId: string;
    changeType: 'create' | 'update' | 'delete' | 'sync' | 'reset';
    configPath?: string;
    oldValue?: unknown;
    newValue?: unknown;
    changedBy?: string;
    reason?: string;
  }): Promise<string> {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO config_audit_log
      (id, scope, scope_id, change_type, config_path, old_value, new_value, changed_by, changed_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      entry.scope,
      entry.scopeId,
      entry.changeType,
      entry.configPath || null,
      entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      entry.changedBy || null,
      Date.now(),
      entry.reason || null
    );

    // Also log to main enterprise audit log for comprehensive compliance tracking
    const eventTypeMap: Record<string, string> = {
      create: 'config.created',
      update: 'config.updated',
      sync: 'config.synced',
      reset: 'config.reset',
      delete: 'config.updated', // Map delete to updated since config delete is rare
    };

    const eventType = eventTypeMap[entry.changeType] || 'config.updated';
    const action = entry.configPath
      ? `Configuration ${entry.changeType}: ${entry.configPath}`
      : `Configuration ${entry.changeType}`;

    await this.logAuditEvent({
      eventType,
      actorId: entry.changedBy || 'system',
      actorType: entry.changedBy === 'system' || entry.changedBy === 'file-sync' || entry.changedBy === 'project-activation'
        ? 'system'
        : 'user',
      projectId: entry.scope === 'project' ? entry.scopeId : 'system',
      resourceType: 'config',
      resourceId: entry.scopeId,
      action,
      beforeState: entry.oldValue,
      afterState: entry.newValue,
      metadata: {
        scope: entry.scope,
        configPath: entry.configPath,
        reason: entry.reason,
      },
    });

    return id;
  }

  /**
   * Get configuration audit log
   */
  async getConfigAuditLog(options: {
    scope?: string;
    scopeId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Array<{
    id: string;
    scope: string;
    scopeId: string;
    changeType: string;
    configPath?: string;
    oldValue?: unknown;
    newValue?: unknown;
    changedBy?: string;
    changedAt: Date;
    reason?: string;
  }>> {
    let query = 'SELECT * FROM config_audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (options.scope) {
      query += ' AND scope = ?';
      params.push(options.scope);
    }
    if (options.scopeId) {
      query += ' AND scope_id = ?';
      params.push(options.scopeId);
    }

    query += ' ORDER BY changed_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      scope: row.scope,
      scopeId: row.scope_id,
      changeType: row.change_type,
      configPath: row.config_path || undefined,
      oldValue: safeJsonParse<any>(row.old_value, undefined),
      newValue: safeJsonParse<any>(row.new_value, undefined),
      changedBy: row.changed_by || undefined,
      changedAt: new Date(row.changed_at),
      reason: row.reason || undefined,
    }));
  }

  /**
   * Clean up expired session configs
   */
  async cleanupExpiredSessionConfigs(): Promise<number> {
    const stmt = this.db.prepare('DELETE FROM session_config WHERE expires_at IS NOT NULL AND expires_at < ?');
    const result = stmt.run(Date.now());
    return result.changes;
  }

  // ========================================================================
  // Human Checkpoint Management
  // ========================================================================

  /**
   * Create a new human checkpoint
   */
  async createCheckpoint(checkpoint: {
    id: string;
    taskId: string;
    projectId: string;
    type: 'phase-gate' | 'decision-required' | 'review-required' | 'approval-required';
    status: 'pending' | 'approved' | 'rejected' | 'timed-out';
    phase?: number;
    reason: string;
    question?: string;
    options?: Array<{ id: string; label: string; description?: string; action?: string }>;
    context?: string;
    requestedBy: string;
    requestedAt: Date;
    timeoutMinutes?: number;
    escalateTo?: string;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints
        (id, task_id, project_id, type, status, phase, reason, question, options, context,
         requested_by, requested_at, timeout_minutes, escalate_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      checkpoint.id,
      checkpoint.taskId,
      checkpoint.projectId,
      checkpoint.type,
      checkpoint.status,
      checkpoint.phase ?? null,
      checkpoint.reason,
      checkpoint.question ?? null,
      checkpoint.options ? JSON.stringify(checkpoint.options) : null,
      checkpoint.context ?? null,
      checkpoint.requestedBy,
      checkpoint.requestedAt.getTime(),
      checkpoint.timeoutMinutes ?? null,
      checkpoint.escalateTo ?? null
    );
  }

  /**
   * Get a checkpoint by ID
   */
  async getCheckpoint(id: string): Promise<{
    id: string;
    taskId: string;
    projectId: string;
    type: string;
    status: string;
    phase?: number;
    reason: string;
    question?: string;
    options?: Array<{ id: string; label: string; description?: string; action?: string }>;
    context?: string;
    requestedBy: string;
    requestedAt: Date;
    respondedBy?: string;
    respondedAt?: Date;
    response?: string;
    selectedOption?: string;
    decision?: string;
    timeoutMinutes?: number;
    escalateTo?: string;
    escalatedAt?: Date;
  } | null> {
    const stmt = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapCheckpointRow(row);
  }

  /**
   * Get checkpoint by task ID (returns active pending checkpoint if any)
   */
  async getActiveCheckpointForTask(taskId: string): Promise<{
    id: string;
    taskId: string;
    projectId: string;
    type: string;
    status: string;
    phase?: number;
    reason: string;
    question?: string;
    options?: Array<{ id: string; label: string; description?: string; action?: string }>;
    context?: string;
    requestedBy: string;
    requestedAt: Date;
    respondedBy?: string;
    respondedAt?: Date;
    response?: string;
    selectedOption?: string;
    decision?: string;
    timeoutMinutes?: number;
    escalateTo?: string;
    escalatedAt?: Date;
  } | null> {
    const stmt = this.db.prepare('SELECT * FROM checkpoints WHERE task_id = ? AND status = ? ORDER BY requested_at DESC LIMIT 1');
    const row = stmt.get(taskId, 'pending') as any;
    if (!row) return null;
    return this.mapCheckpointRow(row);
  }

  /**
   * Get all pending checkpoints for a project
   */
  async getPendingCheckpoints(projectId?: string): Promise<Array<{
    id: string;
    taskId: string;
    projectId: string;
    type: string;
    status: string;
    phase?: number;
    reason: string;
    question?: string;
    options?: Array<{ id: string; label: string; description?: string; action?: string }>;
    context?: string;
    requestedBy: string;
    requestedAt: Date;
    timeoutMinutes?: number;
    escalateTo?: string;
  }>> {
    let query = 'SELECT * FROM checkpoints WHERE status = ?';
    const params: unknown[] = ['pending'];

    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }

    query += ' ORDER BY requested_at ASC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    return rows.map(row => this.mapCheckpointRow(row));
  }

  /**
   * Respond to a checkpoint (approve, reject, or provide input)
   */
  async respondToCheckpoint(
    checkpointId: string,
    response: {
      respondedBy: string;
      response?: string;
      selectedOption?: string;
      decision: 'approve' | 'reject' | 'redirect';
    }
  ): Promise<boolean> {
    const newStatus = response.decision === 'approve' ? 'approved' :
                      response.decision === 'reject' ? 'rejected' : 'pending';

    const stmt = this.db.prepare(`
      UPDATE checkpoints SET
        status = ?,
        responded_by = ?,
        responded_at = ?,
        response = ?,
        selected_option = ?,
        decision = ?
      WHERE id = ? AND status = 'pending'
    `);

    const result = stmt.run(
      newStatus,
      response.respondedBy,
      Date.now(),
      response.response ?? null,
      response.selectedOption ?? null,
      response.decision,
      checkpointId
    );

    return result.changes > 0;
  }

  /**
   * Mark a checkpoint as timed out
   */
  async timeoutCheckpoint(checkpointId: string): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE checkpoints SET status = 'timed-out' WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(checkpointId);
    return result.changes > 0;
  }

  /**
   * Mark a checkpoint as escalated
   */
  async escalateCheckpoint(checkpointId: string): Promise<boolean> {
    const stmt = this.db.prepare(`
      UPDATE checkpoints SET escalated_at = ? WHERE id = ? AND status = 'pending'
    `);
    const result = stmt.run(Date.now(), checkpointId);
    return result.changes > 0;
  }

  /**
   * Get checkpoint history for a task
   */
  async getCheckpointHistory(taskId: string): Promise<Array<{
    id: string;
    taskId: string;
    projectId: string;
    type: string;
    status: string;
    phase?: number;
    reason: string;
    requestedBy: string;
    requestedAt: Date;
    respondedBy?: string;
    respondedAt?: Date;
    response?: string;
    decision?: string;
  }>> {
    const stmt = this.db.prepare('SELECT * FROM checkpoints WHERE task_id = ? ORDER BY requested_at DESC');
    const rows = stmt.all(taskId) as any[];
    return rows.map(row => this.mapCheckpointRow(row));
  }

  /**
   * Helper to map database row to checkpoint object
   */
  private mapCheckpointRow(row: any): {
    id: string;
    taskId: string;
    projectId: string;
    type: string;
    status: string;
    phase?: number;
    reason: string;
    question?: string;
    options?: Array<{ id: string; label: string; description?: string; action?: string }>;
    context?: string;
    requestedBy: string;
    requestedAt: Date;
    respondedBy?: string;
    respondedAt?: Date;
    response?: string;
    selectedOption?: string;
    decision?: string;
    timeoutMinutes?: number;
    escalateTo?: string;
    escalatedAt?: Date;
  } {
    return {
      id: row.id,
      taskId: row.task_id,
      projectId: row.project_id,
      type: row.type,
      status: row.status,
      phase: row.phase ?? undefined,
      reason: row.reason,
      question: row.question ?? undefined,
      options: safeJsonParse<any>(row.options, undefined),
      context: row.context ?? undefined,
      requestedBy: row.requested_by,
      requestedAt: new Date(row.requested_at),
      respondedBy: row.responded_by ?? undefined,
      respondedAt: row.responded_at ? new Date(row.responded_at) : undefined,
      response: row.response ?? undefined,
      selectedOption: row.selected_option ?? undefined,
      decision: row.decision ?? undefined,
      timeoutMinutes: row.timeout_minutes ?? undefined,
      escalateTo: row.escalate_to ?? undefined,
      escalatedAt: row.escalated_at ? new Date(row.escalated_at) : undefined,
    };
  }

  // ========================================================================
  // Initiative Management (Outcome Tracking)
  // ========================================================================

  /**
   * Create a new initiative (goal with success criteria)
   */
  async createInitiative(initiative: {
    id: string;
    projectId: string;
    title: string;
    description?: string;
    successCriteria?: string;
    createdBy?: string;
  }): Promise<void> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO initiatives (id, project_id, title, description, success_criteria, status, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `);
    stmt.run(
      initiative.id,
      initiative.projectId,
      initiative.title,
      initiative.description || null,
      initiative.successCriteria || null,
      now,
      now,
      initiative.createdBy || null
    );
  }

  /**
   * Get an initiative by ID
   */
  async getInitiative(id: string): Promise<{
    id: string;
    projectId: string;
    title: string;
    description?: string;
    successCriteria?: string;
    status: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    outcomeNotes?: string;
    outcomeRecordedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
    createdBy?: string;
    tasks: Array<{ taskId: string; contributionNotes?: string; linkedAt: Date }>;
  } | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM initiatives WHERE id = ?
    `);
    const row = stmt.get(id) as any;
    if (!row) return null;

    // Get linked tasks
    const tasksStmt = this.db.prepare(`
      SELECT task_id, contribution_notes, linked_at
      FROM task_initiatives WHERE initiative_id = ?
    `);
    const taskRows = tasksStmt.all(id) as any[];

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description || undefined,
      successCriteria: row.success_criteria || undefined,
      status: row.status,
      outcomeNotes: row.outcome_notes || undefined,
      outcomeRecordedAt: row.outcome_recorded_at ? new Date(row.outcome_recorded_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      createdBy: row.created_by || undefined,
      tasks: taskRows.map(t => ({
        taskId: t.task_id,
        contributionNotes: t.contribution_notes || undefined,
        linkedAt: new Date(t.linked_at),
      })),
    };
  }

  /**
   * List initiatives for a project
   */
  async listInitiatives(options: {
    projectId?: string;
    status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    projectId: string;
    title: string;
    status: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    taskCount: number;
    createdAt: Date;
  }>> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.projectId) {
      conditions.push('i.project_id = ?');
      params.push(options.projectId);
    }
    if (options.status) {
      conditions.push('i.status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 50;

    const stmt = this.db.prepare(`
      SELECT i.*, COUNT(ti.task_id) as task_count
      FROM initiatives i
      LEFT JOIN task_initiatives ti ON i.id = ti.initiative_id
      ${whereClause}
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(...params, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      taskCount: row.task_count,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Link a task to an initiative
   */
  async linkTaskToInitiative(options: {
    taskId: string;
    initiativeId: string;
    contributionNotes?: string;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO task_initiatives (task_id, initiative_id, linked_at, contribution_notes)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(
      options.taskId,
      options.initiativeId,
      Date.now(),
      options.contributionNotes || null
    );
  }

  /**
   * Unlink a task from an initiative
   */
  async unlinkTaskFromInitiative(taskId: string, initiativeId: string): Promise<void> {
    const stmt = this.db.prepare(`
      DELETE FROM task_initiatives WHERE task_id = ? AND initiative_id = ?
    `);
    stmt.run(taskId, initiativeId);
  }

  /**
   * Get initiatives linked to a task
   */
  async getTaskInitiatives(taskId: string): Promise<Array<{
    id: string;
    title: string;
    status: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    contributionNotes?: string;
  }>> {
    const stmt = this.db.prepare(`
      SELECT i.id, i.title, i.status, ti.contribution_notes
      FROM initiatives i
      JOIN task_initiatives ti ON i.id = ti.initiative_id
      WHERE ti.task_id = ?
    `);
    const rows = stmt.all(taskId) as any[];

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      status: row.status,
      contributionNotes: row.contribution_notes || undefined,
    }));
  }

  /**
   * Record outcome for an initiative
   */
  async recordInitiativeOutcome(options: {
    initiativeId: string;
    status: 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    outcomeNotes: string;
  }): Promise<void> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE initiatives
      SET status = ?, outcome_notes = ?, outcome_recorded_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      options.status,
      options.outcomeNotes,
      now,
      now,
      options.initiativeId
    );
  }

  /**
   * Update an initiative's fields
   */
  async updateInitiative(options: {
    initiativeId: string;
    title?: string;
    description?: string;
    successCriteria?: string;
    status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    outcomeNotes?: string;
    projectId?: string;
  }): Promise<void> {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (options.title !== undefined) {
      sets.push('title = ?');
      values.push(options.title);
    }
    if (options.description !== undefined) {
      sets.push('description = ?');
      values.push(options.description);
    }
    if (options.successCriteria !== undefined) {
      sets.push('success_criteria = ?');
      values.push(options.successCriteria);
    }
    if (options.status !== undefined) {
      sets.push('status = ?');
      values.push(options.status);
      // Auto-set outcome_recorded_at for terminal statuses
      if (['succeeded', 'failed', 'pivoted', 'abandoned'].includes(options.status)) {
        sets.push('outcome_recorded_at = COALESCE(outcome_recorded_at, ?)');
        values.push(now);
      }
    }
    if (options.outcomeNotes !== undefined) {
      sets.push('outcome_notes = ?');
      values.push(options.outcomeNotes);
    }
    if (options.projectId !== undefined) {
      sets.push('project_id = ?');
      values.push(options.projectId);
    }

    values.push(options.initiativeId);
    const stmt = this.db.prepare(`
      UPDATE initiatives SET ${sets.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);
  }

  /**
   * Get learnings from initiatives (patterns of success/failure)
   */
  async getInitiativeLearnings(options: {
    projectId?: string;
    includeActive?: boolean;
  } = {}): Promise<{
    summary: {
      total: number;
      succeeded: number;
      failed: number;
      pivoted: number;
      abandoned: number;
      active: number;
      successRate: number;
    };
    succeededInitiatives: Array<{
      id: string;
      title: string;
      outcomeNotes?: string;
      taskCount: number;
    }>;
    failedInitiatives: Array<{
      id: string;
      title: string;
      outcomeNotes?: string;
      taskCount: number;
    }>;
  }> {
    const projectCondition = options.projectId ? 'AND i.project_id = ?' : '';
    const params: any[] = options.projectId ? [options.projectId] : [];

    // Get counts by status
    const countStmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM initiatives i
      WHERE 1=1 ${projectCondition}
      GROUP BY status
    `);
    const counts = countStmt.all(...params) as any[];

    const statusCounts: Record<string, number> = {
      active: 0,
      succeeded: 0,
      failed: 0,
      pivoted: 0,
      abandoned: 0,
    };
    for (const row of counts) {
      statusCounts[row.status] = row.count;
    }

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const completedTotal = statusCounts.succeeded + statusCounts.failed + statusCounts.pivoted;
    const successRate = completedTotal > 0 ? statusCounts.succeeded / completedTotal : 0;

    // Get succeeded initiatives with task counts
    const succeededStmt = this.db.prepare(`
      SELECT i.id, i.title, i.outcome_notes, COUNT(ti.task_id) as task_count
      FROM initiatives i
      LEFT JOIN task_initiatives ti ON i.id = ti.initiative_id
      WHERE i.status = 'succeeded' ${projectCondition}
      GROUP BY i.id
      ORDER BY i.outcome_recorded_at DESC
      LIMIT 10
    `);
    const succeeded = succeededStmt.all(...params) as any[];

    // Get failed initiatives with task counts
    const failedStmt = this.db.prepare(`
      SELECT i.id, i.title, i.outcome_notes, COUNT(ti.task_id) as task_count
      FROM initiatives i
      LEFT JOIN task_initiatives ti ON i.id = ti.initiative_id
      WHERE i.status = 'failed' ${projectCondition}
      GROUP BY i.id
      ORDER BY i.outcome_recorded_at DESC
      LIMIT 10
    `);
    const failed = failedStmt.all(...params) as any[];

    return {
      summary: {
        total,
        succeeded: statusCounts.succeeded,
        failed: statusCounts.failed,
        pivoted: statusCounts.pivoted,
        abandoned: statusCounts.abandoned,
        active: statusCounts.active,
        successRate,
      },
      succeededInitiatives: succeeded.map(row => ({
        id: row.id,
        title: row.title,
        outcomeNotes: row.outcome_notes || undefined,
        taskCount: row.task_count,
      })),
      failedInitiatives: failed.map(row => ({
        id: row.id,
        title: row.title,
        outcomeNotes: row.outcome_notes || undefined,
        taskCount: row.task_count,
      })),
    };
  }

  // ========================================================================
  // Task Relationships (semantic links beyond blocking dependencies)
  // ========================================================================

  /**
   * Create a semantic relationship between two tasks
   */
  async createTaskRelationship(
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType: TaskRelationshipType,
    options?: {
      description?: string;
      confidence?: number;
      source?: TaskRelationshipSource;
      createdBy?: string;
    }
  ): Promise<TaskRelationship> {
    const id = uuidv4();
    const now = Date.now();
    const confidence = options?.confidence ?? 1.0;
    const source = options?.source ?? 'manual';

    const stmt = this.db.prepare(`
      INSERT INTO task_relationships (id, source_task_id, target_task_id, relationship_type, description, confidence, source, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      sourceTaskId,
      targetTaskId,
      relationshipType,
      options?.description || null,
      confidence,
      source,
      now,
      options?.createdBy || null
    );

    return {
      id,
      sourceTaskId,
      targetTaskId,
      relationshipType,
      description: options?.description,
      confidence,
      source,
      createdAt: new Date(now),
      createdBy: options?.createdBy,
    };
  }

  /**
   * Remove a relationship between two tasks
   */
  async removeTaskRelationship(
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType?: TaskRelationshipType
  ): Promise<boolean> {
    let sql = 'DELETE FROM task_relationships WHERE source_task_id = ? AND target_task_id = ?';
    const params: (string | undefined)[] = [sourceTaskId, targetTaskId];

    if (relationshipType) {
      sql += ' AND relationship_type = ?';
      params.push(relationshipType);
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return result.changes > 0;
  }

  /**
   * Get all relationships for a task (both as source and target)
   */
  async getTaskRelationships(
    taskId: string,
    options?: {
      relationshipType?: TaskRelationshipType;
      direction?: 'outgoing' | 'incoming' | 'both';
      minConfidence?: number;
    }
  ): Promise<TaskRelationship[]> {
    const direction = options?.direction ?? 'both';
    const minConfidence = options?.minConfidence ?? 0;

    let sql = '';
    const params: (string | number)[] = [];

    if (direction === 'outgoing' || direction === 'both') {
      sql = 'SELECT * FROM task_relationships WHERE source_task_id = ?';
      params.push(taskId);
      if (options?.relationshipType) {
        sql += ' AND relationship_type = ?';
        params.push(options.relationshipType);
      }
      sql += ' AND confidence >= ?';
      params.push(minConfidence);
    }

    if (direction === 'incoming' || direction === 'both') {
      const incomingSql = 'SELECT * FROM task_relationships WHERE target_task_id = ?' +
        (options?.relationshipType ? ' AND relationship_type = ?' : '') +
        ' AND confidence >= ?';

      if (direction === 'both') {
        sql += ' UNION ' + incomingSql;
        params.push(taskId);
        if (options?.relationshipType) params.push(options.relationshipType);
        params.push(minConfidence);
      } else {
        sql = incomingSql;
        params.push(taskId);
        if (options?.relationshipType) params.push(options.relationshipType);
        params.push(minConfidence);
      }
    }

    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToTaskRelationship(row));
  }

  /**
   * Get related task IDs (tasks that have any relationship with the given task)
   */
  async getRelatedTaskIds(taskId: string): Promise<string[]> {
    const relationships = await this.getTaskRelationships(taskId);
    const relatedIds = new Set<string>();

    for (const rel of relationships) {
      if (rel.sourceTaskId === taskId) {
        relatedIds.add(rel.targetTaskId);
      } else {
        relatedIds.add(rel.sourceTaskId);
      }
    }

    return Array.from(relatedIds);
  }

  /**
   * Find tasks with similar file patterns (for relationship suggestions)
   */
  async findTasksWithFileOverlap(taskId: string, projectId: string): Promise<Array<{taskId: string; overlapScore: number}>> {
    // Get the task's files
    const task = await this.getTask(taskId);
    if (!task || !task.files || task.files.length === 0) {
      return [];
    }

    const taskFiles = new Set(task.files);

    // Get all other tasks in the project with files
    const stmt = this.db.prepare(`
      SELECT id, files FROM tasks
      WHERE project_id = ? AND id != ? AND files IS NOT NULL AND status != 'completed'
    `);
    const rows = stmt.all(projectId, taskId) as any[];

    const overlaps: Array<{taskId: string; overlapScore: number}> = [];

    for (const row of rows) {
      const otherFiles: string[] = safeJsonParse(row.files, []);
      if (otherFiles.length === 0) continue;

      // Calculate Jaccard similarity
      const otherSet = new Set(otherFiles);
      let intersection = 0;
      for (const f of taskFiles) {
        if (otherSet.has(f)) intersection++;
      }

      const union = taskFiles.size + otherSet.size - intersection;
      const overlapScore = union > 0 ? intersection / union : 0;

      if (overlapScore > 0) {
        overlaps.push({ taskId: row.id, overlapScore });
      }
    }

    // Sort by overlap score descending
    return overlaps.sort((a, b) => b.overlapScore - a.overlapScore);
  }

  /**
   * Check if a relationship already exists
   */
  async relationshipExists(
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType: TaskRelationshipType
  ): Promise<boolean> {
    const stmt = this.db.prepare(`
      SELECT 1 FROM task_relationships
      WHERE source_task_id = ? AND target_task_id = ? AND relationship_type = ?
    `);
    const row = stmt.get(sourceTaskId, targetTaskId, relationshipType);
    return !!row;
  }

  /**
   * Convert database row to TaskRelationship
   */
  private rowToTaskRelationship(row: any): TaskRelationship {
    return {
      id: row.id,
      sourceTaskId: row.source_task_id,
      targetTaskId: row.target_task_id,
      relationshipType: row.relationship_type as TaskRelationshipType,
      description: row.description || undefined,
      confidence: row.confidence,
      source: row.source as TaskRelationshipSource | undefined,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
    };
  }

  // ============================================================================
  // Entity Hierarchy System
  // ============================================================================

  /**
   * Create a hierarchy definition for a project
   */
  async createHierarchyDefinition(definition: {
    projectId: string;
    name: string;
    description?: string;
    levels: Array<{
      id: string;
      name: string;
      pluralName: string;
      order: number;
      description?: string;
      color?: string;
      icon?: string;
    }>;
  }): Promise<HierarchyDefinition> {
    const id = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO hierarchy_definitions (id, project_id, name, description, levels, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      definition.projectId,
      definition.name,
      definition.description || null,
      JSON.stringify(definition.levels),
      now,
      now
    );

    return {
      id,
      projectId: definition.projectId,
      name: definition.name,
      description: definition.description,
      levels: definition.levels,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * Get hierarchy definitions for a project
   */
  async getHierarchyDefinitions(projectId: string): Promise<HierarchyDefinition[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM hierarchy_definitions WHERE project_id = ?
    `);
    const rows = stmt.all(projectId) as any[];

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || undefined,
      levels: safeJsonParse(row.levels, []),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Get a specific hierarchy definition
   */
  async getHierarchyDefinition(id: string): Promise<HierarchyDefinition | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM hierarchy_definitions WHERE id = ?
    `);
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || undefined,
      levels: safeJsonParse(row.levels, []),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Create a hierarchy node (tag an entity with a position in the hierarchy)
   */
  async createHierarchyNode(node: {
    hierarchyId: string;
    levelId: string;
    parentNodeId?: string;
    entityType: HierarchyEntityType;
    entityId: string;
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<HierarchyNode> {
    const id = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO hierarchy_nodes (id, hierarchy_id, level_id, parent_node_id, entity_type, entity_id, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      node.hierarchyId,
      node.levelId,
      node.parentNodeId || null,
      node.entityType,
      node.entityId,
      node.name,
      node.metadata ? JSON.stringify(node.metadata) : null,
      now,
      now
    );

    return {
      id,
      hierarchyId: node.hierarchyId,
      levelId: node.levelId,
      parentNodeId: node.parentNodeId,
      entityType: node.entityType,
      entityId: node.entityId,
      name: node.name,
      metadata: node.metadata,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * Get a hierarchy node by ID
   */
  async getHierarchyNode(id: string): Promise<HierarchyNode | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM hierarchy_nodes WHERE id = ?
    `);
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToHierarchyNode(row);
  }

  /**
   * Get hierarchy node for an entity
   */
  async getHierarchyNodeForEntity(
    entityType: HierarchyEntityType,
    entityId: string
  ): Promise<HierarchyNode | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM hierarchy_nodes WHERE entity_type = ? AND entity_id = ?
    `);
    const row = stmt.get(entityType, entityId) as any;

    if (!row) return null;

    return this.rowToHierarchyNode(row);
  }

  /**
   * Get ancestors of a node (what contains this?)
   */
  async getAncestors(nodeId: string): Promise<HierarchyNode[]> {
    const ancestors: HierarchyNode[] = [];
    let currentNode = await this.getHierarchyNode(nodeId);

    while (currentNode?.parentNodeId) {
      const parent = await this.getHierarchyNode(currentNode.parentNodeId);
      if (parent) {
        ancestors.push(parent);
        currentNode = parent;
      } else {
        break;
      }
    }

    return ancestors;
  }

  /**
   * Get descendants of a node (what does this contain?)
   */
  async getDescendants(nodeId: string): Promise<HierarchyNode[]> {
    const descendants: HierarchyNode[] = [];
    const queue = [nodeId];

    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const stmt = this.db.prepare(`
        SELECT * FROM hierarchy_nodes WHERE parent_node_id = ?
      `);
      const children = stmt.all(parentId) as any[];

      for (const row of children) {
        const node = this.rowToHierarchyNode(row);
        descendants.push(node);
        queue.push(node.id);
      }
    }

    return descendants;
  }

  /**
   * Get siblings of a node (same level, same parent)
   */
  async getSiblings(nodeId: string): Promise<HierarchyNode[]> {
    const node = await this.getHierarchyNode(nodeId);
    if (!node) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM hierarchy_nodes
      WHERE hierarchy_id = ? AND level_id = ? AND parent_node_id IS ? AND id != ?
    `);
    const rows = stmt.all(
      node.hierarchyId,
      node.levelId,
      node.parentNodeId || null,
      nodeId
    ) as any[];

    return rows.map(row => this.rowToHierarchyNode(row));
  }

  /**
   * Get all nodes at a specific level (cross-level query)
   */
  async getNodesAtLevel(hierarchyId: string, levelId: string): Promise<HierarchyNode[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM hierarchy_nodes WHERE hierarchy_id = ? AND level_id = ?
    `);
    const rows = stmt.all(hierarchyId, levelId) as any[];

    return rows.map(row => this.rowToHierarchyNode(row));
  }

  /**
   * Delete a hierarchy node and optionally its descendants
   */
  async deleteHierarchyNode(nodeId: string, deleteDescendants: boolean = false): Promise<boolean> {
    if (deleteDescendants) {
      const descendants = await this.getDescendants(nodeId);
      for (const desc of descendants.reverse()) {
        this.db.prepare('DELETE FROM hierarchy_nodes WHERE id = ?').run(desc.id);
      }
    }

    const stmt = this.db.prepare('DELETE FROM hierarchy_nodes WHERE id = ?');
    const result = stmt.run(nodeId);
    return result.changes > 0;
  }

  /**
   * Convert database row to HierarchyNode
   */
  private rowToHierarchyNode(row: any): HierarchyNode {
    return {
      id: row.id,
      hierarchyId: row.hierarchy_id,
      levelId: row.level_id,
      parentNodeId: row.parent_node_id || undefined,
      entityType: row.entity_type as HierarchyEntityType,
      entityId: row.entity_id,
      name: row.name,
      metadata: safeJsonParse<any>(row.metadata, undefined),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Get hierarchy node by source ID (entity_id) within a hierarchy
   */
  async getHierarchyNodeBySourceId(
    hierarchyId: string,
    sourceId: string
  ): Promise<HierarchyNode | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM hierarchy_nodes WHERE hierarchy_id = ? AND entity_id = ?
    `);
    const row = stmt.get(hierarchyId, sourceId) as any;

    if (!row) return null;

    return this.rowToHierarchyNode(row);
  }

  /**
   * Update a hierarchy node
   */
  async updateHierarchyNode(
    id: string,
    updates: Partial<HierarchyNode>
  ): Promise<HierarchyNode> {
    const existing = await this.getHierarchyNode(id);
    if (!existing) {
      throw new Error(`Hierarchy node not found: ${id}`);
    }

    const now = Date.now();
    const updateFields: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.levelId !== undefined) {
      updateFields.push('level_id = ?');
      values.push(updates.levelId);
    }
    if (updates.parentNodeId !== undefined) {
      updateFields.push('parent_node_id = ?');
      values.push(updates.parentNodeId);
    }
    if (updates.metadata !== undefined) {
      updateFields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE hierarchy_nodes SET ${updateFields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);

    return (await this.getHierarchyNode(id))!;
  }

  /**
   * Archive a hierarchy node (soft delete with reason)
   */
  async archiveHierarchyNode(id: string, reason: string): Promise<void> {
    const existing = await this.getHierarchyNode(id);
    if (!existing) {
      throw new Error(`Hierarchy node not found: ${id}`);
    }

    const metadata = existing.metadata || {};
    await this.updateHierarchyNode(id, {
      metadata: {
        ...metadata,
        archived: true,
        archivedAt: new Date().toISOString(),
        archivedReason: reason,
      },
    });
  }

  // ============================================================================
  // Source Ingestion Storage
  // ============================================================================

  /**
   * Create a source configuration
   */
  async createSourceConfig(
    config: Omit<SourceConfig, 'id'>
  ): Promise<SourceConfig> {
    const id = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO source_configs (
        id, project_id, source_type, name, location, config,
        auto_sync, sync_interval_minutes, hierarchy_id, level_mappings,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      config.projectId,
      config.sourceType,
      config.name,
      config.location,
      JSON.stringify(config.config),
      config.autoSync ? 1 : 0,
      config.syncIntervalMinutes || null,
      config.hierarchyId || null,
      config.levelMappings ? JSON.stringify(config.levelMappings) : null,
      now,
      now
    );

    return {
      id,
      ...config,
    };
  }

  /**
   * Get a source configuration by ID
   */
  async getSourceConfig(id: string): Promise<SourceConfig | null> {
    const stmt = this.db.prepare(`SELECT * FROM source_configs WHERE id = ?`);
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToSourceConfig(row);
  }

  /**
   * Get all source configurations for a project
   */
  async getSourceConfigs(projectId: string): Promise<SourceConfig[]> {
    const stmt = this.db.prepare(`SELECT * FROM source_configs WHERE project_id = ?`);
    const rows = stmt.all(projectId) as any[];

    return rows.map(row => this.rowToSourceConfig(row));
  }

  /**
   * Update a source configuration
   */
  async updateSourceConfig(
    id: string,
    updates: Partial<SourceConfig>
  ): Promise<SourceConfig> {
    const existing = await this.getSourceConfig(id);
    if (!existing) {
      throw new Error(`Source config not found: ${id}`);
    }

    const now = Date.now();
    const updateFields: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.location !== undefined) {
      updateFields.push('location = ?');
      values.push(updates.location);
    }
    if (updates.config !== undefined) {
      updateFields.push('config = ?');
      values.push(JSON.stringify(updates.config));
    }
    if (updates.autoSync !== undefined) {
      updateFields.push('auto_sync = ?');
      values.push(updates.autoSync ? 1 : 0);
    }
    if (updates.syncIntervalMinutes !== undefined) {
      updateFields.push('sync_interval_minutes = ?');
      values.push(updates.syncIntervalMinutes);
    }
    if (updates.lastIngestedAt !== undefined) {
      updateFields.push('last_ingested_at = ?');
      values.push(updates.lastIngestedAt.getTime());
    }
    if (updates.hierarchyId !== undefined) {
      updateFields.push('hierarchy_id = ?');
      values.push(updates.hierarchyId);
    }
    if (updates.levelMappings !== undefined) {
      updateFields.push('level_mappings = ?');
      values.push(JSON.stringify(updates.levelMappings));
    }

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE source_configs SET ${updateFields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);

    return (await this.getSourceConfig(id))!;
  }

  /**
   * Delete a source configuration
   */
  async deleteSourceConfig(id: string): Promise<boolean> {
    const stmt = this.db.prepare(`DELETE FROM source_configs WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Convert database row to SourceConfig
   */
  private rowToSourceConfig(row: any): SourceConfig {
    return {
      id: row.id,
      projectId: row.project_id,
      sourceType: row.source_type,
      name: row.name,
      location: row.location,
      config: safeJsonParse(row.config, {}),
      autoSync: row.auto_sync === 1,
      syncIntervalMinutes: row.sync_interval_minutes || undefined,
      lastIngestedAt: row.last_ingested_at ? new Date(row.last_ingested_at) : undefined,
      hierarchyId: row.hierarchy_id || undefined,
      levelMappings: safeJsonParse<any>(row.level_mappings, undefined),
    };
  }

  // ============================================================================
  // Ingestion Jobs
  // ============================================================================

  /**
   * Create an ingestion job
   */
  async createIngestionJob(
    job: Omit<IngestionJob, 'id'>
  ): Promise<IngestionJob> {
    const id = uuidv4();

    const stmt = this.db.prepare(`
      INSERT INTO ingestion_jobs (
        id, source_id, project_id, status, started_at, completed_at,
        result, reconciliation_result, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      job.sourceId,
      job.projectId,
      job.status,
      job.startedAt.getTime(),
      job.completedAt?.getTime() || null,
      job.result ? JSON.stringify(job.result) : null,
      job.reconciliationResult ? JSON.stringify(job.reconciliationResult) : null,
      job.error || null
    );

    return {
      id,
      ...job,
    };
  }

  /**
   * Get an ingestion job by ID
   */
  async getIngestionJob(id: string): Promise<IngestionJob | null> {
    const stmt = this.db.prepare(`SELECT * FROM ingestion_jobs WHERE id = ?`);
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToIngestionJob(row);
  }

  /**
   * Get ingestion jobs for a source
   */
  async getIngestionJobs(sourceId: string, limit = 10): Promise<IngestionJob[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM ingestion_jobs
      WHERE source_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(sourceId, limit) as any[];

    return rows.map(row => this.rowToIngestionJob(row));
  }

  /**
   * Update an ingestion job
   */
  async updateIngestionJob(
    id: string,
    updates: Partial<IngestionJob>
  ): Promise<IngestionJob> {
    const existing = await this.getIngestionJob(id);
    if (!existing) {
      throw new Error(`Ingestion job not found: ${id}`);
    }

    const updateFields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.completedAt !== undefined) {
      updateFields.push('completed_at = ?');
      values.push(updates.completedAt.getTime());
    }
    if (updates.result !== undefined) {
      updateFields.push('result = ?');
      values.push(JSON.stringify(updates.result));
    }
    if (updates.reconciliationResult !== undefined) {
      updateFields.push('reconciliation_result = ?');
      values.push(JSON.stringify(updates.reconciliationResult));
    }
    if (updates.error !== undefined) {
      updateFields.push('error = ?');
      values.push(updates.error);
    }

    if (updateFields.length === 0) {
      return existing;
    }

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE ingestion_jobs SET ${updateFields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);

    return (await this.getIngestionJob(id))!;
  }

  /**
   * Convert database row to IngestionJob
   */
  private rowToIngestionJob(row: any): IngestionJob {
    return {
      id: row.id,
      sourceId: row.source_id,
      projectId: row.project_id,
      status: row.status,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      result: safeJsonParse<any>(row.result, undefined),
      reconciliationResult: safeJsonParse<any>(row.reconciliation_result, undefined),
      error: row.error || undefined,
    };
  }

  // ============================================================================
  // Ingestion Snapshots
  // ============================================================================

  /**
   * Save an ingestion snapshot
   */
  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    const id = uuidv4();

    // Convert Maps to objects for JSON storage
    const entityHashes: Record<string, string> = {};
    snapshot.entityHashes.forEach((hash, key) => {
      entityHashes[key] = hash;
    });

    const relationshipHashes: Record<string, string> = {};
    snapshot.relationshipHashes.forEach((hash, key) => {
      relationshipHashes[key] = hash;
    });

    const stmt = this.db.prepare(`
      INSERT INTO ingestion_snapshots (id, source_id, timestamp, entity_hashes, relationship_hashes)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      snapshot.sourceId,
      snapshot.timestamp.getTime(),
      JSON.stringify(entityHashes),
      JSON.stringify(relationshipHashes)
    );
  }

  /**
   * Get the latest snapshot for a source
   */
  async getLatestSnapshot(sourceId: string): Promise<Snapshot | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM ingestion_snapshots
      WHERE source_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    const row = stmt.get(sourceId) as any;

    if (!row) return null;

    // Convert objects back to Maps
    const entityHashesObj = safeJsonParse<Record<string, string>>(row.entity_hashes, {});
    const entityHashes = new Map<string, string>();
    for (const [key, value] of Object.entries(entityHashesObj)) {
      entityHashes.set(key, value);
    }

    const relHashesObj = safeJsonParse<Record<string, string>>(row.relationship_hashes, {});
    const relationshipHashes = new Map<string, string>();
    for (const [key, value] of Object.entries(relHashesObj)) {
      relationshipHashes.set(key, value);
    }

    return {
      timestamp: new Date(row.timestamp),
      sourceId: row.source_id,
      entityHashes,
      relationshipHashes,
    };
  }

  // ============================================================================
  // Knowledge Entity Methods (Crystallization)
  // ============================================================================

  private rowToKnowledgeEntity(row: any): KnowledgeEntity {
    return {
      id: row.id,
      projectId: row.project_id,
      type: row.type as KnowledgeEntityType,
      title: row.title,
      content: row.content,
      summary: row.summary || undefined,
      parentId: row.parent_id || undefined,
      disposition: row.disposition as KnowledgeDisposition,
      proposedBy: row.proposed_by || undefined,
      proposedAt: row.proposed_at ? new Date(row.proposed_at) : undefined,
      approvedBy: safeJsonParse<string[] | undefined>(row.approved_by, undefined),
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
      reviewDueDate: row.review_due_date ? new Date(row.review_due_date) : undefined,
      supersededById: row.superseded_by_id || undefined,
      sourceDecisionIds: safeJsonParse<string[] | undefined>(row.source_decision_ids, undefined),
      sourceArtifactIds: safeJsonParse<string[] | undefined>(row.source_artifact_ids, undefined),
      sourceTaskIds: safeJsonParse<string[] | undefined>(row.source_task_ids, undefined),
      sourceChatUris: safeJsonParse<string[] | undefined>(row.source_chat_uris, undefined),
      tags: safeJsonParse<string[] | undefined>(row.tags, undefined),
      scope: safeJsonParse<KnowledgeScope | undefined>(row.scope, undefined),
      applicableFilePatterns: safeJsonParse<string[] | undefined>(row.applicable_file_patterns, undefined),
      usageCount: row.usage_count || 0,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
      effectivenessScore: row.effectiveness_score || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      createdBy: row.created_by || undefined,
      version: row.version || 1,
    };
  }

  private rowToKnowledgeRelationship(row: any): KnowledgeRelationship {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationshipType: row.relationship_type as KnowledgeRelationshipType,
      description: row.description || undefined,
      confidence: row.confidence,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by || undefined,
    };
  }

  async saveKnowledgeEntity(entity: KnowledgeEntity): Promise<KnowledgeEntity> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_entities (
        id, project_id, type, title, content, summary, parent_id,
        disposition, proposed_by, proposed_at, approved_by, approved_at,
        review_due_date, superseded_by_id, source_decision_ids, source_artifact_ids,
        source_task_ids, source_chat_uris, tags, scope, applicable_file_patterns,
        usage_count, last_used_at, effectiveness_score, created_at, updated_at,
        created_by, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entity.id,
      entity.projectId,
      entity.type,
      entity.title,
      entity.content,
      entity.summary || null,
      entity.parentId || null,
      entity.disposition,
      entity.proposedBy || null,
      entity.proposedAt ? entity.proposedAt.getTime() : null,
      entity.approvedBy ? JSON.stringify(entity.approvedBy) : null,
      entity.approvedAt ? entity.approvedAt.getTime() : null,
      entity.reviewDueDate ? entity.reviewDueDate.getTime() : null,
      entity.supersededById || null,
      entity.sourceDecisionIds ? JSON.stringify(entity.sourceDecisionIds) : null,
      entity.sourceArtifactIds ? JSON.stringify(entity.sourceArtifactIds) : null,
      entity.sourceTaskIds ? JSON.stringify(entity.sourceTaskIds) : null,
      entity.sourceChatUris ? JSON.stringify(entity.sourceChatUris) : null,
      entity.tags ? JSON.stringify(entity.tags) : null,
      entity.scope ? JSON.stringify(entity.scope) : null,
      entity.applicableFilePatterns ? JSON.stringify(entity.applicableFilePatterns) : null,
      entity.usageCount || 0,
      entity.lastUsedAt ? entity.lastUsedAt.getTime() : null,
      entity.effectivenessScore || null,
      entity.createdAt?.getTime() || now,
      now,
      entity.createdBy || null,
      entity.version || 1
    );

    return entity;
  }

  async getKnowledgeEntity(id: string): Promise<KnowledgeEntity | null> {
    const stmt = this.db.prepare('SELECT * FROM knowledge_entities WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.rowToKnowledgeEntity(row);
  }

  async getKnowledgeEntities(options: {
    projectId?: string;
    type?: KnowledgeEntityType;
    disposition?: KnowledgeDisposition;
    parentId?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<KnowledgeEntity[]> {
    let query = 'SELECT * FROM knowledge_entities WHERE 1=1';
    const params: any[] = [];

    if (options.projectId) {
      query += ' AND project_id = ?';
      params.push(options.projectId);
    }
    if (options.type) {
      query += ' AND type = ?';
      params.push(options.type);
    }
    if (options.disposition) {
      query += ' AND disposition = ?';
      params.push(options.disposition);
    }
    if (options.parentId) {
      query += ' AND parent_id = ?';
      params.push(options.parentId);
    }
    if (options.tags && options.tags.length > 0) {
      // Match any of the provided tags using JSON
      const tagConditions = options.tags.map(() => "json_extract(tags, '$') LIKE ?").join(' OR ');
      query += ` AND (${tagConditions})`;
      options.tags.forEach(tag => params.push(`%"${tag}"%`));
    }

    query += ' ORDER BY updated_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    return rows.map(row => this.rowToKnowledgeEntity(row));
  }

  async getKnowledgeEntityChildren(parentId: string): Promise<KnowledgeEntity[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_entities
      WHERE parent_id = ?
      ORDER BY type, title
    `);
    const rows = stmt.all(parentId) as any[];
    return rows.map(row => this.rowToKnowledgeEntity(row));
  }

  async getKnowledgeEntityAncestors(id: string): Promise<KnowledgeEntity[]> {
    // Recursive CTE to get all ancestors up to root
    const stmt = this.db.prepare(`
      WITH RECURSIVE ancestors AS (
        SELECT * FROM knowledge_entities WHERE id = ?
        UNION ALL
        SELECT ke.* FROM knowledge_entities ke
        INNER JOIN ancestors a ON ke.id = a.parent_id
      )
      SELECT * FROM ancestors WHERE id != ?
      ORDER BY (
        CASE type
          WHEN 'principle' THEN 1
          WHEN 'rationale' THEN 2
          WHEN 'pattern' THEN 3
          WHEN 'practice' THEN 4
          WHEN 'example' THEN 5
        END
      )
    `);
    const rows = stmt.all(id, id) as any[];
    return rows.map(row => this.rowToKnowledgeEntity(row));
  }

  async updateKnowledgeEntity(id: string, updates: Partial<KnowledgeEntity>): Promise<KnowledgeEntity | null> {
    const existing = await this.getKnowledgeEntity(id);
    if (!existing) return null;

    const fields: string[] = ['updated_at = ?'];
    const values: any[] = [Date.now()];

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
    if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
    if (updates.parentId !== undefined) { fields.push('parent_id = ?'); values.push(updates.parentId); }
    if (updates.disposition !== undefined) { fields.push('disposition = ?'); values.push(updates.disposition); }
    if (updates.proposedBy !== undefined) { fields.push('proposed_by = ?'); values.push(updates.proposedBy); }
    if (updates.proposedAt !== undefined) { fields.push('proposed_at = ?'); values.push(updates.proposedAt?.getTime()); }
    if (updates.approvedBy !== undefined) { fields.push('approved_by = ?'); values.push(JSON.stringify(updates.approvedBy)); }
    if (updates.approvedAt !== undefined) { fields.push('approved_at = ?'); values.push(updates.approvedAt?.getTime()); }
    if (updates.reviewDueDate !== undefined) { fields.push('review_due_date = ?'); values.push(updates.reviewDueDate?.getTime()); }
    if (updates.supersededById !== undefined) { fields.push('superseded_by_id = ?'); values.push(updates.supersededById); }
    if (updates.sourceDecisionIds !== undefined) { fields.push('source_decision_ids = ?'); values.push(JSON.stringify(updates.sourceDecisionIds)); }
    if (updates.sourceArtifactIds !== undefined) { fields.push('source_artifact_ids = ?'); values.push(JSON.stringify(updates.sourceArtifactIds)); }
    if (updates.sourceTaskIds !== undefined) { fields.push('source_task_ids = ?'); values.push(JSON.stringify(updates.sourceTaskIds)); }
    if (updates.sourceChatUris !== undefined) { fields.push('source_chat_uris = ?'); values.push(JSON.stringify(updates.sourceChatUris)); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }
    if (updates.scope !== undefined) { fields.push('scope = ?'); values.push(JSON.stringify(updates.scope)); }
    if (updates.applicableFilePatterns !== undefined) { fields.push('applicable_file_patterns = ?'); values.push(JSON.stringify(updates.applicableFilePatterns)); }
    if (updates.usageCount !== undefined) { fields.push('usage_count = ?'); values.push(updates.usageCount); }
    if (updates.lastUsedAt !== undefined) { fields.push('last_used_at = ?'); values.push(updates.lastUsedAt?.getTime()); }
    if (updates.effectivenessScore !== undefined) { fields.push('effectiveness_score = ?'); values.push(updates.effectivenessScore); }
    if (updates.version !== undefined) { fields.push('version = ?'); values.push(updates.version); }

    values.push(id);
    const stmt = this.db.prepare(`UPDATE knowledge_entities SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.getKnowledgeEntity(id);
  }

  async deleteKnowledgeEntity(id: string): Promise<boolean> {
    // Also delete relationships involving this entity
    this.db.prepare('DELETE FROM knowledge_relationships WHERE source_id = ? OR target_id = ?').run(id, id);
    const stmt = this.db.prepare('DELETE FROM knowledge_entities WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async incrementKnowledgeUsage(id: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE knowledge_entities
      SET usage_count = usage_count + 1, last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  // Knowledge Relationship Methods

  async saveKnowledgeRelationship(relationship: KnowledgeRelationship): Promise<KnowledgeRelationship> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_relationships (
        id, source_id, target_id, relationship_type, description, confidence, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      relationship.id,
      relationship.sourceId,
      relationship.targetId,
      relationship.relationshipType,
      relationship.description || null,
      relationship.confidence,
      relationship.createdAt.getTime(),
      relationship.createdBy || null
    );

    return relationship;
  }

  async getKnowledgeRelationship(id: string): Promise<KnowledgeRelationship | null> {
    const stmt = this.db.prepare('SELECT * FROM knowledge_relationships WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.rowToKnowledgeRelationship(row);
  }

  async getKnowledgeRelationshipsFor(entityId: string): Promise<KnowledgeRelationship[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_relationships
      WHERE source_id = ? OR target_id = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(entityId, entityId) as any[];
    return rows.map(row => this.rowToKnowledgeRelationship(row));
  }

  async deleteKnowledgeRelationship(id: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM knowledge_relationships WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async searchKnowledgeEntities(options: {
    query: string;
    projectId?: string;
    type?: KnowledgeEntityType;
    disposition?: KnowledgeDisposition;
    limit?: number;
  }): Promise<KnowledgeEntity[]> {
    const { query, projectId, type, disposition, limit = 20 } = options;

    let sql = `
      SELECT * FROM knowledge_entities
      WHERE (title LIKE ? OR content LIKE ? OR summary LIKE ?)
    `;
    const searchPattern = `%${query}%`;
    const params: any[] = [searchPattern, searchPattern, searchPattern];

    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (disposition) {
      sql += ' AND disposition = ?';
      params.push(disposition);
    }

    sql += ' ORDER BY effectiveness_score DESC NULLS LAST, usage_count DESC, updated_at DESC';
    sql += ' LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];
    return rows.map(row => this.rowToKnowledgeEntity(row));
  }

  // ========================================================================
  // Component Registry
  // ========================================================================

  async saveComponent(component: {
    id: string;
    projectId: string;
    name: string;
    type: string;
    layer?: string;
    description?: string;
    filePatterns?: string[];
    entryPoint?: string;
    metadata?: Record<string, unknown>;
    healthScore?: number;
  }): Promise<void> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO components (id, project_id, name, type, layer, description, file_patterns, entry_point, metadata, health_score, last_activity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        layer = excluded.layer,
        description = excluded.description,
        file_patterns = excluded.file_patterns,
        entry_point = excluded.entry_point,
        metadata = excluded.metadata,
        health_score = excluded.health_score,
        last_activity = excluded.last_activity,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      component.id,
      component.projectId,
      component.name,
      component.type,
      component.layer || null,
      component.description || null,
      component.filePatterns ? JSON.stringify(component.filePatterns) : null,
      component.entryPoint || null,
      component.metadata ? JSON.stringify(component.metadata) : null,
      component.healthScore ?? null,
      now,
      now,
      now,
    );
  }

  async getComponent(id: string): Promise<{
    id: string;
    projectId: string;
    name: string;
    type: string;
    layer?: string;
    description?: string;
    filePatterns: string[];
    entryPoint?: string;
    metadata?: Record<string, unknown>;
    healthScore?: number;
    lastActivity?: Date;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const stmt = this.db.prepare('SELECT * FROM components WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.rowToComponent(row);
  }

  async getComponents(options: {
    projectId?: string;
    type?: string;
    layer?: string;
    minHealth?: number;
    maxHealth?: number;
  } = {}): Promise<Array<{
    id: string;
    projectId: string;
    name: string;
    type: string;
    layer?: string;
    description?: string;
    filePatterns: string[];
    entryPoint?: string;
    metadata?: Record<string, unknown>;
    healthScore?: number;
    lastActivity?: Date;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }
    if (options.layer) {
      conditions.push('layer = ?');
      params.push(options.layer);
    }
    if (options.minHealth !== undefined) {
      conditions.push('health_score >= ?');
      params.push(options.minHealth);
    }
    if (options.maxHealth !== undefined) {
      conditions.push('health_score <= ?');
      params.push(options.maxHealth);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = this.db.prepare(`SELECT * FROM components ${where} ORDER BY layer, name`);
    const rows = stmt.all(...params) as any[];
    return rows.map(row => this.rowToComponent(row));
  }

  async deleteComponent(id: string): Promise<void> {
    this.db.prepare('DELETE FROM component_decisions WHERE component_id = ?').run(id);
    this.db.prepare('DELETE FROM component_health_events WHERE component_id = ?').run(id);
    this.db.prepare('DELETE FROM component_relationships WHERE source_id = ? OR target_id = ?').run(id, id);
    this.db.prepare('DELETE FROM components WHERE id = ?').run(id);
  }

  async deleteComponentsByProject(projectId: string): Promise<number> {
    const components = await this.getComponents({ projectId });
    for (const c of components) {
      await this.deleteComponent(c.id);
    }
    return components.length;
  }

  // Component relationships

  async saveComponentRelationship(rel: {
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO component_relationships (id, source_id, target_id, type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        metadata = excluded.metadata
    `);
    stmt.run(
      rel.id,
      rel.sourceId,
      rel.targetId,
      rel.type,
      rel.metadata ? JSON.stringify(rel.metadata) : null,
      Date.now(),
    );
  }

  async getComponentRelationships(componentId: string): Promise<Array<{
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    metadata?: Record<string, unknown>;
  }>> {
    const stmt = this.db.prepare(`
      SELECT * FROM component_relationships
      WHERE source_id = ? OR target_id = ?
      ORDER BY type, created_at
    `);
    const rows = stmt.all(componentId, componentId) as any[];
    return rows.map(row => ({
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type,
      metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    }));
  }

  // Component-decision links

  async linkComponentDecision(componentId: string, decisionId: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO component_decisions (component_id, decision_id)
      VALUES (?, ?)
    `);
    stmt.run(componentId, decisionId);
  }

  async getComponentDecisions(componentId: string): Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    category: string;
    createdAt: Date;
  }>> {
    const stmt = this.db.prepare(`
      SELECT d.id, d.decision, d.rationale, d.category, d.created_at
      FROM component_decisions cd
      JOIN decisions d ON cd.decision_id = d.id
      WHERE cd.component_id = ?
      ORDER BY d.created_at DESC
    `);
    const rows = stmt.all(componentId) as any[];
    return rows.map(row => ({
      id: row.id,
      decision: row.decision,
      rationale: row.rationale || undefined,
      category: row.category,
      createdAt: new Date(row.created_at),
    }));
  }

  // Component health events

  async logComponentHealthEvent(event: {
    id: string;
    componentId: string;
    eventType: string;
    severity: string;
    description?: string;
    metadata?: Record<string, unknown>;
    source?: string;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO component_health_events (id, component_id, event_type, severity, description, metadata, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.componentId,
      event.eventType,
      event.severity,
      event.description || null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.source || 'manual',
      Date.now(),
    );
  }

  async getComponentHealthEvents(componentId: string, options: {
    since?: Date;
    severity?: string;
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    componentId: string;
    eventType: string;
    severity: string;
    description?: string;
    metadata?: Record<string, unknown>;
    source?: string;
    createdAt: Date;
  }>> {
    const conditions: string[] = ['component_id = ?'];
    const params: unknown[] = [componentId];

    if (options.since) {
      conditions.push('created_at >= ?');
      params.push(options.since.getTime());
    }
    if (options.severity) {
      conditions.push('severity = ?');
      params.push(options.severity);
    }

    const limit = options.limit || 50;
    const where = conditions.join(' AND ');
    const stmt = this.db.prepare(`
      SELECT * FROM component_health_events
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = stmt.all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      componentId: row.component_id,
      eventType: row.event_type,
      severity: row.severity,
      description: row.description || undefined,
      metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
      source: row.source || undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  // Project relationships

  async saveProjectRelationship(rel: {
    id: string;
    sourceProjectId: string;
    targetProjectId: string;
    type: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO project_relationships (id, source_project_id, target_project_id, type, description, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        description = excluded.description,
        metadata = excluded.metadata
    `);
    stmt.run(
      rel.id,
      rel.sourceProjectId,
      rel.targetProjectId,
      rel.type,
      rel.description || null,
      rel.metadata ? JSON.stringify(rel.metadata) : null,
      Date.now(),
    );
  }

  async getProjectRelationships(projectId: string): Promise<Array<{
    id: string;
    sourceProjectId: string;
    targetProjectId: string;
    type: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }>> {
    const stmt = this.db.prepare(`
      SELECT * FROM project_relationships
      WHERE source_project_id = ? OR target_project_id = ?
      ORDER BY type, created_at
    `);
    const rows = stmt.all(projectId, projectId) as any[];
    return rows.map(row => ({
      id: row.id,
      sourceProjectId: row.source_project_id,
      targetProjectId: row.target_project_id,
      type: row.type,
      description: row.description || undefined,
      metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
    }));
  }

  // Helper

  private rowToComponent(row: any) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      type: row.type,
      layer: row.layer || undefined,
      description: row.description || undefined,
      filePatterns: row.file_patterns ? safeJsonParse(row.file_patterns, []) : [],
      entryPoint: row.entry_point || undefined,
      metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
      healthScore: row.health_score ?? undefined,
      lastActivity: row.last_activity ? new Date(row.last_activity) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ========================================================================
  // Agent Registry
  // ========================================================================

  async registerAgent(agent: AgentProfile): Promise<void> {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, agent_type, agent_version, capabilities, strengths, limitations,
        mcp_version, client_info, max_concurrent_tasks, status, last_seen_at, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        agent_type = excluded.agent_type,
        agent_version = excluded.agent_version,
        capabilities = excluded.capabilities,
        strengths = excluded.strengths,
        limitations = excluded.limitations,
        mcp_version = excluded.mcp_version,
        client_info = excluded.client_info,
        max_concurrent_tasks = excluded.max_concurrent_tasks,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      agent.id,
      agent.name,
      agent.agentType,
      agent.agentVersion || null,
      JSON.stringify(agent.capabilities),
      agent.strengths ? JSON.stringify(agent.strengths) : null,
      agent.limitations ? JSON.stringify(agent.limitations) : null,
      agent.mcpVersion || null,
      agent.clientInfo || null,
      agent.maxConcurrentTasks ?? 1,
      agent.status,
      agent.lastSeenAt ? agent.lastSeenAt.getTime() : null,
      agent.metadata ? JSON.stringify(agent.metadata) : null,
      agent.createdAt?.getTime() || now,
      now,
    );
  }

  async getAgent(id: string): Promise<AgentProfile | null> {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.rowToAgentProfile(row);
  }

  async listAgents(options?: {
    status?: 'active' | 'inactive' | 'busy';
    agentType?: string;
    capability?: string;
  }): Promise<AgentProfile[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options?.agentType) {
      conditions.push('agent_type = ?');
      params.push(options.agentType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = this.db.prepare(`SELECT * FROM agents ${where} ORDER BY name`);
    let rows = stmt.all(...params) as any[];

    // Filter by capability in JS (stored as JSON array)
    if (options?.capability) {
      rows = rows.filter(row => {
        const caps = safeJsonParse<string[]>(row.capabilities, []);
        return caps.includes(options.capability!);
      });
    }

    return rows.map(row => this.rowToAgentProfile(row));
  }

  async updateAgent(id: string, updates: Partial<AgentProfile>): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.agentType !== undefined) { fields.push('agent_type = ?'); params.push(updates.agentType); }
    if (updates.agentVersion !== undefined) { fields.push('agent_version = ?'); params.push(updates.agentVersion); }
    if (updates.capabilities !== undefined) { fields.push('capabilities = ?'); params.push(JSON.stringify(updates.capabilities)); }
    if (updates.strengths !== undefined) { fields.push('strengths = ?'); params.push(JSON.stringify(updates.strengths)); }
    if (updates.limitations !== undefined) { fields.push('limitations = ?'); params.push(JSON.stringify(updates.limitations)); }
    if (updates.mcpVersion !== undefined) { fields.push('mcp_version = ?'); params.push(updates.mcpVersion); }
    if (updates.clientInfo !== undefined) { fields.push('client_info = ?'); params.push(updates.clientInfo); }
    if (updates.maxConcurrentTasks !== undefined) { fields.push('max_concurrent_tasks = ?'); params.push(updates.maxConcurrentTasks); }
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.lastSeenAt !== undefined) { fields.push('last_seen_at = ?'); params.push(updates.lastSeenAt.getTime()); }
    if (updates.metadata !== undefined) { fields.push('metadata = ?'); params.push(JSON.stringify(updates.metadata)); }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    const stmt = this.db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...params);
  }

  async deleteAgent(id: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM agents WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async touchAgentLastSeen(agentId: string): Promise<void> {
    const stmt = this.db.prepare('UPDATE agents SET last_seen_at = ?, updated_at = ? WHERE id = ?');
    const now = Date.now();
    stmt.run(now, now, agentId);
  }

  async getAgentsWithCapability(capability: string): Promise<AgentProfile[]> {
    return this.listAgents({ capability, status: 'active' });
  }

  // ── Contributions (Collaborative Tasks) ──────────────────────────────

  async saveContribution(contribution: Contribution): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO contributions (id, task_id, project_id, agent_id, role, type, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      contribution.id,
      contribution.taskId,
      contribution.projectId,
      contribution.agentId,
      contribution.role,
      contribution.type,
      contribution.content,
      contribution.metadata ? JSON.stringify(contribution.metadata) : null,
      contribution.createdAt.getTime(),
    );
  }

  async getContributions(taskId: string, options?: {
    agentId?: string;
    type?: string;
    limit?: number;
  }): Promise<Contribution[]> {
    let sql = 'SELECT * FROM contributions WHERE task_id = ?';
    const params: unknown[] = [taskId];

    if (options?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(options.agentId);
    }
    if (options?.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    sql += ' ORDER BY created_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToContribution(row));
  }

  async deleteContributions(taskId: string): Promise<number> {
    const stmt = this.db.prepare('DELETE FROM contributions WHERE task_id = ?');
    const result = stmt.run(taskId);
    return result.changes;
  }

  private rowToContribution(row: any): Contribution {
    return {
      id: row.id,
      taskId: row.task_id,
      projectId: row.project_id,
      agentId: row.agent_id,
      role: row.role as AgentRole,
      type: row.type as ContributionType,
      content: row.content,
      metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
      createdAt: new Date(row.created_at),
    };
  }

  // ── Dispatch Queue ──────────────────────────────────────────────────

  async saveDispatch(dispatch: Dispatch): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO dispatches (id, project_id, task_id, target_agent, dispatched_by,
        priority_override, context, status, claimed_at, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      dispatch.id,
      dispatch.projectId,
      dispatch.taskId,
      dispatch.targetAgent,
      dispatch.dispatchedBy,
      dispatch.priorityOverride || null,
      dispatch.context || null,
      dispatch.status,
      dispatch.claimedAt?.getTime() || null,
      dispatch.createdAt.getTime(),
      dispatch.expiresAt?.getTime() || null,
    );
  }

  async getDispatch(id: string): Promise<Dispatch | null> {
    const row = this.db.prepare('SELECT * FROM dispatches WHERE id = ?').get(id) as any;
    return row ? this.rowToDispatch(row) : null;
  }

  async getPendingDispatches(targetAgent: string, projectId?: string): Promise<Dispatch[]> {
    let sql = 'SELECT * FROM dispatches WHERE target_agent = ? AND status = ?';
    const params: unknown[] = [targetAgent, 'pending'];

    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }

    // Expire stale dispatches
    sql += ' AND (expires_at IS NULL OR expires_at > ?)';
    params.push(Date.now());

    sql += ' ORDER BY created_at ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToDispatch(row));
  }

  async updateDispatchStatus(id: string, status: DispatchStatus, claimedAt?: Date): Promise<void> {
    const stmt = this.db.prepare(
      'UPDATE dispatches SET status = ?, claimed_at = ? WHERE id = ?'
    );
    stmt.run(status, claimedAt?.getTime() || null, id);
  }

  async listDispatches(options?: {
    status?: DispatchStatus;
    targetAgent?: string;
    projectId?: string;
    limit?: number;
  }): Promise<Dispatch[]> {
    let sql = 'SELECT * FROM dispatches WHERE 1=1';
    const params: unknown[] = [];

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options?.targetAgent) {
      sql += ' AND target_agent = ?';
      params.push(options.targetAgent);
    }
    if (options?.projectId) {
      sql += ' AND project_id = ?';
      params.push(options.projectId);
    }

    sql += ' ORDER BY created_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToDispatch(row));
  }

  private rowToDispatch(row: any): Dispatch {
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id,
      targetAgent: row.target_agent,
      dispatchedBy: row.dispatched_by,
      priorityOverride: row.priority_override as TaskPriority | undefined,
      context: row.context || undefined,
      status: row.status as DispatchStatus,
      claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    };
  }

  private rowToAgentProfile(row: any): AgentProfile {
    return {
      id: row.id,
      name: row.name,
      agentType: row.agent_type,
      agentVersion: row.agent_version || undefined,
      capabilities: safeJsonParse<string[]>(row.capabilities, []) as AgentCapability[],
      strengths: row.strengths ? safeJsonParse<string[]>(row.strengths, []) : undefined,
      limitations: row.limitations ? safeJsonParse<string[]>(row.limitations, []) : undefined,
      mcpVersion: row.mcp_version || undefined,
      clientInfo: row.client_info || undefined,
      maxConcurrentTasks: row.max_concurrent_tasks ?? 1,
      status: row.status,
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : undefined,
      metadata: row.metadata ? safeJsonParse(row.metadata, undefined) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
