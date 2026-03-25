/**
 * StorageAdapter Interface
 *
 * Comprehensive interface for all Enginehaus storage operations.
 * Abstracts the underlying storage backend (SQLite, PostgreSQL, etc.)
 * so that CoordinationService and other consumers depend on the
 * interface, not a concrete implementation.
 *
 * Extracted from SQLiteStorageService's ~145 public methods.
 */

import type {
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
  Contribution,
  ContributionType,
  Dispatch,
  DispatchStatus,
} from '../coordination/types.js';
import type {
  SourceConfig,
  IngestionJob,
  Snapshot,
} from '../ingestion/types.js';

// ── Shared param/result types ────────────────────────────────────────

export interface StorageStats {
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  isOpen: boolean;
  activeProjectId: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  details: {
    connectionOpen: boolean;
    integrityCheck: boolean;
    walSize: number;
    tableCount: number;
    taskCount: number;
    error?: string;
  };
}

export interface WalCheckpointResult {
  success: boolean;
  walFrames: number;
  checkpointedFrames: number;
}

export interface AuditEvent {
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
}

export interface AuditLogEntry {
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
}

export interface AuditSummary {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByActor: Record<string, number>;
  eventsByResource: Record<string, number>;
  timeRange: { earliest: Date | null; latest: Date | null };
}

export interface DecisionInput {
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
}

export interface DecisionRecord {
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
}

export type MetricEventType =
  | 'task_claimed' | 'task_completed' | 'task_abandoned'
  | 'context_expanded' | 'session_started' | 'session_ended'
  | 'tool_called' | 'quality_gate_passed' | 'quality_gate_failed'
  | 'context_fetch_minimal' | 'context_fetch_full' | 'task_reopened'
  | 'session_feedback' | 'context_repeated' | 'quality_bypass'
  | 'learnings_surfaced' | 'decisions_surfaced';

export interface MetricEvent {
  eventType: MetricEventType;
  projectId?: string;
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface EffectivenessMetrics {
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
}

export interface TaskOutcomeInput {
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
}

export interface TaskOutcomeRecord extends TaskOutcomeInput {
  projectId: string;
  recordedAt: Date;
  updatedAt: Date;
}

export interface SessionFeedbackInput {
  id: string;
  sessionId: string;
  projectId?: string;
  taskId?: string;
  productivityRating?: number;
  frictionTags: string[];
  notes?: string;
}

export interface SessionFeedbackRecord extends SessionFeedbackInput {
  projectId: string;
  createdAt: Date;
}

export interface AXSurveyResponse {
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
}

export interface OutcomeRawData {
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
}

export interface CheckpointInput {
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
}

export interface CheckpointRecord extends CheckpointInput {
  respondedBy?: string;
  respondedAt?: Date;
  response?: string;
  selectedOption?: string;
  decision?: string;
  escalatedAt?: Date;
}

export interface InitiativeInput {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  successCriteria?: string;
  createdBy?: string;
}

export interface InitiativeRecord {
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
}

export interface InitiativeSummary {
  id: string;
  projectId: string;
  title: string;
  status: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
  taskCount: number;
  createdAt: Date;
}

export interface InitiativeLearnings {
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    pivoted: number;
    abandoned: number;
    active: number;
    successRate: number;
  };
  succeededInitiatives: Array<{ id: string; title: string; outcomeNotes?: string; taskCount: number }>;
  failedInitiatives: Array<{ id: string; title: string; outcomeNotes?: string; taskCount: number }>;
}

export interface ComponentInput {
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
}

export interface ComponentRecord {
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
}

