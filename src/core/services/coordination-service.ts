/**
 * Core Coordination Service — Thin Facade
 *
 * All business logic has been extracted into focused sub-services.
 * This file is the public API surface: it delegates every call.
 *
 * Sub-services:
 *   ProjectService     — project CRUD and active project management
 *   TaskService         — task CRUD, search, change summary
 *   SessionService      — session lifecycle, heartbeat, claim/release
 *   DecisionService     — decision logging and querying
 *   PhaseService        — phase workflow (start/advance/skip)
 *   CompletionService   — getNextTask, completeTask, completeTaskSmart
 *   AnalyticsService    — outcome metrics, AX metrics, value dashboard
 *   ArtifactService     — artifact CRUD, search, lineage
 *   CheckpointService   — human checkpoint management
 *   HandoffServiceAdapter — session handoff and continuation prompts
 *   InitiativeService   — initiative CRUD, task linking, learnings
 */

import { v4 as uuidv4 } from 'uuid';
import {
  UnifiedTask,
  TaskStatus,
  TaskPriority,
  TaskType,
  CoordinationSession,
  StrategicDecision,
  UXRequirements,
  TechnicalPlan,
  Project,
  ProjectDomain,
  ProjectStatus,
  StrategicContext,
  UXContext,
  TechnicalContext,
  Artifact,
  ArtifactType,
  ArtifactContentType,
  ArtifactEvolution,
  HumanCheckpoint,
  CheckpointType,
  CheckpointStatus,
  CheckpointOption,
  TaskRelationship,
  TaskRelationshipType,
  TaskRelationshipSource,
  DecisionScope,
  DecisionLayer,
  AgentProfile,
  Contribution,
  ContributionType,
  Dispatch,
  DispatchStatus,
} from '../../coordination/types.js';
import type { StorageAdapter } from '../../storage/storage-adapter.js';
import { EventOrchestrator } from '../../events/event-orchestrator.js';
import {
  generateQualityChecklistWithConfig,
  formatQualityChecklist,
  checkQualityCompliance,
  QualityExpectation,
} from '../../quality/quality-expectations.js';
import { DEFAULT_CONFIG } from '../../config/types.js';
import {
  getTaskSuggestions,
  getSuggestionsByCategory,
  analyzeTaskHealth,
  DeveloperContext,
  SuggestionCategory,
} from '../../ai/task-suggestions.js';
import {
  getTrendAnalysis,
  calculateQualityMetrics,
  generateQualityInsights,
  compareMetrics,
} from '../../quality/quality-trends.js';
import {
  generateDependencyGraph,
} from '../../visualization/mermaid-export.js';
import { ComponentScanner, persistScanResults } from '../../analysis/component-scanner.js';
import { LearningEngine, DecisionPattern, FrictionAnalysis, QualityTrends, Recommendation, Worldview } from '../../analysis/learning-engine.js';
import { ProjectService } from './project-service.js';
import { DecisionService } from './decision-service.js';
import { PhaseService } from './phase-service.js';
import { TaskService } from './task-service.js';
import { SessionService } from './session-service.js';
import { CompletionService } from './completion-service.js';
import { AnalyticsService } from './analytics-service.js';
import { ArtifactService } from './artifact-service.js';
import { CheckpointService } from './checkpoint-service.js';
import { HandoffServiceAdapter } from './handoff-service-adapter.js';
import { InitiativeService } from './initiative-service.js';
import type { ServiceContext } from './service-context.js';
import { HealthScorer, ComponentHealthReport } from '../../analysis/health-scorer.js';
import { InsightLoop, InsightSummary } from '../../analysis/insight-loop.js';
import {
  renderTaskGraph,
  renderSessionGraph,
  generateBriefing,
  formatBriefing,
  generateClusterContext,
  GraphView,
} from '../../visualization/task-graph.js';
import { ToolHint } from '../../utils/tool-hints.js';
import { eventsToCSV, AuditEventType, AuditEvent } from '../../audit/audit-service.js';
import {
  HandoffContext,
  ContinuationPrompt,
  CompressedSessionState,
} from '../../coordination/handoff-service.js';
import { ConfigurationManager } from '../../config/configuration-manager.js';
import { expandPath } from '../../utils/paths.js';

export interface ClaimResult {
  success: boolean;
  sessionId?: string;
  conflict?: { sessionId: string; agentId: string; startTime: Date };
  fileConflicts?: Array<{ taskId: string; taskTitle: string; agentId: string; overlappingFiles: string[] }>;
  capacityExceeded?: { currentTasks: Array<{ taskId: string; taskTitle: string; sessionId: string }>; capacity: number };
  dependencyBlock?: { blockedBy: Array<{ taskId: string; taskTitle: string; status: string }> };
}

export interface TaskFilter {
  projectId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
}

export class CoordinationService {
  private events?: EventOrchestrator;
  private configManager: ConfigurationManager;

  // ── Decomposed sub-services ──────────────────────────────────────────
  private projectService: ProjectService;
  private decisionService: DecisionService;
  private phaseService: PhaseService;
  private taskService: TaskService;
  private sessionService: SessionService;
  private completionService: CompletionService;
  private analyticsService: AnalyticsService;
  private artifactService: ArtifactService;
  private checkpointService: CheckpointService;
  private handoffAdapter: HandoffServiceAdapter;
  private initiativeService: InitiativeService;

  constructor(
    private storage: StorageAdapter,
    events?: EventOrchestrator
  ) {
    this.events = events;
    this.configManager = new ConfigurationManager({
      storage: this.storage,
      autoSyncFromFile: true,
      cacheEnabled: true,
      cacheTTLMs: 60000,
    });

    const ctx: ServiceContext = { storage: this.storage, events: this.events };
    this.projectService = new ProjectService(ctx, this.configManager);
    this.decisionService = new DecisionService(ctx);
    this.phaseService = new PhaseService(ctx);
    this.taskService = new TaskService(ctx);
    this.sessionService = new SessionService(ctx);
    this.completionService = new CompletionService(ctx, this.configManager);
    this.analyticsService = new AnalyticsService(ctx);
    this.artifactService = new ArtifactService(ctx);
    this.checkpointService = new CheckpointService(ctx);
    this.handoffAdapter = new HandoffServiceAdapter(ctx);
    this.initiativeService = new InitiativeService(ctx);

    this.wireCallbacks();
  }

  private wireCallbacks(): void {
    this.phaseService.setCheckpointCallback({
      requestHumanInput: (params) => this.requestHumanInput(params),
    });

    this.completionService.setCallbacks({
      claimTask: (taskId, agentId) => this.claimTask(taskId, agentId),
      getFileRelevantDecisions: (taskId, taskFiles) => this.getFileRelevantDecisions(taskId, taskFiles),
      getComponentContextForTask: (projectId, taskFiles) => this.getComponentContextForTask(projectId, taskFiles),
      getRelationshipContext: (taskId) => this.getRelationshipContext(taskId),
      getRelatedLearnings: (taskId) => this.getRelatedLearnings(taskId),
      logDecision: (params) => this.logDecision(params),
      completeTaskWithResponse: (taskId, completion) => this.completionService.completeTaskWithResponse(taskId, completion),
      recordTaskOutcome: (params) => this.recordTaskOutcome(params),
      getDecisions: async (params) => {
        const result = await this.getDecisions(params as any);
        return { success: true, decisions: result.decisions } as any;
      },
      getActiveCheckpointForTask: (taskId) => this.getActiveCheckpointForTask(taskId),
      getRelatedDecisionsForTask: (taskId) => this.decisionService.getRelatedDecisionsForTask(taskId),
    });

    this.artifactService.setCallbacks({
      logDecision: (params) => this.logDecision(params),
      storeArtifact: (params) => this.storeArtifact(params),
    });
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private async resolveProjectId(explicit?: string | null): Promise<string | null> {
    if (!explicit) return this.storage.getActiveProjectId();

    // If it looks like a UUID, use it directly
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(explicit)) {
      return explicit;
    }

    // Otherwise treat as slug and resolve
    const project = await this.storage.getProjectBySlug(explicit);
    if (project) return project.id;

    // Fall through — might be a non-UUID ID format, pass as-is
    return explicit;
  }

  private audit(
    eventType: string, projectId: string, resourceType: string, resourceId: string, action: string,
    opts: { actorId?: string; actorType?: 'user' | 'agent' | 'system'; metadata?: Record<string, unknown> } = {},
  ) {
    return this.storage.logAuditEvent({
      eventType, actorId: opts.actorId ?? 'agent', actorType: opts.actorType ?? 'agent',
      projectId, resourceType, resourceId, action, metadata: opts.metadata,
    });
  }

  // ── Public Lifecycle ───────────────────────────────────────────────────

  async initialize(): Promise<void> { await this.storage.initialize(); }
  getConfigManager(): ConfigurationManager { return this.configManager; }

