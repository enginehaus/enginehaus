/**
 * Checkpoint Tools
 *
 * Human checkpoint management.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  requestHumanInputSchema,
  provideHumanInputSchema,
  getPendingCheckpointsSchema,
  getCheckpointSchema,
  getTasksAwaitingHumanSchema,
} from '../schemas/checkpoint-schemas.js';
import {
  handleRequestHumanInput,
  handleProvideHumanInput,
  handleGetPendingCheckpoints,
  handleGetCheckpoint,
  handleGetTasksAwaitingHuman,
} from '../handlers/checkpoint-handlers.js';

registry.register({
  ...requestHumanInputSchema,
  domain: 'checkpoint',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRequestHumanInput(ctx.service, args as any);
  },
});

registry.register({
  ...provideHumanInputSchema,
  domain: 'checkpoint',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleProvideHumanInput(ctx.service, args as any);
  },
});

registry.register({
  ...getPendingCheckpointsSchema,
  domain: 'checkpoint',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetPendingCheckpoints(ctx.service, args as any);
  },
});

registry.register({
  ...getCheckpointSchema,
  domain: 'checkpoint',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetCheckpoint(ctx.service, args as any);
  },
});

registry.register({
  ...getTasksAwaitingHumanSchema,
  domain: 'checkpoint',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTasksAwaitingHuman(ctx.service, args as any);
  },
});
