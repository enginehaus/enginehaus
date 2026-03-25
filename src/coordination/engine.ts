import {
  CoordinationSession,
  UnifiedTask,
  TaskStatus,
  QualityGate,
  SessionStatus,
  StrategicDecision,
  UXRequirements,
  TechnicalPlan,
  CoordinationContext,
  CoordinationEvent,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { GitService } from '../git/git-service.js';
import { QualityService } from '../quality/quality-service.js';
import { StorageService } from '../storage/storage-service.js';
import { SQLiteStorageService } from '../storage/sqlite-storage-service.js';
import { createPhaseProgress } from './phases.js';
import { ConfigurationManager } from '../config/configuration-manager.js';

/**
 * CoordinationEngine
 *
 * The heart of Enginehaus - orchestrates all coordination between roles,
 * manages sessions, tasks, quality gates, and git workflow.
 */
export class CoordinationEngine {
  private activeSessions: Map<string, CoordinationSession> = new Map();
  private defaultGitService: GitService;
  private defaultQualityService: QualityService;
  private storage: StorageService;
  private configManager: ConfigurationManager | null = null;

  constructor(
    gitService: GitService,
    qualityService: QualityService,
    storage: StorageService
  ) {
    this.defaultGitService = gitService;
    this.defaultQualityService = qualityService;
    this.storage = storage;

    // Initialize ConfigurationManager if using SQLite storage
    if (storage instanceof SQLiteStorageService) {
      this.configManager = new ConfigurationManager({
        storage: storage,
        autoSyncFromFile: true,
        cacheEnabled: true,
        cacheTTLMs: 60000, // 1 minute cache
      });
    }
  }

  /**
   * Get the ConfigurationManager instance
   */
  getConfigManager(): ConfigurationManager | null {
    return this.configManager;
  }

  /**
   * Initialize the engine by restoring active sessions from storage.
   * Should be called after storage is initialized.
   */
  async initialize(): Promise<void> {
    // Restore active sessions from SQLite
    if (this.storage instanceof SQLiteStorageService) {
      const activeSessions = await this.storage.getActiveSessions();
      for (const session of activeSessions) {
        this.activeSessions.set(session.id, session);
      }
      if (activeSessions.length > 0) {
        console.error(`Restored ${activeSessions.length} active session(s) from storage`);
      }
    }
  }

  /**
   * Sync in-memory sessions with SQLite storage.
   * Removes sessions from memory that are no longer active in storage.
   * Called by SessionHealthChecker after expiring stale sessions.
   */
  async syncSessions(): Promise<number> {
    if (!(this.storage instanceof SQLiteStorageService)) {
      return 0;
    }

    const activeInDb = await this.storage.getActiveSessions();
    const activeDbIds = new Set(activeInDb.map(s => s.id));

    let removed = 0;
    for (const sessionId of this.activeSessions.keys()) {
      if (!activeDbIds.has(sessionId)) {
        this.activeSessions.delete(sessionId);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the storage service
   */
  getStorage(): StorageService {
    return this.storage;
  }

  /**
   * Get GitService for a specific project
   * Uses project's rootPath instead of default PROJECT_ROOT
   */
  private async getGitServiceForProject(projectId: string): Promise<GitService> {
    const sqliteStorage = this.storage as SQLiteStorageService;
    const project = await sqliteStorage.getProject(projectId);
    if (project && project.rootPath) {
      return new GitService(project.rootPath);
    }
    return this.defaultGitService;
  }

  /**
   * Get QualityService for a specific project
   * Uses project's rootPath instead of default PROJECT_ROOT
   */
  private async getQualityServiceForProject(projectId: string): Promise<QualityService> {
    const sqliteStorage = this.storage as SQLiteStorageService;
    const project = await sqliteStorage.getProject(projectId);
    if (project && project.rootPath) {
      return new QualityService(project.rootPath);
    }
    return this.defaultQualityService;
  }

  /**
   * Get default agent capacity from config (or fallback to 1)
   */
  private async getDefaultAgentCapacity(projectId: string): Promise<number> {
    if (this.configManager) {
      const sessionSettings = await this.configManager.getSessionSettings(projectId);
      return sessionSettings.defaultAgentCapacity;
    }
    return 1;
  }

  // ========================================================================
  // Strategic Decision Recording (Product Manager)
  // ========================================================================

  async recordStrategicDecision(
    decision: Omit<StrategicDecision, 'id' | 'createdAt' | 'projectId'> & { projectId?: string }
  ): Promise<StrategicDecision> {
    // Get active projectId if not provided
    let projectId = decision.projectId;
    if (!projectId) {
      const sqliteStorage = this.storage as SQLiteStorageService;
      projectId = sqliteStorage.getActiveProjectIdOrDefault();
    }

    const strategicDecision: StrategicDecision = {
      id: uuidv4(),
      ...decision,
      projectId,
      createdAt: new Date(),
    };

    await this.storage.saveStrategicDecision(strategicDecision);

    // Emit event
    await this.emitEvent({
      type: 'task-created',
      data: { decision: strategicDecision },
    });

    return strategicDecision;
  }

  // ========================================================================
  // UX Requirements Recording (UX Director)
  // ========================================================================

  async recordUXRequirements(
    requirements: Omit<UXRequirements, 'id' | 'createdAt' | 'projectId'> & { projectId?: string }
  ): Promise<UXRequirements> {
    // Get active projectId if not provided
    let projectId = requirements.projectId;
    if (!projectId) {
      const sqliteStorage = this.storage as SQLiteStorageService;
      projectId = sqliteStorage.getActiveProjectIdOrDefault();
    }

    const uxRequirements: UXRequirements = {
      id: uuidv4(),
      ...requirements,
      projectId,
      createdAt: new Date(),
    };

    await this.storage.saveUXRequirements(uxRequirements);

    await this.emitEvent({
      type: 'task-updated',
      data: { uxRequirements },
    });

    return uxRequirements;
  }

  // ========================================================================
  // Technical Plan Recording (Technical Lead)
  // ========================================================================

  async recordTechnicalPlan(
    plan: Omit<TechnicalPlan, 'id' | 'createdAt' | 'projectId'> & { projectId?: string }
  ): Promise<TechnicalPlan> {
    // Get active projectId if not provided (fix: ensure tasks get correct projectId)
    let projectId = plan.projectId;
    if (!projectId) {
      const sqliteStorage = this.storage as SQLiteStorageService;
      projectId = sqliteStorage.getActiveProjectIdOrDefault();
    }

    const technicalPlan: TechnicalPlan = {
      id: uuidv4(),
      ...plan,
      projectId, // Use resolved projectId
      createdAt: new Date(),
    };

    await this.storage.saveTechnicalPlan(technicalPlan);

    // Create unified tasks from the technical plan
    if (plan.unifiedTasks && plan.unifiedTasks.length > 0) {
      for (const taskData of plan.unifiedTasks) {
        await this.createUnifiedTask({
          ...taskData,
          projectId: technicalPlan.projectId,
        });
      }
    }

    await this.emitEvent({
      type: 'task-created',
      data: { technicalPlan },
    });

    return technicalPlan;
  }

  // ========================================================================
  // Unified Task Management
  // ========================================================================

  async createUnifiedTask(
    taskData: Omit<UnifiedTask, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'projectId'> & { projectId?: string }
  ): Promise<UnifiedTask> {
    // Get active projectId if not provided
    let projectId = taskData.projectId;
    if (!projectId) {
      const sqliteStorage = this.storage as SQLiteStorageService;
      const activeId = await sqliteStorage.getActiveProjectId();
      if (!activeId) {
        throw new Error('No active project. Set a project first with set_active_project.');
      }
      projectId = activeId;
    }

    const task: UnifiedTask = {
      id: uuidv4(),
      status: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...taskData,
      projectId,
    };

    await this.storage.saveTask(task);

    await this.emitEvent({
      type: 'task-created',
      taskId: task.id,
      data: { task },
    });

    return task;
  }

  async getNextTask(
    priority?: 'critical' | 'high' | 'medium' | 'low',
    status?: TaskStatus
  ): Promise<UnifiedTask | null> {
    const tasks = await this.storage.getTasks({
      priority,
      status: status || 'ready',
    });

    if (tasks.length === 0) {
      return null;
    }

    // Sort by priority and created date
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return tasks[0];
  }

  async updateTaskProgress(
    taskId: string,
    updates: {
      status?: TaskStatus;
      currentPhase?: number;
      deliverables?: Array<{ file: string; status: string; description: string }>;
      notes?: string;
      phaseCompletion?: string;
      /** Role of the agent making this update - enables coordination visibility */
      role?: string;
    }
  ): Promise<UnifiedTask> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Don't persist role to task - it's for event tracking only
    const { role, ...taskUpdates } = updates;

    const updatedTask: UnifiedTask = {
      ...task,
      ...taskUpdates,
      updatedAt: new Date(),
    };

    await this.storage.saveTask(updatedTask);

    // If phase completion provided, create git commit
    if (updates.phaseCompletion && task.implementation?.gitBranch) {
      const gitService = await this.getGitServiceForProject(task.projectId);
      await gitService.commitPhase(
        task.implementation.gitBranch,
        updates.currentPhase || 0,
        updates.phaseCompletion,
        updates.deliverables?.map(d => d.file) || []
      );
    }

    await this.emitEvent({
      type: 'task-updated',
      taskId,
      data: {
        task: updatedTask,
        role: role || 'developer', // Default to developer for backwards compatibility
      },
    });

    return updatedTask;
  }

  async completeTask(
    taskId: string,
    completion: {
      implementationSummary: string;
      deliverables: Array<{ file: string; status: string; description: string }>;
      qualityMetrics?: {
        testCoverage?: string;
        performanceBenchmarks?: string;
        securityValidation?: string;
        documentationComplete?: boolean;
      };
      architectureDecisions?: Array<{
        decision: string;
        rationale: string;
        impact: string;
      }>;
      nextSteps?: string[];
      handoffNotes?: string;
    }
  ): Promise<UnifiedTask> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Run quality validation
    const qualityService = await this.getQualityServiceForProject(task.projectId);
    const qualityResults = await qualityService.validateQualityGates(
      task.technicalContext?.qualityGates || [],
      completion.deliverables.map(d => d.file)
    );

    // Update task with completion data
    const completedTask: UnifiedTask = {
      ...task,
      status: 'completed',
      updatedAt: new Date(),
      implementation: {
        ...task.implementation,
        completedAt: new Date(),
        implementationSummary: completion.implementationSummary,
        qualityMetrics: completion.qualityMetrics,
        architectureDecisions: completion.architectureDecisions,
        nextSteps: completion.nextSteps,
        handoffNotes: completion.handoffNotes,
      },
    };

    await this.storage.saveTask(completedTask);

    // Create final commit and push
    if (task.implementation?.gitBranch) {
      const gitService = await this.getGitServiceForProject(task.projectId);
      await gitService.finalizeTask(
        task.implementation.gitBranch,
        completion.implementationSummary,
        completion.deliverables.map(d => d.file)
      );
    }

    // Unblock any tasks that were waiting on this one
    const sqliteStorage = this.storage as SQLiteStorageService;
    const unblockedTasks = await sqliteStorage.unblockDependentTasks(taskId);

    await this.emitEvent({
      type: 'task-completed',
      taskId,
      data: { task: completedTask, qualityResults, unblockedTasks },
    });

    return completedTask;
  }

  // ========================================================================
  // Session Management
  // ========================================================================

  async startImplementationSession(
    taskId: string,
    agentId: string = 'claude-code'
  ): Promise<CoordinationSession> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const sessionId = uuidv4();

    // Create git branch for this implementation
    const gitService = await this.getGitServiceForProject(task.projectId);
    const branchName = await gitService.createTaskBranch(task);

    const session: CoordinationSession = {
      id: sessionId,
      projectId: task.projectId,
      taskId,
      agentId,
      status: 'active',
      startTime: new Date(),
      lastHeartbeat: new Date(),
      currentPhase: 1,
      context: await this.getCoordinationContext(agentId, taskId),
    };

    // Update task with implementation details
    await this.updateTaskProgress(taskId, {
      status: 'in-progress',
      currentPhase: 1,
    });

    // Update task with git branch
    task.implementation = {
      ...task.implementation,
      sessionId,
      gitBranch: branchName,
      startedAt: new Date(),
    };
    await this.storage.saveTask(task);

    this.activeSessions.set(sessionId, session);
    await this.storage.saveSession(session);

    await this.emitEvent({
      type: 'session-started',
      taskId,
      data: { session },
    });

    return session;
  }

  async updateSessionHeartbeat(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired`);
    }

    session.lastHeartbeat = new Date();
    await this.storage.saveSession(session);

    await this.emitEvent({
      type: 'session-heartbeat',
      data: { sessionId },
    });
  }

  async endSession(
    sessionId: string,
    outcome: 'completed' | 'timeout' | 'error'
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return; // Already ended or doesn't exist
    }

    session.status = outcome === 'completed' ? 'completed' : 'expired';
    session.endTime = new Date();

    await this.storage.saveSession(session);
    this.activeSessions.delete(sessionId);

    await this.emitEvent({
      type: 'session-completed',
      taskId: session.taskId,
      data: { sessionId, outcome },
    });
  }

  // ========================================================================
  // Coordination Context
  // ========================================================================

  async getCoordinationContext(
    role: string,
    taskId?: string
  ): Promise<CoordinationContext> {
    const recentDecisions = await this.storage.getRecentStrategicDecisions(10);
    const recentUXRequirements = await this.storage.getRecentUXRequirements(10);
    const recentTechnicalPlans = await this.storage.getRecentTechnicalPlans(10);
    
    let currentTask: UnifiedTask | null = null;
    if (taskId) {
      currentTask = await this.storage.getTask(taskId);
    }

    const activeTasks = await this.storage.getTasks({
      status: 'in-progress',
    });

    const readyTasks = await this.storage.getTasks({
      status: 'ready',
    });

    return {
      role,
      currentTask,
      recentDecisions,
      recentUXRequirements,
      recentTechnicalPlans,
      activeTasks,
      readyTasks,
      projectContext: await this.storage.getProjectMetadata(),
    };
  }

  // ========================================================================
  // Quality Gates
  // ========================================================================

  async validateQualityGates(
    taskId: string,
    files: string[],
    requirements: string[]
  ): Promise<{
    passed: boolean;
    results: Array<{ gate: string; passed: boolean; details: string }>;
  }> {
    const task = await this.storage.getTask(taskId);
    const projectId = task?.projectId || 'default';
    const qualityService = await this.getQualityServiceForProject(projectId);
    return await qualityService.validateQualityGates(
      requirements,
      files
    );
  }

  // ========================================================================
  // Git Integration
  // ========================================================================

  async getGitStatus(projectId?: string): Promise<{
    currentBranch: string;
    hasUncommittedChanges: boolean;
    activeBranches: string[];
  }> {
    // Use provided projectId or get active project
    let targetProjectId = projectId;
    if (!targetProjectId) {
      const sqliteStorage = this.storage as SQLiteStorageService;
      const activeId = await sqliteStorage.getActiveProjectId();
      if (!activeId) {
        throw new Error('No active project. Set a project first with set_active_project.');
      }
      targetProjectId = activeId;
    }
    const gitService = await this.getGitServiceForProject(targetProjectId);
    return await gitService.getStatus();
  }

  async createPullRequest(taskId: string): Promise<{
    url: string;
    title: string;
    description: string;
  }> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (!task.implementation?.gitBranch) {
      throw new Error(`Task ${taskId} has no git branch`);
    }

    const gitService = await this.getGitServiceForProject(task.projectId);
    return await gitService.createPullRequest(task);
  }

  // ========================================================================
  // Session Management & Conflict Detection
  // ========================================================================

  /**
   * Claim a task for an agent session.
   * Returns conflict info if another agent is already working on the task.
   * @param capacity - Max concurrent tasks for this agent (default: 1, 0 = unlimited)
   */
  async claimTask(taskId: string, agentId: string, force: boolean = false, capacity: number = 1): Promise<{
    success: boolean;
    sessionId?: string;
    conflict?: {
      existingSessionId: string;
      existingAgentId: string;
      lastHeartbeat: Date;
      startTime: Date;
    };
    fileConflicts?: Array<{
      taskId: string;
      taskTitle: string;
      agentId: string;
      overlappingFiles: string[];
    }>;
    capacityExceeded?: {
      currentTasks: Array<{ taskId: string; taskTitle: string; sessionId: string }>;
      capacity: number;
    };
  }> {
    const sqliteStorage = this.storage as SQLiteStorageService;

    // First, expire any stale sessions
    await sqliteStorage.expireStaleSessions();

    // Get task details early — needed for capacity check and session creation
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Check for existing active session on this task (pre-check before atomic claim)
    const existingSession = await sqliteStorage.getActiveSessionForTask(taskId);

    if (existingSession && existingSession.agentId !== agentId) {
      if (!force) {
        return {
          success: false,
          conflict: {
            existingSessionId: existingSession.id,
            existingAgentId: existingSession.agentId,
            lastHeartbeat: existingSession.lastHeartbeat,
            startTime: existingSession.startTime,
          },
        };
      }
      // Force claim - expire the existing session
      await sqliteStorage.completeSession(existingSession.id);
    }

    // Same agent already has a session on THIS task — refresh heartbeat and return it
    if (existingSession && existingSession.agentId === agentId) {
      await sqliteStorage.updateSessionHeartbeat(existingSession.id);
      // Ensure task is in-progress — it may have been reset while session was still active
      if (task.status !== 'in-progress') {
        task.status = 'in-progress';
        task.implementation = {
          ...task.implementation,
          sessionId: existingSession.id,
          startedAt: task.implementation?.startedAt || new Date(),
          phaseProgress: task.implementation?.phaseProgress || createPhaseProgress(),
        };
        await this.storage.saveTask(task);
      }
      return {
        success: true,
        sessionId: existingSession.id,
      };
    }

    // Check agent capacity (skip if force or capacity=0 means unlimited)
    if (!force && capacity > 0) {
      const agentSessions = await sqliteStorage.getActiveSessionsForAgent(agentId);
      if (agentSessions.length >= capacity) {
        const currentTasks = await Promise.all(
          agentSessions.map(async (s) => {
            const t = await this.storage.getTask(s.taskId);
            return {
              taskId: s.taskId,
              taskTitle: t?.title || 'Unknown',
              sessionId: s.id,
            };
          })
        );
        return {
          success: false,
          capacityExceeded: {
            currentTasks,
            capacity,
          },
        };
      }
    }

    // Check for file-level conflicts (other agents working on same files)
    const fileConflicts = await sqliteStorage.findFileConflicts(taskId, agentId);
    if (fileConflicts.length > 0 && !force) {
      return {
        success: false,
        fileConflicts: fileConflicts.map(fc => ({
          taskId: fc.task.id,
          taskTitle: fc.task.title,
          agentId: fc.session.agentId,
          overlappingFiles: fc.overlappingFiles,
        })),
      };
    }

    // Atomic session creation — prevents race where two agents pass checks simultaneously
    const sessionId = uuidv4();
    const now = new Date();

    const session: CoordinationSession = {
      id: sessionId,
      projectId: task.projectId,
      taskId,
      agentId,
      status: 'active',
      startTime: now,
      lastHeartbeat: now,
      context: {
        role: agentId,
        currentTask: task,
        recentDecisions: [],
        recentUXRequirements: [],
        recentTechnicalPlans: [],
        activeTasks: [task],
        readyTasks: [],
        projectContext: {},
      },
    };

    const claimResult = sqliteStorage.claimSessionAtomic(session);
    if (claimResult.conflict) {
      return {
        success: false,
        conflict: {
          existingSessionId: claimResult.conflict.id,
          existingAgentId: claimResult.conflict.agentId,
          lastHeartbeat: claimResult.conflict.lastHeartbeat,
          startTime: claimResult.conflict.startTime,
        },
      };
    }

    // If same agent already had a session, ensure task is in-progress and return
    if (claimResult.existingSessionId) {
      if (task.status !== 'in-progress') {
        task.status = 'in-progress';
        task.implementation = {
          ...task.implementation,
          sessionId: claimResult.existingSessionId,
          startedAt: task.implementation?.startedAt || now,
          phaseProgress: task.implementation?.phaseProgress || createPhaseProgress(),
        };
        await this.storage.saveTask(task);
      }
      return {
        success: true,
        sessionId: claimResult.existingSessionId,
      };
    }

    // Update task status to in-progress and auto-initialize phases
    task.status = 'in-progress';
    task.implementation = {
      ...task.implementation,
      sessionId,
      startedAt: now,
      phaseProgress: task.implementation?.phaseProgress || createPhaseProgress(),
    };
    await this.storage.saveTask(task);

    // Emit event
    await this.emitEvent({
      type: 'session-started',
      taskId,
      data: { sessionId, agentId },
    });

    return {
      success: true,
      sessionId,
    };
  }

  /**
   * Release a task claim (complete or abandon session)
   */
  async releaseTask(sessionId: string, completed: boolean = false): Promise<void> {
    const sqliteStorage = this.storage as SQLiteStorageService;

    const session = await sqliteStorage.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (completed) {
      await sqliteStorage.completeSession(sessionId);
      await this.emitEvent({
        type: 'session-completed',
        taskId: session.taskId,
        data: { sessionId, agentId: session.agentId },
      });
    } else {
      // Abandoned - expire the session and reset task status
      await sqliteStorage.completeSession(sessionId);

      const task = await this.storage.getTask(session.taskId);
      if (task && task.status === 'in-progress') {
        task.status = 'ready';
        await this.storage.saveTask(task);
      }

      await this.emitEvent({
        type: 'session-expired',
        taskId: session.taskId,
        data: { sessionId, agentId: session.agentId, reason: 'abandoned' },
      });
    }
  }

  /**
   * Send heartbeat to keep session alive
   */
  async sessionHeartbeat(sessionId: string): Promise<{ success: boolean; expired: boolean }> {
    const sqliteStorage = this.storage as SQLiteStorageService;

    const session = await sqliteStorage.getSession(sessionId);
    if (!session) {
      return { success: false, expired: true };
    }

    if (session.status !== 'active') {
      return { success: false, expired: true };
    }

    await sqliteStorage.updateSessionHeartbeat(sessionId);

    await this.emitEvent({
      type: 'session-heartbeat',
      taskId: session.taskId,
      data: { sessionId, agentId: session.agentId },
    });

    return { success: true, expired: false };
  }

  /**
   * Get session status for a task
   */
  async getTaskSessionStatus(taskId: string): Promise<{
    hasActiveSession: boolean;
    session?: CoordinationSession;
    sessionHistory: CoordinationSession[];
  }> {
    const sqliteStorage = this.storage as SQLiteStorageService;

    // Expire stale sessions first
    await sqliteStorage.expireStaleSessions();

    const activeSession = await sqliteStorage.getActiveSessionForTask(taskId);
    const sessionHistory = await sqliteStorage.getSessionsForTask(taskId);

    return {
      hasActiveSession: !!activeSession,
      session: activeSession || undefined,
      sessionHistory,
    };
  }

  // ========================================================================
  // Event Management
  // ========================================================================

  private async emitEvent(
    event: Omit<CoordinationEvent, 'id' | 'projectId' | 'userId' | 'agentId' | 'timestamp'>
  ): Promise<void> {
    const sqliteStorage = this.storage as SQLiteStorageService;
    const projectId = sqliteStorage.getActiveProjectIdOrDefault();

    const fullEvent: CoordinationEvent = {
      id: uuidv4(),
      projectId,
      userId: 'system',
      agentId: undefined,
      timestamp: new Date(),
      ...event,
    };

    await this.storage.saveEvent(fullEvent);
  }

  // ========================================================================
  // Token-Efficient Context Methods
  // ========================================================================

  /**
   * Get minimal streaming session context (<400 tokens)
   * Returns only essential information needed for immediate action
   * Creates a new session if one doesn't exist
   */
  async getStreamingSessionContext(
    sessionId: string,
    role: string
  ): Promise<{
    sessionId: string;
    isNewSession: boolean;
    currentTask: {
      id: string;
      title: string;
      priority: string;
      status: string;
    } | null;
    readyTasks: Array<{
      id: string;
      title: string;
      priority: string;
    }>;
    recentDecisions: Array<{
      id: string;
      decision: string;
      rationale: string;
    }>;
    strategicSummary: string;
    uxSummary: string;
    technicalSummary: string;
    gitBranch: string | null;
    sessionStartTime: string;
  }> {
    let session = await this.storage.getSession(sessionId);
    let isNewSession = false;

    // Create a new session if one doesn't exist
    if (!session) {
      isNewSession = true;
      const sqliteStorage = this.storage as SQLiteStorageService;
      const activeProjectId = await sqliteStorage.getActiveProjectId();
      if (!activeProjectId) {
        throw new Error('No active project. Set a project first with set_active_project.');
      }

      session = {
        id: sessionId,
        projectId: activeProjectId,
        taskId: '', // No task yet
        agentId: role,
        status: 'active',
        startTime: new Date(),
        lastHeartbeat: new Date(),
        currentPhase: 0,
        context: await this.getCoordinationContext(role),
      };

      await this.storage.saveSession(session);
      this.activeSessions.set(sessionId, session);
    }

    const currentTask = session.context.currentTask;
    const recentDecisions = await this.storage.getRecentStrategicDecisions(3);
    const recentUX = await this.storage.getRecentUXRequirements(1);
    const recentTech = await this.storage.getRecentTechnicalPlans(1);
    const readyTasks = await this.storage.getTasks({ status: 'ready' });

    // Create 1-sentence summaries (~80 tokens each)
    const strategicSummary = recentDecisions.length > 0
      ? `${recentDecisions[0].decision}: ${recentDecisions[0].rationale.substring(0, 100)}...`
      : 'No recent strategic decisions';

    const uxSummary = recentUX.length > 0
      ? `${recentUX[0].feature}: ${recentUX[0].userExperience.substring(0, 100)}...`
      : 'No recent UX requirements';

    const technicalSummary = recentTech.length > 0
      ? `${recentTech[0].feature}: ${recentTech[0].technicalApproach.substring(0, 100)}...`
      : 'No recent technical plans';

    return {
      sessionId: session.id,
      isNewSession,
      currentTask: currentTask
        ? {
            id: currentTask.id,
            title: currentTask.title,
            priority: currentTask.priority,
            status: currentTask.status,
          }
        : null,
      readyTasks: readyTasks.slice(0, 5).map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
      })),
      recentDecisions: recentDecisions.map(d => ({
        id: d.id,
        decision: d.decision,
        rationale: d.rationale.substring(0, 150),
      })),
      strategicSummary,
      uxSummary,
      technicalSummary,
      gitBranch: currentTask?.implementation?.gitBranch || null,
      sessionStartTime: session.startTime.toISOString(),
    };
  }

  /**
   * Get minimal task information (~200 tokens)
   * Just the essentials needed to start work
   */
  async getMinimalTask(taskId: string): Promise<{
    id: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    files: string[];
  }> {
    const task = await this.storage.getTask(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      files: task.files || [],
    };
  }

  /**
   * Expand context on demand
   * Load full context only when needed
   */
  async expandContext(
    aspect: 'strategic' | 'ux' | 'technical' | 'full',
    id: string
  ): Promise<{
    aspect: string;
    data: StrategicDecision | UXRequirements | TechnicalPlan | UnifiedTask | null;
  }> {
    let data: any = null;

    switch (aspect) {
      case 'strategic':
        data = await this.storage.getStrategicDecision(id);
        break;
      case 'ux':
        data = await this.storage.getUXRequirements(id);
        break;
      case 'technical':
        data = await this.storage.getTechnicalPlan(id);
        break;
      case 'full':
        data = await this.storage.getTask(id);
        break;
    }

    return {
      aspect,
      data,
    };
  }

  // ========================================================================
  // Health & Monitoring
  // ========================================================================

  async runHealthCheck(projectId?: string): Promise<{
    healthy: boolean;
    issues: string[];
    metrics: {
      activeSessions: number;
      readyTasks: number;
      inProgressTasks: number;
      completedTasksToday: number;
    };
  }> {
    const issues: string[] = [];

    // Get configured session expiry timeout (default 5 minutes if no config)
    let sessionExpiryMinutes = 5;
    if (this.configManager && projectId) {
      const sessionSettings = await this.configManager.getSessionSettings(projectId);
      sessionExpiryMinutes = sessionSettings.expiryMinutes;
    } else if (this.configManager) {
      // Try to get from active project
      const sqliteStorage = this.storage as SQLiteStorageService;
      const activeId = await sqliteStorage.getActiveProjectId();
      if (activeId) {
        const sessionSettings = await this.configManager.getSessionSettings(activeId);
        sessionExpiryMinutes = sessionSettings.expiryMinutes;
      }
    }

    // Check for stale sessions
    const now = new Date();
    for (const [sessionId, session] of this.activeSessions) {
      const minutesSinceHeartbeat =
        (now.getTime() - session.lastHeartbeat.getTime()) / 1000 / 60;

      if (minutesSinceHeartbeat > sessionExpiryMinutes) {
        issues.push(`Session ${sessionId} has not sent heartbeat in ${minutesSinceHeartbeat.toFixed(1)} minutes (timeout: ${sessionExpiryMinutes}m)`);
        await this.endSession(sessionId, 'timeout');
      }
    }

    // Check for blocked tasks
    const blockedTasks = await this.storage.getTasks({ status: 'blocked' });
    if (blockedTasks.length > 0) {
      issues.push(`${blockedTasks.length} tasks are blocked`);
    }

    // Gather metrics
    const readyTasks = await this.storage.getTasks({ status: 'ready' });
    const inProgressTasks = await this.storage.getTasks({ status: 'in-progress' });
    const completedTasksToday = await this.storage.getTasksCompletedSince(
      new Date(now.getTime() - 24 * 60 * 60 * 1000)
    );

    await this.emitEvent({
      type: 'health-check-run',
      data: {
        healthy: issues.length === 0,
        issues,
        activeSessions: this.activeSessions.size,
        readyTasks: readyTasks.length,
        inProgressTasks: inProgressTasks.length,
        completedTasksToday: completedTasksToday.length,
      },
    });

    return {
      healthy: issues.length === 0,
      issues,
      metrics: {
        activeSessions: this.activeSessions.size,
        readyTasks: readyTasks.length,
        inProgressTasks: inProgressTasks.length,
        completedTasksToday: completedTasksToday.length,
      },
    };
  }
}
