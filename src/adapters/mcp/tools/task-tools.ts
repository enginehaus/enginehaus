/**
 * Task Tools
 *
 * Task management: get_next_task, update_progress, complete_task, etc.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  getNextTaskSchema,
  updateTaskProgressSchema,
  completeTaskSchema,
  completeTaskSmartSchema,
  listTasksSchema,
  searchTasksSchema,
  addTaskSchema,
  updateTaskSchema,
  batchUpdateTasksSchema,
  getStreamingSessionContextSchema,
  getMinimalTaskSchema,
  expandContextSchema,
  flagForHumanSchema,
} from '../schemas/task-schemas.js';
import {
  handleGetNextTask,
  handleUpdateTaskProgress,
  handleCompleteTask,
  handleCompleteTaskSmart,
  handleListTasks,
  handleSearchTasks,
  handleAddTask,
  handleUpdateTask,
  handleBatchUpdateTasks,
  handleGetStreamingSessionContext,
  handleGetMinimalTask,
  handleExpandContext,
  handleFlagForHuman,
} from '../handlers/task-handlers.js';

function taskCtx(ctx: ToolContext) {
  return {
    projectRoot: ctx.projectRoot,
    service: ctx.service,
    coordination: ctx.coordination,
    getProjectContext: ctx.getProjectContext,
    sessionState: ctx.sessionState,
    resolvedAgentId: ctx.resolvedAgentId,
  };
}

registry.register({
  ...getNextTaskSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetNextTask(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...updateTaskProgressSchema,
  domain: 'task',
  aliases: ['update_task_progress'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleUpdateTaskProgress(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...completeTaskSchema,
  domain: 'task',
  mutating: true,
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCompleteTask(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...completeTaskSmartSchema,
  domain: 'task',
  mutating: true,
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCompleteTaskSmart(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...listTasksSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListTasks(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...searchTasksSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSearchTasks(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...addTaskSchema,
  domain: 'task',
  mutating: true,
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleAddTask(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...updateTaskSchema,
  domain: 'task',
  mutating: true,
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleUpdateTask(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...batchUpdateTasksSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleBatchUpdateTasks(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...getStreamingSessionContextSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetStreamingSessionContext(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...getMinimalTaskSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetMinimalTask(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...expandContextSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleExpandContext(taskCtx(ctx), args as any);
  },
});

registry.register({
  ...flagForHumanSchema,
  domain: 'task',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleFlagForHuman(taskCtx(ctx), args as any);
  },
});
