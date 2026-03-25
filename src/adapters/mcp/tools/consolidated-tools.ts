/**
 * Consolidated Tools
 *
 * Tools from src/tools/ that already have schema+handler co-located:
 * audit, suggest, quality, visualize.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { auditToolSchema, handleAudit } from '../../../tools/audit.js';
import { suggestToolSchema, handleSuggest } from '../../../tools/suggest.js';
import { qualityToolSchema, handleQuality } from '../../../tools/quality.js';
import { visualizeToolSchema, handleVisualize } from '../../../tools/visualize.js';

registry.register({
  ...auditToolSchema,
  domain: 'consolidated',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleAudit(ctx.service, args as any);
  },
});

registry.register({
  ...suggestToolSchema,
  domain: 'consolidated',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSuggest(ctx.service, args as any);
  },
});

registry.register({
  ...qualityToolSchema,
  domain: 'consolidated',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleQuality(ctx.service, args as any);
  },
});

registry.register({
  ...visualizeToolSchema,
  domain: 'consolidated',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleVisualize(ctx.service, args as any);
  },
});
