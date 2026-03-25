/**
 * Metrics Tools
 *
 * Coordination metrics and metric logging.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { getCoordinationMetricsSchema, logMetricSchema } from '../schemas/metrics-schemas.js';
import { handleGetCoordinationMetrics, handleLogMetric } from '../handlers/metrics-handlers.js';

registry.register({
  ...getCoordinationMetricsSchema,
  domain: 'metrics',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetCoordinationMetrics(ctx.service, args as any);
  },
});

// log_metric is hidden from the tool list (not in metricsSchemas) but still
// needs to be in the registry so it can be dispatched by name.
registry.register({
  ...logMetricSchema,
  domain: 'metrics',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleLogMetric(ctx.service, args as any);
  },
});
