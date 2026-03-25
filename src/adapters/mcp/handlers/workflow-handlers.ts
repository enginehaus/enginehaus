/**
 * Workflow Tool Handlers
 *
 * Primary interface for agent workflow: start_work and finish_work.
 * These composite tools orchestrate all coordination automatically,
 * implementing the "two-tool phenomenology" for simple agent enhancement.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { CoordinationEngine } from '../../../coordination/engine.js';
import { checkInstructionsHealth, type InstructionsHealth } from '../../../instructions-version.js';
import { getDecisionPrompt } from '../../../utils/decision-prompting.js';

/**
 * Context required by workflow handlers
 */
export interface WorkflowHandlerContext {
  projectRoot: string;
  service: CoordinationService;
  coordination: CoordinationEngine;
  resolvedAgentId: string;
}

// Parameter interfaces
export interface StartWorkParams {
  taskId?: string;
  agentId?: string;
  instructionsVersion?: string;
}

export interface FinishWorkParams {
  summary: string;
  taskId?: string;
  decisions?: Array<{
    decision: string;
    rationale: string;
    category?: string;
  }>;
  bypassQuality?: boolean;
  bypassReason?: string;
}

/**
 * start_work - Primary tool to begin work on a task.
 *
 * Orchestrates: get_next_task + claim + related_learnings + file_previews +
 * recent_commits + decisions
 */
