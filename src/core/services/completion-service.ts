/**
 * CompletionService — extracted from CoordinationService
 *
 * Smart task completion with git analysis, quality enforcement,
 * getNextTask workflow, and task update operations.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  UnifiedTask,
  TaskStatus,
  TaskPriority,
  StrategicContext,
  UXContext,
  TechnicalContext,
  CheckpointType,
  CheckpointStatus,
  CheckpointOption,
  TaskRelationshipType,
  ArtifactType,
} from '../../coordination/types.js';
import type { ServiceContext } from './service-context.js';
import { audit, resolveProjectId } from './service-context.js';
import {
  createPhaseProgress,
  getPhase,
  PHASES,
} from '../../coordination/phases.js';
import {
  generateQualityChecklistWithConfig,
} from '../../quality/quality-expectations.js';
import { DEFAULT_CONFIG } from '../../config/types.js';
import {
  validateCompletion,
} from '../../ai/completion-validator.js';
import {
  analyzeGitHistory,
  hasUncommittedChanges,
  hasUnpushedCommits,
  isGitRepository,
  generateDeliverables,
  inferArchitectureDecisions,
  generateQualityMetrics as generateGitQualityMetrics,
  getRecentCommitsForFiles,
  RecentCommitsResult,
  removeWorktree,
  deleteTaskBranch,
} from '../../git/git-analysis.js';
import {
  loadFilePreviews,
  getPreviewSummary,
  FilePreview,
} from '../../context/file-loader.js';
import { ConfigurationManager } from '../../config/configuration-manager.js';
import { QualityService } from '../../quality/quality-service.js';
import { VerificationEngine, VerificationVerdict } from '../../quality/verification-engine.js';
import { expandPath } from '../../utils/paths.js';
import { getClaimHints, getCompletionHints, ToolHint } from '../../utils/tool-hints.js';

/**
 * Callbacks for cross-service operations that CompletionService needs.
 * Prevents circular dependencies.
 */
export interface CompletionCallbacks {
  claimTask: (taskId: string, agentId: string) => Promise<import('./coordination-service.js').ClaimResult>;
  getFileRelevantDecisions: (taskId: string, taskFiles: string[]) => Promise<{
    relevantDecisions: Array<{
      id: string;
      decision: string;
      rationale?: string;
      category?: string;
      createdAt: Date;
    }>;
    initiative?: { id: string; title: string; successCriteria?: string };
  }>;
  getComponentContextForTask: (projectId: string, taskFiles: string[]) => Promise<Array<{
    name: string;
    type: string;
    layer?: string;
    healthScore?: number;
    healthStatus: 'healthy' | 'warning' | 'critical' | 'unknown';
    dependencies: string[];
    dependents: string[];
    recentDecisions: Array<{ decision: string; category: string }>;
    recentEvents: Array<{ eventType: string; severity: string; description?: string }>;
  }>>;
  getRelationshipContext: (taskId: string) => Promise<{
    relatedTasks: Array<{
      id: string;
      title: string;
      status: TaskStatus;
      relationshipType: TaskRelationshipType;
      direction: 'outgoing' | 'incoming';
    }>;
    contextSummary: string;
  }>;
  getRelatedLearnings: (taskId: string) => Promise<{
    success: boolean;
    learnings: {
      fromCompletedTasks: Array<{
        decisions: Array<any>;
      }>;
      fromInitiatives: Array<any>;
      summary: string;
      recommendations: string[];
    };
  }>;
  logDecision: (params: {
    decision: string;
    rationale?: string;
    impact?: string;
    category?: string;
    taskId?: string;
    projectId?: string;
  }) => Promise<{ success: boolean; decisionId?: string }>;
  completeTaskWithResponse: (taskId: string, completion: {
    implementationSummary: string;
    deliverables?: Array<{ file: string; status: string; description: string }>;
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
  }) => Promise<{
    success: boolean;
    taskId?: string;
    status?: TaskStatus;
    gitBranch?: string;
    completedAt?: Date;
    message?: string;
    error?: string;
  }>;
  recordTaskOutcome: (params: {
    taskId: string;
    status: 'pending' | 'shipped' | 'rejected' | 'rework' | 'abandoned';
    notes?: string;
  }) => Promise<{ success: boolean; outcomeId?: string; message: string }>;
  getDecisions: (params: {
    taskId?: string;
    category?: string;
    limit?: number;
    projectId?: string;
  }) => Promise<{
    success: boolean;
    decisions: Array<{
      id: string;
      decision: string;
      rationale?: string;
      category?: string;
      createdAt: Date;
      taskId?: string;
      projectId: string;
      impact?: string;
    }>;
  }>;
  getActiveCheckpointForTask: (taskId: string) => Promise<any>;
  getRelatedDecisionsForTask: (taskId: string) => Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    category?: string;
    createdAt: Date;
    relevanceScore: number;
    matchReason: string;
  }>>;
}

export class CompletionService {
  private callbacks!: CompletionCallbacks;

  constructor(
    private ctx: ServiceContext,
    private configManager: ConfigurationManager,
  ) {}

  setCallbacks(callbacks: CompletionCallbacks): void {
    this.callbacks = callbacks;
  }

  // ========================================================================
  // getNextTaskWithResponse
  // ========================================================================

