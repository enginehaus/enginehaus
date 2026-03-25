/**
 * Telemetry Tool Schemas
 *
 * Schema definitions for telemetry/observability MCP tools.
 */

export const getTelemetrySummarySchema = {
  name: 'get_telemetry_summary',
  description: 'Get a summary of agent tool usage patterns and detected behaviors. Shows most-used tools, success rates, common patterns (both anti-patterns and positive patterns), and actionable insights. Use for understanding how agents interact with the coordination system.',
  inputSchema: {
    type: 'object',
    properties: {
      startTime: { type: 'string', description: 'ISO timestamp for start of period (default: 7 days ago)' },
      endTime: { type: 'string', description: 'ISO timestamp for end of period (default: now)' },
      projectId: { type: 'string', description: 'Optional filter by project' },
    },
  },
};

export const getToolUsageStatsSchema = {
  name: 'get_tool_usage_stats',
  description: 'Get detailed statistics for each MCP tool: call counts, success rates, average duration, P95 latency, and common tool sequences. Use for performance analysis and understanding tool usage patterns.',
  inputSchema: {
    type: 'object',
    properties: {
      startTime: { type: 'string', description: 'ISO timestamp for start of period' },
      endTime: { type: 'string', description: 'ISO timestamp for end of period' },
      projectId: { type: 'string', description: 'Optional filter by project' },
    },
  },
};

export const getSessionStatsSchema = {
  name: 'get_session_stats',
  description: 'Get statistics for a specific session: duration, tool calls made, unique tools used, tasks worked on, and patterns detected. Use for analyzing individual agent sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to analyze' },
    },
    required: ['sessionId'],
  },
};

/** Hidden from tool list — internal observability. Handlers still respond to these names. */
export const telemetrySchemas: typeof getTelemetrySummarySchema[] = [];
