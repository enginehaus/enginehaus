/**
 * Telemetry Service
 *
 * Captures and analyzes how agents use the coordination system.
 * Enables AX observability - making agent behaviour legible.
 */

import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import {
  TelemetryConfig,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryEventData,
  ToolInvocationData,
  ToolChainData,
  PatternData,
  PatternType,
  ToolUsageStats,
  SessionStats,
  TelemetrySummary,
  DEFAULT_TELEMETRY_CONFIG,
} from './types.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';

export class TelemetryService {
  private config: TelemetryConfig;
  private storage: StorageAdapter;

  // In-memory state for chain tracking
  private activeChains: Map<string, {
    chainId: string;
    startTime: number;
    tools: string[];
    sessionId: string;
  }> = new Map();

  // Recent tool calls for sequence detection (sessionId -> recent tools)
  private recentToolCalls: Map<string, Array<{ tool: string; timestamp: number }>> = new Map();

  constructor(storage: StorageAdapter, config: Partial<TelemetryConfig> = {}) {
    this.storage = storage;
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
  }

  /**
   * Check if telemetry should be captured (based on config and sampling)
   */
  private shouldCapture(): boolean {
    if (this.config.level === 'off') return false;
    if (this.config.samplingRate < 1.0) {
      return Math.random() < this.config.samplingRate;
    }
    return true;
  }

  /**
   * Hash session ID for pseudonymous mode
   */
  private processSessionId(sessionId: string): string {
    switch (this.config.sessionIdentification) {
      case 'anonymous':
        return 'anonymous';
      case 'pseudonymous':
        return crypto.createHash('sha256').update(sessionId).digest('hex').substring(0, 16);
      case 'identifiable':
        return sessionId;
    }
  }

  /**
   * Record a tool invocation
   */
  async recordToolInvocation(params: {
    toolName: string;
    sessionId: string;
    projectId?: string;
    taskId?: string;
    durationMs: number;
    inputSize: number;
    outputSize: number;
    success: boolean;
    errorType?: string;
  }): Promise<void> {
    if (!this.shouldCapture()) return;

    const processedSessionId = this.processSessionId(params.sessionId);

    // Track for sequence analysis
    const recentCalls = this.recentToolCalls.get(processedSessionId) || [];
    const previousTool = recentCalls.length > 0 ? recentCalls[recentCalls.length - 1].tool : undefined;

    // Update recent calls (keep last 10)
    recentCalls.push({ tool: params.toolName, timestamp: Date.now() });
    if (recentCalls.length > 10) recentCalls.shift();
    this.recentToolCalls.set(processedSessionId, recentCalls);

    // Track chain
    let chainPosition: number | undefined;
    const activeChain = this.activeChains.get(processedSessionId);
    if (activeChain) {
      activeChain.tools.push(params.toolName);
      chainPosition = activeChain.tools.length;
    }

    const data: ToolInvocationData = {
      toolName: params.toolName,
      durationMs: params.durationMs,
      inputSize: params.inputSize,
      outputSize: params.outputSize,
      success: params.success,
      errorType: params.errorType,
      chainPosition,
      previousTool,
    };

    await this.storage.logMetric({
      eventType: 'tool_called',
      projectId: params.projectId,
      taskId: params.taskId,
      sessionId: processedSessionId,
      metadata: {
        ...data,
        telemetryEventType: params.success ? 'tool_succeeded' : 'tool_failed',
      },
    });

    // Check for patterns (only in full mode)
    if (this.config.level === 'full') {
      await this.detectPatterns(processedSessionId, params.toolName, recentCalls);
    }
  }

  /**
   * Start tracking a tool chain (sequence of related tool calls)
   */
  startChain(sessionId: string): string {
    const processedSessionId = this.processSessionId(sessionId);
    const chainId = uuidv4();

    this.activeChains.set(processedSessionId, {
      chainId,
      startTime: Date.now(),
      tools: [],
      sessionId: processedSessionId,
    });

    return chainId;
  }

  /**
   * End a tool chain and record its stats
   */
  async endChain(sessionId: string, success: boolean): Promise<void> {
    if (!this.shouldCapture()) return;

    const processedSessionId = this.processSessionId(sessionId);
    const chain = this.activeChains.get(processedSessionId);
    if (!chain) return;

    const data: ToolChainData = {
      chainId: chain.chainId,
      tools: chain.tools,
      totalDurationMs: Date.now() - chain.startTime,
      toolCount: chain.tools.length,
      success,
    };

    await this.storage.logMetric({
      eventType: 'tool_called',
      sessionId: processedSessionId,
      metadata: {
        ...data,
        telemetryEventType: 'tool_chain_completed',
      },
    });

    this.activeChains.delete(processedSessionId);
  }