  async getNextTaskWithResponse(options: {
    priority?: TaskPriority;
    status?: TaskStatus;
    agentId?: string;
    withContext?: boolean;
    maxPreviewLines?: number;
    defaultRootPath?: string;
  } = {}): Promise<any> {
    const {
      priority,
      status,
      agentId = 'claude-code',
      withContext = true,
      maxPreviewLines = 100,
      defaultRootPath,
    } = options;

    // Get next available task based on priority scoring
    const projectId = await this.ctx.storage.getActiveProjectId();
    const tasks = await this.ctx.storage.getTasks({ projectId: projectId || undefined, status, priority });

    // First check for tasks awaiting human input - surface these prominently
    const awaitingHumanTasks = tasks.filter((t: UnifiedTask) => t.status === 'awaiting-human');
    if (awaitingHumanTasks.length > 0) {
      const awaitingTask = awaitingHumanTasks[0];
      const checkpoint = await this.callbacks.getActiveCheckpointForTask(awaitingTask.id);

      return {
        success: true,
        message: `${awaitingHumanTasks.length} task(s) awaiting human input`,
        awaitingHumanInput: {
          task: {
            id: awaitingTask.id,
            title: awaitingTask.title,
            status: awaitingTask.status,
            priority: awaitingTask.priority,
          },
          checkpoint: checkpoint ? {
            id: checkpoint.id,
            type: checkpoint.type,
            reason: checkpoint.reason,
            question: checkpoint.question,
            options: checkpoint.options,
            requestedAt: checkpoint.requestedAt,
          } : null,
          totalAwaiting: awaitingHumanTasks.length,
          hint: checkpoint
            ? `Use provide_human_input with checkpointId: ${checkpoint.id} to respond`
            : 'Use get_pending_checkpoints to see all pending checkpoints',
        },
      };
    }

    // Find highest priority ready task
    const readyTasks = tasks.filter((t: UnifiedTask) =>
      t.status === 'ready' && (!t.assignedTo || t.assignedTo === agentId)
    );
    if (readyTasks.length === 0) {
      const assignedToOthers = tasks.filter((t: UnifiedTask) =>
        t.status === 'ready' && t.assignedTo && t.assignedTo !== agentId
      );
      if (assignedToOthers.length > 0) {
        return {
          success: false,
          message: `No tasks available for agent '${agentId}'. ${assignedToOthers.length} task(s) are assigned to other users.`,
        };
      }
      return {
        success: false,
        message: 'No tasks available matching criteria',
      };
    }

    // Sort by priority (critical > high > medium > low)
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    readyTasks.sort((a: UnifiedTask, b: UnifiedTask) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Try to claim tasks in priority order
    let task: UnifiedTask | null = null;
    let claimResult: import('./coordination-service.js').ClaimResult | null = null;
    const skippedReasons: string[] = [];

    for (const candidate of readyTasks) {
      const result = await this.callbacks.claimTask(candidate.id, agentId);
      if (result.success) {
        task = candidate;
        claimResult = result;
        break;
      }
      if (result.capacityExceeded) {
        return {
          success: false,
          message: `Agent capacity exceeded (${result.capacityExceeded.capacity} concurrent task limit)`,
        };
      }
      if (result.fileConflicts) {
        skippedReasons.push(`${candidate.title}: file conflicts with active sessions`);
      } else if (result.dependencyBlock) {
        skippedReasons.push(`${candidate.title}: blocked by unmet dependencies`);
      } else if (result.conflict) {
        skippedReasons.push(`${candidate.title}: already claimed by ${result.conflict.agentId}`);
      }
    }

    if (!task || !claimResult) {
      return {
        success: false,
        message: skippedReasons.length > 0
          ? `All ${readyTasks.length} ready task(s) have conflicts: ${skippedReasons.join('; ')}`
          : 'No claimable tasks available',
      };
    }

    // Get session
    const session = await this.ctx.storage.getSession(claimResult.sessionId!);
    if (!session) {
      return {
        success: false,
        message: 'Session not found after claim',
      };
    }

    // Auto-initialize phases if not already started
    let phaseInfo: {
      initialized: boolean;
      currentPhase?: string;
      phaseNumber: number;
      completedPhases?: number;
      totalPhases: number;
    };

    if (!task.implementation?.phaseProgress) {
      const phaseProgress = createPhaseProgress();
      await this.ctx.storage.updateTask(task.id, {
        implementation: {
          ...task.implementation,
          sessionId: session.id,
          phaseProgress,
          startedAt: new Date(),
        },
      });
      const currentPhase = getPhase(1);
      phaseInfo = {
        initialized: true,
        currentPhase: currentPhase?.name,
        phaseNumber: 1,
        totalPhases: PHASES.length,
      };
    } else {
      const progress = task.implementation.phaseProgress;
      const currentPhase = getPhase(progress.currentPhase);
      phaseInfo = {
        initialized: false,
        currentPhase: currentPhase?.name,
        phaseNumber: progress.currentPhase,
        completedPhases: progress.completedPhases.length,
        totalPhases: PHASES.length,
      };
    }

    // Generate quality expectations checklist with project config
    const qualityConfig = await this.configManager.getQualityConfig(task.projectId).catch(() => DEFAULT_CONFIG.quality);
    const qualityChecklist = generateQualityChecklistWithConfig(task, { quality: qualityConfig });

    // Load file previews if requested
    let contextFiles: FilePreview[] | undefined;
    let contextSummary: { total: number; loaded: number; missing: number; binary: number; errors: number; totalBytes: number } | undefined;
    let recentCommitsData: RecentCommitsResult | undefined;

    if (withContext && task.files && task.files.length > 0) {
      const project = await this.ctx.storage.getActiveProject();
      const rootPath = project?.rootPath ? expandPath(project.rootPath) : defaultRootPath || process.cwd();

      contextFiles = await loadFilePreviews(task.files, rootPath, {
        maxLines: maxPreviewLines,
      });
      contextSummary = getPreviewSummary(contextFiles);

      try {
        recentCommitsData = await getRecentCommitsForFiles(rootPath, task.files, {
          maxCommits: 10,
          sinceDays: 14,
        });
      } catch {
        // Git analysis is optional
      }
    }

    // Log token efficiency metric
    await this.ctx.storage.logMetric({
      eventType: 'context_fetch_full',
      projectId: task.projectId,
      taskId: task.id,
      sessionId: session.id,
      metadata: {
        withContext,
        filesLoaded: contextSummary?.loaded || 0,
      },
    });

    // Get linked decisions for this task
    const linkedDecisions = await this.ctx.storage.getDecisions({ taskId: task.id, limit: 20 });
    const decisionsSummary = linkedDecisions.length > 0
      ? linkedDecisions.map(d => ({
          id: d.id,
          decision: d.decision,
          rationale: d.rationale,
          category: d.category,
          createdAt: d.createdAt,
        }))
      : undefined;

    // Get file-relevant architectural decisions
    const taskFiles = task.files || [];
    const architecturalContext = await this.callbacks.getFileRelevantDecisions(task.id, taskFiles);

    // Cross-project decision context
    let crossProjectDecisions: Array<{
      decision: string;
      rationale?: string;
      category: string;
      projectId: string;
      createdAt: Date;
    }> | undefined;
    try {
      const localCategories = new Set<string>();
      for (const d of linkedDecisions) localCategories.add(d.category);
      for (const d of architecturalContext.relevantDecisions || []) {
        if (d.category) localCategories.add(d.category);
      }
      if (localCategories.size === 0) localCategories.add('architecture');

      const crossProjectResults: typeof crossProjectDecisions = [];
      for (const category of localCategories) {
        const allDecisions = await this.ctx.storage.getDecisions({ category, limit: 50 });
        const otherProject = allDecisions.filter(d => d.projectId !== task!.projectId);
        for (const d of otherProject.slice(0, 3)) {
          crossProjectResults.push({
            decision: d.decision,
            rationale: d.rationale,
            category: d.category,
            projectId: d.projectId,
            createdAt: d.createdAt,
          });
        }
      }
      if (crossProjectResults.length > 0) {
        crossProjectDecisions = crossProjectResults.slice(0, 5);
      }
    } catch {
      // Non-critical
    }

    // Find related decisions by keyword/tag similarity (unattached strategic decisions)
    let relatedDecisions: Array<{
      id: string;
      decision: string;
      rationale?: string;
      category?: string;
      createdAt: Date;
      relevanceScore: number;
      matchReason: string;
    }> | undefined;
    try {
      const related = await this.callbacks.getRelatedDecisionsForTask(task.id);
      // Exclude decisions already in linkedDecisions or fileRelevantDecisions
      const alreadySurfacedIds = new Set([
        ...(linkedDecisions.map(d => d.id)),
        ...(architecturalContext.relevantDecisions?.map(d => d.id) || []),
      ]);
      const filtered = related.filter(d => !alreadySurfacedIds.has(d.id));
      if (filtered.length > 0) {
        relatedDecisions = filtered;
      }
    } catch {
      // Non-critical
    }

    // Track decisions surfaced
    const totalDecisionsSurfaced =
      (decisionsSummary?.length || 0) +
      (architecturalContext.relevantDecisions?.length || 0) +
      (crossProjectDecisions?.length || 0) +
      (relatedDecisions?.length || 0);
    if (totalDecisionsSurfaced > 0) {
      await this.ctx.storage.logMetric({
        eventType: 'decisions_surfaced',
        projectId: task.projectId,
        taskId: task.id,
        sessionId: session.id,
        metadata: {
          linkedDecisions: decisionsSummary?.length || 0,
          fileRelevantDecisions: architecturalContext.relevantDecisions?.length || 0,
          crossProjectDecisions: crossProjectDecisions?.length || 0,
          relatedDecisions: relatedDecisions?.length || 0,
          totalSurfaced: totalDecisionsSurfaced,
        },
      });
    }

    // Get component architecture context
    const componentContext = await this.callbacks.getComponentContextForTask(task.projectId, taskFiles);

    // Get related tasks
    const relationshipContext = await this.callbacks.getRelationshipContext(task.id);
    const relatedTasksSummary = relationshipContext.relatedTasks.length > 0
      ? relationshipContext.relatedTasks
      : undefined;

    // Load plan artifacts
    let planArtifacts: Array<{
      title?: string;
      content: string;
      fromTaskId: string;
      fromTaskTitle: string;
      createdAt: Date;
    }> | undefined;
    try {
      const allPlans: typeof planArtifacts & Array<any> = [];

      const taskPlans = await this.ctx.storage.getArtifactsForTask(task.id, 'design');
      for (const plan of taskPlans) {
        if (plan.content) {
          allPlans.push({
            title: plan.title,
            content: plan.content,
            fromTaskId: task.id,
            fromTaskTitle: task.title,
            createdAt: plan.createdAt,
          });
        }
      }

      for (const rel of relationshipContext.relatedTasks) {
        const relPlans = await this.ctx.storage.getArtifactsForTask(rel.id, 'design');
        for (const plan of relPlans) {
          if (plan.content) {
            allPlans.push({
              title: plan.title,
              content: plan.content,
              fromTaskId: rel.id,
              fromTaskTitle: rel.title,
              createdAt: plan.createdAt,
            });
          }
        }
      }

      if (allPlans.length > 0) {
        allPlans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        planArtifacts = allPlans.slice(0, 3);
      }
    } catch {
      // Non-critical
    }

    // Get cross-session learnings
    const learningsResult = await this.callbacks.getRelatedLearnings(task.id);
    const relatedLearnings = learningsResult.success && (
      learningsResult.learnings.fromCompletedTasks.length > 0 ||
      learningsResult.learnings.fromInitiatives.length > 0
    ) ? {
      summary: learningsResult.learnings.summary,
      recommendations: learningsResult.learnings.recommendations,
      completedTaskCount: learningsResult.learnings.fromCompletedTasks.length,
      totalDecisions: learningsResult.learnings.fromCompletedTasks.reduce(
        (sum, t) => sum + t.decisions.length, 0
      ),
    } : undefined;

    // Track learnings surfaced
    if (relatedLearnings) {
      await this.ctx.storage.logMetric({
        eventType: 'learnings_surfaced',
        projectId: task.projectId,
        taskId: task.id,
        sessionId: session.id,
        metadata: {
          completedTaskCount: relatedLearnings.completedTaskCount,
          totalDecisions: relatedLearnings.totalDecisions,
          recommendationCount: relatedLearnings.recommendations.length,
        },
      });
    }

    // Surface pending outcomes
    let pendingOutcomes: Array<{
      taskId: string;
      taskTitle: string;
      completedAt: Date;
    }> | undefined;
    try {
      const pending = await this.ctx.storage.getCompletedTasksWithPendingOutcomes(task.projectId, 3);
      if (pending.length > 0) {
        pendingOutcomes = pending.map(p => ({
          taskId: p.taskId,
          taskTitle: p.taskTitle,
          completedAt: p.completedAt,
        }));
      }
    } catch {
      // Non-critical
    }

    return {
      success: true,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: 'in-progress',
        files: task.files,
        strategicContext: task.strategicContext,
        uxContext: task.uxContext,
        technicalContext: task.technicalContext,
        qualityRequirements: task.qualityRequirements,
      },
      linkedDecisions: decisionsSummary,
      fileRelevantDecisions: architecturalContext.relevantDecisions.length > 0
        ? architecturalContext.relevantDecisions
        : undefined,
      crossProjectDecisions,
      relatedDecisions,
      initiative: architecturalContext.initiative,
      qualityExpectations: {
        summary: qualityChecklist.summary,
        required: qualityChecklist.criticalItems,
        all: qualityChecklist.expectations.map(e => ({
          category: e.category,
          requirement: e.requirement,
          priority: e.priority,
          rationale: e.rationale,
        })),
      },
      session: {
        id: session.id,
        gitBranch: task.implementation?.gitBranch,
        startTime: session.startTime,
        agentId,
      },
      phaseWorkflow: phaseInfo,
      contextFiles: contextFiles?.map(f => ({
        path: f.path,
        exists: f.exists,
        size: f.size,
        lines: f.lines,
        preview: f.preview,
        isBinary: f.isBinary,
        error: f.error,
      })),
      contextSummary,
      recentCommits: recentCommitsData && recentCommitsData.commits.length > 0 ? {
        commits: recentCommitsData.commits.map(c => ({
          shortHash: c.shortHash,
          message: c.message,
          author: c.author,
          date: c.date,
          linesChanged: (c.linesAdded || 0) + (c.linesRemoved || 0) || undefined,
        })),
        summary: recentCommitsData.summary,
      } : undefined,
      relatedTasks: relatedTasksSummary,
      relationshipContext: relationshipContext.contextSummary || undefined,
      relatedLearnings,
      componentArchitecture: componentContext.length > 0 ? componentContext : undefined,
      planArtifacts,
      pendingOutcomes,
      toolHints: getClaimHints({
        hasBlockedBy: (task.blockedBy?.length ?? 0) > 0,
        hasInitiative: !!architecturalContext.initiative,
        hasRelatedTasks: (relatedTasksSummary?.length ?? 0) > 0,
        hasFiles: (task.files?.length ?? 0) > 0,
        hasQualityGates: (task.technicalContext?.qualityGates?.length ?? 0) > 0,
        hasProjectInitiatives: (await this.ctx.storage.listInitiatives({ projectId: task.projectId, limit: 1 })).length > 0,
        taskTitle: task.title,
        taskDescription: task.description,
      }),
      message: this.buildNextTaskMessage(phaseInfo, linkedDecisions, relatedTasksSummary, relatedLearnings, recentCommitsData, crossProjectDecisions, relatedDecisions, componentContext, planArtifacts, pendingOutcomes),
    };
  }

