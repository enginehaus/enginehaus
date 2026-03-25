/**
 * Outcome-based Analytics Service
 *
 * Calculates metrics that measure actual value delivered:
 * - Token efficiency (ESTIMATED - based on context fetch patterns)
 * - Human time (the expensive resource)
 * - Quality outcomes (did the work succeed)
 *
 * These replace vanity metrics like "tasks completed" with
 * actionable insights like "first-attempt success rate" and
 * "rework rate".
 *
 * MEASUREMENT ACCURACY NOTES:
 * - Token counts are ESTIMATED using heuristics (bytes/4), not actual LLM usage
 * - "Tokens saved" is calculated from context fetch patterns, not API response data
 * - Cycle times measure claim-to-complete, not actual working time
 * - Agent satisfaction requires explicit feedback to measure accurately
 */

import type { StorageAdapter } from '../storage/storage-adapter.js';
import type {
  OutcomeMetrics,
  OutcomeTrend,
  ValueDashboard,
  DashboardInsight,
  FrictionTag,
} from './types.js';

// Storage returns generic string arrays; we'll type-check at runtime
interface StorageSessionFeedback {
  id: string;
  sessionId: string;
  projectId: string;
  taskId?: string;
  productivityRating?: number;
  frictionTags: string[];
  notes?: string;
  createdAt: Date;
}

export class OutcomeAnalyticsService {
  constructor(private storage: StorageAdapter) {}

  /**
   * Get outcome-based metrics for a time period
   */
  async getOutcomeMetrics(options: {
    projectId: string;
    period?: 'day' | 'week' | 'month';
    since?: Date;
    until?: Date;
  }): Promise<OutcomeMetrics> {
    const { projectId, period = 'week' } = options;

    const now = Date.now();
    const periodMs = {
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    }[period];

    const since = options.since || new Date(now - periodMs);
    const until = options.until || new Date(now);

    // Get raw metrics from storage
    const rawMetrics = await this.storage.getOutcomeRawData({
      projectId,
      since,
      until,
    });

    // Calculate token efficiency
    const tokenEfficiency = this.calculateTokenEfficiency(rawMetrics);

    // Calculate human time metrics
    const humanTime = await this.calculateHumanTimeMetrics(rawMetrics, projectId, since, until);

    // Calculate quality outcomes
    const qualityOutcomes = await this.calculateQualityOutcomes(rawMetrics, projectId, since, until);

    return {
      period: {
        start: since,
        end: until,
        label: `Last ${period}`,
      },
      tokenEfficiency,
      humanTime,
      qualityOutcomes,
      rawCounts: {
        tasksCompleted: rawMetrics.tasksCompleted,
        tasksAbandoned: rawMetrics.tasksAbandoned,
        tasksClaimed: rawMetrics.tasksClaimed,
        tasksReopened: rawMetrics.tasksReopened,
        sessions: rawMetrics.sessions,
        artifacts: rawMetrics.artifacts,
        decisions: rawMetrics.decisions,
      },
    };
  }

  private calculateTokenEfficiency(raw: RawMetricsData): OutcomeMetrics['tokenEfficiency'] {
    const minimalFetches = raw.contextFetchMinimal;
    const fullFetches = raw.contextFetchFull;
    const expansions = raw.contextExpansions;

    // Minimal sufficiency: minimal fetches that weren't followed by expansion
    // This is MEASURED directly from event patterns
    const minimalSufficient = raw.minimalSufficientCount;
    const minimalSufficiencyRate = minimalFetches > 0
      ? minimalSufficient / minimalFetches
      : 1;

    // ESTIMATED tokens saved - this is a rough heuristic, NOT actual measurement
    // Assumption: full fetch ~3x tokens of minimal (~1500 vs ~500 tokens)
    // We don't have access to actual LLM token counts
    const estimatedTokensSaved = minimalSufficient * 1000;

    // Tool calls per task
    const avgToolCallsPerTask = raw.tasksClaimed > 0
      ? raw.toolCalls / raw.tasksClaimed
      : 0;

    // Sessions per task (lower is better - means task done in fewer sessions)
    const avgSessionsPerTask = raw.tasksClaimed > 0
      ? raw.sessions / raw.tasksClaimed
      : 0;

    return {
      minimalContextFetches: minimalFetches,
      fullContextFetches: fullFetches,
      contextExpansions: expansions,
      minimalSufficiencyRate,
      estimatedTokensSaved, // NOTE: This is an estimate, not measured
      avgToolCallsPerTask,
      avgSessionsPerTask,
    };
  }