  /**
   * Detect patterns in tool usage
   */
  private async detectPatterns(
    sessionId: string,
    currentTool: string,
    recentCalls: Array<{ tool: string; timestamp: number }>
  ): Promise<void> {
    const patterns: PatternData[] = [];

    // Pattern: Repeated context fetch
    const contextFetches = recentCalls.filter(c =>
      c.tool === 'get_next_task' || c.tool === 'start_work' || c.tool === 'get_coordination_context' || c.tool === 'get_briefing'
    );
    if (contextFetches.length >= 3) {
      const timeSpan = contextFetches[contextFetches.length - 1].timestamp - contextFetches[0].timestamp;
      if (timeSpan < 60000) { // 3+ fetches in under a minute
        patterns.push({
          patternType: 'repeated_context_fetch',
          severity: 'warning',
          description: `${contextFetches.length} context fetches in ${Math.round(timeSpan / 1000)}s`,
          toolsInvolved: contextFetches.map(c => c.tool),
          recommendation: 'Consider using get_minimal_task for subsequent fetches',
        });
      }
    }

    // Pattern: Tool thrashing (rapid switching without progress)
    if (recentCalls.length >= 5) {
      const uniqueTools = new Set(recentCalls.slice(-5).map(c => c.tool));
      if (uniqueTools.size >= 4) {
        const timeSpan = recentCalls[recentCalls.length - 1].timestamp - recentCalls[recentCalls.length - 5].timestamp;
        if (timeSpan < 10000) { // 5 different tools in 10 seconds
          patterns.push({
            patternType: 'tool_thrashing',
            severity: 'warning',
            description: 'Rapid switching between tools without completing workflow',
            toolsInvolved: [...uniqueTools],
            recommendation: 'Consider completing current task before switching contexts',
          });
        }
      }
    }

    // Pattern: Efficient workflow (get_next_task -> work -> complete_task)
    if (currentTool === 'complete_task' || currentTool === 'complete_task_smart') {
      const getNextIdx = recentCalls.findIndex(c => c.tool === 'get_next_task');
      if (getNextIdx !== -1) {
        const workflowCalls = recentCalls.slice(getNextIdx);
        if (workflowCalls.length <= 5) {
          patterns.push({
            patternType: 'efficient_workflow',
            severity: 'info',
            description: `Completed workflow in ${workflowCalls.length} tool calls`,
            toolsInvolved: workflowCalls.map(c => c.tool),
          });
        }
      }
    }

    // Pattern: Good decision logging
    if (currentTool === 'complete_task' || currentTool === 'complete_task_smart') {
      const decisionCalls = recentCalls.filter(c => c.tool === 'log_decision');
      if (decisionCalls.length >= 1) {
        patterns.push({
          patternType: 'good_decision_logging',
          severity: 'info',
          description: `${decisionCalls.length} decision(s) logged during implementation`,
          toolsInvolved: ['log_decision'],
        });
      }
    }

    // Log detected patterns
    for (const pattern of patterns) {
      await this.storage.logMetric({
        eventType: 'tool_called',
        sessionId,
        metadata: {
          telemetryEventType: 'pattern_detected',
          ...pattern,
        },
      });
    }
  }

