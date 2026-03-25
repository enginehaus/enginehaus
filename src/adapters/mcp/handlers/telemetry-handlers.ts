/**
 * Telemetry Tool Handlers
 *
 * Handlers for telemetry/observability MCP tools.
 */

import type { TelemetryService } from '../../../telemetry/telemetry-service.js';

/**
 * Context required by telemetry handlers
 */
export interface TelemetryHandlerContext {
  telemetry: TelemetryService;
}

// Parameter interfaces
export interface GetTelemetrySummaryParams {
  startTime?: string;
  endTime?: string;
  projectId?: string;
}

export interface GetToolUsageStatsParams {
  startTime?: string;
  endTime?: string;
  projectId?: string;
}

export interface GetSessionStatsParams {
  sessionId: string;
}

export async function handleGetTelemetrySummary(
  ctx: TelemetryHandlerContext,
  args: GetTelemetrySummaryParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const summary = await ctx.telemetry.getTelemetrySummary({
    startTime: args.startTime ? new Date(args.startTime) : undefined,
    endTime: args.endTime ? new Date(args.endTime) : undefined,
    projectId: args.projectId,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        summary: {
          period: {
            start: summary.period.start.toISOString(),
            end: summary.period.end.toISOString(),
          },
          totalSessions: summary.totalSessions,
          totalToolCalls: summary.totalToolCalls,
          toolUsage: summary.toolUsage.slice(0, 10), // Top 10 tools
          commonPatterns: summary.commonPatterns,
          insights: summary.insights,
        },
        message: `Telemetry summary for ${summary.period.start.toISOString().split('T')[0]} to ${summary.period.end.toISOString().split('T')[0]}`,
      }, null, 2),
    }],
  };
}

export async function handleGetToolUsageStats(
  ctx: TelemetryHandlerContext,
  args: GetToolUsageStatsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const stats = await ctx.telemetry.getToolUsageStats({
    startTime: args.startTime ? new Date(args.startTime) : undefined,
    endTime: args.endTime ? new Date(args.endTime) : undefined,
    projectId: args.projectId,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        toolCount: stats.length,
        tools: stats.map(t => ({
          toolName: t.toolName,
          callCount: t.callCount,
          successRate: `${(t.successRate * 100).toFixed(1)}%`,
          avgDurationMs: Math.round(t.avgDurationMs),
          p95DurationMs: Math.round(t.p95DurationMs),
          commonSequences: t.commonSequences.slice(0, 3),
        })),
        message: `Usage statistics for ${stats.length} tools`,
      }, null, 2),
    }],
  };
}

export async function handleGetSessionStats(
  ctx: TelemetryHandlerContext,
  args: GetSessionStatsParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const stats = await ctx.telemetry.getSessionStats(args.sessionId);

  if (!stats) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `No telemetry data found for session: ${args.sessionId}`,
        }, null, 2),
      }],
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        session: {
          sessionId: stats.sessionId,
          startTime: stats.startTime.toISOString(),
          endTime: stats.endTime?.toISOString(),
          durationMinutes: Math.round(stats.durationMs / 60000),
          toolCallCount: stats.toolCallCount,
          uniqueToolsUsed: stats.uniqueToolsUsed,
          tasksWorked: stats.tasksWorked,
          tasksCompleted: stats.tasksCompleted,
          patternsDetected: stats.patternsDetected,
        },
        message: `Session statistics for ${stats.sessionId.substring(0, 8)}...`,
      }, null, 2),
    }],
  };
}