  setEventOrchestrator(events: EventOrchestrator): void {
    this.events = events;
    const ctx: ServiceContext = { storage: this.storage, events };
    this.projectService = new ProjectService(ctx, this.configManager);
    this.decisionService = new DecisionService(ctx);
    this.phaseService = new PhaseService(ctx);
    this.taskService = new TaskService(ctx);
    this.sessionService = new SessionService(ctx);
    this.completionService = new CompletionService(ctx, this.configManager);
    this.analyticsService = new AnalyticsService(ctx);
    this.artifactService = new ArtifactService(ctx);
    this.checkpointService = new CheckpointService(ctx);
    this.handoffAdapter = new HandoffServiceAdapter(ctx);
    this.initiativeService = new InitiativeService(ctx);
    this.wireCallbacks();
  }

  // ============================================================================
  // Project Management (delegated to ProjectService)
  // ============================================================================

  async createProject(data: { name: string; slug?: string; description?: string; rootPath?: string; domain?: ProjectDomain; techStack?: string[] }): Promise<Project> { return this.projectService.createProject(data); }
  async createProjectWithResponse(data: { name: string; slug?: string; description?: string; rootPath?: string; domain?: ProjectDomain; techStack?: string[] }) { return this.projectService.createProjectWithResponse(data); }
  async getProject(id: string): Promise<Project | null> { return this.projectService.getProject(id); }
  async getProjectBySlug(slug: string): Promise<Project | null> { return this.projectService.getProjectBySlug(slug); }
  async getProjectByIdOrSlug(idOrSlug: string): Promise<{ success: boolean; project?: Project; error?: string }> { return this.projectService.getProjectByIdOrSlug(idOrSlug); }
  async listProjects(status?: ProjectStatus): Promise<Project[]> { return this.projectService.listProjects(status); }
  async listProjectsWithResponse(status?: ProjectStatus) { return this.projectService.listProjectsWithResponse(status); }
  async updateProject(id: string, updates: Partial<Project>): Promise<Project | null> { return this.projectService.updateProject(id, updates); }
  async updateProjectByIdOrSlug(idOrSlug: string, updates: any) { return this.projectService.updateProjectByIdOrSlug(idOrSlug, updates); }
  async deleteProject(id: string): Promise<void> { return this.projectService.deleteProject(id); }
  async deleteProjectByIdOrSlug(idOrSlug: string) { return this.projectService.deleteProjectByIdOrSlug(idOrSlug); }
  async getActiveProject(): Promise<Project | null> { return this.projectService.getActiveProject(); }
  async getActiveProjectWithResponse() { return this.projectService.getActiveProjectWithResponse(); }
  async setActiveProject(id: string): Promise<void> { return this.projectService.setActiveProject(id); }
  async setActiveProjectWithResponse(projectId: string) { return this.projectService.setActiveProjectWithResponse(projectId); }

  // ============================================================================
  // Task Management (delegated to TaskService)
  // ============================================================================

  async createTask(data: { title: string; description?: string; priority?: TaskPriority; files?: string[]; projectId?: string; type?: TaskType; tags?: string[]; references?: Array<{ url: string; label?: string; type?: string }>; createdBy?: string }): Promise<UnifiedTask> { return this.taskService.createTask(data); }
  async getTask(id: string): Promise<UnifiedTask | null> { return this.taskService.getTask(id); }
  async resolveTaskId(taskId: string, projectId?: string): Promise<UnifiedTask | null> { return this.taskService.resolveTaskId(taskId, projectId); }
  async getTasks(filter: TaskFilter = {}): Promise<UnifiedTask[]> { return this.taskService.getTasks(filter); }
  async searchTasks(query: string, options?: { projectId?: string; status?: TaskStatus; limit?: number }): Promise<UnifiedTask[]> { return this.taskService.searchTasks(query, options); }
  async getChangeSummary(since: Date, projectId?: string) { return this.taskService.getChangeSummary(since, projectId); }
  async updateTask(id: string, updates: Partial<UnifiedTask>): Promise<UnifiedTask | null> { return this.taskService.updateTask(id, updates); }
  async deleteTask(id: string): Promise<void> { return this.taskService.deleteTask(id); }
  async getNextTask(filter: TaskFilter = {}): Promise<UnifiedTask | null> { return this.taskService.getNextTask(filter); }

  // ============================================================================
  // Session Management (delegated to SessionService)
  // ============================================================================

  async claimTask(taskId: string, agentId: string, options: { force?: boolean; capacity?: number } = {}): Promise<ClaimResult> { return this.sessionService.claimTask(taskId, agentId, options); }
  async claimTaskWithResponse(taskId: string, agentId: string, options: { force?: boolean; capacity?: number } = {}) { return this.sessionService.claimTaskWithResponse(taskId, agentId, options); }
  async releaseTask(sessionId: string, completed: boolean = false, options: { reason?: import('../../analytics/types.js').AbandonmentReason; notes?: string } = {}): Promise<void> { return this.sessionService.releaseTask(sessionId, completed, options); }
  async releaseTaskWithResponse(sessionId: string, completed: boolean = false, options: { reason?: import('../../analytics/types.js').AbandonmentReason; notes?: string; agentId?: string } = {}) { return this.sessionService.releaseTaskWithResponse(sessionId, completed, options); }
  async sessionHeartbeat(sessionId: string): Promise<{ success: boolean; expired: boolean }> { return this.sessionService.sessionHeartbeat(sessionId); }
  async getSession(id: string): Promise<CoordinationSession | null> { return this.sessionService.getSession(id); }
  async getActiveSessions(projectId?: string): Promise<CoordinationSession[]> { return this.sessionService.getActiveSessions(projectId); }
  async getSessionFeedback(options: { projectId?: string; since?: Date; until?: Date } = {}) { return this.sessionService.getSessionFeedback(options); }
  async getActiveSessionForTask(taskId: string): Promise<CoordinationSession | null> { return this.sessionService.getActiveSessionForTask(taskId); }
  async cleanupDanglingSessions(): Promise<number> { return this.sessionService.cleanupDanglingSessions(); }
  async getAllSessions(options: { projectId?: string; status?: string; agentId?: string; limit?: number; offset?: number } = {}): Promise<CoordinationSession[]> { return this.sessionService.getAllSessions(options); }

  // ============================================================================
  // Completion & Task Lifecycle (delegated to CompletionService)
  // ============================================================================

  async getNextTaskWithResponse(options: any = {}) { return this.completionService.getNextTaskWithResponse(options); }
  async completeTaskWithResponse(taskId: string, completion: any, agentId?: string) { return this.completionService.completeTaskWithResponse(taskId, completion, agentId); }
  async updateTaskWithResponse(params: any) { return this.completionService.updateTaskWithResponse(params); }
  async completeTaskSmart(params: any) { return this.completionService.completeTaskSmart(params); }

  // ============================================================================
  // Phase Workflow (delegated to PhaseService)
  // ============================================================================

  async getTaskPhase(taskId: string) { return this.phaseService.getTaskPhase(taskId); }
  async startTaskPhases(taskId: string) { return this.phaseService.startTaskPhases(taskId); }
  async advanceTaskPhase(taskId: string, commitSha: string, note?: string, role?: string) { return this.phaseService.advanceTaskPhase(taskId, commitSha, note, role); }
  async skipTaskPhase(taskId: string, force?: boolean) { return this.phaseService.skipTaskPhase(taskId, force); }

  // ============================================================================
  // Decision Logging (delegated to DecisionService)
  // ============================================================================

  async logDecision(params: any) { return this.decisionService.logDecision(params); }
  async getDecisions(params: any = {}) { return this.decisionService.getDecisions(params); }
  async getFileRelevantDecisions(taskId: string, taskFiles: string[]) { return this.decisionService.getFileRelevantDecisions(taskId, taskFiles); }
  async getDecision(decisionId: string) { return this.decisionService.getDecision(decisionId); }
  async getRelatedDecisionsForTask(taskId: string) { return this.decisionService.getRelatedDecisionsForTask(taskId); }
  async captureThought(params: any) { return this.decisionService.captureThought(params); }
  async reviewThoughts(params: any = {}) { return this.decisionService.reviewThoughts(params); }
  async promoteThought(decisionId: string, category?: string) { return this.decisionService.promoteThought(decisionId, category); }
  async discardThought(decisionId: string) { return this.decisionService.discardThought(decisionId); }
  async deferThought(decisionId: string) { return this.decisionService.deferThought(decisionId); }

  // ============================================================================
  // Analytics (delegated to AnalyticsService)
  // ============================================================================