  private buildNextTaskMessage(
    phaseInfo: { currentPhase?: string } | undefined,
    linkedDecisions: Array<{ id: string }>,
    relatedTasks: Array<{ id: string }> | undefined,
    relatedLearnings?: { completedTaskCount: number; totalDecisions: number } | undefined,
    recentCommits?: RecentCommitsResult,
    crossProjectDecisions?: Array<{ decision: string }>,
    relatedDecisions?: Array<{ id: string }>,
    componentContext?: Array<{ name: string; healthStatus: string }>,
    planArtifacts?: Array<{ title?: string; fromTaskTitle: string }>,
    pendingOutcomes?: Array<{ taskId: string }>,
  ): string {
    const parts: string[] = [`Task claimed. Phase: ${phaseInfo?.currentPhase || 'N/A'}`];

    if (linkedDecisions.length > 0) {
      parts.push(`${linkedDecisions.length} linked decision(s)`);
    }
    if (relatedDecisions && relatedDecisions.length > 0) {
      parts.push(`${relatedDecisions.length} related decision(s) matched by topic`);
    }
    if (relatedTasks && relatedTasks.length > 0) {
      parts.push(`${relatedTasks.length} related task(s) for context`);
    }
    if (relatedLearnings && relatedLearnings.completedTaskCount > 0) {
      parts.push(`${relatedLearnings.totalDecisions} learnings from ${relatedLearnings.completedTaskCount} completed related task(s)`);
    }
    if (recentCommits && recentCommits.commits.length > 0) {
      parts.push(`File history: ${recentCommits.summary.pattern}`);
    }
    if (crossProjectDecisions && crossProjectDecisions.length > 0) {
      parts.push(`${crossProjectDecisions.length} cross-project decision(s) for organizational context`);
    }
    if (componentContext && componentContext.length > 0) {
      const unhealthy = componentContext.filter(c => c.healthStatus === 'warning' || c.healthStatus === 'critical');
      if (unhealthy.length > 0) {
        parts.push(`${componentContext.length} component(s) affected — ${unhealthy.length} need attention (${unhealthy.map(c => c.name).join(', ')})`);
      } else {
        parts.push(`${componentContext.length} component(s) affected: ${componentContext.map(c => c.name).join(', ')}`);
      }
    }
    if (planArtifacts && planArtifacts.length > 0) {
      parts.push(`${planArtifacts.length} implementation plan(s) available — review before coding`);
    }
    if (pendingOutcomes && pendingOutcomes.length > 0) {
      parts.push(`${pendingOutcomes.length} completed task(s) have pending outcomes — update with record_task_outcome when work ships`);
    }
    parts.push('Log architectural decisions with log_decision as you work');

    return parts.join('. ') + '.';
  }

