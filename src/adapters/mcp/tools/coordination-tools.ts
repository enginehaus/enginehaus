/**
 * Coordination Tools
 *
 * Context, task graph, briefing, cluster context, what_changed.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  getCoordinationContextSchema,
  getTaskGraphSchema,
  getBriefingSchema,
  getClusterContextSchema,
  whatChangedSchema,
} from '../schemas/coordination-schemas.js';
import {
  handleGetCoordinationContext,
  handleGetTaskGraph,
  handleGetBriefing,
  handleGetClusterContext,
  handleWhatChanged,
  type GetBriefingParams,
} from '../handlers/coordination-handlers.js';

function coordCtx(ctx: ToolContext) {
  return { service: ctx.service, coordination: ctx.coordination };
}

registry.register({
  ...getCoordinationContextSchema,
  domain: 'coordination',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetCoordinationContext(coordCtx(ctx), args as any);
  },
});

registry.register({
  ...getTaskGraphSchema,
  domain: 'coordination',
  aliases: ['get_task_graph'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTaskGraph(coordCtx(ctx), args as any);
  },
});

registry.register({
  ...getBriefingSchema,
  domain: 'coordination',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    // Auto-inject agentId if not explicitly provided (matches original behavior)
    const briefingArgs = args as unknown as GetBriefingParams;
    if (!briefingArgs.agentId) {
      briefingArgs.agentId = ctx.resolvedAgentId;
    }
    return handleGetBriefing(coordCtx(ctx), briefingArgs);
  },
});

registry.register({
  ...getClusterContextSchema,
  domain: 'coordination',
  aliases: ['get_cluster_context'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetClusterContext(coordCtx(ctx), args as any);
  },
});

registry.register({
  ...whatChangedSchema,
  domain: 'coordination',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleWhatChanged(coordCtx(ctx), args as any);
  },
});