export async function handleStartWork(
  ctx: WorkflowHandlerContext,
  args: StartWorkParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const agentId = args.agentId || ctx.resolvedAgentId;

  // Update agent last-seen timestamp (best-effort)
  ctx.service.touchAgentLastSeen(agentId).catch(() => {});

  // If explicit taskId provided, claim THAT task. Never silently fall back to a different task.
  if (args.taskId) {
    const claimResult = await ctx.service.claimTaskWithResponse(args.taskId, agentId, { capacity: 1 });
    if (!claimResult.success) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: claimResult.message || `Failed to claim task ${args.taskId}`,
            taskId: args.taskId,
            guidance: 'The requested task could not be claimed. Check its status with `enginehaus task show <id>`.',
          }, null, 2),
        }],
      };
    }

    // Get full task info for the explicitly requested task
    const task = await ctx.service.getTask(args.taskId);
    const instructionsHealth = checkInstructionsHealth(args.instructionsVersion);

    // Get file-relevant architectural decisions and initiative context
    const taskFiles = task?.files || [];
    const architecturalContext = await ctx.service.getFileRelevantDecisions(args.taskId, taskFiles);

    // Get decisions and proactive alerts in parallel
    const [linkedResult, proactiveAlerts] = await Promise.all([
      ctx.service.getDecisions({ taskId: args.taskId, limit: 5 }),
      task ? ctx.service.getProactiveAlerts(task) : Promise.resolve([]),
    ]);

    // Auto-detect task complexity
    const isSimple = !task?.files?.length && (!task?.description || task.description.length < 200);

    let guidance = `Task claimed.${isSimple ? ' (Simple task — phases auto-skipped.)' : ''}

As you work:
- Log decisions: log_decision({ decision: "...", rationale: "..." })

When done:
- finish_work({ summary: "what you did" })
  (You can also log decisions inline at completion: finish_work({ summary: "...", decisions: [...] }))`;

    // Surface proactive alerts
    if (proactiveAlerts.length > 0) {
      guidance += '\n';
      for (const alert of proactiveAlerts) {
        const icon = alert.severity === 'warning' ? '⚠️' : 'ℹ️';
        guidance += `\n${icon} ${alert.title}\n   → ${alert.action}`;
      }
    }

    if (instructionsHealth.status !== 'current' && instructionsHealth.message) {
      guidance += `\n\n📋 Instructions Health: ${instructionsHealth.message}`;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          task: task ? {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            files: task.files,
          } : undefined,
          sessionId: claimResult.sessionId,
          phaseWorkflow: claimResult.phaseWorkflow,
          alerts: proactiveAlerts.length > 0 ? proactiveAlerts : undefined,
          context: {
            linkedDecisions: linkedResult.decisions.length > 0 ? linkedResult.decisions : undefined,
            relevantDecisions: architecturalContext.relevantDecisions.length > 0
              ? architecturalContext.relevantDecisions
              : undefined,
            initiative: architecturalContext.initiative,
          },
          guidance,
        }, null, 2),
      }],
    };
  }

  // Check dispatch queue — dispatched tasks take priority over natural selection
  const pendingDispatches = await ctx.service.getPendingDispatches(agentId);
  if (pendingDispatches.length > 0) {
    const dispatch = pendingDispatches[0];
    // Claim the dispatched task
    const claimResult = await ctx.service.claimTaskWithResponse(dispatch.taskId, agentId, { capacity: 1 });
    if (claimResult.success) {
      await ctx.service.claimDispatch(dispatch.id);
      const task = await ctx.service.getTask(dispatch.taskId);
      const instructionsHealth = checkInstructionsHealth(args.instructionsVersion);

      let guidance = `📋 Dispatched by ${dispatch.dispatchedBy}: "${task?.title}"`;
      if (dispatch.context) {
        guidance += `\n\nDispatch context: ${dispatch.context}`;
      }
      guidance += `\n\nAs you work:\n- Log decisions: log_decision({ decision: "...", rationale: "..." })\n\nWhen done:\n- finish_work({ summary: "what you did" })`;

      if (instructionsHealth.status !== 'current' && instructionsHealth.message) {
        guidance += `\n\n📋 Instructions Health: ${instructionsHealth.message}`;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            dispatched: true,
            dispatchedBy: dispatch.dispatchedBy,
            task: task ? {
              id: task.id,
              title: task.title,
              description: task.description,
              priority: dispatch.priorityOverride || task.priority,
              files: task.files,
            } : undefined,
            sessionId: claimResult.sessionId,
            phaseWorkflow: claimResult.phaseWorkflow,
            guidance,
          }, null, 2),
        }],
      };
    }
    // If claim failed, fall through to normal priority selection
  }

  // No explicit taskId and no dispatches - get next available task by priority
  const result = await ctx.service.getNextTaskWithResponse({
    agentId,
    withContext: true,
    maxPreviewLines: 100,
    defaultRootPath: ctx.projectRoot,
  });

  if (!result.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: result.message || 'No tasks available',
          guidance: 'Add tasks with: enginehaus task add -t "title" -p medium',
        }, null, 2),
      }],
    };
  }

  // Check instructions health and proactive alerts in parallel
  const [instructionsHealth, nextTaskAlerts] = await Promise.all([
    Promise.resolve(checkInstructionsHealth(args.instructionsVersion)),
    result.task?.id ? ctx.service.getTask(result.task.id).then(t => t ? ctx.service.getProactiveAlerts(t) : []) : Promise.resolve([]),
  ]);

  // Auto-detect task complexity
  const taskFiles = result.task?.files || [];
  const taskDesc = result.task?.description || '';
  const isSimpleTask = taskFiles.length <= 1 && taskDesc.length < 200;

  // Build guidance with optional health warning
  let guidance = `Ready to work on: ${result.task?.title}${isSimpleTask ? ' (simple task — phases auto-skipped)' : ''}

As you work:
- Log decisions: log_decision({ decision: "...", rationale: "..." })${!isSimpleTask ? '\n- For complex tasks, advance phases after each stage' : ''}

When done:
- finish_work({ summary: "what you did" })
  (You can also log decisions inline: finish_work({ summary: "...", decisions: [...] }))

Quality gates will be checked automatically.`;

  // Surface proactive alerts
  if (nextTaskAlerts.length > 0) {
    guidance += '\n';
    for (const alert of nextTaskAlerts) {
      const icon = alert.severity === 'warning' ? '⚠️' : 'ℹ️';
      guidance += `\n${icon} ${alert.title}\n   → ${alert.action}`;
    }
  }

  // Add health warning if needed
  if (instructionsHealth.status !== 'current' && instructionsHealth.message) {
    guidance += `\n\n📋 Instructions Health: ${instructionsHealth.message}`;
  }

  // Transform response to match start_work shape
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        task: result.task,
        gitBranch: result.session?.gitBranch,
        session: result.session,
        context: {
          filePreviews: result.contextFiles?.reduce((acc: any, f: any) => {
            if (f.preview) acc[f.path] = f.preview;
            return acc;
          }, {} as Record<string, string>),
          recentCommits: result.recentCommits?.commits,
          relatedLearnings: result.relatedLearnings,
          linkedDecisions: result.linkedDecisions,
          relevantDecisions: result.fileRelevantDecisions,
          initiative: result.initiative,
        },
        alerts: nextTaskAlerts.length > 0 ? nextTaskAlerts : undefined,
        qualityExpectations: result.qualityExpectations?.required,
        phaseWorkflow: result.phaseWorkflow,
        guidance,
        // Include structured health data if version was provided
        ...(args.instructionsVersion !== undefined && {
          _instructionsHealth: instructionsHealth,
        }),
      }, null, 2),
    }],
  };
}

/**
 * finish_work - Primary tool to complete current task.
 *
 * Orchestrates: validate_quality + complete_task_smart + unblock_check + next_suggestion
 */