  async getCoordinationMetrics(options: any = {}) { return this.analyticsService.getCoordinationMetrics(options); }
  async getOutcomeMetrics(params: any = {}) { return this.analyticsService.getOutcomeMetrics(params); }
  async getValueDashboard(params: any = {}) { return this.analyticsService.getValueDashboard(params); }
  async recordTaskOutcome(params: any) { return this.analyticsService.recordTaskOutcome(params); }
  async getTaskOutcome(taskId: string) { return this.analyticsService.getTaskOutcome(taskId); }
  async getTaskOutcomeMetrics(params: any = {}) { return this.analyticsService.getTaskOutcomeMetrics(params); }
  async getAXMetrics(params: any = {}) { return this.analyticsService.getAXMetrics(params); }
  async submitAXSurvey(params: any) { return this.analyticsService.submitAXSurvey(params); }
  async getAXSurveyQuestions(params: any = {}) { return this.analyticsService.getAXSurveyQuestions(params); }
  async getAXSurveyAnalysis(params: any = {}) { return this.analyticsService.getAXSurveyAnalysis(params); }
  async getAXEvaluationReport(params: any = {}) { return this.analyticsService.getAXEvaluationReport(params); }
  async submitSessionFeedback(params: { sessionId: string; taskId?: string; productivityRating?: number; frictionTags: string[]; notes?: string }): Promise<any> {
    const projectId = await this.storage.getActiveProjectId();
    if (!projectId) return { success: false, message: 'No active project. Set a project first.' };
    const feedbackId = `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.storage.saveSessionFeedback({ id: feedbackId, sessionId: params.sessionId, projectId, taskId: params.taskId, productivityRating: params.productivityRating, frictionTags: params.frictionTags, notes: params.notes });
    return { success: true, feedbackId, message: 'Session feedback recorded. Thank you!' };
  }

  // ============================================================================
  // Artifact Management (delegated to ArtifactService)
  // ============================================================================

  async linkArtifact(params: any) { return this.artifactService.linkArtifact(params); }
  async listArtifacts(params: any) { return this.artifactService.listArtifacts(params); }
  async removeArtifact(artifactId: string) { return this.artifactService.removeArtifact(artifactId); }
  async getArtifactLineage(artifactId: string) { return this.artifactService.getArtifactLineage(artifactId); }
  async storeArtifact(params: any) { return this.artifactService.storeArtifact(params); }
  async captureInsight(params: any) { return this.artifactService.captureInsight(params); }
  async searchArtifacts(params: any) { return this.artifactService.searchArtifacts(params); }
  async getArtifact(artifactId: string, includeContent: boolean = true) { return this.artifactService.getArtifact(artifactId, includeContent); }

  // ============================================================================
  // Checkpoint Management (delegated to CheckpointService)
  // ============================================================================

  async requestHumanInput(params: any) { return this.checkpointService.requestHumanInput(params); }
  async provideHumanInput(params: any) { return this.checkpointService.provideHumanInput(params); }
  async getPendingCheckpoints(projectId?: string): Promise<HumanCheckpoint[]> { return this.checkpointService.getPendingCheckpoints(projectId); }
  async getCheckpoint(checkpointId: string): Promise<HumanCheckpoint | null> { return this.checkpointService.getCheckpoint(checkpointId); }
  async getActiveCheckpointForTask(taskId: string): Promise<HumanCheckpoint | null> { return this.checkpointService.getActiveCheckpointForTask(taskId); }
  async getCheckpointHistory(taskId: string): Promise<HumanCheckpoint[]> { return this.checkpointService.getCheckpointHistory(taskId); }
  async timeoutCheckpoint(checkpointId: string) { return this.checkpointService.timeoutCheckpoint(checkpointId); }
  async getTasksAwaitingHuman(projectId?: string): Promise<UnifiedTask[]> {
    return this.checkpointService.getTasksAwaitingHuman(projectId, (filter) => this.getTasks(filter));
  }

  // ============================================================================
  // Handoff (delegated to HandoffServiceAdapter)
  // ============================================================================

  async getHandoffContext(params: any) { return this.handoffAdapter.getHandoffContext(params); }
  async generateContinuationPrompt(params: any) { return this.handoffAdapter.generateContinuationPrompt(params); }
  async compressSessionState(sessionId: string) { return this.handoffAdapter.compressSessionState(sessionId); }
  async getHandoffStatus(params: any = {}) { return this.handoffAdapter.getHandoffStatus(params); }
  async generateStartSessionPrompt(projectSlug: string) { return this.handoffAdapter.generateStartSessionPrompt(projectSlug); }
  async generateReviewPrompt(taskId: string) { return this.handoffAdapter.generateReviewPrompt(taskId); }

  // ============================================================================
  // Initiative/Outcome Tracking (delegated to InitiativeService)
  // ============================================================================

  async createInitiative(params: any) { return this.initiativeService.createInitiative(params); }
  async getInitiative(initiativeId: string) { return this.initiativeService.getInitiative(initiativeId); }
  async listInitiatives(params: any = {}) { return this.initiativeService.listInitiatives(params); }
  async linkTaskToInitiative(params: any) { return this.initiativeService.linkTaskToInitiative(params); }
  async recordInitiativeOutcome(params: any) { return this.initiativeService.recordInitiativeOutcome(params); }
  async updateInitiative(params: any) { return this.initiativeService.updateInitiative(params); }
  async getInitiativeLearnings(params: any = {}) { return this.initiativeService.getInitiativeLearnings(params); }
  async suggestInitiatives(params: any = {}) { return this.initiativeService.suggestInitiatives(params); }
  async getTaskInitiatives(taskId: string) { return this.initiativeService.getTaskInitiatives(taskId); }

  // ============================================================================
  // Methods remaining in facade (thin wrappers over storage/pure functions)
  // ============================================================================

  // ── List Tasks ──────────────────────────────────────────────────────

  async listTasksWithResponse(filter: { status?: TaskStatus | 'all'; projectId?: string; priority?: TaskPriority; tags?: string[] } = {}): Promise<any> {
    const status = filter.status === 'all' ? undefined : filter.status;
    const projectId = await this.resolveProjectId(filter.projectId) || undefined;
    const tasks = await this.storage.getTasks({ status, projectId, priority: filter.priority, tags: filter.tags });
    return {
      success: true,
      tasks: tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, tags: t.tags, gitBranch: t.implementation?.gitBranch, createdAt: t.createdAt })),
      count: tasks.length,
    };
  }

  // ── Minimal Task Context ────────────────────────────────────────────

  async getMinimalTaskWithResponse(taskId: string): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };
    const linkedDecisions = await this.storage.getDecisions({ taskId, limit: 1 });
    const decisionCount = linkedDecisions.length > 0 ? (await this.storage.getDecisions({ taskId })).length : 0;
    const response = {
      success: true,
      task: { id: task.id, title: task.title, priority: task.priority, status: task.status, files: task.files },
      linkedDecisionCount: decisionCount > 0 ? decisionCount : undefined,
      topDecision: linkedDecisions.length > 0 ? { id: linkedDecisions[0].id, decision: linkedDecisions[0].decision, category: linkedDecisions[0].category } : undefined,
    };
    await this.storage.logMetric({ eventType: 'context_fetch_minimal', projectId: task.projectId, taskId, metadata: { responseBytes: JSON.stringify(response).length } });
    return response;
  }

  // ── Task Dependencies ──────────────────────────────────────────────

  async getTaskDependenciesWithDetails(taskId: string): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, blockedBy: [], blocks: [], error: `Task not found: ${taskId}` };
    const blockedBy = task.blockedBy || [];
    const allTasks = await this.storage.getTasks({ projectId: task.projectId });
    const blocks = allTasks.filter(t => t.blockedBy?.includes(taskId)).map(t => t.id);
    const blockedByDetails = await Promise.all(blockedBy.map(id => this.storage.getTask(id)));
    const blocksDetails = await Promise.all(blocks.map(id => this.storage.getTask(id)));
    return {
      success: true, task: { id: task.id, title: task.title, status: task.status },
      blockedBy: blockedByDetails.filter(Boolean).map(t => ({ id: t!.id, title: t!.title, status: t!.status })),
      blocks: blocksDetails.filter(Boolean).map(t => ({ id: t!.id, title: t!.title, status: t!.status })),
    };
  }

  async addTaskDependency(blockerTaskId: string, blockedTaskId: string): Promise<any> {
    const blocker = await this.storage.getTask(blockerTaskId);
    const blocked = await this.storage.getTask(blockedTaskId);
    if (!blocker) return { success: false, message: `Blocker task not found: ${blockerTaskId}` };
    if (!blocked) return { success: false, message: `Blocked task not found: ${blockedTaskId}` };
    await this.storage.addTaskDependency(blockerTaskId, blockedTaskId);
    if (blocker.status !== 'completed' && blocked.status !== 'blocked') await this.storage.updateTask(blockedTaskId, { status: 'blocked' });
    await this.audit('task.dependency_added', blocker.projectId, 'task', blockedTaskId, `Dependency added: ${blockedTaskId.slice(0, 8)} blocked by ${blockerTaskId.slice(0, 8)}`, { metadata: { blockerTaskId, blockedTaskId, blockerTitle: blocker.title, blockedTitle: blocked.title } });
    return { success: true, message: `Task ${blockedTaskId.slice(0, 8)} is now blocked by ${blockerTaskId.slice(0, 8)}` };
  }

  async removeTaskDependency(blockerTaskId: string, blockedTaskId: string): Promise<any> {
    await this.storage.removeTaskDependency(blockerTaskId, blockedTaskId);
    const remainingBlockers = this.storage.getBlockingTasks(blockedTaskId);
    if (remainingBlockers.length === 0) {
      const blocked = await this.storage.getTask(blockedTaskId);
      if (blocked && blocked.status === 'blocked') await this.storage.updateTask(blockedTaskId, { status: 'ready' });
    }
    await this.audit('task.dependency_removed', 'unknown', 'task', blockedTaskId, `Dependency removed: ${blockedTaskId.slice(0, 8)} no longer blocked by ${blockerTaskId.slice(0, 8)}`, { metadata: { blockerTaskId, blockedTaskId, remainingBlockers: remainingBlockers.length } });
    return { success: true, message: `Removed dependency: ${blockedTaskId.slice(0, 8)} no longer blocked by ${blockerTaskId.slice(0, 8)}` };
  }

  async getBlockedTasks(projectId?: string): Promise<UnifiedTask[]> { return this.storage.getTasks({ projectId: await this.resolveProjectId(projectId) || undefined, status: 'blocked' }); }
  async getTaskDependencies(taskId: string): Promise<{ blockedBy: string[]; blocks: string[] }> { return { blockedBy: this.storage.getBlockingTasks(taskId), blocks: this.storage.getBlockedTasks(taskId) }; }

  // ── Context Expansion ───────────────────────────────────────────────

  async expandContextWithResponse(aspect: string, id: string, taskId?: string): Promise<any> {
    let context: any;
    switch (aspect) {
      case 'decision': context = await this.storage.getStrategicDecision(id); break;
      case 'ux': context = await this.storage.getUXRequirements(id); break;
      case 'technical': context = await this.storage.getTechnicalPlan(id); break;
      case 'task': context = await this.storage.getTask(id); break;
      default: return { success: false, aspect, error: `Unknown aspect: ${aspect}` };
    }
    if (!context) return { success: false, aspect, error: `${aspect} not found: ${id}` };
    const response = { success: true, aspect, context };
    await this.storage.logMetric({ eventType: 'context_expanded', taskId, metadata: { aspect, responseBytes: JSON.stringify(response).length } });
    return response;
  }

  // ── Strategic Planning ──────────────────────────────────────────────

  async recordStrategicDecision(data: Omit<StrategicDecision, 'id' | 'createdAt'>): Promise<StrategicDecision> {
    const projectId = data.projectId || this.storage.getActiveProjectIdOrDefault();
    const decision: StrategicDecision = { id: uuidv4(), ...data, projectId, createdAt: new Date() };
    await this.storage.saveStrategicDecision(decision);
    return decision;
  }

  async recordUXRequirements(data: Omit<UXRequirements, 'id' | 'createdAt'>): Promise<UXRequirements> {
    const projectId = data.projectId || this.storage.getActiveProjectIdOrDefault();
    const requirements: UXRequirements = { id: uuidv4(), ...data, projectId, createdAt: new Date() };
    await this.storage.saveUXRequirements(requirements);
    return requirements;
  }

  async recordTechnicalPlan(data: Omit<TechnicalPlan, 'id' | 'createdAt'>): Promise<TechnicalPlan> {
    const projectId = data.projectId || this.storage.getActiveProjectIdOrDefault();
    const plan: TechnicalPlan = { id: uuidv4(), ...data, projectId, createdAt: new Date() };
    await this.storage.saveTechnicalPlan(plan);
    if (data.unifiedTasks && data.unifiedTasks.length > 0) {
      for (const taskData of data.unifiedTasks) await this.createTask({ ...taskData, projectId });
    }
    return plan;
  }

  // ── Stats & Metrics ─────────────────────────────────────────────────

  async getStats(projectId?: string): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(projectId);
    const [tasks, sessions, projects] = await Promise.all([
      this.storage.getTasks({ projectId: resolvedProjectId || undefined }),
      this.storage.getActiveSessions(resolvedProjectId || undefined),
      this.storage.listProjects(),
    ]);
    return {
      tasks: {
        total: tasks.length,
        byStatus: { ready: tasks.filter(t => t.status === 'ready').length, 'in-progress': tasks.filter(t => t.status === 'in-progress').length, blocked: tasks.filter(t => t.status === 'blocked').length, completed: tasks.filter(t => t.status === 'completed').length },
        byPriority: { critical: tasks.filter(t => t.priority === 'critical').length, high: tasks.filter(t => t.priority === 'high').length, medium: tasks.filter(t => t.priority === 'medium').length, low: tasks.filter(t => t.priority === 'low').length },
      },
      sessions: { active: sessions.length },
      projects: { total: projects.length, activeId: resolvedProjectId },
    };
  }

  async getMetrics(options: { projectId?: string; period?: 'day' | 'week' | 'month' }): Promise<any> {
    const { period = 'week' } = options;
    const projectId = await this.resolveProjectId(options.projectId);
    const now = Date.now();
    let sinceMs: number;
    switch (period) { case 'day': sinceMs = now - 86400000; break; case 'month': sinceMs = now - 2592000000; break; default: sinceMs = now - 604800000; }
    return this.storage.getEffectivenessMetrics({ projectId: projectId || undefined, since: new Date(sinceMs) });
  }

  async getEffectivenessMetrics(options: { projectId?: string; since?: Date } = {}): Promise<any> { return this.storage.getEffectivenessMetrics(options); }
  async getMetricsByAgent(options: { projectId?: string; since?: Date } = {}): Promise<any> { return this.storage.getMetricsByAgent(options); }

  async logMetric(params: any): Promise<any> {
    await this.storage.logMetric(params);
    return { success: true, message: `Metric logged: ${params.eventType}` };
  }

  // ── Quality ─────────────────────────────────────────────────────────

  async getQualityExpectations(taskId: string): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, message: `Task not found: ${taskId}` };
    const qualityConfig = await this.configManager.getQualityConfig(task.projectId).catch(() => DEFAULT_CONFIG.quality);
    const checklist = generateQualityChecklistWithConfig(task, { quality: qualityConfig });
    return { success: true, taskId: task.id, taskTitle: task.title, qualityExpectations: { summary: checklist.summary, estimatedEffort: checklist.estimatedEffort, required: checklist.criticalItems, all: checklist.expectations }, formattedChecklist: formatQualityChecklist(checklist) };
  }

  async checkQualityCompliance(taskId: string, completedItems: string[]): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, message: `Task not found: ${taskId}` };
    const compliance = checkQualityCompliance(task, completedItems);
    return { success: true, taskId: task.id, compliant: compliance.compliant, completedCount: compliance.completedCount, totalRequired: compliance.totalRequired, missingRequired: compliance.missingRequired, message: compliance.compliant ? 'All required quality expectations met!' : `Missing ${compliance.missingRequired.length} required item(s)`, recommendation: compliance.compliant ? 'Ready for review and merge' : 'Complete missing items before finalizing' };
  }

  // ── Task Suggestions ────────────────────────────────────────────────

  async getTaskSuggestions(options: any): Promise<any> {
    const projectId = await this.resolveProjectId(options.projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId });
    const developerContext: DeveloperContext | undefined = (options.recentFiles || options.expertiseAreas || options.availableMinutes) ? { recentTaskIds: [], recentFiles: options.recentFiles || [], expertiseAreas: options.expertiseAreas || [], availableTimeMinutes: options.availableMinutes } : undefined;
    const suggestions = getTaskSuggestions(tasks, { limit: options.limit || 5, categories: options.categories, developerContext });
    return { success: true, suggestions: suggestions.map(s => ({ taskId: s.task.id, title: s.task.title, priority: s.task.priority, score: s.score, category: s.category, reasons: s.reasons, files: s.task.files || [] })), count: suggestions.length, message: suggestions.length > 0 ? `Top suggestion: ${suggestions[0].task.title} (${suggestions[0].category})` : 'No tasks available for suggestions' };
  }

  async getSuggestionsByCategory(options: any): Promise<any> {
    const projectId = await this.resolveProjectId(options.projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId });
    const developerContext: DeveloperContext | undefined = (options.recentFiles || options.expertiseAreas) ? { recentTaskIds: [], recentFiles: options.recentFiles || [], expertiseAreas: options.expertiseAreas || [] } : undefined;
    const grouped = getSuggestionsByCategory(tasks, developerContext);
    const formatted: Record<string, Array<any>> = {};
    for (const [category, suggestions] of Object.entries(grouped)) { if (suggestions.length > 0) formatted[category] = suggestions.slice(0, 3).map(s => ({ taskId: s.task.id, title: s.task.title, score: s.score, reasons: s.reasons })); }
    return { success: true, categories: formatted, summary: Object.entries(formatted).filter(([_, t]) => t.length > 0).map(([cat, t]) => `${cat}: ${t.length} task(s)`).join(', ') };
  }

  async analyzeProjectTaskHealth(projectId?: string): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId: resolvedProjectId });
    const health = analyzeTaskHealth(tasks);
    return { success: true, health: { urgentTasks: health.urgentCount, blockedTasks: health.blockedCount, staleTasks: health.staleCount, averageAgeDays: health.averageAge, priorityDistribution: health.priorityDistribution, statusDistribution: health.statusDistribution, urgentTaskIds: health.urgentTaskIds, blockedTaskIds: health.blockedTaskIds, staleTaskIds: health.staleTaskIds }, recommendations: health.recommendations, overallStatus: health.urgentCount > 0 ? 'needs-attention' : health.blockedCount > 3 ? 'review-blockers' : health.staleCount > 2 ? 'address-stale-tasks' : 'healthy' };
  }

  // ── Quality Trends ──────────────────────────────────────────────────

  async getQualityTrends(days: number = 30, projectId?: string): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId: resolvedProjectId });
    const trends = getTrendAnalysis(tasks, days);
    return { success: true, period: `Last ${days} days`, trends: { completionVelocity: { data: trends.completionVelocity.slice(-14), summary: `${trends.completionVelocity.reduce((sum, p) => sum + p.value, 0)} tasks completed` }, averageCycleTime: { data: trends.averageCycleTime, summary: trends.averageCycleTime.length > 0 ? `${(trends.averageCycleTime.reduce((sum, p) => sum + p.value, 0) / trends.averageCycleTime.length).toFixed(1)} days avg` : 'No data' }, blockerRate: { data: trends.blockerRate, summary: trends.blockerRate.length > 0 ? `${(trends.blockerRate.reduce((sum, p) => sum + p.value, 0) / trends.blockerRate.length).toFixed(0)}% avg` : 'No data' }, priorityDistribution: trends.priorityDistribution.slice(-7) } };
  }

  async getQualityMetrics(periodDays: number = 7, projectId?: string): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId: resolvedProjectId });
    const metrics = calculateQualityMetrics(tasks, periodDays);
    return { success: true, metrics: { period: metrics.period, dateRange: { start: metrics.startDate.toISOString().split('T')[0], end: metrics.endDate.toISOString().split('T')[0] }, tasksCompleted: metrics.tasksCompleted, averageCycleTimeDays: metrics.averageCycleTimeDays, priorityBreakdown: metrics.priorityBreakdown, blockerRate: `${metrics.blockerRate}%`, velocityTrend: metrics.velocityTrend } };
  }

  async getQualityInsights(projectId?: string): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId: resolvedProjectId });
    const insights = generateQualityInsights(tasks);
    return { success: true, insights: { summary: insights.summary, healthScore: insights.healthScore, healthGrade: insights.healthScore >= 80 ? 'A' : insights.healthScore >= 60 ? 'B' : insights.healthScore >= 40 ? 'C' : 'D', highlights: insights.highlights, concerns: insights.concerns, recommendations: insights.recommendations } };
  }

  async compareQualityPeriods(period1Days: number = 7, period2Days: number = 7, projectId?: string): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId: resolvedProjectId });
    const comparison = compareMetrics(tasks, period1Days, period2Days);
    return { success: true, comparison: { currentPeriod: { days: period1Days, tasksCompleted: comparison.period1.tasksCompleted, avgCycleTime: comparison.period1.averageCycleTimeDays, blockerRate: `${comparison.period1.blockerRate}%` }, previousPeriod: { days: period2Days, tasksCompleted: comparison.period2.tasksCompleted, avgCycleTime: comparison.period2.averageCycleTimeDays, blockerRate: `${comparison.period2.blockerRate}%` }, changes: { velocity: comparison.changes.velocityChange > 0 ? `+${comparison.changes.velocityChange} tasks` : `${comparison.changes.velocityChange} tasks`, cycleTime: comparison.changes.cycleTimeChange > 0 ? `+${comparison.changes.cycleTimeChange.toFixed(1)} days (slower)` : `${comparison.changes.cycleTimeChange.toFixed(1)} days (faster)`, blockerRate: comparison.changes.blockerRateChange > 0 ? `+${comparison.changes.blockerRateChange}% (more blockers)` : `${comparison.changes.blockerRateChange}% (fewer blockers)` } } };
  }

  // ── Visualization ───────────────────────────────────────────────────

  async generateTaskGraph(options: any = {}): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(options.projectId) || undefined;
    const tasks = await this.storage.getTasks({ projectId: resolvedProjectId });
    const diagram = generateDependencyGraph(tasks, { direction: options.direction, showPriority: options.showPriority, showStatus: options.showStatus, maxNodes: options.maxNodes });
    return { success: true, format: 'mermaid', diagramType: 'flowchart', taskCount: tasks.length, diagram, usage: 'Paste into any Mermaid-compatible viewer or markdown file' };
  }

  // ── File-Lock Conflict Detection ────────────────────────────────────

  async getLockedFiles(): Promise<any> {
    const lockedFiles = await this.storage.getLockedFiles();
    const filesArray = Array.from(lockedFiles.entries()).map(([file, info]) => ({ file, taskId: info.taskId, agentId: info.agentId, sessionId: info.sessionId }));
    return { success: true, lockedFileCount: filesArray.length, lockedFiles: filesArray, message: filesArray.length > 0 ? `${filesArray.length} file(s) currently locked by active sessions` : 'No files currently locked' };
  }

  async checkFileConflicts(taskId: string): Promise<any> {
    const conflicts = await this.storage.findFileConflicts(taskId);
    if (conflicts.length === 0) return { success: true, hasConflicts: false, message: 'No file conflicts detected - safe to claim this task' };
    return { success: true, hasConflicts: true, conflicts: conflicts.map(c => ({ taskId: c.task.id, taskTitle: c.task.title, agentId: c.session.agentId, sessionId: c.session.id, overlappingFiles: c.overlappingFiles })), message: `Found ${conflicts.length} task(s) with overlapping files`, recommendation: 'Wait for conflicting tasks to complete or use force claim' };
  }

  // ── Audit Log ───────────────────────────────────────────────────────

  async queryAuditLog(params: any): Promise<any> {
    const events = await this.storage.queryAuditLog({ ...params, limit: params.limit || 100 });
    return { success: true, events: events.map(e => ({ id: e.id, timestamp: e.timestamp.toISOString(), eventType: e.eventType, actorId: e.actorId, actorType: e.actorType, resourceType: e.resourceType, resourceId: e.resourceId, action: e.action, metadata: e.metadata })), count: events.length };
  }

  async getAuditSummary(params: any = {}): Promise<any> {
    const resolvedProjectId = await this.resolveProjectId(params.projectId) || undefined;
    const project = resolvedProjectId ? await this.storage.getProject(resolvedProjectId) : null;
    const summary = await this.storage.getAuditSummary(resolvedProjectId, params.startTime, params.endTime);
    return { success: true, summary: { ...summary, timeRange: { earliest: summary.timeRange.earliest?.toISOString() || null, latest: summary.timeRange.latest?.toISOString() || null } }, project: project?.name || 'all' };
  }

  async exportAuditLog(params: any): Promise<any> {
    const events = await this.storage.queryAuditLog({ startTime: params.startTime, endTime: params.endTime, limit: params.limit || 1000 });
    let exportData: string;
    if (params.format === 'csv') {
      const auditEvents = events.map(e => ({ ...e, eventType: e.eventType as AuditEventType, actorType: e.actorType as 'user' | 'agent' | 'system', resourceType: e.resourceType as any }));
      exportData = eventsToCSV(auditEvents);
    } else { exportData = JSON.stringify(events.map(e => ({ ...e, timestamp: e.timestamp.toISOString() })), null, 2); }
    return { success: true, format: params.format, eventCount: events.length, data: exportData, message: `Exported ${events.length} audit events in ${params.format.toUpperCase()} format` };
  }

  // ── Task Graph / Mind Map / Briefing ────────────────────────────────

  async getTaskGraph(params: any): Promise<any> {
    const projectId = await this.resolveProjectId(params.projectId);
    const tasks = await this.storage.getTasks({ projectId: projectId || undefined });
    let graph: string;
    if (params.view === 'session') {
      const sessions = await this.storage.getActiveSessions(projectId || undefined);
      const session = sessions[0] || null;
      const decisions = await this.storage.getDecisions({ projectId: projectId || undefined, limit: 10 });
      const strategicDecisions = decisions.map(d => ({ id: d.id, projectId: d.projectId, decision: d.decision, rationale: d.rationale || '', impact: d.impact || '', timeline: '', stakeholders: [], createdAt: d.createdAt, taskId: d.taskId }));
      graph = renderSessionGraph(tasks, session, strategicDecisions, { maxDepth: params.maxDepth });
    } else { graph = renderTaskGraph(tasks, { view: params.view || 'developer', maxDepth: params.maxDepth }); }
    return { success: true, graph, view: params.view || 'developer' };
  }

  async getBriefing(params: any): Promise<any> {
    const projectId = await this.resolveProjectId(params.projectId);
    const tasks = await this.storage.getTasks({ projectId: projectId || undefined });
    const decisions = await this.storage.getDecisions({ projectId: projectId || undefined, limit: 10 });
    const strategicDecisions = decisions.map(d => ({ id: d.id, projectId: d.projectId, decision: d.decision, rationale: d.rationale || '', impact: d.impact || '', timeline: '', stakeholders: [], createdAt: d.createdAt, taskId: d.taskId }));
    const initiativeList = await this.storage.listInitiatives({ projectId: projectId || undefined, status: 'active' });
    const initiatives = await Promise.all(initiativeList.slice(0, 5).map(async (init) => { const full = await this.storage.getInitiative(init.id); return { id: init.id, title: init.title, status: init.status, taskCount: init.taskCount, linkedTaskIds: full?.tasks?.map(t => t.taskId) || [] }; }));
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    const recentCompletions = tasks.filter(t => t.status === 'completed' && new Date(t.updatedAt) > threeDaysAgo).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 5);
    const topTasks = tasks.filter(t => t.status === 'ready' || t.status === 'in-progress').slice(0, 10);
    const taskDecisions = new Map<string, Array<{ decision: string; category?: string }>>();
    for (const task of topTasks) { try { const result = await this.getDecisions({ taskId: task.id, limit: 3 }); if (result.decisions.length > 0) taskDecisions.set(task.id, result.decisions.map(d => ({ decision: d.decision, category: d.category }))); } catch {} }
    const pendingThoughtsRaw = await this.storage.getThoughts({ projectId: projectId || undefined, limit: 10 });
    const pendingThoughts = pendingThoughtsRaw.map(t => ({ id: t.id, thought: t.decision, taskId: t.taskId, createdAt: t.createdAt }));
    const briefing = generateBriefing(tasks, strategicDecisions, { focus: params.focus, agentId: params.agentId, initiatives, recentCompletions, taskDecisions, pendingThoughts });
    return { success: true, briefing: formatBriefing(briefing) };
  }

  async getClusterContext(taskId: string): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };
    const tasks = await this.storage.getTasks({ projectId: task.projectId });
    const rawDecisions = await this.storage.getDecisions({ projectId: task.projectId, taskId });
    const decisions = rawDecisions.map(d => ({ id: d.id, projectId: d.projectId, taskId: d.taskId, decision: d.decision, rationale: d.rationale || '', impact: d.impact || '', timeline: '', stakeholders: [], createdAt: d.createdAt }));
    return { success: true, context: generateClusterContext(tasks, taskId, decisions) };
  }

  // ── Task Relationships ──────────────────────────────────────────────

  async linkTasks(params: any): Promise<any> {
    const { sourceTaskId, targetTaskId, relationshipType, description, bidirectional } = params;
    const sourceTask = await this.storage.getTask(sourceTaskId);
    const targetTask = await this.storage.getTask(targetTaskId);
    if (!sourceTask) return { success: false, message: `Source task not found: ${sourceTaskId}` };
    if (!targetTask) return { success: false, message: `Target task not found: ${targetTaskId}` };
    const exists = await this.storage.relationshipExists(sourceTaskId, targetTaskId, relationshipType);
    if (exists) return { success: false, message: `Relationship already exists: ${sourceTaskId} ${relationshipType} ${targetTaskId}` };
    const relationship = await this.storage.createTaskRelationship(sourceTaskId, targetTaskId, relationshipType, { description, source: 'manual' });
    let reverseRelationship: TaskRelationship | undefined;
    if (bidirectional && (relationshipType === 'related_to' || relationshipType === 'similar_to')) {
      const reverseExists = await this.storage.relationshipExists(targetTaskId, sourceTaskId, relationshipType);
      if (!reverseExists) reverseRelationship = await this.storage.createTaskRelationship(targetTaskId, sourceTaskId, relationshipType, { description, source: 'manual' });
    }
    return { success: true, relationship, reverseRelationship, message: reverseRelationship ? `Created bidirectional ${relationshipType} relationship between tasks` : `Created ${relationshipType} relationship: ${sourceTask.title} → ${targetTask.title}` };
  }

  async unlinkTasks(params: any): Promise<any> {
    const { sourceTaskId, targetTaskId, relationshipType, bidirectional } = params;
    let removed = 0;
    if (await this.storage.removeTaskRelationship(sourceTaskId, targetTaskId, relationshipType)) removed++;
    if (bidirectional && await this.storage.removeTaskRelationship(targetTaskId, sourceTaskId, relationshipType)) removed++;
    if (removed === 0) return { success: false, removed: 0, message: 'No matching relationships found' };
    return { success: true, removed, message: `Removed ${removed} relationship(s)` };
  }

  async getRelatedTasks(params: any): Promise<any> {
    const { taskId, relationshipType, direction, includeTaskDetails } = params;
    const relationships = await this.storage.getTaskRelationships(taskId, { relationshipType, direction: direction ?? 'both' });
    const enrichedRelationships: Array<TaskRelationship & { relatedTask?: UnifiedTask }> = [];
    for (const rel of relationships) {
      const relatedTaskId = rel.sourceTaskId === taskId ? rel.targetTaskId : rel.sourceTaskId;
      if (includeTaskDetails) { const relatedTask = await this.storage.getTask(relatedTaskId); enrichedRelationships.push({ ...rel, relatedTask: relatedTask || undefined }); }
      else enrichedRelationships.push(rel);
    }
    return { success: true, relationships: enrichedRelationships, message: `Found ${relationships.length} relationship(s) for task` };
  }

  async suggestRelationships(params: any): Promise<any> {
    const { taskId, minOverlapScore = 0.1, limit = 10 } = params;
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, suggestions: [], message: `Task not found: ${taskId}` };
    const overlaps = await this.storage.findTasksWithFileOverlap(taskId, task.projectId);
    const filtered = overlaps.filter(o => o.overlapScore >= minOverlapScore).slice(0, limit);
    const taskFiles = new Set(task.files || []);
    const suggestions: any[] = [];
    for (const overlap of filtered) {
      const targetTask = await this.storage.getTask(overlap.taskId);
      if (!targetTask) continue;
      const existingRels = await this.storage.getTaskRelationships(taskId, { direction: 'both' });
      if (existingRels.some(r => r.sourceTaskId === overlap.taskId || r.targetTaskId === overlap.taskId)) continue;
      suggestions.push({ targetTaskId: overlap.taskId, targetTaskTitle: targetTask.title, overlapScore: overlap.overlapScore, suggestedType: overlap.overlapScore > 0.5 ? 'related_to' : 'similar_to', sharedFiles: (targetTask.files || []).filter(f => taskFiles.has(f)) });
    }
    return { success: true, suggestions, message: `Found ${suggestions.length} potential relationship(s) based on file overlap` };
  }

  async getRelationshipContext(taskId: string): Promise<any> {
    const relationships = await this.storage.getTaskRelationships(taskId, { direction: 'both' });
    const relatedTasks: any[] = [];
    for (const rel of relationships) {
      const isOutgoing = rel.sourceTaskId === taskId;
      const relatedTask = await this.storage.getTask(isOutgoing ? rel.targetTaskId : rel.sourceTaskId);
      if (!relatedTask) continue;
      relatedTasks.push({ id: relatedTask.id, title: relatedTask.title, status: relatedTask.status, relationshipType: rel.relationshipType, direction: isOutgoing ? 'outgoing' : 'incoming' });
    }
    let contextSummary = '';
    if (relatedTasks.length > 0) {
      const parts: string[] = [];
      const partOf = relatedTasks.filter(t => t.relationshipType === 'part_of');
      const informedBy = relatedTasks.filter(t => t.relationshipType === 'informed_by');
      const relatedTo = relatedTasks.filter(t => t.relationshipType === 'related_to');
      if (partOf.length > 0) parts.push(`Part of: ${partOf.map(t => t.title).join(', ')}`);
      if (informedBy.length > 0) parts.push(`Informed by: ${informedBy.map(t => t.title).join(', ')}`);
      if (relatedTo.length > 0) parts.push(`Related to: ${relatedTo.map(t => t.title).join(', ')}`);
      contextSummary = parts.join('; ');
    }
    return { relatedTasks, contextSummary };
  }

  // ── Related Learnings ───────────────────────────────────────────────

  async getRelatedLearnings(taskId: string): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, learnings: { fromCompletedTasks: [], fromInitiatives: [], summary: 'Task not found', recommendations: [] } };
    const relationships = await this.storage.getTaskRelationships(taskId, { direction: 'both' });
    const fromCompletedTasks: any[] = [];
    for (const rel of relationships) {
      const relatedTaskId = rel.sourceTaskId === taskId ? rel.targetTaskId : rel.sourceTaskId;
      const relatedTask = await this.storage.getTask(relatedTaskId);
      if (!relatedTask || relatedTask.status !== 'completed') continue;
      const decisions = await this.storage.getDecisions({ taskId: relatedTaskId, limit: 10 });
      const impl = relatedTask.implementation;
      const whatWorked: string[] = []; const whatToAvoid: string[] = [];
      if (impl?.architectureDecisions) { for (const ad of impl.architectureDecisions) { if (ad.impact.toLowerCase().includes('success') || ad.impact.toLowerCase().includes('worked')) whatWorked.push(ad.decision); if (ad.impact.toLowerCase().includes('avoid') || ad.impact.toLowerCase().includes('caution')) whatToAvoid.push(ad.decision); } }
      if (impl?.qualityMetrics?.testCoverage) { const coverage = parseInt(impl.qualityMetrics.testCoverage); if (coverage >= 80) whatWorked.push('Achieved high test coverage'); }
      fromCompletedTasks.push({ taskId: relatedTask.id, taskTitle: relatedTask.title, relationshipType: rel.relationshipType, implementationSummary: impl?.implementationSummary, decisions: decisions.map(d => ({ id: d.id, decision: d.decision, rationale: d.rationale, category: d.category })), qualityMetrics: impl?.qualityMetrics ? { testCoverage: impl.qualityMetrics.testCoverage, documentationComplete: impl.qualityMetrics.documentationComplete } : undefined, whatWorked: whatWorked.length > 0 ? whatWorked : undefined, whatToAvoid: whatToAvoid.length > 0 ? whatToAvoid : undefined });
    }
    const taskInitiatives = await this.storage.getTaskInitiatives(taskId);
    const fromInitiatives: any[] = [];
    for (const init of taskInitiatives) { const initiative = await this.storage.getInitiative(init.id); if (!initiative) continue; let pattern: string | undefined; if (initiative.status === 'succeeded') pattern = 'success'; else if (initiative.status === 'failed') pattern = 'failure'; else if (initiative.status === 'pivoted' || initiative.status === 'abandoned') pattern = 'learning'; fromInitiatives.push({ id: initiative.id, title: initiative.title, status: initiative.status, successCriteria: initiative.successCriteria, outcomeNotes: initiative.outcomeNotes, pattern }); }
    const recommendations: string[] = [];
    const totalDecisions = fromCompletedTasks.reduce((sum, t) => sum + t.decisions.length, 0);
    if (totalDecisions > 0) recommendations.push(`Review ${totalDecisions} decision(s) from ${fromCompletedTasks.length} related task(s) before starting`);
    const allWhatWorked = fromCompletedTasks.flatMap(t => t.whatWorked || []);
    if (allWhatWorked.length > 0) recommendations.push(`Approaches that worked: ${allWhatWorked.slice(0, 3).join('; ')}`);
    const succeededInitiatives = fromInitiatives.filter(i => i.status === 'succeeded');
    if (succeededInitiatives.length > 0) recommendations.push(`This task contributes to successful initiative(s): ${succeededInitiatives.map(i => i.title).join(', ')}`);
    const failedInitiatives = fromInitiatives.filter(i => i.status === 'failed');
    if (failedInitiatives.length > 0) recommendations.push(`Warning: Related initiative(s) failed: ${failedInitiatives.map(i => i.title).join(', ')} - review lessons learned`);
    let summary = '';
    if (fromCompletedTasks.length > 0) summary += `${fromCompletedTasks.length} related completed task(s) provide context. `;
    if (fromInitiatives.length > 0) summary += `Linked to ${fromInitiatives.length} initiative(s). `;
    if (recommendations.length === 0) { summary += 'No historical learnings available for this task.'; recommendations.push('Consider logging decisions as you work to help future agents'); }
    return { success: true, learnings: { fromCompletedTasks, fromInitiatives, summary: summary.trim(), recommendations } };
  }

  // ── Component Architecture ──────────────────────────────────────────

  private async ensureComponentsFresh(projectId: string): Promise<void> {
    const STALE_THRESHOLD_MS = 86400000;
    const components = await this.storage.getComponents({ projectId });
    const isStale = components.length === 0 || components.some(c => Date.now() - new Date(c.updatedAt).getTime() > STALE_THRESHOLD_MS);
    if (!isStale) return;
    const project = await this.storage.getProject(projectId);
    if (!project?.rootPath) return;
    const { existsSync } = await import('fs');
    const rootPath = project.rootPath.startsWith('~') ? project.rootPath.replace('~', (await import('os')).homedir()) : project.rootPath;
    if (!existsSync(rootPath)) return;
    try { const scanner = new ComponentScanner(); const result = await scanner.scan(rootPath); if (result.components.length > 0) await persistScanResults(this.storage, projectId, result, { clearExisting: true }); } catch {}
  }

  private async getComponentContextForTask(projectId: string, taskFiles: string[]): Promise<any[]> {
    if (taskFiles.length === 0) return [];
    try {
      await this.ensureComponentsFresh(projectId);
      const allComponents = await this.storage.getComponents({ projectId });
      if (allComponents.length === 0) return [];
      const matchedComponentIds = new Set<string>();
      for (const comp of allComponents) { if (!comp.filePatterns || comp.filePatterns.length === 0) continue; for (const pattern of comp.filePatterns) { const prefix = pattern.replace(/\*\*.*$/, '').replace(/\*$/, ''); if (prefix && taskFiles.some(f => f.startsWith(prefix))) { matchedComponentIds.add(comp.id); break; } } }
      if (matchedComponentIds.size === 0) return [];
      const results: any[] = [];
      const componentMap = new Map(allComponents.map(c => [c.id, c]));
      for (const compId of matchedComponentIds) {
        const comp = componentMap.get(compId)!;
        const rels = await this.storage.getComponentRelationships(compId);
        const dependencies = rels.filter(r => r.sourceId === compId && r.type === 'depends-on').map(r => componentMap.get(r.targetId)?.name || r.targetId).slice(0, 5);
        const dependents = rels.filter(r => r.targetId === compId && r.type === 'depends-on').map(r => componentMap.get(r.sourceId)?.name || r.sourceId).slice(0, 5);
        const decisions = await this.storage.getComponentDecisions(compId);
        const recentDecisions = decisions.slice(0, 3).map(d => ({ decision: d.decision, category: d.category }));
        const since = new Date(Date.now() - 14 * 86400000);
        const events = await this.storage.getComponentHealthEvents(compId, { since });
        const recentEvents = events.filter(e => e.severity === 'warning' || e.severity === 'error').slice(0, 3).map(e => ({ eventType: e.eventType, severity: e.severity, description: e.description }));
        const healthStatus: 'healthy' | 'warning' | 'critical' | 'unknown' = comp.healthScore === undefined ? 'unknown' : comp.healthScore >= 0.7 ? 'healthy' : comp.healthScore >= 0.4 ? 'warning' : 'critical';
        results.push({ name: comp.name, type: comp.type, layer: comp.layer, healthScore: comp.healthScore, healthStatus, dependencies, dependents, recentDecisions, recentEvents });
      }
      return results;
    } catch { return []; }
  }

  // ── Interface Support Methods ───────────────────────────────────────

  async getActiveProjectContext(): Promise<any> {
    const projectId = await this.storage.getActiveProjectId();
    if (!projectId) return null;
    const project = await this.storage.getProject(projectId);
    if (!project) return null;
    return { projectId: project.id, projectName: project.name, projectSlug: project.slug, rootPath: project.rootPath };
  }

  async getActiveProjectRoot(): Promise<string | null> { const context = await this.getActiveProjectContext(); return context?.rootPath || null; }

  async getTaskContextForPrompt(taskId: string): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };
    const values: Record<string, string> = { FEATURE_NAME: task.title, DESCRIPTION: task.description || '', REQUIREMENTS: task.description || '', FILES: task.files?.join(', ') || '', AREA: task.title, SUBJECT: task.title, MODULE: task.title };
    if (task.strategicContext) { values.STRATEGIC_CONTEXT = task.strategicContext.businessRationale || ''; values.CONTEXT = task.strategicContext.businessRationale || ''; }
    if (task.technicalContext) { values.CONSTRAINTS = task.technicalContext.architecture || ''; values.TARGET_STATE = task.technicalContext.implementation || ''; }
    return { success: true, values };
  }

  async getNextAvailableTask(options: { agentId: string; projectId?: string }): Promise<any> {
    const tasks = await this.storage.getTasks({ status: 'ready', projectId: options.projectId });
    const available = tasks.filter((t: UnifiedTask) => !t.assignedTo || t.assignedTo === options.agentId);
    const assignedToOthers = tasks.filter((t: UnifiedTask) => t.assignedTo && t.assignedTo !== options.agentId);
    if (available.length === 0) return { task: null, assignedToOthers };
    const priorityOrder: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    available.sort((a, b) => { const diff = priorityOrder[a.priority] - priorityOrder[b.priority]; return diff !== 0 ? diff : a.createdAt.getTime() - b.createdAt.getTime(); });
    return { task: available[0], assignedToOthers };
  }

  async getProjectStatusSummary(projectId: string): Promise<any> {
    const [inProgressTasks, readyTasks] = await Promise.all([this.storage.getTasks({ status: 'in-progress', projectId }), this.storage.getTasks({ status: 'ready', projectId })]);
    return { inProgressTasks, readyCount: readyTasks.length, criticalCount: readyTasks.filter((t: UnifiedTask) => t.priority === 'critical').length, highCount: readyTasks.filter((t: UnifiedTask) => t.priority === 'high').length };
  }

  async getTaskStats(options: { projectId?: string; allProjects?: boolean } = {}): Promise<any> {
    let allTasks: UnifiedTask[] = [];
    if (options.allProjects) { const projects = await this.storage.listProjects(); for (const p of projects) { allTasks.push(...await this.storage.getTasks({ projectId: p.id })); } }
    else { const projectId = await this.resolveProjectId(options.projectId) || 'default'; allTasks = await this.storage.getTasks({ projectId }); }
    const projects = await this.storage.listProjects();
    return { tasks: { ready: allTasks.filter(t => t.status === 'ready').length, inProgress: allTasks.filter(t => t.status === 'in-progress').length, completed: allTasks.filter(t => t.status === 'completed').length, blocked: allTasks.filter(t => t.status === 'blocked').length, total: allTasks.length }, attention: { critical: allTasks.filter(t => t.priority === 'critical' && t.status !== 'completed').length, high: allTasks.filter(t => t.priority === 'high' && t.status !== 'completed').length }, projectCount: projects.length };
  }

  async getDecisionsForBriefing(projectId: string, limit: number = 20): Promise<StrategicDecision[]> {
    const result = await this.getDecisions({ projectId, limit });
    return result.decisions.map(d => ({ id: d.id, projectId, taskId: d.taskId, decision: d.decision, rationale: d.rationale || '', impact: d.impact || '', timeline: '', stakeholders: [], createdAt: d.createdAt }));
  }

  generateTaskBranchName(taskId: string, title: string): string {
    const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    return `feature/task-${taskId.slice(0, 8)}-${titleSlug}`;
  }

  async generateQuickHandoff(options: { taskId?: string; note?: string } = {}): Promise<any> {
    let taskId = options.taskId;
    if (!taskId) {
      const activeSessions = await this.getActiveSessions();
      const activeProjectId = await this.storage.getActiveProjectId();
      const sorted = activeSessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      for (const session of sorted) { if (session.taskId) { const task = await this.getTask(session.taskId); if (task && task.status === 'in-progress' && (!activeProjectId || task.projectId === activeProjectId)) { taskId = session.taskId; break; } } }
    }
    if (!taskId) return { success: false, error: 'No active in-progress task found. Provide an explicit taskId or claim a task first.' };
    const task = await this.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };
    if (task.status !== 'in-progress') return { success: false, error: `Task ${taskId.slice(0, 8)} is "${task.status}", not in-progress. Provide the correct taskId.`, taskTitle: task.title, taskStatus: task.status };
    const decisionsResult = await this.getDecisions({ taskId, limit: 3 });
    const recentDecisions = decisionsResult.decisions;
    const handoffPrompt = `# Handoff: ${task.title}\n\n**Task ID:** ${task.id.slice(0, 8)}\n**Priority:** ${task.priority}\n\n## What needs to be done\n${task.description?.slice(0, 500) || 'See task details'}\n\n${options.note ? `## Context from investigation\n${options.note}\n\n` : ''}${recentDecisions.length > 0 ? `## Recent decisions\n${recentDecisions.map(d => `- ${d.decision}`).join('\n')}\n\n` : ''}## Files\n${task.files?.slice(0, 5).join('\n') || 'Not specified'}\n\n---\n*Run \`enginehaus briefing\` for full context*`;
    return { success: true, taskId, handoffPrompt };
  }