export interface ComponentRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface ComponentHealthEvent {
  id: string;
  componentId: string;
  eventType: string;
  severity: string;
  description?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface ProjectRelationship {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
  type: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface FileConflict {
  session: CoordinationSession;
  task: UnifiedTask;
  overlappingFiles: string[];
}

export interface FileLockInfo {
  taskId: string;
  agentId: string;
  sessionId: string;
}

// ── The Interface ────────────────────────────────────────────────────

export interface StorageAdapter {
  // ── Lifecycle ──────────────────────────────────────────────────────
  initialize(): Promise<void>;
  close(): void;
  backupDatabase(rotateOld?: boolean, maxBackups?: number): Promise<string | null>;
  healthCheck(): Promise<HealthCheckResult>;
  checkpointWal(mode?: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'): Promise<WalCheckpointResult>;
  reconnect(): Promise<boolean>;
  getStats(): StorageStats;

  // ── Projects ───────────────────────────────────────────────────────
  createProject(project: Project): Promise<void>;
  getProject(id: string): Promise<Project | null>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  listProjects(status?: ProjectStatus): Promise<Project[]>;
  updateProject(id: string, updates: Partial<Project>): Promise<void>;
  deleteProject(id: string): Promise<void>;
  getActiveProjectId(): Promise<string | null>;
  getActiveProjectIdOrDefault(): string;
  setActiveProjectId(projectId: string): Promise<void>;
  getActiveProject(): Promise<Project | null>;

  // ── Strategic Decisions ────────────────────────────────────────────
  saveStrategicDecision(decision: StrategicDecision): Promise<void>;
  getStrategicDecision(id: string): Promise<StrategicDecision | null>;
  getRecentStrategicDecisions(limit: number, projectId?: string): Promise<StrategicDecision[]>;

  // ── UX Requirements ────────────────────────────────────────────────
  saveUXRequirements(requirements: UXRequirements): Promise<void>;
  getUXRequirements(id: string): Promise<UXRequirements | null>;
  getRecentUXRequirements(limit: number, projectId?: string): Promise<UXRequirements[]>;

  // ── Technical Plans ────────────────────────────────────────────────
  saveTechnicalPlan(plan: TechnicalPlan): Promise<void>;
  getTechnicalPlan(id: string): Promise<TechnicalPlan | null>;
  getRecentTechnicalPlans(limit: number, projectId?: string): Promise<TechnicalPlan[]>;

  // ── Tasks ──────────────────────────────────────────────────────────
  saveTask(task: UnifiedTask): Promise<void>;
  updateTask(id: string, updates: Partial<UnifiedTask>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  getTask(id: string): Promise<UnifiedTask | null>;
  getTasks(filter: {
    status?: TaskStatus;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    projectId?: string;
    tags?: string[];
  }): Promise<UnifiedTask[]>;
  searchTasks(query: string, options?: {
    projectId?: string;
    status?: TaskStatus;
    limit?: number;
  }): Promise<UnifiedTask[]>;
  getTasksCompletedSince(since: Date): Promise<UnifiedTask[]>;
  getBlockingTasks(taskId: string): string[];
  getBlockedTasks(taskId: string): string[];
  unblockDependentTasks(completedTaskId: string): Promise<string[]>;

  // ── Task Dependencies ──────────────────────────────────────────────
  addTaskDependency(blockerTaskId: string, blockedTaskId: string): Promise<void>;
  removeTaskDependency(blockerTaskId: string, blockedTaskId: string): Promise<void>;
  checkAndUnblockTask(taskId: string): Promise<boolean>;
  onTaskCompleted(taskId: string): Promise<string[]>;
  getBlockedTasksList(projectId?: string): Promise<UnifiedTask[]>;
  getUnblockedReadyTasks(projectId?: string): Promise<UnifiedTask[]>;

  // ── Sessions ───────────────────────────────────────────────────────
  claimSessionAtomic(session: CoordinationSession): { conflict: CoordinationSession | null; existingSessionId?: string };
  saveSession(session: CoordinationSession): Promise<void>;
  getSession(id: string): Promise<CoordinationSession | null>;
  getActiveSessions(projectId?: string): Promise<CoordinationSession[]>;
  getAllSessions(options?: {
    projectId?: string;
    status?: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<CoordinationSession[]>;
  getActiveSessionForTask(taskId: string): Promise<CoordinationSession | null>;
  getActiveSessionsForAgent(agentId: string): Promise<CoordinationSession[]>;
  updateSessionHeartbeat(sessionId: string): Promise<void>;
  expireStaleSessions(timeoutMs?: number): Promise<number>;
  completeSession(sessionId: string): Promise<void>;
  getSessionsForTask(taskId: string): Promise<CoordinationSession[]>;

  // ── File-Lock Conflict Detection ───────────────────────────────────
  findFileConflicts(taskId: string, excludeAgentId?: string): Promise<FileConflict[]>;
  getLockedFiles(projectId?: string): Promise<Map<string, FileLockInfo>>;

  // ── Events ─────────────────────────────────────────────────────────
  saveEvent(event: CoordinationEvent): Promise<void>;
  getRecentEvents(limit: number): Promise<CoordinationEvent[]>;

  // ── Project Metadata ───────────────────────────────────────────────
  getProjectMetadata(): Promise<Record<string, any>>;
  saveProjectMetadata(metadata: Record<string, any>): Promise<void>;

  // ── Audit Logging ──────────────────────────────────────────────────
  logAuditEvent(event: AuditEvent): Promise<{ id: string; timestamp: Date }>;
  queryAuditLog(options?: {
    eventTypes?: string[];
    actorId?: string;
    projectId?: string;
    resourceType?: string;
    resourceId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditLogEntry[]>;
  getAuditSummary(projectId?: string, startTime?: Date, endTime?: Date): Promise<AuditSummary>;

  // ── In-Flight Decisions ────────────────────────────────────────────
  logDecision(decision: DecisionInput): Promise<string>;
  getDecisions(options?: {
    taskId?: string;
    projectId?: string;
    category?: string;
    since?: Date;
    limit?: number;
  }): Promise<DecisionRecord[]>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  getDecisionsForTask(taskId: string): Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    impact?: string;
    category: string;
    createdAt: Date;
  }>>;
  getThoughts(options?: {
    projectId?: string;
    taskId?: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    decision: string;
    taskId?: string;
    projectId: string;
    createdAt: Date;
    createdBy?: string;
  }>>;
  updateDisposition(decisionId: string, disposition: string, category?: string): Promise<boolean>;

  // ── Metrics ────────────────────────────────────────────────────────
  logMetric(event: MetricEvent): Promise<void>;
  getMetrics(options?: {
    projectId?: string;
    since?: Date;
    until?: Date;
    eventTypes?: string[];
  }): Promise<{
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
  }>;
  getMetricsRaw(options?: {
    eventType?: string;
    projectId?: string;
    sessionId?: string;
    taskId?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<Array<{
    timestamp: Date;
    eventType: string;
    projectId: string;
    taskId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }>>;
  getEffectivenessMetrics(options?: {
    projectId?: string;
    since?: Date;
  }): Promise<EffectivenessMetrics>;
  getMetricsByAgent(options?: {
    projectId?: string;
    since?: Date;
  }): Promise<Array<{
    agentId: string;
    tasksClaimed: number;
    tasksCompleted: number;
    sessionsStarted: number;
  }>>;

  deleteMetricsByType(eventTypes: string[]): Promise<number>;

  // ── Session Feedback ───────────────────────────────────────────────
  saveSessionFeedback(feedback: SessionFeedbackInput): Promise<void>;
  getSessionFeedback(options?: {
    projectId?: string;
    since?: Date;
    until?: Date;
  }): Promise<SessionFeedbackRecord[]>;

  // ── Task Outcomes ──────────────────────────────────────────────────
  saveTaskOutcome(outcome: TaskOutcomeInput): Promise<void>;
  getTaskOutcome(taskId: string): Promise<TaskOutcomeRecord | null>;
  getCompletedTasksWithPendingOutcomes(projectId: string, limit?: number): Promise<Array<{
    taskId: string;
    taskTitle: string;
    completedAt: Date;
    outcomeId: string;
  }>>;
  getOutcomeMetrics(options?: {
    projectId?: string;
    since?: Date;
    until?: Date;
  }): Promise<{
    totalOutcomes: number;
    byStatus: Record<string, number>;
    shipRate: number;
    reworkRate: number;
    avgTimeToMerge?: number;
    avgTimeToProduction?: number;
    ciFirstTryPassRate: number;
    avgReviewerSatisfaction?: number;
  }>;

  // ── AX Survey ──────────────────────────────────────────────────────
  saveAXSurveyResponse(response: AXSurveyResponse): Promise<void>;
  getAXSurveyResponses(options?: {
    projectId?: string;
    agentId?: string;
    surveyId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
  }): Promise<Array<AXSurveyResponse & { submittedAt: Date }>>;

  // ── Outcome Raw Data ───────────────────────────────────────────────
  getOutcomeRawData(options: {
    projectId: string;
    since: Date;
    until: Date;
  }): Promise<OutcomeRawData>;

  // ── Artifacts ──────────────────────────────────────────────────────
  createArtifact(artifact: Artifact): Promise<Artifact>;
  getArtifact(id: string): Promise<Artifact | null>;
  getArtifactsForTask(taskId: string, type?: ArtifactType): Promise<Artifact[]>;
  getArtifactsForProject(projectId: string, type?: ArtifactType): Promise<Artifact[]>;
  updateArtifact(id: string, updates: Partial<Artifact>): Promise<Artifact | null>;
  deleteArtifact(id: string): Promise<boolean>;
  deleteArtifactsForTask(taskId: string): Promise<number>;
  getArtifactChildren(parentId: string): Promise<Artifact[]>;
  searchArtifacts(options: {
    query: string;
    projectId?: string;
    type?: ArtifactType;
    limit?: number;
  }): Promise<Array<{ artifact: Artifact; snippet: string; rank: number }>>;

  // ── Configuration ──────────────────────────────────────────────────
  getProjectConfig(projectId: string): Promise<{
    configJson: Record<string, unknown>;
    source: 'file' | 'database' | 'default';
    filePath?: string;
    fileHash?: string;
    teamId?: string;
    inheritFromTeam: boolean;
    syncedAt?: Date;
  } | null>;
  saveProjectConfig(projectId: string, config: Record<string, unknown>, options: {
    source: 'file' | 'database' | 'default';
    filePath?: string;
    fileHash?: string;
    teamId?: string;
    inheritFromTeam?: boolean;
  }): Promise<void>;
  getSessionConfig(sessionId: string): Promise<Record<string, unknown> | null>;
  setSessionConfig(sessionId: string, overrides: Record<string, unknown>, expiresInMinutes?: number): Promise<void>;
  clearSessionConfig(sessionId: string): Promise<void>;
  logConfigChange(entry: {
    scope: 'organization' | 'team' | 'project' | 'user' | 'session';
    scopeId: string;
    changeType: 'create' | 'update' | 'delete' | 'sync' | 'reset';
    configPath?: string;
    oldValue?: unknown;
    newValue?: unknown;
    changedBy?: string;
    reason?: string;
  }): Promise<string>;
  getConfigAuditLog(options?: {
    scope?: string;
    scopeId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<{
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
  }>>;
  cleanupExpiredSessionConfigs(): Promise<number>;

  // ── Human Checkpoints ──────────────────────────────────────────────
  createCheckpoint(checkpoint: CheckpointInput): Promise<void>;
  getCheckpoint(id: string): Promise<CheckpointRecord | null>;
  getActiveCheckpointForTask(taskId: string): Promise<CheckpointRecord | null>;
  getPendingCheckpoints(projectId?: string): Promise<Array<CheckpointInput & { id: string }>>;
  respondToCheckpoint(checkpointId: string, response: {
    respondedBy: string;
    response?: string;
    selectedOption?: string;
    decision: 'approve' | 'reject' | 'redirect';
  }): Promise<boolean>;
  timeoutCheckpoint(checkpointId: string): Promise<boolean>;
  escalateCheckpoint(checkpointId: string): Promise<boolean>;
  getCheckpointHistory(taskId: string): Promise<Array<{
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
  }>>;

  // ── Initiatives ────────────────────────────────────────────────────
  createInitiative(initiative: InitiativeInput): Promise<void>;
  getInitiative(id: string): Promise<InitiativeRecord | null>;
  listInitiatives(options?: {
    projectId?: string;
    status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    limit?: number;
  }): Promise<InitiativeSummary[]>;
  linkTaskToInitiative(options: {
    taskId: string;
    initiativeId: string;
    contributionNotes?: string;
  }): Promise<void>;
  unlinkTaskFromInitiative(taskId: string, initiativeId: string): Promise<void>;
  getTaskInitiatives(taskId: string): Promise<Array<{
    id: string;
    title: string;
    status: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    contributionNotes?: string;
  }>>;
  recordInitiativeOutcome(options: {
    initiativeId: string;
    status: 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    outcomeNotes: string;
  }): Promise<void>;
  updateInitiative(options: {
    initiativeId: string;
    title?: string;
    description?: string;
    successCriteria?: string;
    status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
    outcomeNotes?: string;
    projectId?: string;
  }): Promise<void>;
  getInitiativeLearnings(options?: {
    projectId?: string;
    includeActive?: boolean;
  }): Promise<InitiativeLearnings>;

  // ── Task Relationships ─────────────────────────────────────────────
  createTaskRelationship(
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType: TaskRelationshipType,
    options?: {
      description?: string;
      confidence?: number;
      source?: TaskRelationshipSource;
      createdBy?: string;
    },
  ): Promise<TaskRelationship>;
  removeTaskRelationship(
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType?: TaskRelationshipType,
  ): Promise<boolean>;
  getTaskRelationships(taskId: string, options?: {
    relationshipType?: TaskRelationshipType;
    direction?: 'outgoing' | 'incoming' | 'both';
    minConfidence?: number;
  }): Promise<TaskRelationship[]>;
  getRelatedTaskIds(taskId: string): Promise<string[]>;
  findTasksWithFileOverlap(taskId: string, projectId: string): Promise<Array<{
    taskId: string;
    overlapScore: number;
  }>>;
  relationshipExists(
    sourceTaskId: string,
    targetTaskId: string,
    relationshipType: TaskRelationshipType,
  ): Promise<boolean>;

  // ── Entity Hierarchies ─────────────────────────────────────────────
  createHierarchyDefinition(definition: {
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
  }): Promise<HierarchyDefinition>;
  getHierarchyDefinitions(projectId: string): Promise<HierarchyDefinition[]>;
  getHierarchyDefinition(id: string): Promise<HierarchyDefinition | null>;
  createHierarchyNode(node: {
    hierarchyId: string;
    levelId: string;
    parentNodeId?: string;
    entityType: HierarchyEntityType;
    entityId: string;
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<HierarchyNode>;
  getHierarchyNode(id: string): Promise<HierarchyNode | null>;
  getHierarchyNodeForEntity(entityType: HierarchyEntityType, entityId: string): Promise<HierarchyNode | null>;
  getAncestors(nodeId: string): Promise<HierarchyNode[]>;
  getDescendants(nodeId: string): Promise<HierarchyNode[]>;
  getSiblings(nodeId: string): Promise<HierarchyNode[]>;
  getNodesAtLevel(hierarchyId: string, levelId: string): Promise<HierarchyNode[]>;
  deleteHierarchyNode(nodeId: string, deleteDescendants?: boolean): Promise<boolean>;
  getHierarchyNodeBySourceId(hierarchyId: string, sourceId: string): Promise<HierarchyNode | null>;
  updateHierarchyNode(id: string, updates: Partial<HierarchyNode>): Promise<HierarchyNode>;
  archiveHierarchyNode(id: string, reason: string): Promise<void>;

  // ── Knowledge Management ───────────────────────────────────────────
  saveKnowledgeEntity(entity: KnowledgeEntity): Promise<KnowledgeEntity>;
  getKnowledgeEntity(id: string): Promise<KnowledgeEntity | null>;
  getKnowledgeEntities(options: {
    projectId?: string;
    type?: KnowledgeEntityType;
    disposition?: KnowledgeDisposition;
    parentId?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<KnowledgeEntity[]>;
  getKnowledgeEntityChildren(parentId: string): Promise<KnowledgeEntity[]>;
  getKnowledgeEntityAncestors(id: string): Promise<KnowledgeEntity[]>;
  updateKnowledgeEntity(id: string, updates: Partial<KnowledgeEntity>): Promise<KnowledgeEntity | null>;
  deleteKnowledgeEntity(id: string): Promise<boolean>;
  incrementKnowledgeUsage(id: string): Promise<void>;
  saveKnowledgeRelationship(relationship: KnowledgeRelationship): Promise<KnowledgeRelationship>;
  getKnowledgeRelationship(id: string): Promise<KnowledgeRelationship | null>;
  getKnowledgeRelationshipsFor(entityId: string): Promise<KnowledgeRelationship[]>;
  deleteKnowledgeRelationship(id: string): Promise<boolean>;
  searchKnowledgeEntities(options: {
    query: string;
    projectId?: string;
    type?: KnowledgeEntityType;
    disposition?: KnowledgeDisposition;
    limit?: number;
  }): Promise<KnowledgeEntity[]>;

  // ── Source Ingestion ───────────────────────────────────────────────
  createSourceConfig(config: Omit<SourceConfig, 'id'>): Promise<SourceConfig>;
  getSourceConfig(id: string): Promise<SourceConfig | null>;
  getSourceConfigs(projectId: string): Promise<SourceConfig[]>;
  updateSourceConfig(id: string, updates: Partial<SourceConfig>): Promise<SourceConfig>;
  deleteSourceConfig(id: string): Promise<boolean>;
  createIngestionJob(job: Omit<IngestionJob, 'id'>): Promise<IngestionJob>;
  getIngestionJob(id: string): Promise<IngestionJob | null>;
  getIngestionJobs(sourceId: string, limit?: number): Promise<IngestionJob[]>;
  updateIngestionJob(id: string, updates: Partial<IngestionJob>): Promise<IngestionJob>;
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  getLatestSnapshot(sourceId: string): Promise<Snapshot | null>;

  // ── Component Registry ─────────────────────────────────────────────
  saveComponent(component: ComponentInput): Promise<void>;
  getComponent(id: string): Promise<ComponentRecord | null>;
  getComponents(options?: {
    projectId?: string;
    type?: string;
    layer?: string;
    minHealth?: number;
    maxHealth?: number;
  }): Promise<ComponentRecord[]>;
  deleteComponent(id: string): Promise<void>;
  deleteComponentsByProject(projectId: string): Promise<number>;
  saveComponentRelationship(rel: ComponentRelationship): Promise<void>;
  getComponentRelationships(componentId: string): Promise<ComponentRelationship[]>;
  linkComponentDecision(componentId: string, decisionId: string): Promise<void>;
  getComponentDecisions(componentId: string): Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    category: string;
    createdAt: Date;
  }>>;
  logComponentHealthEvent(event: ComponentHealthEvent): Promise<void>;
  getComponentHealthEvents(componentId: string, options?: {
    since?: Date;
    severity?: string;
    limit?: number;
  }): Promise<Array<ComponentHealthEvent & { createdAt: Date }>>;

  // ── Project Relationships ──────────────────────────────────────────
  saveProjectRelationship(rel: ProjectRelationship): Promise<void>;
  getProjectRelationships(projectId: string): Promise<ProjectRelationship[]>;

  // ── Agent Registry ─────────────────────────────────────────────────
  registerAgent(agent: AgentProfile): Promise<void>;
  getAgent(id: string): Promise<AgentProfile | null>;
  listAgents(options?: {
    status?: 'active' | 'inactive' | 'busy';
    agentType?: string;
    capability?: string;
  }): Promise<AgentProfile[]>;
  updateAgent(id: string, updates: Partial<AgentProfile>): Promise<void>;
  deleteAgent(id: string): Promise<boolean>;
  touchAgentLastSeen(agentId: string): Promise<void>;
  getAgentsWithCapability(capability: string): Promise<AgentProfile[]>;

  // ── Contributions (Collaborative Tasks) ─────────────────────────────
  saveContribution(contribution: Contribution): Promise<void>;
  getContributions(taskId: string, options?: {
    agentId?: string;
    type?: ContributionType;
    limit?: number;
  }): Promise<Contribution[]>;
  deleteContributions(taskId: string): Promise<number>;

  // ── Dispatch Queue ──────────────────────────────────────────────────
  saveDispatch(dispatch: Dispatch): Promise<void>;
  getDispatch(id: string): Promise<Dispatch | null>;
  getPendingDispatches(targetAgent: string, projectId?: string): Promise<Dispatch[]>;
  updateDispatchStatus(id: string, status: DispatchStatus, claimedAt?: Date): Promise<void>;
  listDispatches(options?: {
    status?: DispatchStatus;
    targetAgent?: string;
    projectId?: string;
    limit?: number;
  }): Promise<Dispatch[]>;
}
