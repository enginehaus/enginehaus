/**
 * Contribution Tools
 *
 * Collaborative task contributions.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { contributeToTaskSchema, listContributionsSchema, getTaskContributorsSchema } from '../schemas/contribution-schemas.js';
import { handleContributeToTask, handleListContributions, handleGetTaskContributors } from '../handlers/contribution-handlers.js';

function contribCtx(ctx: ToolContext) {
  return { service: ctx.service, resolvedAgentId: ctx.resolvedAgentId };
}

registry.register({
  ...contributeToTaskSchema,
  domain: 'contribution',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleContributeToTask(contribCtx(ctx), args as any);
  },
});

registry.register({
  ...listContributionsSchema,
  domain: 'contribution',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListContributions(contribCtx(ctx), args as any);
  },
});

registry.register({
  ...getTaskContributorsSchema,
  domain: 'contribution',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTaskContributors(contribCtx(ctx), args as any);
  },
});
