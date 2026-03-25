/**
 * Decision Tools
 *
 * Decision logging and retrieval.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  logDecisionSchema,
  getDecisionsSchema,
  getDecisionSchema,
  batchLogDecisionsSchema,
} from '../schemas/decision-schemas.js';
import {
  handleLogDecision,
  handleGetDecisions,
  handleGetDecision,
  handleBatchLogDecisions,
} from '../handlers/decision-handlers.js';

registry.register({
  ...logDecisionSchema,
  domain: 'decision',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleLogDecision({ service: ctx.service, resolvedAgentId: ctx.resolvedAgentId }, args as any);
  },
});

registry.register({
  ...getDecisionsSchema,
  domain: 'decision',
  aliases: ['get_decisions'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetDecisions(ctx.service, args as any);
  },
});

registry.register({
  ...getDecisionSchema,
  domain: 'decision',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetDecision(ctx.service, args as any);
  },
});

registry.register({
  ...batchLogDecisionsSchema,
  domain: 'decision',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleBatchLogDecisions(ctx.service, args as any);
  },
});