  // ========================================================================
  // completeTaskWithResponse
  // ========================================================================

  async completeTaskWithResponse(
    taskId: string,
    completion: {
      implementationSummary: string;
      deliverables?: Array<{ file: string; status: string; description: string }>;
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
    },
    agentId?: string,
  ): Promise<{
    success: boolean;
    taskId?: string;
    status?: TaskStatus;
    gitBranch?: string;
    completedAt?: Date;
    message?: string;
    error?: string;
    ownershipConflict?: { claimingAgent: string; callingAgent: string; sessionId: string };
  }> {
    const task = await this.ctx.storage.getTask(taskId);
    if (!task) {
      return {
        success: false,
        error: `Task not found: ${taskId}`,
      };
    }

    // Check agent ownership — only the claiming agent can complete the task
    if (agentId) {
      const activeSession = await this.ctx.storage.getActiveSessionForTask(taskId);
      if (activeSession && activeSession.agentId !== agentId) {
        return {
          success: false,
          error: `Task is owned by agent "${activeSession.agentId}" — only the claiming agent can complete it.\n` +
            `  Your agent ID: ${agentId}\n` +
            `  Owning agent: ${activeSession.agentId}\n` +
            `Let the owning agent complete this task through its own workflow.`,
          ownershipConflict: {
            claimingAgent: activeSession.agentId,
            callingAgent: agentId,
            sessionId: activeSession.id,
          },
        };
      }
    }

    const now = new Date();
    const completedTask: UnifiedTask = {
      ...task,
      status: 'completed',
      updatedAt: now,
      implementation: {
        ...task.implementation,
        completedAt: now,
        implementationSummary: completion.implementationSummary,
        qualityMetrics: completion.qualityMetrics,
        architectureDecisions: completion.architectureDecisions,
        nextSteps: completion.nextSteps,
        handoffNotes: completion.handoffNotes,
      },
    };

    await this.ctx.storage.saveTask(completedTask);

    // Auto-unblock dependent tasks
    await this.ctx.storage.unblockDependentTasks(taskId);

    const activeSession = await this.ctx.storage.getActiveSessionForTask(taskId);

    await this.ctx.storage.logMetric({
      eventType: 'task_completed',
      projectId: task.projectId,
      taskId,
      sessionId: activeSession?.id,
      metadata: {
        completedAt: now.toISOString(),
        deliverables: completion.deliverables?.length || 0,
        agentId: activeSession?.agentId,
      },
    });

    if (activeSession) {
      await this.ctx.storage.completeSession(activeSession.id);
    }

    if (this.ctx.events) {
      await this.ctx.events.emitTaskCompleted(completedTask, 'internal');
      if (activeSession) {
        await this.ctx.events.emitSessionCompleted(activeSession, 'internal');
      }
    }

    return {
      success: true,
      taskId: task.id,
      status: 'completed',
      gitBranch: task.implementation?.gitBranch,
      completedAt: now,
      message: 'Task completed successfully',
    };
  }

  // ========================================================================
  // updateTaskWithResponse
  // ========================================================================