  async getNextTaskSuggestion(projectId?: string): Promise<any> {
    const activeProject = projectId ? await this.getProject(projectId) : await this.getActiveProject();
    const nextTasks = await this.listTasksWithResponse({ status: 'ready', projectId: activeProject?.id });
    if (nextTasks.tasks.length > 0) return { taskId: nextTasks.tasks[0].id, title: nextTasks.tasks[0].title, reason: 'Highest priority ready task' };
    return undefined;
  }

  async getProactiveAlerts(task: UnifiedTask): Promise<any[]> {
    try { const { getProactiveAlerts: runAlerts } = await import('../proactive/alerts.js'); return await runAlerts(this.storage, task); } catch { return []; }
  }

  async releaseTaskByTaskId(taskId: string, completed: boolean = false): Promise<any> {
    const task = await this.storage.getTask(taskId);
    if (!task) return { success: false, error: 'Task not found' };
    const sessions = await this.getActiveSessions();
    const session = sessions.find(s => s.taskId === taskId);
    if (session) await this.releaseTask(session.id, completed);
    if (completed) await this.updateTask(taskId, { status: 'completed' });
    const updatedTask = await this.getTask(taskId);
    return { success: true, task: updatedTask || undefined };
  }

  // ── Analysis & Learning Engine ──────────────────────────────────────

