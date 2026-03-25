/**
 * Dispatch Queue Tool Handlers
 *
 * Handlers for human-triggered agent work assignment MCP tools.
 */

import { v4 as uuidv4 } from 'uuid';
import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { TaskPriority } from '../../../coordination/types.js';

/**
 * Context required by dispatch handlers
 */
export interface DispatchHandlerContext {
  service: CoordinationService;
}

export interface DispatchTaskParams {
  taskId: string;
  targetAgent: string;
  dispatchedBy: string;
  priorityOverride?: TaskPriority;
  context?: string;
  expiresInMinutes?: number;
}

export interface ListDispatchesParams {
  status?: 'pending' | 'claimed' | 'recalled' | 'expired';
  targetAgent?: string;
  limit?: number;
}

export interface RecallDispatchParams {
  dispatchId: string;
}

export async function handleDispatchTask(
  ctx: DispatchHandlerContext,
  args: DispatchTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Get the task to find its projectId and validate it exists
  const task = await ctx.service.getTask(args.taskId);
  if (!task) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Task ${args.taskId} not found`,
        }, null, 2),
      }],
    };
  }

  const dispatch = {
    id: uuidv4(),
    projectId: task.projectId,
    taskId: args.taskId,
    targetAgent: args.targetAgent,
    dispatchedBy: args.dispatchedBy,
    priorityOverride: args.priorityOverride,
    context: args.context,
    status: 'pending' as const,
    createdAt: new Date(),
    expiresAt: args.expiresInMinutes
      ? new Date(Date.now() + args.expiresInMinutes * 60 * 1000)
      : undefined,
  };

  try {
    await ctx.service.dispatchTask(dispatch);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          dispatchId: dispatch.id,
          taskId: args.taskId,
          taskTitle: task.title,
          targetAgent: args.targetAgent,
          message: `Task "${task.title}" dispatched to ${args.targetAgent}. It will be picked up on their next start_work call.`,
        }, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2),
      }],
    };
  }
}

export async function handleListDispatches(
  ctx: DispatchHandlerContext,
  args: ListDispatchesParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const dispatches = await ctx.service.listDispatches({
    status: args.status,
    targetAgent: args.targetAgent,
    limit: args.limit,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        count: dispatches.length,
        dispatches: dispatches.map(d => ({
          id: d.id,
          taskId: d.taskId,
          targetAgent: d.targetAgent,
          dispatchedBy: d.dispatchedBy,
          status: d.status,
          priorityOverride: d.priorityOverride,
          context: d.context,
          createdAt: d.createdAt,
          expiresAt: d.expiresAt,
        })),
      }, null, 2),
    }],
  };
}

export async function handleRecallDispatch(
  ctx: DispatchHandlerContext,
  args: RecallDispatchParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const recalled = await ctx.service.recallDispatch(args.dispatchId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: recalled,
        dispatchId: args.dispatchId,
        message: recalled
          ? 'Dispatch recalled successfully'
          : 'Dispatch not found or already claimed/recalled',
      }, null, 2),
    }],
  };
}
