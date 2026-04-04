/**
 * Task Tool Handlers
 *
 * Handlers for task management MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { CoordinationEngine } from '../../../coordination/engine.js';
import {
  validateSchema,
  sanitizeString,
  sanitizeFilePath,
  SCHEMAS,
} from '../../../validation/validators.js';
import { getDecisionPrompt } from '../../../utils/decision-prompting.js';

/**
 * Context required by task handlers
 */
export interface TaskHandlerContext {
  projectRoot: string;
  service: CoordinationService;
  coordination: CoordinationEngine;
  getProjectContext: () => Promise<ProjectContext | null>;
  sessionState: {
    taskCount: number;
  };
  resolvedAgentId: string;
}

export interface ProjectContext {
  projectId: string;
  projectName: string;
  projectSlug: string;
}

/**
 * Validate that a task belongs to the active project.
 * Prevents cross-project task leaks where an agent could claim/complete
 * tasks from other projects by knowing their ID.
 * Returns the task if valid, or throws with a clear error message.
 */
async function validateTaskInProject(
  ctx: TaskHandlerContext,
  taskId: string,
): Promise<void> {
  const projectContext = await ctx.getProjectContext();
  if (!projectContext) return; // No active project — can't enforce

  const task = await ctx.service.getTask(taskId);
  if (!task) return; // Task not found — let downstream handle the error

  if (task.projectId !== projectContext.projectId) {
    throw new Error(
      `Task ${taskId.slice(0, 8)} belongs to a different project. ` +
      `Active project: ${projectContext.projectSlug}. ` +
      `Set the correct active project first.`
    );
  }
}

// Parameter interfaces for each handler
export interface GetNextTaskParams {
  priority?: 'critical' | 'high' | 'medium' | 'low';
  status?: 'ready' | 'in-progress' | 'blocked';
  sessionId?: string;
  withContext?: boolean;
  maxPreviewLines?: number;
}

export interface UpdateTaskProgressParams {
  taskId: string;
  role: 'pm' | 'ux' | 'tech-lead' | 'developer' | 'qa' | 'human';
  status?: 'ready' | 'in-progress' | 'blocked' | 'completed';
  currentPhase?: number;
  deliverables?: Array<{ file: string; status: string; description: string }>;
  notes?: string;
  phaseCompletion?: string;
  sessionId?: string;
}

export interface CompleteTaskParams {
  taskId: string;
  implementationSummary: string;
  deliverables?: Array<{ file: string; status: string; description: string }>;
  qualityMetrics?: {
    testCoverage?: string;
    performanceBenchmarks?: string;
    securityValidation?: string;
    documentationComplete?: boolean;
  };
  architectureDecisions?: Array<{ decision: string; rationale: string; impact: string }>;
  nextSteps?: string[];
  handoffNotes?: string;
}

export interface CompleteTaskSmartParams {
  taskId: string;
  summary: string;
  role?: 'pm' | 'ux' | 'tech-lead' | 'developer' | 'qa' | 'human';
  sessionStartTime?: string;
  enforceQuality?: boolean;
  allowUnmerged?: boolean;
  decisions?: Array<{
    decision: string;
    rationale?: string;
    category?: string;
  }>;
  outcome?: {
    status?: 'shipped' | 'pending' | 'rejected' | 'rework' | 'abandoned';
    notes?: string;
  };
}

export interface ListTasksParams {
  status?: 'ready' | 'in-progress' | 'completed' | 'all';
  projectId?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  tags?: string[];
}

export interface AddTaskParams {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  tags?: string[];
  files?: string[];
  projectId?: string;
  strategicContext?: {
    businessRationale?: string;
    competitiveAdvantage?: string;
    revenueImpact?: string;
    timeline?: string;
  };
  uxContext?: {
    userExperience?: string;
    designPattern?: string;
    progressiveDisclosure?: string;
    technicalConstraints?: string;
  };
  technicalContext?: {
    implementation?: string;
    architecture?: string;
    estimatedEffort?: string;
    qualityGates?: string[];
  };
  qualityRequirements?: string[];
  mode?: 'exclusive' | 'collaborative';
  references?: Array<{ url: string; label?: string; type?: string }>;
}