  async analyzeDecisionPatterns(options: { since: Date }): Promise<DecisionPattern[]> { return new LearningEngine(this.storage).analyzeDecisionPatterns(options); }
  async analyzeFrictionPatterns(options: { since: Date }): Promise<FrictionAnalysis> { return new LearningEngine(this.storage).analyzeFrictionPatterns(options); }
  async analyzeQualityTrends(options: { since: Date }): Promise<QualityTrends> { return new LearningEngine(this.storage).analyzeQualityTrends(options); }
  async generateRecommendations(options: { since: Date }): Promise<Recommendation[]> { return new LearningEngine(this.storage).generateRecommendations(options); }
  async generateWorldview(options: { since: Date }): Promise<Worldview> { return new LearningEngine(this.storage).generateWorldview(options); }
  async generateBriefingInsights(): Promise<InsightSummary> { return InsightLoop.forBriefing(this.storage).generateInsights(); }
  formatBriefingInsights(insights: InsightSummary): string { return InsightLoop.forBriefing(this.storage).formatInsights(insights); }

  // ── Component Architecture Scanning ─────────────────────────────────

  async scanProjectArchitecture(projectId: string, rootPath: string, options?: { clearExisting?: boolean }): Promise<any> {
    const scanner = new ComponentScanner();
    const result = await scanner.scan(rootPath);
    const { componentsCreated, relationshipsCreated } = await persistScanResults(this.storage, projectId, result, { clearExisting: options?.clearExisting });
    const scorer = new HealthScorer(this.storage);
    const health = await scorer.scoreProject(projectId);
    return { components: componentsCreated, relationships: relationshipsCreated, health, scanDuration: result.scanDuration };
  }

