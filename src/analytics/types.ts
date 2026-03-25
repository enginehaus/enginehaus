/**
 * Outcome-based analytics types
 *
 * These types support metrics that measure actual value delivered,
 * not just activity counts (vanity metrics).
 */

// ============================================================================
// Session Feedback
// ============================================================================

export interface SessionFeedback {
  id: string;
  sessionId: string;
  projectId: string;
  taskId?: string;

  // Pulse rating (1-5)
  productivityRating?: number;

  // Friction tags (what slowed you down)
  frictionTags: FrictionTag[];

  // Optional notes
  notes?: string;

  createdAt: Date;
}

export type FrictionTag =
  | 'repeated_context'      // Had to re-explain something
  | 'wrong_context'         // Got irrelevant context
  | 'tool_confusion'        // Tools didn't work as expected
  | 'missing_files'         // Needed files not loaded
  | 'slow_response'         // Long wait times
  | 'unclear_task'          // Task description was vague
  | 'dependency_blocked'    // Blocked by another task
  | 'quality_rework'        // Had to redo for quality
  | 'scope_creep'           // Task grew beyond original scope
  | 'other';

// ============================================================================
// Abandonment Reasons
// ============================================================================

/**
 * Reasons for releasing/abandoning a task.
 * Critical for interpretable metrics - a 10% abandonment rate means very
 * different things depending on whether abandonments are tests vs stuck agents.
 */
export type AbandonmentReason =
  | 'test'            // Test/exploration, not real work
  | 'redirect'        // User redirected to different priority
  | 'blocked'         // Blocked by external dependency
  | 'stuck'           // Agent genuinely stuck, couldn't proceed
  | 'scope_change'    // Task scope changed mid-work
  | 'user_requested'  // User explicitly asked to stop
  | 'context_limit'   // Hit context/token limits
  | 'other';          // Other reason (use notes)

export const ABANDONMENT_REASON_LABELS: Record<AbandonmentReason, string> = {
  test: 'Test/exploration',
  redirect: 'Redirected to different priority',
  blocked: 'Blocked by external dependency',
  stuck: 'Agent stuck, couldn\'t proceed',
  scope_change: 'Task scope changed',
  user_requested: 'User requested stop',
  context_limit: 'Hit context/token limits',
  other: 'Other',
};

// ============================================================================
// Outcome Metrics
// ============================================================================

export interface OutcomeMetrics {
  period: {
    start: Date;
    end: Date;
    label: string;
  };

  // Token Efficiency (actual spend proxies)
  tokenEfficiency: {
    // Direct measures
    minimalContextFetches: number;
    fullContextFetches: number;
    contextExpansions: number;

    // Efficiency rate (minimal fetches that didn't need expansion)
    minimalSufficiencyRate: number;

    // Estimated tokens saved
    estimatedTokensSaved: number;

    // Conversation metrics (proxy for token usage)
    avgToolCallsPerTask: number;
    avgSessionsPerTask: number;
  };

  // Human Time (the expensive resource)
  humanTime: {
    // Task completion metrics
    avgCycleTimeMs: number | null;
    avgCycleTimeFormatted: string;

    // Session focus (longer = better flow state)
    avgSessionDurationMs: number | null;
    avgTasksPerSession: number;

    // Rework indicators
    taskReopeningRate: number;  // Tasks that went back to non-completed
    multiSessionTaskRate: number;  // Tasks needing >1 session

    // Feedback-based
    avgProductivityRating: number | null;
    frictionTagCounts: Record<FrictionTag, number>;
  };

  // Quality Outcomes
  qualityOutcomes: {
    // Gate metrics
    qualityGatePassRate: number;

    // First-attempt success (completed in one session)
    firstAttemptSuccessRate: number;

    // Rework rate (task modified after completion)
    reworkRate: number;

    // Knowledge capture
    artifactCreationRate: number;  // Artifacts per task
    decisionLoggingRate: number;   // Decisions per task

    // Completion metrics
    completionRate: number;
    abandonmentRate: number;

    // Abandonment breakdown by reason
    abandonmentByReason: Record<AbandonmentReason, number>;
    // "Real" abandonment rate excludes test/redirect (actionable signal)
    realAbandonmentRate: number;
  };

  // Raw counts for context
  rawCounts: {
    tasksCompleted: number;
    tasksAbandoned: number;
    tasksClaimed: number;
    tasksReopened: number;
    sessions: number;
    artifacts: number;
    decisions: number;
  };
}

// ============================================================================
// Trend Analysis
// ============================================================================

export interface OutcomeTrend {
  metric: keyof OutcomeMetrics['tokenEfficiency'] |
          keyof OutcomeMetrics['humanTime'] |
          keyof OutcomeMetrics['qualityOutcomes'];

  dataPoints: Array<{
    period: string;
    value: number;
  }>;

  trend: 'improving' | 'stable' | 'declining';
  changePercent: number;
}

// ============================================================================
// Value Dashboard
// ============================================================================

export interface ValueDashboard {
  generatedAt: Date;
  projectId: string;

  // Current period metrics
  current: OutcomeMetrics;

  // Comparison to previous period
  previousPeriod?: OutcomeMetrics;

  // Key trends
  trends: OutcomeTrend[];

  // Actionable insights
  insights: DashboardInsight[];

  // Honest limitations
  limitations: string[];
}

export interface DashboardInsight {
  type: 'positive' | 'negative' | 'neutral';
  category: 'token_efficiency' | 'human_time' | 'quality';
  title: string;
  description: string;
  recommendation?: string;
}

// ============================================================================
// Event Types (extended from existing)
// ============================================================================

export type OutcomeEventType =
  // Existing events
  | 'task_claimed'
  | 'task_completed'
  | 'task_abandoned'
  | 'context_expanded'
  | 'session_started'
  | 'session_ended'
  | 'tool_called'
  | 'quality_gate_passed'
  | 'quality_gate_failed'
  | 'context_fetch_minimal'
  | 'context_fetch_full'
  // New outcome events
  | 'task_reopened'           // Task went from completed back to ready/in-progress
  | 'session_feedback'        // Human pulse rating
  | 'context_repeated';       // Same context requested again (heuristic)
