/**
 * Migration tool to import tasks from actual-coordination PostgreSQL database
 * into Enginehaus SQLite storage.
 */

import { SQLiteStorageService } from '../storage/sqlite-storage-service.js';
import { UnifiedTask, TaskPriority, TaskStatus } from '../coordination/types.js';
import { v4 as uuidv4 } from 'uuid';

// pg is an optional dependency — only needed if running this migration
async function getPgPool(config: Record<string, unknown>) {
  try {
    const pg = await import('pg');
    return new pg.default.Pool(config);
  } catch {
    throw new Error(
      'PostgreSQL client (pg) is required for this migration.\n' +
      'Install it with: npm install pg'
    );
  }
}

export interface MigrationResult {
  tasksImported: number;
  tasksSkipped: number;
  decisionsImported: number;
  errors: string[];
  dryRun: boolean;
}

export interface PostgresConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

/**
 * Migrate tasks from actual-coordination PostgreSQL to Enginehaus SQLite
 */
export async function migrateFromActualCoordination(
  pgConfig: PostgresConfig,
  storage: SQLiteStorageService,
  targetProjectId: string,
  dryRun: boolean = false
): Promise<MigrationResult> {
  const result: MigrationResult = {
    tasksImported: 0,
    tasksSkipped: 0,
    decisionsImported: 0,
    errors: [],
    dryRun,
  };

  // Default PostgreSQL config for actual-coordination
  const config = {
    host: pgConfig.host || 'localhost',
    port: pgConfig.port || 5432,
    database: pgConfig.database || 'coordination_mcp',
    user: pgConfig.user || process.env.USER,
    password: pgConfig.password,
  };

  const pool = await getPgPool(config);

  try {
    // Test connection
    const client = await pool.connect();
    console.error('[Migration] Connected to actual-coordination database');

    // Get tasks from source
    const tasksResult = await client.query(`
      SELECT
        id, title, description, priority, status, files,
        strategic_context, technical_context, ux_context,
        quality_requirements, session_id, git_branch,
        created_at, updated_at
      FROM tasks
      ORDER BY created_at ASC
    `);

    console.error(`[Migration] Found ${tasksResult.rows.length} tasks to migrate`);

    for (const row of tasksResult.rows) {
      try {
        // Validate priority
        const validPriorities: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
        const priority: TaskPriority = validPriorities.includes(row.priority)
          ? row.priority
          : 'medium';

        // Validate status
        const validStatuses: TaskStatus[] = ['ready', 'in-progress', 'blocked', 'completed'];
        const status: TaskStatus = validStatuses.includes(row.status)
          ? row.status
          : 'ready';

        // Parse JSON fields safely
        const parseJson = (val: any) => {
          if (!val) return undefined;
          if (typeof val === 'object') return val;
          try {
            return JSON.parse(val);
          } catch {
            return undefined;
          }
        };

        const task: UnifiedTask = {
          id: row.id || uuidv4(),
          projectId: targetProjectId,
          title: row.title || 'Untitled Task',
          description: row.description || '',
          priority,
          status,
          files: parseJson(row.files) || [],
          strategicContext: parseJson(row.strategic_context),
          technicalContext: parseJson(row.technical_context),
          uxContext: parseJson(row.ux_context),
          qualityRequirements: parseJson(row.quality_requirements) || [],
          implementation: row.git_branch ? {
            sessionId: row.session_id,
            gitBranch: row.git_branch,
          } : undefined,
          createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
        };

        if (!dryRun) {
          await storage.saveTask(task);
        }

        result.tasksImported++;
        console.error(`[Migration] ${dryRun ? '[DRY RUN] Would import' : 'Imported'} task: ${task.id} - ${task.title}`);
      } catch (e) {
        result.tasksSkipped++;
        const errorMsg = e instanceof Error ? e.message : String(e);
        result.errors.push(`Task ${row.id}: ${errorMsg}`);
        console.error(`[Migration] Error with task ${row.id}: ${errorMsg}`);
      }
    }

    // Try to migrate strategic decisions if table exists
    try {
      const decisionsResult = await client.query(`
        SELECT id, decision, rationale, impact, timeline, stakeholders, created_at
        FROM strategic_decisions
        ORDER BY created_at ASC
      `);

      for (const row of decisionsResult.rows) {
        try {
          if (!dryRun) {
            await storage.saveStrategicDecision({
              id: row.id || uuidv4(),
              projectId: targetProjectId,
              decision: row.decision || '',
              rationale: row.rationale || '',
              impact: row.impact || '',
              timeline: row.timeline || '',
              stakeholders: row.stakeholders || [],
              createdAt: row.created_at ? new Date(row.created_at) : new Date(),
            });
          }
          result.decisionsImported++;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          result.errors.push(`Decision ${row.id}: ${errorMsg}`);
        }
      }
    } catch {
      // Table might not exist, that's OK
      console.error('[Migration] No strategic_decisions table found, skipping');
    }

    client.release();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Database error: ${errorMsg}`);
    console.error(`[Migration] Database error: ${errorMsg}`);
  } finally {
    await pool.end();
  }

  return result;
}

/**
 * List tasks in actual-coordination database (preview)
 */
export async function previewActualCoordinationTasks(
  pgConfig: PostgresConfig
): Promise<{ tasks: any[]; error?: string }> {
  const config = {
    host: pgConfig.host || 'localhost',
    port: pgConfig.port || 5432,
    database: pgConfig.database || 'coordination_mcp',
    user: pgConfig.user || process.env.USER,
    password: pgConfig.password,
  };

  const pool = await getPgPool(config);

  try {
    const client = await pool.connect();

    const result = await client.query(`
      SELECT id, title, priority, status, created_at
      FROM tasks
      ORDER BY created_at DESC
      LIMIT 50
    `);

    client.release();
    await pool.end();

    return { tasks: result.rows };
  } catch (error) {
    await pool.end();
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { tasks: [], error: errorMsg };
  }
}
