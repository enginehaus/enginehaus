/**
 * Metrics Tool Schemas
 *
 * Schema definitions for coordination metrics MCP tools.
 */

export const getCoordinationMetricsSchema = {
  name: 'get_coordination_metrics',
  description: 'Get task throughput, cycle times, context efficiency, and quality gate pass rates for a project over a given period.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time period for metrics (default: week)',
      },
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
    },
  },
};

export const logMetricSchema = {
  name: 'log_metric',
  description: 'Record a telemetry event (context fetch, quality gate result, tool call) for internal coordination analytics.',
  inputSchema: {
    type: 'object',
    properties: {
      eventType: {
        type: 'string',
        enum: ['context_expanded', 'tool_called', 'quality_gate_passed', 'quality_gate_failed', 'context_fetch_minimal', 'context_fetch_full', 'task_reopened', 'context_repeated'],
        description: 'Type of metric event',
      },
      taskId: { type: 'string', description: 'Associated task ID' },
      sessionId: { type: 'string', description: 'Associated session ID' },
      metadata: { type: 'object', description: 'Additional metadata (include responseBytes for context fetches)' },
    },
    required: ['eventType'],
  },
};

/** User-facing metrics schemas (log_metric hidden — internal telemetry) */
export const metricsSchemas = [
  getCoordinationMetricsSchema,
];