export async function handleFinishWork(
  ctx: WorkflowHandlerContext,
  args: FinishWorkParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate bypass parameters
  if (args.bypassQuality && !args.bypassReason) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'bypassQuality requires bypassReason',
          guidance: 'Provide a reason for bypassing quality gates, or remove bypassQuality.',
        }, null, 2),
      }],
    };
  }

  // Get taskId from args or active session
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
            guidance: 'Call start_work to begin a task, or provide taskId explicitly.',
          }, null, 2),
        }],
      };
    }
    taskId = activeSessions[0].taskId;
  }

  // Log inline decisions before completing (so quality gates see them)
  if (args.decisions && args.decisions.length > 0) {
    for (const d of args.decisions) {
      await ctx.service.logDecision({
        decision: d.decision,
        rationale: d.rationale,
        category: d.category || 'other',
        taskId,
        createdBy: ctx.resolvedAgentId,
      });
    }
  }

  // Complete the task
  const result = await ctx.service.completeTaskSmart({
    taskId,
    summary: args.summary,
    defaultProjectRoot: ctx.projectRoot,
    enforceQuality: !args.bypassQuality,
    agentId: ctx.resolvedAgentId,
  });

  if (!result.success) {
    // Quality gates failed
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          taskId,
          qualityResult: {
            passed: false,
            gaps: result.qualityGaps,
            enforced: result.qualityEnforced,
          },
          error: result.error,
          uncommittedChanges: result.uncommittedChanges,
          guidance: result.qualityEnforced
            ? `Quality gates blocked completion. To fix:
1. Provide decisions inline: finish_work({ summary: "...", decisions: [{ decision: "...", rationale: "..." }] })
2. Or bypass: finish_work({ summary: "...", bypassQuality: true, bypassReason: "..." })

Quality gaps: ${result.qualityGaps?.join(', ')}`
            : result.error,
        }, null, 2),
      }],
    };
  }

  // Side effects: gather post-completion context in parallel
  const agentId = ctx.resolvedAgentId;
  const [nextSuggestion, taskDecisions, completedTask, allActiveSessions] = await Promise.all([
    ctx.service.getNextTaskSuggestion(),
    ctx.service.getDecisions({ taskId, limit: 100 }).catch(() => ({ decisions: [] })),
    ctx.service.getTask(taskId),
    ctx.service.getActiveSessions(),
  ]);

  // Check if this task unblocked others (blocks field populated from dependencies)
  const unblockedTaskIds = completedTask?.blocks || [];
  const unblockedTasks: Array<{ id: string; title: string; priority: string }> = [];
  for (const blockedId of unblockedTaskIds.slice(0, 5)) {
    const t = await ctx.service.getTask(blockedId);
    if (t && t.status === 'ready') {
      unblockedTasks.push({ id: t.id, title: t.title, priority: t.priority });
    }
  }

  // Check for other in-progress tasks this agent still has open (completion drift detection)
  const orphanedSessions = allActiveSessions.filter(
    s => s.agentId === agentId && s.taskId !== taskId
  );
  const orphanedTasks: Array<{ id: string; title: string }> = [];
  for (const s of orphanedSessions.slice(0, 5)) {
    const t = await ctx.service.getTask(s.taskId);
    if (t && t.status === 'in-progress') {
      orphanedTasks.push({ id: t.id, title: t.title });
    }
  }

  // Build guidance with all side-effect information
  let guidance = '';

  // Unblocked tasks notification
  if (unblockedTasks.length > 0) {
    guidance += `\n\n🔓 **Unblocked ${unblockedTasks.length} task(s):**`;
    for (const t of unblockedTasks.slice(0, 3)) {
      guidance += `\n  - "${t.title}" (${t.priority})`;
    }
    if (unblockedTasks.length > 3) {
      guidance += `\n  ... and ${unblockedTasks.length - 3} more`;
    }
  }

  // Orphaned task warning (completion drift)
  if (orphanedTasks.length > 0) {
    guidance += `\n\n⚠️ **${orphanedTasks.length} other task(s) still in-progress for you:**`;
    for (const t of orphanedTasks) {
      guidance += `\n  - "${t.title}" → finish_work({ taskId: "${t.id}" }) or release it`;
    }
  }

  // Decision count summary
  const decisionCount = taskDecisions.decisions.length;
  if (decisionCount > 0) {
    guidance += `\n\n📝 ${decisionCount} decision(s) logged during this task.`;
  }

  // Outcome tracking prompt
  if (result.pendingOutcomeCreated) {
    guidance += '\n\n📊 **Outcome tracking:** Was this shipped? PR merged? Record it: `record_task_outcome({ taskId: "' + taskId + '", status: "shipped" })`';
  }

  // Next task suggestion
  if (nextSuggestion) {
    guidance += `\n\nNext up: "${nextSuggestion.title}"\nStart it with: start_work({ taskId: "${nextSuggestion.taskId}" })`;
  } else {
    guidance += '\n\nNo more tasks in queue.';
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        taskId: result.taskId,
        ...(args.decisions && args.decisions.length > 0 && {
          decisionsLogged: args.decisions.length,
        }),
        qualityResult: {
          passed: true,
          gaps: result.qualityGaps,
        },
        completion: {
          summary: result.summary,
          filesChanged: result.gitAnalysis?.filesChanged,
          commits: result.gitAnalysis?.commits,
          linesAdded: result.gitAnalysis?.linesAdded,
          linesRemoved: result.gitAnalysis?.linesRemoved,
          decisionsLogged: decisionCount,
        },
        generatedDocs: result.generatedDocs,
        workflowWarnings: result.workflowWarnings,
        unblockedTasks: unblockedTasks.length > 0
          ? unblockedTasks.map(t => ({ id: t.id, title: t.title, priority: t.priority }))
          : undefined,
        orphanedTasks: orphanedTasks.length > 0
          ? orphanedTasks.map(t => ({ id: t.id, title: t.title }))
          : undefined,
        nextSuggestion,
        guidance: `Task completed!${guidance}`,
      }, null, 2),
    }],
  };
}