  private async calculateHumanTimeMetrics(
    raw: RawMetricsData,
    projectId: string,
    since: Date,
    until: Date
  ): Promise<OutcomeMetrics['humanTime']> {
    // Get cycle times (claim to complete)
    const cycleTimes = raw.cycleTimes.filter(ct => ct !== null) as number[];
    const avgCycleTimeMs = cycleTimes.length > 0
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
      : null;

    // Get session durations
    const sessionDurations = raw.sessionDurations.filter(sd => sd !== null) as number[];
    const avgSessionDurationMs = sessionDurations.length > 0
      ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
      : null;

    // Tasks per session
    const avgTasksPerSession = raw.sessions > 0
      ? raw.tasksCompleted / raw.sessions
      : 0;

    // Rework indicators
    const taskReopeningRate = raw.tasksClaimed > 0
      ? raw.tasksReopened / raw.tasksClaimed
      : 0;

    // Multi-session tasks (tasks that required >1 session)
    const multiSessionTaskRate = raw.tasksClaimed > 0
      ? raw.multiSessionTasks / raw.tasksClaimed
      : 0;

    // Feedback metrics
    const feedback = await this.storage.getSessionFeedback({
      projectId,
      since,
      until,
    });

    const avgProductivityRating = feedback.length > 0
      ? feedback
          .filter(f => f.productivityRating !== undefined)
          .reduce((sum, f) => sum + (f.productivityRating || 0), 0) /
        feedback.filter(f => f.productivityRating !== undefined).length
      : null;

    const frictionTagCounts = this.countFrictionTags(feedback);

    return {
      avgCycleTimeMs,
      avgCycleTimeFormatted: this.formatDuration(avgCycleTimeMs),
      avgSessionDurationMs,
      avgTasksPerSession,
      taskReopeningRate,
      multiSessionTaskRate,
      avgProductivityRating,
      frictionTagCounts,
    };
  }

  private async calculateQualityOutcomes(
    raw: RawMetricsData,
    projectId: string,
    since: Date,
    until: Date
  ): Promise<OutcomeMetrics['qualityOutcomes']> {
    // Quality gate pass rate
    const totalGates = raw.qualityGatePassed + raw.qualityGateFailed;
    const qualityGatePassRate = totalGates > 0
      ? raw.qualityGatePassed / totalGates
      : 1;

    // First-attempt success (completed in single session)
    const firstAttemptSuccessRate = raw.tasksClaimed > 0
      ? raw.singleSessionCompletions / raw.tasksClaimed
      : 0;

    // Rework rate (tasks modified after completion)
    const reworkRate = raw.tasksCompleted > 0
      ? raw.tasksReworked / raw.tasksCompleted
      : 0;

    // Knowledge capture rates
    const artifactCreationRate = raw.tasksClaimed > 0
      ? raw.artifacts / raw.tasksClaimed
      : 0;

    const decisionLoggingRate = raw.tasksClaimed > 0
      ? raw.decisions / raw.tasksClaimed
      : 0;

    // Completion and abandonment
    const totalOutcomes = raw.tasksCompleted + raw.tasksAbandoned;
    const completionRate = totalOutcomes > 0
      ? raw.tasksCompleted / totalOutcomes
      : 0;

    const abandonmentRate = totalOutcomes > 0
      ? raw.tasksAbandoned / totalOutcomes
      : 0;

    // Import type for type checking
    type AbandonmentReasonType = import('./types.js').AbandonmentReason;

    // Abandonment breakdown by reason
    const abandonmentByReason = raw.abandonmentByReason as Record<AbandonmentReasonType, number>;

    // "Real" abandonment rate excludes test and redirect (which are expected/healthy)
    const nonActionableReasons = ['test', 'redirect'];
    const actionableAbandonments = Object.entries(raw.abandonmentByReason)
      .filter(([reason]) => !nonActionableReasons.includes(reason))
      .reduce((sum, [_, count]) => sum + count, 0);

    const realAbandonmentRate = totalOutcomes > 0
      ? actionableAbandonments / totalOutcomes
      : 0;

    return {
      qualityGatePassRate,
      firstAttemptSuccessRate,
      reworkRate,
      artifactCreationRate,
      decisionLoggingRate,
      completionRate,
      abandonmentRate,
      abandonmentByReason,
      realAbandonmentRate,
    };
  }