export interface UpdateTaskParams {
  taskId: string;
  title?: string;
  description?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  status?: 'ready' | 'in-progress' | 'blocked' | 'completed';
  tags?: string[];
  files?: string[];
  projectId?: string;
  assignedTo?: string;
  mode?: 'exclusive' | 'collaborative';
}

export interface GetStreamingSessionContextParams {
  sessionId: string;
  role: string;
}

export interface GetMinimalTaskParams {
  taskId: string;
}

export interface ExpandContextParams {
  aspect: 'strategic' | 'ux' | 'technical' | 'full';
  id: string;
  taskId?: string;
}

export async function handleGetNextTask(
  ctx: TaskHandlerContext,
  args: GetNextTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getNextTaskWithResponse({
    priority: args.priority,
    status: args.status,
    agentId: args.sessionId || ctx.resolvedAgentId,
    withContext: args.withContext !== false,
    maxPreviewLines: args.maxPreviewLines || 100,
    defaultRootPath: ctx.projectRoot,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleUpdateTaskProgress(
  ctx: TaskHandlerContext,
  args: UpdateTaskProgressParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  await validateTaskInProject(ctx, args.taskId);
  const task = await ctx.coordination.updateTaskProgress(args.taskId, args);

  // Check if we should prompt for decision logging
  const decisionPrompt = await getDecisionPrompt(ctx.service, {
    taskId: args.taskId,
    taskDescription: task.description,
    taskTitle: task.title,
    currentPhase: args.currentPhase ? parseInt(String(args.currentPhase)) : undefined,
  }).catch(() => undefined);

  let message = `Task progress updated successfully (as ${args.role || 'developer'})`;
  if (decisionPrompt) message += decisionPrompt;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        taskId: task.id,
        status: task.status,
        currentPhase: args.currentPhase,
        role: args.role || 'developer',
        message,
      }, null, 2),
    }],
  };
}

export async function handleCompleteTask(
  ctx: TaskHandlerContext,
  args: CompleteTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  await validateTaskInProject(ctx, args.taskId);
  const result = await ctx.service.completeTaskWithResponse(args.taskId, {
    implementationSummary: args.implementationSummary,
    deliverables: args.deliverables || [],
    qualityMetrics: args.qualityMetrics,
    architectureDecisions: args.architectureDecisions,
    nextSteps: args.nextSteps,
    handoffNotes: args.handoffNotes,
  }, ctx.resolvedAgentId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleCompleteTaskSmart(
  ctx: TaskHandlerContext,
  args: CompleteTaskSmartParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  await validateTaskInProject(ctx, args.taskId);
  const result = await ctx.service.completeTaskSmart({
    taskId: args.taskId,
    summary: args.summary,
    sessionStartTime: args.sessionStartTime,
    defaultProjectRoot: ctx.projectRoot,
    enforceQuality: args.enforceQuality,
    allowUnmerged: args.allowUnmerged,
    role: args.role,
    agentId: ctx.resolvedAgentId,
    decisions: args.decisions,
    outcome: args.outcome,
  });

  if (!result.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          message: result.error,
          qualityGaps: result.qualityGaps,
          qualityEnforced: result.qualityEnforced,
          uncommittedChanges: result.uncommittedChanges,
        }, null, 2),
      }],
    };
  }

  // When a survey is due, add an actionable prompt so agents know to submit feedback
  const responseBlocks: Array<{ type: string; text: string }> = [
    {
      type: 'text',
      text: JSON.stringify(result, null, 2),
    },
  ];

  if (result.surveyDue) {
    const survey = result.surveyDue;
    const lines = [
      '',
      '--- AX FEEDBACK SURVEY ---',
      survey.reason,
      '',
      'Please answer these questions and submit via the submit_feedback tool:',
      '',
    ];
    for (const q of survey.questions) {
      lines.push(`  ${q.id}: ${q.question}`);
      if (q.options) {
        lines.push(`    Options: ${q.options.join(', ')}`);
      }
    }
    lines.push('');
    lines.push('Submit with: submit_feedback({ sessionId: "<your-session>", productivityRating: <1-5>, frictionTags: [...], notes: "..." })');
    lines.push('--- END SURVEY ---');

    responseBlocks.push({
      type: 'text',
      text: lines.join('\n'),
    });
  }

  return { content: responseBlocks };
}

