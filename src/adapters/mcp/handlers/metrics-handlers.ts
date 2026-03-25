/**
 * Metrics Tool Handlers
 *
 * Handlers for coordination metrics MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';

export interface GetCoordinationMetricsParams {
  period?: 'day' | 'week' | 'month';
  projectId?: string;
}

export interface LogMetricParams {
  eventType: 'context_expanded' | 'tool_called' | 'quality_gate_passed' | 'quality_gate_failed' | 'context_fetch_minimal' | 'context_fetch_full' | 'task_reopened' | 'context_repeated';
  taskId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export async function handleGetCoordinationMetrics(
  service: CoordinationService,
  args: GetCoordinationMetricsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.getCoordinationMetrics({
    period: args.period,
    projectId: args.projectId,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleLogMetric(
  service: CoordinationService,
  args: LogMetricParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.logMetric({
    eventType: args.eventType,
    taskId: args.taskId,
    sessionId: args.sessionId,
    metadata: args.metadata,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