  /**
   * Generate a value dashboard with insights and trends
   */
  async generateValueDashboard(options: {
    projectId: string;
    period?: 'day' | 'week' | 'month';
    includeTrends?: boolean;
  }): Promise<ValueDashboard> {
    const { projectId, period = 'week', includeTrends = true } = options;

    // Get current period metrics
    const current = await this.getOutcomeMetrics({ projectId, period });

    // Get previous period for comparison
    let previousPeriod: OutcomeMetrics | undefined;
    if (includeTrends) {
      const periodMs = {
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
      }[period];

      const previousEnd = new Date(current.period.start.getTime() - 1);
      const previousStart = new Date(previousEnd.getTime() - periodMs);

      const previousRaw = await this.storage.getOutcomeRawData({
        projectId,
        since: previousStart,
        until: previousEnd,
      });

      if (previousRaw.tasksClaimed > 0) {
        previousPeriod = await this.getOutcomeMetrics({ projectId, period, since: previousStart, until: previousEnd });
      }
    }

    // Generate insights
    const insights = this.generateInsights(current, previousPeriod);

    // Calculate trends
    const trends: OutcomeTrend[] = [];
    if (includeTrends && previousPeriod) {
      trends.push(...this.calculateTrends(current, previousPeriod));
    }

    return {
      generatedAt: new Date(),
      projectId,
      current,
      previousPeriod,
      trends,
      insights,
      limitations: [
        'Token savings are ESTIMATED (~1000 tokens per minimal fetch that avoided expansion) - not actual LLM token counts',
        'Cycle times measure claim-to-complete timestamps, not actual working time',
        'Quality gate pass rate requires validate_quality_gates to be called - otherwise defaults to 100%',
        'Agent satisfaction requires explicit feedback to measure accurately',
        'Context efficiency is a proxy for token savings, not direct measurement',
      ],
    };
  }

  private generateInsights(
    current: OutcomeMetrics,
    previous?: OutcomeMetrics
  ): DashboardInsight[] {
    const insights: DashboardInsight[] = [];

    // Token efficiency insights
    if (current.tokenEfficiency.minimalSufficiencyRate >= 0.8) {
      insights.push({
        type: 'positive',
        category: 'token_efficiency',
        title: 'High context efficiency',
        description: `${Math.round(current.tokenEfficiency.minimalSufficiencyRate * 100)}% of minimal context fetches were sufficient without expansion.`,
      });
    } else if (current.tokenEfficiency.minimalSufficiencyRate < 0.5) {
      insights.push({
        type: 'negative',
        category: 'token_efficiency',
        title: 'Frequent context expansion needed',
        description: `Only ${Math.round(current.tokenEfficiency.minimalSufficiencyRate * 100)}% of minimal fetches were sufficient. Consider improving task file lists.`,
        recommendation: 'Review tasks that needed expansion and update their file lists.',
      });
    }

    // Human time insights
    if (current.humanTime.taskReopeningRate > 0.2) {
      insights.push({
        type: 'negative',
        category: 'human_time',
        title: 'High task reopening rate',
        description: `${Math.round(current.humanTime.taskReopeningRate * 100)}% of tasks were reopened after completion.`,
        recommendation: 'Review task definitions for clarity and completeness.',
      });
    }

    if (current.humanTime.multiSessionTaskRate > 0.5) {
      insights.push({
        type: 'neutral',
        category: 'human_time',
        title: 'Tasks often span multiple sessions',
        description: `${Math.round(current.humanTime.multiSessionTaskRate * 100)}% of tasks required multiple sessions to complete.`,
        recommendation: 'Consider breaking large tasks into smaller, single-session units.',
      });
    }

    // Quality insights
    if (current.qualityOutcomes.firstAttemptSuccessRate >= 0.7) {
      insights.push({
        type: 'positive',
        category: 'quality',
        title: 'Strong first-attempt success',
        description: `${Math.round(current.qualityOutcomes.firstAttemptSuccessRate * 100)}% of tasks completed on first attempt.`,
      });
    }

    if (current.qualityOutcomes.reworkRate > 0.15) {
      insights.push({
        type: 'negative',
        category: 'quality',
        title: 'Elevated rework rate',
        description: `${Math.round(current.qualityOutcomes.reworkRate * 100)}% of completed tasks required rework.`,
        recommendation: 'Run quality gates before marking tasks complete.',
      });
    }

    if (current.qualityOutcomes.artifactCreationRate < 0.3) {
      insights.push({
        type: 'neutral',
        category: 'quality',
        title: 'Low knowledge capture',
        description: `Only ${current.qualityOutcomes.artifactCreationRate.toFixed(1)} artifacts created per task.`,
        recommendation: 'Consider documenting design decisions and learnings as artifacts.',
      });
    }

    // Friction tag insights
    const topFriction = this.getTopFrictionTags(current.humanTime.frictionTagCounts, 2);
    if (topFriction.length > 0 && topFriction[0].count > 0) {
      insights.push({
        type: 'negative',
        category: 'human_time',
        title: `Common friction: ${this.formatFrictionTag(topFriction[0].tag)}`,
        description: `Reported ${topFriction[0].count} times this period.`,
        recommendation: this.getFrictionRecommendation(topFriction[0].tag),
      });
    }

    return insights;
  }