  async scoreProjectHealth(projectId: string): Promise<ComponentHealthReport[]> { return new HealthScorer(this.storage).scoreProject(projectId); }
  async getComponents(params: { projectId: string; layer?: string; type?: string }): Promise<any[]> { return this.storage.getComponents(params); }
  async getComponentRelationships(componentId: string): Promise<any[]> { return this.storage.getComponentRelationships(componentId); }
  async getComponentDecisions(componentId: string): Promise<any[]> { return this.storage.getComponentDecisions(componentId); }
  async getComponentHealthEvents(componentId: string, options?: { limit?: number }): Promise<any[]> { return this.storage.getComponentHealthEvents(componentId, options); }
  async getArtifactsForProject(projectId: string, type?: ArtifactType): Promise<any[]> { return this.storage.getArtifactsForProject(projectId, type); }
  async getArtifactsForTask(taskId: string, type?: ArtifactType): Promise<any[]> { return this.storage.getArtifactsForTask(taskId, type); }

  // ── Agent Registry ──────────────────────────────────────────────────

  async registerAgent(agent: AgentProfile): Promise<void> { return this.storage.registerAgent(agent); }
  async getAgent(id: string): Promise<AgentProfile | null> { return this.storage.getAgent(id); }
  async listAgents(options?: { status?: 'active' | 'inactive' | 'busy'; agentType?: string; capability?: string }): Promise<AgentProfile[]> { return this.storage.listAgents(options); }
  async updateAgent(id: string, updates: Partial<AgentProfile>): Promise<void> { return this.storage.updateAgent(id, updates); }
  async touchAgentLastSeen(agentId: string): Promise<void> { return this.storage.touchAgentLastSeen(agentId); }

