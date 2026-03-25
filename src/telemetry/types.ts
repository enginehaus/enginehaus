/**
 * Telemetry Types for AX Usage Profiling
 *
 * Captures how agents actually use the coordination system to:
 * 1. Understand usage patterns for product development
 * 2. Detect AX anti-patterns (bypassing coordination tools, etc.)
 */

// ============================================================================
// Configuration Types
// ============================================================================

export type TelemetryLevel = 'off' | 'minimal' | 'full';
export type SessionIdentification = 'anonymous' | 'pseudonymous' | 'identifiable';

export interface TelemetryConfig {
  /** Telemetry detail level: off | minimal | full (default: minimal) */
  level: TelemetryLevel;
  /** How to identify sessions: anonymous | pseudonymous | identifiable */
  sessionIdentification: SessionIdentification;
  /** Sampling rate 0.0-1.0 for high-volume deployments (default: 1.0) */
  samplingRate: number;
  /** Retention in days for telemetry data (default: 30) */
  retentionDays: number;
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  level: 'minimal',
  sessionIdentification: 'pseudonymous',
  samplingRate: 1.0,
  retentionDays: 30,
};

// ============================================================================
// Event Types
// ============================================================================

export type TelemetryEventType =
  // Tool invocation events
  | 'tool_invoked'
  | 'tool_succeeded'
  | 'tool_failed'
  // Sequence events
  | 'tool_chain_started'
  | 'tool_chain_completed'
  // Pattern detection events
  | 'pattern_detected'
  // Session lifecycle
  | 'session_started'
  | 'session_ended'
  | 'session_drift_detected';

export interface TelemetryEvent {
  id: string;
  timestamp: Date;
  eventType: TelemetryEventType;
  sessionId: string;
  projectId?: string;
  taskId?: string;
  data: TelemetryEventData;
}

// ============================================================================
// Event Data Types
// ============================================================================

export interface ToolInvocationData {
  toolName: string;
  durationMs: number;
  inputSize: number;
  outputSize: number;
  success: boolean;
  errorType?: string;
  /** Position in current tool chain (1-indexed) */
  chainPosition?: number;
  /** Previous tool in chain (for sequence analysis) */
  previousTool?: string;
}

export interface ToolChainData {
  chainId: string;
  tools: string[];
  totalDurationMs: number;
  toolCount: number;
  success: boolean;
}

export interface PatternData {
  patternType: PatternType;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  toolsInvolved: string[];
  recommendation?: string;
}

export interface SessionDriftData {
  /** Time since session start in ms */
  sessionAgeMs: number;
  /** Context size trend: growing, stable, shrinking */
  contextTrend: 'growing' | 'stable' | 'shrinking';
  /** Average response time trend */
  responseTrend: 'faster' | 'stable' | 'slower';
  /** Tool variety (unique tools used / total calls) */
  toolVariety: number;
}

export type TelemetryEventData =
  | ToolInvocationData
  | ToolChainData
  | PatternData
  | SessionDriftData
  | Record<string, unknown>;

// ============================================================================
// Pattern Types (for anti-pattern detection)
// ============================================================================

export type PatternType =
  // Anti-patterns
  | 'repeated_context_fetch'     // Fetching same context repeatedly
  | 'bypassed_coordination'      // Direct DB access detected
  | 'tool_thrashing'             // Rapid switching between tools without progress
  | 'context_bloat'              // Context size growing excessively
  | 'abandoned_workflow'         // Started but not completed workflow
  // Positive patterns
  | 'efficient_workflow'         // Completed workflow with minimal tool calls
  | 'good_decision_logging'      // Decisions logged during implementation
  | 'proper_task_completion';    // Task completed with all expected steps

// ============================================================================
// Analysis Types
// ============================================================================

export interface ToolUsageStats {
  toolName: string;
  callCount: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  commonSequences: Array<{
    previousTool: string;
    count: number;
  }>;
}

export interface SessionStats {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  durationMs: number;
  toolCallCount: number;
  uniqueToolsUsed: number;
  tasksWorked: number;
  tasksCompleted: number;
  patternsDetected: Array<{
    type: PatternType;
    count: number;
  }>;
}

export interface TelemetrySummary {
  period: {
    start: Date;
    end: Date;
  };
  totalSessions: number;
  totalToolCalls: number;
  toolUsage: ToolUsageStats[];
  commonPatterns: Array<{
    type: PatternType;
    count: number;
    severity: 'info' | 'warning' | 'critical';
  }>;
  insights: string[];
}
