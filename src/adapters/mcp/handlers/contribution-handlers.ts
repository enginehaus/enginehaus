/**
 * Contribution Tool Handlers
 *
 * Handlers for collaborative task contribution MCP tools.
 */

import { v4 as uuidv4 } from 'uuid';
import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { AgentRole, ContributionType } from '../../../coordination/types.js';

/**
 * Context required by contribution handlers
 */
export interface ContributionHandlerContext {
  service: CoordinationService;
  resolvedAgentId: string;
}

export interface ContributeToTaskParams {
  taskId: string;
  content: string;
  type: ContributionType;
  role?: AgentRole;
  agentId?: string;
}

export interface ListContributionsParams {
  taskId: string;
  agentId?: string;
  type?: ContributionType;
  limit?: number;
}

export interface GetTaskContributorsParams {
  taskId: string;
}

export async function handleContributeToTask(
  ctx: ContributionHandlerContext,
  args: ContributeToTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const agentId = args.agentId || ctx.resolvedAgentId;

  // Get the task to find its projectId
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

  try {
    await ctx.service.contributeToTask({
      id: uuidv4(),
      taskId: args.taskId,
      projectId: task.projectId,
      agentId,
      role: args.role || 'developer',
      type: args.type,
      content: args.content,
      createdAt: new Date(),
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          taskId: args.taskId,
          agentId,
          type: args.type,
          role: args.role || 'developer',
          message: `Contribution added to task "${task.title}"`,
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

export async function handleListContributions(
  ctx: ContributionHandlerContext,
  args: ListContributionsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const contributions = await ctx.service.getContributions(args.taskId, {
    agentId: args.agentId,
    type: args.type,
    limit: args.limit,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        taskId: args.taskId,
        count: contributions.length,
        contributions: contributions.map(c => ({
          id: c.id,
          agentId: c.agentId,
          role: c.role,
          type: c.type,
          content: c.content,
          createdAt: c.createdAt,
        })),
      }, null, 2),
    }],
  };
}

export async function handleGetTaskContributors(
  ctx: ContributionHandlerContext,
  args: GetTaskContributorsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const contributors = await ctx.service.getTaskContributors(args.taskId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        taskId: args.taskId,
        contributorCount: contributors.length,
        contributors,
      }, null, 2),
    }],
  };
}