  // ── Contributions ───────────────────────────────────────────────────

  async contributeToTask(contribution: Contribution): Promise<void> {
    const task = await this.storage.getTask(contribution.taskId);
    if (!task) throw new Error(`Task ${contribution.taskId} not found`);
    if (task.mode !== 'collaborative') throw new Error(`Task ${contribution.taskId} is not in collaborative mode. Set mode to 'collaborative' first.`);
    await this.storage.saveContribution(contribution);
  }

  async getContributions(taskId: string, options?: { agentId?: string; type?: ContributionType; limit?: number }): Promise<Contribution[]> { return this.storage.getContributions(taskId, options); }

  async getTaskContributors(taskId: string): Promise<Array<{ agentId: string; contributionCount: number; types: string[]; lastContributedAt: Date }>> {
    const contributions = await this.storage.getContributions(taskId);
    const byAgent = new Map<string, { count: number; types: Set<string>; lastAt: Date }>();
    for (const c of contributions) { const existing = byAgent.get(c.agentId); if (existing) { existing.count++; existing.types.add(c.type); if (c.createdAt > existing.lastAt) existing.lastAt = c.createdAt; } else { byAgent.set(c.agentId, { count: 1, types: new Set([c.type]), lastAt: c.createdAt }); } }
    return Array.from(byAgent.entries()).map(([agentId, data]) => ({ agentId, contributionCount: data.count, types: Array.from(data.types), lastContributedAt: data.lastAt }));
  }

