/**
 * Dispatch Tools
 *
 * Human-triggered agent work assignment.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { dispatchTaskSchema, listDispatchesSchema, recallDispatchSchema } from '../schemas/dispatch-schemas.js';
import { handleDispatchTask, handleListDispatches, handleRecallDispatch } from '../handlers/dispatch-handlers.js';

function dispatchCtx(ctx: ToolContext) {
  return { service: ctx.service };
}

registry.register({
  ...dispatchTaskSchema,
  domain: 'dispatch',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleDispatchTask(dispatchCtx(ctx), args as any);
  },
});

registry.register({
  ...listDispatchesSchema,
  domain: 'dispatch',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListDispatches(dispatchCtx(ctx), args as any);
  },
});

registry.register({
  ...recallDispatchSchema,
  domain: 'dispatch',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRecallDispatch(dispatchCtx(ctx), args as any);
  },
});