export async function handleListTasks(
  ctx: TaskHandlerContext,
  args: ListTasksParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.listTasksWithResponse({
    status: args.status,
    projectId: args.projectId,
    priority: args.priority,
    tags: args.tags,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleAddTask(
  ctx: TaskHandlerContext,
  args: AddTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectContext = await ctx.getProjectContext();
  const isFirstTask = ctx.sessionState.taskCount === 0;

  // Handler params are intentionally looser than engine type (engine provides defaults)
  const task = await ctx.coordination.createUnifiedTask({ ...args, createdBy: ctx.resolvedAgentId } as any);
  ctx.sessionState.taskCount++;

  // Build response with project context header
  const response: Record<string, any> = {
    success: true,
    taskId: task.id,
    title: task.title,
    priority: task.priority,
    message: 'Task created successfully',
    // Always show project context for visibility
    _projectContext: projectContext ? {
      projectName: projectContext.projectName,
      projectSlug: projectContext.projectSlug,
      projectId: projectContext.projectId,
    } : { warning: 'No active project set' },
  };

  // First task confirmation - make it very visible
  if (isFirstTask && projectContext) {
    response._firstTaskNotice = `⚠️ FIRST TASK IN SESSION: Created in project "${projectContext.projectName}" (${projectContext.projectSlug}). If this is wrong, use update_task with projectId to move it.`;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2),
    }],
  };
}

export async function handleUpdateTask(
  ctx: TaskHandlerContext,
  args: UpdateTaskParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Validate input
  const validation = validateSchema(args as unknown as Record<string, unknown>, SCHEMAS.updateTask);
  if (!validation.valid) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, errors: validation.errors }, null, 2) }],
      isError: true,
    };
  }

  // Sanitize inputs before delegating
  const sanitizedArgs = {
    taskId: args.taskId,
    title: args.title !== undefined ? sanitizeString(args.title) : undefined,
    description: args.description !== undefined ? sanitizeString(args.description) : undefined,
    priority: args.priority,
    status: args.status,
    tags: args.tags !== undefined ? args.tags.map(t => sanitizeString(t)) : undefined,
    files: args.files !== undefined ? args.files.map(f => sanitizeFilePath(f) || f) : undefined,
    projectId: args.projectId,
    // Handle assignedTo: empty string means unassign (convert to undefined)
    assignedTo: args.assignedTo !== undefined
      ? (args.assignedTo === '' ? null : sanitizeString(args.assignedTo))
      : undefined,
    mode: args.mode,
    lastModifiedBy: ctx.resolvedAgentId,
    writeMode: (args as unknown as Record<string, unknown>).writeMode as 'replace' | 'append' | undefined,
    expectedVersion: (args as unknown as Record<string, unknown>).expectedVersion as number | undefined,
  };

  // Validate task belongs to active project
  await validateTaskInProject(ctx, args.taskId);

  // Delegate to CoordinationService for consistent business logic
  const result = await ctx.service.updateTaskWithResponse(sanitizedArgs);

  if (!result.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, message: result.error }, null, 2),
      }],
    };
  }

  const response: Record<string, unknown> = {
    success: true,
    message: result.message,
    task: result.task ? {
      id: result.task.id,
      title: result.task.title,
      priority: result.task.priority,
      status: result.task.status,
      tags: result.task.tags,
      files: result.task.files,
      projectId: result.task.projectId,
      lastModifiedBy: result.task.lastModifiedBy,
      version: result.task.version,
    } : undefined,
  };

  // Surface cross-agent overwrite warnings
  if ((result as { warnings?: string[] }).warnings?.length) {
    response.warnings = (result as { warnings?: string[] }).warnings;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2),
    }],
  };
}

export async function handleGetStreamingSessionContext(
  ctx: TaskHandlerContext,
  args: GetStreamingSessionContextParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const context = await ctx.coordination.getStreamingSessionContext(
    args.sessionId,
    args.role
  );
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        ...context,
      }, null, 2),
    }],
  };
}