  // ── Dispatch Queue ──────────────────────────────────────────────────

  async dispatchTask(dispatch: Dispatch): Promise<void> { const task = await this.storage.getTask(dispatch.taskId); if (!task) throw new Error(`Task ${dispatch.taskId} not found`); await this.storage.saveDispatch(dispatch); }
  async getPendingDispatches(targetAgent: string, projectId?: string): Promise<Dispatch[]> { return this.storage.getPendingDispatches(targetAgent, projectId); }
  async claimDispatch(dispatchId: string): Promise<Dispatch | null> { const dispatch = await this.storage.getDispatch(dispatchId); if (!dispatch || dispatch.status !== 'pending') return null; await this.storage.updateDispatchStatus(dispatchId, 'claimed', new Date()); return { ...dispatch, status: 'claimed', claimedAt: new Date() }; }
  async recallDispatch(dispatchId: string): Promise<boolean> { const dispatch = await this.storage.getDispatch(dispatchId); if (!dispatch || dispatch.status !== 'pending') return false; await this.storage.updateDispatchStatus(dispatchId, 'recalled'); return true; }
  async listDispatches(options?: { status?: DispatchStatus; targetAgent?: string; projectId?: string; limit?: number }): Promise<Dispatch[]> { return this.storage.listDispatches(options); }

  // ── Migration Support ───────────────────────────────────────────────

  getStorageForMigration(): StorageAdapter { return this.storage; }
}