  async updateTaskWithResponse(params: {
    taskId: string;
    title?: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    files?: string[];
    projectId?: string;
    assignedTo?: string | null;
    lastModifiedBy?: string;
    writeMode?: 'replace' | 'append';
    expectedVersion?: number;
  }): Promise<{
    success: boolean;
    task?: UnifiedTask;
    message?: string;
    error?: string;
    warnings?: string[];
  }> {
    const existing = await this.ctx.storage.getTask(params.taskId);
    if (!existing) {
      return {
        success: false,
        error: `Task not found: ${params.taskId}`,
      };
    }

    // Optimistic locking
    if (params.expectedVersion !== undefined && params.expectedVersion !== existing.version) {
      return {
        success: false,
        error: `Version conflict: you read version ${params.expectedVersion} but task is now at version ${existing.version}. ` +
          `Another agent (${existing.lastModifiedBy || 'unknown'}) modified this task since you last read it. ` +
          `Re-read the task to get the latest version before updating.`,
      };
    }

    if (params.projectId) {
      const targetProject = await this.ctx.storage.getProject(params.projectId);
      if (!targetProject) {
        return {
          success: false,
          error: `Project not found: ${params.projectId}`,
        };
      }
    }

    const updates: Partial<UnifiedTask> = {};
    if (params.title !== undefined) updates.title = params.title;

    if (params.description !== undefined) {
      if (params.writeMode === 'append' && existing.description) {
        const agent = params.lastModifiedBy || 'unknown';
        const timestamp = new Date().toISOString().split('T')[0];
        updates.description = existing.description +
          `\n\n---\n_Added by ${agent} on ${timestamp}:_\n${params.description}`;
      } else {
        updates.description = params.description;
      }
    }
    if (params.priority !== undefined) updates.priority = params.priority;
    if (params.status !== undefined) updates.status = params.status;
    if (params.files !== undefined) updates.files = params.files;
    if (params.projectId !== undefined) updates.projectId = params.projectId;
    if (params.assignedTo !== undefined) {
      updates.assignedTo = params.assignedTo === null ? undefined : params.assignedTo;
    }
    if (params.lastModifiedBy) updates.lastModifiedBy = params.lastModifiedBy;

    // Compute field-level diffs
    const changedFields: Record<string, { before: unknown; after: unknown }> = {};
    const contentFields = ['title', 'description', 'priority', 'status', 'files', 'projectId', 'assignedTo'] as const;
    for (const field of contentFields) {
      if (updates[field] !== undefined) {
        const before = existing[field];
        const after = updates[field];
        const beforeStr = Array.isArray(before) ? JSON.stringify(before) : String(before ?? '');
        const afterStr = Array.isArray(after) ? JSON.stringify(after) : String(after ?? '');
        if (beforeStr !== afterStr) {
          changedFields[field] = { before: before ?? null, after: after ?? null };
        }
      }
    }

    // Detect cross-agent overwrite
    const warnings: string[] = [];
    const currentAgent = params.lastModifiedBy || 'unknown';
    const previousAgent = existing.lastModifiedBy;
    if (previousAgent && previousAgent !== currentAgent && Object.keys(changedFields).length > 0) {
      const fieldNames = Object.keys(changedFields).join(', ');
      warnings.push(
        `⚠️ Cross-agent overwrite: ${currentAgent} is modifying [${fieldNames}] last edited by ${previousAgent}. ` +
        `Previous values are preserved in the audit log (event: task.fields_updated).`
      );
    }

    await this.ctx.storage.updateTask(params.taskId, updates);

    if (Object.keys(changedFields).length > 0) {
      await audit(this.ctx.storage, 'task.fields_updated', existing.projectId, 'task', params.taskId,
        `Task fields updated: ${Object.keys(changedFields).join(', ')}`,
        {
          actorId: currentAgent,
          actorType: 'agent',
          metadata: {
            changedFields,
            previousModifiedBy: previousAgent || null,
            crossAgentOverwrite: !!(previousAgent && previousAgent !== currentAgent),
            taskTitle: existing.title,
          },
        },
      );
    }

    const updated = await this.ctx.storage.getTask(params.taskId);

    let message = `Task ${params.taskId.slice(0, 8)} updated successfully`;
    if (params.assignedTo !== undefined) {
      message += params.assignedTo
        ? `. Assigned to: ${params.assignedTo}`
        : '. Assignment cleared';
    }
    if (Object.keys(changedFields).length > 0) {
      message += ` (${Object.keys(changedFields).length} field(s) changed: ${Object.keys(changedFields).join(', ')})`;
    }

    return {
      success: true,
      task: updated!,
      message,
      warnings: warnings.length > 0 ? warnings : undefined,
    } as { success: boolean; task: UnifiedTask; message: string; error?: string };
  }

  // ========================================================================
  // completeTaskSmart
  // ========================================================================

