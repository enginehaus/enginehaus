/**
 * Outcome-Based Analytics Module
 *
 * Provides metrics that measure actual value delivered:
 * - Token efficiency (actual spend)
 * - Human time (the expensive resource)
 * - Quality outcomes (did the work succeed)
 */

export { OutcomeAnalyticsService, type RawMetricsData } from './outcome-analytics.js';
export type {
  OutcomeMetrics,
  OutcomeTrend,
  ValueDashboard,
  DashboardInsight,
  SessionFeedback,
  FrictionTag,
  OutcomeEventType,
} from './types.js';