export async function handleGetMinimalTask(
  ctx: TaskHandlerContext,
  args: GetMinimalTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getMinimalTaskWithResponse(args.taskId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleExpandContext(
  ctx: TaskHandlerContext,
  args: ExpandContextParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.expandContextWithResponse(args.aspect, args.id, args.taskId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

// ── Search ────────────────────────────────────────────────────────────

export interface SearchTasksParams {
  query: string;
  status?: 'ready' | 'in-progress' | 'completed' | 'blocked' | 'all';
  limit?: number;
}

export async function handleSearchTasks(
  ctx: TaskHandlerContext,
  args: SearchTasksParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectContext = await ctx.getProjectContext();
  const status = args.status === 'all' ? undefined : args.status;

  const tasks = await ctx.service.searchTasks(args.query, {
    projectId: projectContext?.projectId,
    status: status as any,
    limit: args.limit || 20,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        query: args.query,
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          tags: t.tags,
          description: t.description.slice(0, 200) + (t.description.length > 200 ? '...' : ''),
        })),
      }, null, 2),
    }],
  };
}

// ── Flag for Human ────────────────────────────────────────────────────

export interface FlagForHumanParams {
  taskId?: string;
  reason: string;
  question?: string;
  options?: string[];
}

export async function handleFlagForHuman(
  ctx: TaskHandlerContext,
  args: FlagForHumanParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Resolve taskId from args or active session
  let taskId = args.taskId;
  if (!taskId) {
    const activeSessions = await ctx.service.getActiveSessions();
    if (activeSessions.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'No active session found. Provide taskId or use start_work first.',
          }, null, 2),
        }],
      };
    }
    taskId = activeSessions[0].taskId;
  }

  await validateTaskInProject(ctx, taskId);

  // Update task status to awaiting-human
  await ctx.service.updateTaskWithResponse({
    taskId,
    status: 'awaiting-human' as any,
  });

  // Create a checkpoint if question or options provided
  let checkpointId: string | undefined;
  if (args.question || args.options) {
    const checkpoint = await ctx.service.requestHumanInput({
      taskId,
      type: 'decision-required',
      reason: args.reason,
      question: args.question,
      options: args.options?.map((o, i) => ({ id: `option-${i}`, label: o })),
      requestedBy: ctx.resolvedAgentId,
    });
    checkpointId = checkpoint.checkpointId;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        taskId,
        status: 'awaiting-human',
        reason: args.reason,
        question: args.question,
        checkpointId,
        guidance: 'Task flagged for human attention. The human will see this in their briefing. Move on to your next task with start_work().',
      }, null, 2),
    }],
  };
}

// ── Batch Operations ──────────────────────────────────────────────────

export interface BatchUpdateTasksParams {
  updates: Array<{
    taskId: string;
    title?: string;
    description?: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    status?: 'ready' | 'in-progress' | 'blocked' | 'completed';
    assignedTo?: string | null;
  }>;
}

export async function handleBatchUpdateTasks(
  ctx: TaskHandlerContext,
  args: BatchUpdateTasksParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const results: Array<{ taskId: string; success: boolean; error?: string }> = [];

  for (const update of args.updates) {
    try {
      // Block cross-agent completion via batch updates — the most common
      // path Desktop uses to close Code's tasks, skipping quality gates.
      if (update.status === 'completed') {
        const activeSession = await ctx.service.getActiveSessionForTask(update.taskId);
        if (activeSession && activeSession.agentId !== ctx.resolvedAgentId) {
          results.push({
            taskId: update.taskId,
            success: false,
            error: `Task is owned by agent "${activeSession.agentId}" — only the claiming agent can complete it. Let the owning agent finish through its own workflow.`,
          });
          continue;
        }
      }
      const result = await ctx.service.updateTaskWithResponse(update);
      results.push({ taskId: update.taskId, success: result.success, error: result.error });
    } catch (err: any) {
      results.push({ taskId: update.taskId, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: failed === 0,
        summary: `${succeeded} updated, ${failed} failed`,
        results,
      }, null, 2),
    }],
  };
}
