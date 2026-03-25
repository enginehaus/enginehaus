/**
 * Telemetry Tools
 *
 * Agent usage observability (hidden from tool list).
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { getTelemetrySummarySchema, getToolUsageStatsSchema, getSessionStatsSchema } from '../schemas/telemetry-schemas.js';
import { handleGetTelemetrySummary, handleGetToolUsageStats, handleGetSessionStats } from '../handlers/telemetry-handlers.js';

registry.register({
  ...getTelemetrySummarySchema,
  domain: 'telemetry',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTelemetrySummary({ telemetry: ctx.telemetry }, args as any);
  },
});

registry.register({
  ...getToolUsageStatsSchema,
  domain: 'telemetry',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetToolUsageStats({ telemetry: ctx.telemetry }, args as any);
  },
});

registry.register({
  ...getSessionStatsSchema,
  domain: 'telemetry',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetSessionStats({ telemetry: ctx.telemetry }, args as any);
  },
});