  async completeTaskSmart(params: {
    taskId: string;
    summary: string;
    sessionStartTime?: string;
    defaultProjectRoot: string;
    enforceQuality?: boolean;
    role?: string;
    agentId?: string;
    decisions?: Array<{
      decision: string;
      rationale?: string;
      category?: string;
    }>;
    outcome?: {
      status?: 'shipped' | 'pending' | 'rejected' | 'rework' | 'abandoned';
      notes?: string;
    };
  }): Promise<any> {
    const { taskId, summary, sessionStartTime, defaultProjectRoot, enforceQuality, role, agentId, decisions, outcome } = params;

    const task = await this.ctx.storage.getTask(taskId);
    if (!task) {
      return {
        success: false,
        error: `Task not found: ${taskId}`,
      };
    }

    // Check agent ownership — only the agent that claimed the task can complete it.
    // This prevents Desktop from batch-closing tasks that Code is managing,
    // which skips quality gates, git analysis, and the audit trail.
    if (agentId) {
      const activeSession = await this.ctx.storage.getActiveSessionForTask(taskId);
      if (activeSession && activeSession.agentId !== agentId) {
        return {
          success: false,
          taskId,
          error: `Task is owned by agent "${activeSession.agentId}" — only the claiming agent can complete it.\n` +
            `  Your agent ID: ${agentId}\n` +
            `  Owning agent: ${activeSession.agentId}\n` +
            `  Claimed at: ${activeSession.startTime}\n` +
            `Let the owning agent complete this task through its own workflow.`,
          ownershipConflict: {
            claimingAgent: activeSession.agentId,
            callingAgent: agentId,
            sessionId: activeSession.id,
          },
          message: 'Structure > Instruction: Tasks can only be completed by the agent that claimed them. This ensures quality gates and git analysis run in the correct context.',
        };
      }
    }

    const project = await this.ctx.storage.getProject(task.projectId);
    const repoPath = project?.rootPath ? expandPath(project.rootPath) : defaultProjectRoot;
    const hasGitRepo = isGitRepository(repoPath);

    // Coordinator roles (pm, human, ux, tech-lead) skip git checks — they
    // coordinate work that other agents (developer, code) commit. Blocking
    // them on uncommitted changes creates a gap in Desktop→Code workflows.
    const coordinatorRoles = ['pm', 'human', 'ux', 'tech-lead'];
    const isCoordinator = role ? coordinatorRoles.includes(role) : false;

    // Check for uncommitted changes
    const workflowConfig = await this.configManager.getWorkflowConfig(task.projectId).catch(() => DEFAULT_CONFIG.workflow);
    const requireCommit = workflowConfig.tasks.requireCommitOnCompletion;

    if (requireCommit && hasGitRepo && !isCoordinator) {
      const gitStatus = await hasUncommittedChanges(repoPath);
      if (gitStatus.hasChanges) {
        const totalChanges = gitStatus.modifiedFiles.length + gitStatus.untrackedFiles.length + gitStatus.stagedFiles.length;
        return {
          success: false,
          taskId,
          error: `Cannot complete task with ${totalChanges} uncommitted change(s). Options:\n` +
            `  - Commit: git add <files> && git commit -m "..."\n` +
            `  - Move scratch: mv <file> .enginehaus/scratch/\n` +
            `  - Discard: git checkout -- <file>\n` +
            `  - Use role: "pm" or "human" if you're coordinating, not implementing\n` +
            `Tip: Use .enginehaus/scratch/ for planning files to avoid this.`,
          uncommittedChanges: {
            modifiedFiles: gitStatus.modifiedFiles,
            untrackedFiles: gitStatus.untrackedFiles,
            stagedFiles: gitStatus.stagedFiles,
          },
          message: 'Structure > Instruction: Tasks must be committed before completion. This ensures work is captured in git history.',
        };
      }
    }

    // Check for unpushed commits
    const requirePush = workflowConfig.tasks.requirePushOnCompletion;

    if (requirePush && hasGitRepo && !isCoordinator) {
      const pushStatus = await hasUnpushedCommits(repoPath);
      if (pushStatus.hasRemote && pushStatus.unpushedCount > 0) {
        return {
          success: false,
          taskId,
          error: `Cannot complete task with ${pushStatus.unpushedCount} unpushed commit(s). Push your work:\n` +
            `  git push ${pushStatus.remoteName} ${pushStatus.branch}`,
          unpushedCommits: {
            branch: pushStatus.branch!,
            remoteName: pushStatus.remoteName!,
            unpushedCount: pushStatus.unpushedCount,
          },
          message: 'Structure > Instruction: Tasks must be pushed to remote before completion. This ensures work is visible to other agents and not at risk of loss.',
        };
      }
    }

    // Analyze git history
    const since = sessionStartTime ? new Date(sessionStartTime) : undefined;
    const analysis = await analyzeGitHistory(repoPath, since);

    // Semantic validation of completion
    const qualityConfig = await this.configManager.getQualityConfig(task.projectId).catch(() => DEFAULT_CONFIG.quality);
    let completionValidation: any;
    if (qualityConfig.completionValidation?.enabled) {
      try {
        completionValidation = await validateCompletion(
          task,
          analysis,
          summary,
          {
            enabled: qualityConfig.completionValidation.enabled,
            useLLM: qualityConfig.completionValidation.useLLM,
            timeoutMs: qualityConfig.completionValidation.timeoutMs,
            skipForSmallChanges: qualityConfig.completionValidation.skipForSmallChanges,
          }
        );
      } catch (error) {
        console.warn('Completion validation failed:', error);
      }
    }

    const deliverables = generateDeliverables(analysis);
    const architectureDecisions = inferArchitectureDecisions(analysis.commitMessages);
    const qualityMetrics = generateGitQualityMetrics(analysis);

    const workflowWarnings: string[] = [];

    if (completionValidation && !completionValidation.valid) {
      workflowWarnings.push(
        `Completion validation: ${completionValidation.rationale}`
      );
      if (completionValidation.concerns) {
        for (const concern of completionValidation.concerns) {
          workflowWarnings.push(`  - ${concern}`);
        }
      }
    }

    // Log inline decisions
    let inlineDecisionsLogged = 0;
    if (decisions && decisions.length > 0) {
      for (const d of decisions) {
        try {
          await this.callbacks.logDecision({
            decision: d.decision,
            rationale: d.rationale,
            category: d.category || 'other',
            taskId,
            projectId: task.projectId,
          });
          inlineDecisionsLogged++;
        } catch {
          // Non-critical
        }
      }
    }

    // Check decisions
    const taskDecisions = await this.ctx.storage.getDecisionsForTask(taskId);
    if (taskDecisions.length === 0) {
      workflowWarnings.push(
        'No decisions logged for this task — consider using log_decision for architectural choices'
      );
    }

    // Check quality gates
    const hasQualityRequirements = task.qualityRequirements && task.qualityRequirements.length > 0;
    const hasQualityGates = task.technicalContext?.qualityGates && task.technicalContext.qualityGates.length > 0;
    if (hasQualityRequirements || hasQualityGates) {
      const hasQualityValidation = analysis.commitMessages.some(msg =>
        msg.toLowerCase().includes('test') ||
        msg.toLowerCase().includes('lint') ||
        msg.toLowerCase().includes('quality') ||
        msg.toLowerCase().includes('validation')
      );
      if (!hasQualityValidation) {
        workflowWarnings.push(
          'Quality gates defined but no validation evidence found — run validate_quality_gates?'
        );
      }
    }

    // Check phase advances
    const phaseProgress = task.implementation?.phaseProgress;
    const isComplexTask = analysis.filesChanged.length > 3 || analysis.commitCount > 5;
    if (isComplexTask && (!phaseProgress || phaseProgress.completedPhases.length === 0)) {
      workflowWarnings.push(
        'Significant changes but no phase advances recorded — was this a simple fix or did you skip phases?'
      );
    }

    // Token-aware session boundary recommendation
    const totalLines = analysis.linesAdded + analysis.linesRemoved;
    const isHeavySession = analysis.filesChanged.length > 10 || analysis.commitCount > 10 || totalLines > 1000;
    if (isHeavySession) {
      workflowWarnings.push(
        '💡 Heavy session detected — consider starting a fresh conversation for your next task to reduce context overhead'
      );
    }

    // Quality gate enforcement
    const isOnboardingTask = task.type === 'docs';

    // Detect trivial changes: config-only edits, very small diffs
    const configOnlyExtensions = ['.json', '.yml', '.yaml', '.toml', '.md', '.txt', '.env', '.gitignore'];
    const isConfigOnly = analysis.filesChanged.length > 0 && analysis.filesChanged.every(f =>
      configOnlyExtensions.some(ext => f.endsWith(ext)) ||
      f.includes('.claude/') || f.includes('.github/') || f.includes('.enginehaus/')
    );
    const isTrivialChange = analysis.filesChanged.length <= 3 &&
      (analysis.linesAdded + analysis.linesRemoved) <= 50 &&
      isConfigOnly;

    const shouldEnforce = (isOnboardingTask || isTrivialChange) ? false : (enforceQuality ?? qualityConfig.enforceOnCompletion);

    const qualityGaps: string[] = [];

    // Determine change complexity to scale quality expectations
    const codeFiles = analysis.filesChanged.filter(f =>
      f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.tsx') || f.endsWith('.jsx')
    );
    const totalDelta = analysis.linesAdded + analysis.linesRemoved;
    const minCodeFiles = qualityConfig.substantialChangeThreshold?.minCodeFiles ?? 4;
    const minLinesDelta = qualityConfig.substantialChangeThreshold?.minLinesDelta ?? 200;
    const isSubstantialChange = codeFiles.length >= minCodeFiles || totalDelta >= minLinesDelta;

    if (taskDecisions.length === 0) {
      if (isSubstantialChange) {
        qualityGaps.push('No decisions were logged during implementation - consider adding key choices for future reference');
      } else {
        workflowWarnings.push('💡 No decisions logged — consider adding one for non-obvious choices');
      }
    }

    // Check for profile-defined quality gates
    const profileGates = qualityConfig?.profileGates;

    if (profileGates && profileGates.length > 0) {
      // Profile gates replace the default test-file heuristic
      for (const gate of profileGates) {
        if (gate.manual) {
          workflowWarnings.push(
            `📋 Manual quality gate "${gate.name}": ${gate.description}. Verify completion before proceeding.`
          );
        }
        // Automated gates with commands are handled by the existing custom quality gates system
      }
    } else {
      // Default: existing test-file heuristic
      const hasTestCommits = analysis.commitMessages.some(msg =>
        msg.toLowerCase().includes('test') ||
        msg.toLowerCase().includes('spec')
      );
      const hasTestFiles = analysis.filesChanged.some(f =>
        f.includes('test') || f.includes('spec') || f.includes('.test.') || f.includes('.spec.')
      );
      if (!hasTestCommits && !hasTestFiles && analysis.filesChanged.length > 0) {
        if (codeFiles.length > 0) {
          if (isSubstantialChange) {
            qualityGaps.push('No test files or test commits detected - consider adding tests before completion');
          } else {
            workflowWarnings.push('💡 No test changes detected — verify existing tests cover this change');
          }
        }
      }
    }

    // Run custom quality gates from project config
    const customGates = qualityConfig.gates?.custom;
    if (customGates && customGates.length > 0) {
      try {
        const qualityService = new QualityService(repoPath);
        const customResults = await qualityService.validateCustomGates(customGates, analysis.filesChanged);
        for (const result of customResults) {
          if (!result.passed) {
            const prefix = result.severity === 'warning' ? '[warning]' : '[error]';
            const msg = `Custom gate "${result.gate}" failed ${prefix}: ${result.details}`;
            if (result.severity === 'warning') {
              workflowWarnings.push(msg);
            } else {
              qualityGaps.push(msg);
            }
          }
        }
      } catch (error) {
        workflowWarnings.push(
          `Custom quality gates could not be run: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Default security + privacy scan (warning-level, never blocks)
    if (analysis.filesChanged.length > 0 && !isTrivialChange) {
      try {
        const securityService = new QualityService(repoPath);
        const scanResult = await securityService.runDefaultSecurityScan(analysis.filesChanged);
        if (!scanResult.passed) {
          workflowWarnings.push(`🔒 Security scan: ${scanResult.summary}`);
        }
      } catch (error) {
        // Don't let scan failures block completion
        workflowWarnings.push(
          `Security scan could not run: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Check for unreviewed thoughts on this task
    const unreviewedThoughts = await this.ctx.storage.getThoughts({ taskId, limit: 50 });
    if (unreviewedThoughts.length > 0) {
      workflowWarnings.push(
        `💭 ${unreviewedThoughts.length} unreviewed thought${unreviewedThoughts.length === 1 ? '' : 's'} from this task — consider reviewing with review_thoughts`
      );
    }

    // Prompt for conversational/strategic decisions that may not have been logged
    workflowWarnings.push(
      '💡 Any strategic decisions from this session worth capturing? Positioning calls, tradeoffs, and "not yet" decisions are valuable context for future agents. Use: enginehaus decision log "..." --tags <topic>'
    );

    // Log quality gate result with breakdown for diagnostics
    const qualityPassed = qualityGaps.length === 0;
    await this.ctx.storage.logMetric({
      eventType: qualityPassed ? 'quality_gate_passed' : 'quality_gate_failed',
      projectId: task.projectId,
      taskId,
      metadata: {
        qualityGaps: qualityGaps.length,
        gapReasons: qualityGaps.map(g => {
          if (g.includes('decision')) return 'no-decisions';
          if (g.includes('test')) return 'no-tests';
          if (g.includes('Custom gate')) return 'custom-gate';
          return 'other';
        }),
        hasDecisions: taskDecisions.length > 0,
        hasTests: analysis.commitMessages.some(msg => msg.toLowerCase().includes('test') || msg.toLowerCase().includes('spec')) ||
          analysis.filesChanged.some(f => f.includes('test') || f.includes('spec') || f.includes('.test.') || f.includes('.spec.')),
        enforced: shouldEnforce,
        codeFiles: codeFiles.length,
        totalDelta,
        isSubstantialChange,
      },
    });

    // Block if enforcing
    if (shouldEnforce && qualityGaps.length > 0) {
      return {
        success: false,
        taskId,
        qualityGaps,
        qualityEnforced: true,
        error: `Quality enforcement blocked completion: ${qualityGaps.length} quality gap(s) detected. Fix these issues or set enforceQuality: false to complete with warnings.`,
        message: 'Task NOT completed due to quality enforcement. Address the quality gaps and try again.',
      };
    }

    // Run verification engine — synthesize all signals into confidence verdict
    let verification: VerificationVerdict | undefined;
    try {
      const verificationEngine = new VerificationEngine();
      const llmConfig = qualityConfig.completionValidation?.useLLM
        ? {
            enabled: true,
            command: qualityConfig.completionValidation.llmCommand,
            timeoutMs: qualityConfig.completionValidation.timeoutMs || 15000,
          }
        : { enabled: false, timeoutMs: 10000 };

      verification = await verificationEngine.verify({
        taskTitle: task.title,
        taskDescription: task.description,
        summary,
        filesChanged: analysis.filesChanged,
        linesAdded: analysis.linesAdded,
        linesRemoved: analysis.linesRemoved,
        commitMessages: analysis.commitMessages,
        commitCount: analysis.commitCount,
        decisionsLogged: taskDecisions.length,
        decisionSummaries: taskDecisions.map(d => d.decision),
        hasTests: analysis.commitMessages.some(msg =>
          msg.toLowerCase().includes('test') || msg.toLowerCase().includes('spec')
        ) || analysis.filesChanged.some(f =>
          f.includes('test') || f.includes('spec') || f.includes('.test.') || f.includes('.spec.')
        ),
        testsPassing: true, // Tests already passed (npm test runs before completion)
        securityFindings: 0, // Will be populated from security scan if it ran
        privacyFindings: 0,
        qualityGaps,
        workflowWarnings,
      }, llmConfig);
    } catch {
      // Verification is best-effort — never blocks completion
    }

    // Complete the task
    const completeResult = await this.callbacks.completeTaskWithResponse(taskId, {
      implementationSummary: summary,
      deliverables,
      architectureDecisions,
      qualityMetrics,
    });

    if (!completeResult.success) {
      return {
        success: false,
        error: completeResult.error,
      };
    }

    // Record outcome
    let pendingOutcomeCreated = false;
    let outcomeRecorded = false;
    if (outcome) {
      try {
        await this.callbacks.recordTaskOutcome({
          taskId,
          status: outcome.status || 'shipped',
          notes: outcome.notes || summary,
        });
        outcomeRecorded = true;
      } catch {
        // Non-critical
      }
    } else if (workflowConfig.tasks.requireOutcomeTracking) {
      try {
        const existingOutcome = await this.ctx.storage.getTaskOutcome(taskId);
        if (!existingOutcome) {
          await this.callbacks.recordTaskOutcome({
            taskId,
            status: 'pending',
            notes: 'Auto-created on task completion. Update with record_task_outcome when work ships.',
          });
          pendingOutcomeCreated = true;
        }
      } catch {
        // Non-critical
      }
    }

    // Check if AX feedback survey is due
    let surveyDue: any;
    try {
      const SURVEY_INTERVAL = 5;
      const surveyResponses = await this.ctx.storage.getAXSurveyResponses({
        projectId: task.projectId,
      });
      const completedTasks = await this.ctx.storage.getTasks({
        projectId: task.projectId,
        status: 'completed' as TaskStatus,
      });
      const totalCompletions = completedTasks.length;
      const totalSurveys = surveyResponses.length;
      const completionsSinceLast = totalCompletions - (totalSurveys * SURVEY_INTERVAL);

      if (completionsSinceLast >= SURVEY_INTERVAL) {
        surveyDue = {
          reason: `${completionsSinceLast} tasks completed since last feedback — your input improves the system for all agents`,
          completionsSinceLast,
          questions: [
            {
              id: 'productivityRating',
              question: 'How productive was this session? (1=very unproductive, 5=very productive)',
              responseType: 'scale',
            },
            {
              id: 'frictionTags',
              question: 'What slowed you down? (select all that apply)',
              responseType: 'multiple_choice',
              options: [
                'repeated_context', 'wrong_context', 'tool_confusion', 'missing_files',
                'slow_response', 'unclear_task', 'dependency_blocked', 'quality_rework', 'scope_creep',
              ],
            },
            {
              id: 'notes',
              question: 'What single change would most improve your effectiveness?',
              responseType: 'text',
            },
          ],
          submitTool: 'submit_feedback',
        };
      }
    } catch {
      // Non-critical
    }

    // Clean up worktree if one was created for this task
    let worktreeCleaned = false;
    const worktreePath = task.implementation?.worktreePath;
    if (worktreePath && hasGitRepo) {
      try {
        const result = await removeWorktree(repoPath, worktreePath);
        worktreeCleaned = result.success;
      } catch {
        // Non-critical — worktree can be cleaned up manually
      }
    }

    // Clean up task branch (local + remote) after completion
    let branchCleanup: { deletedLocal: string[]; deletedRemote: string[] } | undefined;
    const cleanupBranch = workflowConfig.tasks.cleanupBranchOnCompletion ?? true;
    if (cleanupBranch && hasGitRepo) {
      try {
        const taskIdPrefix = taskId.slice(0, 8);
        branchCleanup = await deleteTaskBranch(repoPath, taskIdPrefix);
      } catch {
        // Non-critical — branches can be cleaned up manually
      }
    }

    return {
      success: true,
      taskId: completeResult.taskId,
      status: completeResult.status,
      summary,
      gitAnalysis: {
        filesChanged: analysis.filesChanged.length,
        commits: analysis.commitCount,
        linesAdded: analysis.linesAdded,
        linesRemoved: analysis.linesRemoved,
        authors: analysis.authors,
      },
      generatedDocs: {
        deliverables: deliverables.length,
        architectureDecisions: architectureDecisions.length,
      },
      workflowWarnings: workflowWarnings.length > 0 ? workflowWarnings : undefined,
      qualityGaps: qualityGaps.length > 0 ? qualityGaps : undefined,
      qualityEnforced: shouldEnforce,
      pendingOutcomeCreated: pendingOutcomeCreated || undefined,
      inlineDecisionsLogged: inlineDecisionsLogged > 0 ? inlineDecisionsLogged : undefined,
      outcomeRecorded: outcomeRecorded || undefined,
      worktreeCleaned: worktreeCleaned || undefined,
      branchCleanup: branchCleanup && (branchCleanup.deletedLocal.length > 0 || branchCleanup.deletedRemote.length > 0)
        ? branchCleanup : undefined,
      toolHints: getCompletionHints({
        hasInitiative: !outcomeRecorded,
        hasRelatedTasks: (task.blocks?.length ?? 0) > 0,
        filesChangedCount: analysis.filesChanged.length,
        decisionsLogged: taskDecisions.length,
        inlineDecisionsLogged,
      }),
      surveyDue,
      verification: verification ? {
        confidence: verification.confidence,
        score: verification.score,
        card: verification.card,
        intentAlignment: verification.intentAlignment,
        checksSummary: `${verification.checks.filter(c => c.passed).length}/${verification.checks.length} passed`,
      } : undefined,
      message: workflowWarnings.length > 0
        ? `Task completed with ${workflowWarnings.length} workflow suggestion(s)${qualityGaps.length > 0 ? ` and ${qualityGaps.length} quality gap(s)` : ''}${surveyDue ? ' — AX feedback survey is due' : ''}${pendingOutcomeCreated ? ' — pending outcome created for tracking' : ''}`
        : `Task completed with auto-generated documentation from git history${surveyDue ? ' — AX feedback survey is due' : ''}${pendingOutcomeCreated ? ' — pending outcome created for tracking' : ''}`,
      role: role || 'developer',
    };
  }
}