  private calculateTrends(
    current: OutcomeMetrics,
    previous: OutcomeMetrics
  ): OutcomeTrend[] {
    const trends: OutcomeTrend[] = [];

    // First-attempt success trend
    const firstAttemptChange = previous.qualityOutcomes.firstAttemptSuccessRate > 0
      ? ((current.qualityOutcomes.firstAttemptSuccessRate - previous.qualityOutcomes.firstAttemptSuccessRate) /
         previous.qualityOutcomes.firstAttemptSuccessRate) * 100
      : 0;

    trends.push({
      metric: 'firstAttemptSuccessRate',
      dataPoints: [
        { period: 'Previous', value: previous.qualityOutcomes.firstAttemptSuccessRate },
        { period: 'Current', value: current.qualityOutcomes.firstAttemptSuccessRate },
      ],
      trend: firstAttemptChange > 5 ? 'improving' : firstAttemptChange < -5 ? 'declining' : 'stable',
      changePercent: firstAttemptChange,
    });

    // Token efficiency trend
    const efficiencyChange = previous.tokenEfficiency.minimalSufficiencyRate > 0
      ? ((current.tokenEfficiency.minimalSufficiencyRate - previous.tokenEfficiency.minimalSufficiencyRate) /
         previous.tokenEfficiency.minimalSufficiencyRate) * 100
      : 0;

    trends.push({
      metric: 'minimalSufficiencyRate',
      dataPoints: [
        { period: 'Previous', value: previous.tokenEfficiency.minimalSufficiencyRate },
        { period: 'Current', value: current.tokenEfficiency.minimalSufficiencyRate },
      ],
      trend: efficiencyChange > 5 ? 'improving' : efficiencyChange < -5 ? 'declining' : 'stable',
      changePercent: efficiencyChange,
    });

    return trends;
  }

  private countFrictionTags(feedback: StorageSessionFeedback[]): Record<FrictionTag, number> {
    const counts: Record<FrictionTag, number> = {
      repeated_context: 0,
      wrong_context: 0,
      tool_confusion: 0,
      missing_files: 0,
      slow_response: 0,
      unclear_task: 0,
      dependency_blocked: 0,
      quality_rework: 0,
      scope_creep: 0,
      other: 0,
    };

    for (const f of feedback) {
      for (const tag of f.frictionTags) {
        // Validate tag is a known FrictionTag before counting
        if (tag in counts) {
          counts[tag as FrictionTag]++;
        }
      }
    }

    return counts;
  }

  private getTopFrictionTags(
    counts: Record<FrictionTag, number>,
    limit: number
  ): Array<{ tag: FrictionTag; count: number }> {
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag: tag as FrictionTag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  private formatFrictionTag(tag: FrictionTag): string {
    const labels: Record<FrictionTag, string> = {
      repeated_context: 'Repeated context',
      wrong_context: 'Wrong context',
      tool_confusion: 'Tool confusion',
      missing_files: 'Missing files',
      slow_response: 'Slow response',
      unclear_task: 'Unclear task',
      dependency_blocked: 'Blocked by dependency',
      quality_rework: 'Quality rework',
      scope_creep: 'Scope creep',
      other: 'Other',
    };
    return labels[tag];
  }

  private getFrictionRecommendation(tag: FrictionTag): string {
    const recommendations: Record<FrictionTag, string> = {
      repeated_context: 'Improve artifact capture to preserve context between sessions.',
      wrong_context: 'Review task file lists and strategic context for accuracy.',
      tool_confusion: 'Check tool documentation and consider workflow simplification.',
      missing_files: 'Update task file lists to include all relevant files.',
      slow_response: 'Consider using minimal context fetches for routine queries.',
      unclear_task: 'Add more detail to task descriptions and acceptance criteria.',
      dependency_blocked: 'Review dependency chain and prioritize blocker resolution.',
      quality_rework: 'Run quality gates before marking tasks complete.',
      scope_creep: 'Break large tasks into smaller, well-defined units.',
      other: 'Review session feedback notes for specific issues.',
    };
    return recommendations[tag];
  }

  private formatDuration(ms: number | null): string {
    if (ms === null) return 'N/A';

    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}

// ============================================================================
// Raw metrics data type (from storage layer)
// ============================================================================

export interface RawMetricsData {
  // Task counts
  tasksClaimed: number;
  tasksCompleted: number;
  tasksAbandoned: number;
  tasksReopened: number;
  tasksReworked: number;

  // Session counts
  sessions: number;
  singleSessionCompletions: number;
  multiSessionTasks: number;

  // Context metrics
  contextFetchMinimal: number;
  contextFetchFull: number;
  contextExpansions: number;
  minimalSufficientCount: number;

  // Tool metrics
  toolCalls: number;

  // Quality metrics
  qualityGatePassed: number;
  qualityGateFailed: number;

  // Knowledge capture
  artifacts: number;
  decisions: number;

  // Timing data
  cycleTimes: (number | null)[];
  sessionDurations: (number | null)[];

  // Abandonment breakdown by reason
  abandonmentByReason: Record<string, number>;
}