  /**
   * Get tool usage statistics for a time period
   */
  async getToolUsageStats(params: {
    startTime?: Date;
    endTime?: Date;
    projectId?: string;
  } = {}): Promise<ToolUsageStats[]> {
    const metrics = await this.storage.getMetricsRaw({
      eventType: 'tool_called',
      projectId: params.projectId,
      startTime: params.startTime,
      endTime: params.endTime,
    });

    // Aggregate by tool
    const toolStats: Map<string, {
      callCount: number;
      successCount: number;
      durations: number[];
      previousTools: Map<string, number>;
    }> = new Map();

    for (const metric of metrics) {
      const data = metric.metadata as ToolInvocationData | undefined;
      if (!data?.toolName) continue;

      const stats = toolStats.get(data.toolName) || {
        callCount: 0,
        successCount: 0,
        durations: [] as number[],
        previousTools: new Map<string, number>(),
      };

      stats.callCount++;
      if (data.success) stats.successCount++;
      if (data.durationMs) stats.durations.push(data.durationMs);
      if (data.previousTool) {
        stats.previousTools.set(
          data.previousTool,
          (stats.previousTools.get(data.previousTool) || 0) + 1
        );
      }

      toolStats.set(data.toolName, stats);
    }

    // Convert to output format
    return Array.from(toolStats.entries()).map(([toolName, stats]) => {
      const sortedDurations = stats.durations.sort((a, b) => a - b);
      const p95Index = Math.floor(sortedDurations.length * 0.95);

      return {
        toolName,
        callCount: stats.callCount,
        successRate: stats.callCount > 0 ? stats.successCount / stats.callCount : 0,
        avgDurationMs: stats.durations.length > 0
          ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
          : 0,
        p95DurationMs: sortedDurations[p95Index] || 0,
        commonSequences: Array.from(stats.previousTools.entries())
          .map(([previousTool, count]) => ({ previousTool, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
      };
    }).sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId: string): Promise<SessionStats | null> {
    const processedSessionId = this.processSessionId(sessionId);

    const metrics = await this.storage.getMetricsRaw({
      sessionId: processedSessionId,
    });

    if (metrics.length === 0) return null;

    const toolCalls = metrics.filter(m => {
      const data = m.metadata as any;
      return data?.telemetryEventType === 'tool_succeeded' ||
             data?.telemetryEventType === 'tool_failed' ||
             data?.toolName;
    });

    const uniqueTools = new Set(toolCalls.map(m => (m.metadata as any)?.toolName).filter(Boolean));
    const taskIds = new Set(metrics.map(m => m.taskId).filter(Boolean));

    const patterns = metrics.filter(m => (m.metadata as any)?.telemetryEventType === 'pattern_detected');
    const patternCounts = new Map<PatternType, number>();
    for (const p of patterns) {
      const type = (p.metadata as any)?.patternType as PatternType;
      if (type) {
        patternCounts.set(type, (patternCounts.get(type) || 0) + 1);
      }
    }

    const timestamps = metrics.map(m => m.timestamp.getTime());
    const startTime = new Date(Math.min(...timestamps));
    const endTime = new Date(Math.max(...timestamps));

    return {
      sessionId: processedSessionId,
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
      toolCallCount: toolCalls.length,
      uniqueToolsUsed: uniqueTools.size,
      tasksWorked: taskIds.size,
      tasksCompleted: 0, // Would need to query task completion status
      patternsDetected: Array.from(patternCounts.entries()).map(([type, count]) => ({ type, count })),
    };
  }

  /**
   * Get telemetry summary for a time period
   */
  async getTelemetrySummary(params: {
    startTime?: Date;
    endTime?: Date;
    projectId?: string;
  } = {}): Promise<TelemetrySummary> {
    const startTime = params.startTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
    const endTime = params.endTime || new Date();

    const metrics = await this.storage.getMetricsRaw({
      projectId: params.projectId,
      startTime,
      endTime,
    });

    const toolUsage = await this.getToolUsageStats({ startTime, endTime, projectId: params.projectId });

    // Count unique sessions
    const sessions = new Set(metrics.map(m => m.sessionId).filter(Boolean));

    // Count tool calls
    const toolCalls = metrics.filter(m => {
      const data = m.metadata as any;
      return data?.toolName;
    });

    // Aggregate patterns
    const patternCounts = new Map<PatternType, { count: number; severity: 'info' | 'warning' | 'critical' }>();
    for (const m of metrics) {
      const data = m.metadata as any;
      if (data?.telemetryEventType === 'pattern_detected') {
        const existing = patternCounts.get(data.patternType) || { count: 0, severity: data.severity };
        patternCounts.set(data.patternType, {
          count: existing.count + 1,
          severity: data.severity,
        });
      }
    }

    // Generate insights
    const insights: string[] = [];

    // Top tools insight
    if (toolUsage.length > 0) {
      const topTool = toolUsage[0];
      insights.push(`Most used tool: ${topTool.toolName} (${topTool.callCount} calls, ${Math.round(topTool.successRate * 100)}% success rate)`);
    }

    // Pattern insights
    const warningPatterns = Array.from(patternCounts.entries())
      .filter(([, v]) => v.severity === 'warning')
      .sort((a, b) => b[1].count - a[1].count);

    if (warningPatterns.length > 0) {
      insights.push(`Warning patterns detected: ${warningPatterns.map(([type, v]) => `${type} (${v.count}x)`).join(', ')}`);
    }

    const positivePatterns = Array.from(patternCounts.entries())
      .filter(([type]) => type === 'efficient_workflow' || type === 'good_decision_logging')
      .sort((a, b) => b[1].count - a[1].count);

    if (positivePatterns.length > 0) {
      insights.push(`Positive patterns: ${positivePatterns.map(([type, v]) => `${type} (${v.count}x)`).join(', ')}`);
    }

    // Session duration insight
    if (sessions.size > 0) {
      insights.push(`${sessions.size} unique session(s) tracked`);
    }

    return {
      period: { start: startTime, end: endTime },
      totalSessions: sessions.size,
      totalToolCalls: toolCalls.length,
      toolUsage,
      commonPatterns: Array.from(patternCounts.entries())
        .map(([type, data]) => ({ type, count: data.count, severity: data.severity }))
        .sort((a, b) => b.count - a.count),
      insights,
    };
  }

  /**
   * Clean up old telemetry data based on retention policy
   */
  async cleanupOldData(): Promise<number> {
    const cutoffDate = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
    // This would need a new storage method to delete old metrics
    // For now, return 0 as a placeholder
    return 0;
  }
}
