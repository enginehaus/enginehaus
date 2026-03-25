/**
 * Quality Trend Analysis Service
 *
 * Provides historical metrics and insights for quality tracking:
 * - Task completion velocity over time
 * - Quality gate pass/fail trends
 * - Cycle time analysis (time from ready to completed)
 * - Blocker resolution times
 * - Priority distribution trends
 */

import { UnifiedTask, TaskPriority, TaskStatus } from '../coordination/types.js';

export interface TimeSeriesPoint {
  date: string;  // ISO date string (YYYY-MM-DD)
  value: number;
}

export interface QualityMetrics {
  period: string;  // 'day', 'week', 'month'
  startDate: Date;
  endDate: Date;
  tasksCompleted: number;
  averageCycleTimeDays: number;
  priorityBreakdown: Record<TaskPriority, number>;
  blockerRate: number;  // Percentage of tasks that were blocked
  velocityTrend: 'increasing' | 'stable' | 'decreasing';
}

export interface TrendAnalysis {
  completionVelocity: TimeSeriesPoint[];
  averageCycleTime: TimeSeriesPoint[];
  blockerRate: TimeSeriesPoint[];
  priorityDistribution: Array<{
    date: string;
    critical: number;
    high: number;
    medium: number;
    low: number;
  }>;
}

export interface QualityInsights {
  summary: string;
  highlights: string[];
  concerns: string[];
  recommendations: string[];
  healthScore: number;  // 0-100
}

/**
 * Calculate cycle time for a completed task (in days)
 */
function calculateCycleTime(task: UnifiedTask): number | null {
  if (task.status !== 'completed' || !task.implementation?.completedAt) {
    return null;
  }

  const startTime = task.implementation?.startedAt || task.createdAt;
  const endTime = task.implementation.completedAt;

  return (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Group tasks by date (YYYY-MM-DD)
 */
function groupByDate(tasks: UnifiedTask[], dateExtractor: (t: UnifiedTask) => Date | null): Map<string, UnifiedTask[]> {
  const groups = new Map<string, UnifiedTask[]>();

  for (const task of tasks) {
    const date = dateExtractor(task);
    if (!date) continue;

    const dateStr = date.toISOString().split('T')[0];
    if (!groups.has(dateStr)) {
      groups.set(dateStr, []);
    }
    groups.get(dateStr)!.push(task);
  }

  return groups;
}

/**
 * Get completion velocity trend (tasks completed per day)
 */
export function getCompletionVelocity(
  tasks: UnifiedTask[],
  days: number = 30
): TimeSeriesPoint[] {
  const completedTasks = tasks.filter(t =>
    t.status === 'completed' && t.implementation?.completedAt
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recentTasks = completedTasks.filter(t =>
    t.implementation!.completedAt! >= cutoff
  );

  const grouped = groupByDate(recentTasks, t => t.implementation?.completedAt || null);

  // Fill in missing dates with zero
  const points: TimeSeriesPoint[] = [];
  const current = new Date(cutoff);

  while (current <= new Date()) {
    const dateStr = current.toISOString().split('T')[0];
    points.push({
      date: dateStr,
      value: grouped.get(dateStr)?.length || 0,
    });
    current.setDate(current.getDate() + 1);
  }

  return points;
}

/**
 * Get average cycle time trend (days to complete tasks)
 */
export function getCycleTimeTrend(
  tasks: UnifiedTask[],
  days: number = 30
): TimeSeriesPoint[] {
  const completedTasks = tasks.filter(t =>
    t.status === 'completed' && t.implementation?.completedAt
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recentTasks = completedTasks.filter(t =>
    t.implementation!.completedAt! >= cutoff
  );

  const grouped = groupByDate(recentTasks, t => t.implementation?.completedAt || null);

  const points: TimeSeriesPoint[] = [];

  for (const [date, dateTasks] of grouped) {
    const cycleTimes = dateTasks
      .map(t => calculateCycleTime(t))
      .filter((ct): ct is number => ct !== null);

    if (cycleTimes.length > 0) {
      const avg = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
      points.push({
        date,
        value: Math.round(avg * 10) / 10,
      });
    }
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get blocker rate trend (percentage of tasks that get blocked)
 */
export function getBlockerRateTrend(
  tasks: UnifiedTask[],
  days: number = 30
): TimeSeriesPoint[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recentTasks = tasks.filter(t => t.createdAt >= cutoff);
  const grouped = groupByDate(recentTasks, t => t.createdAt);

  const points: TimeSeriesPoint[] = [];

  for (const [date, dateTasks] of grouped) {
    const blockedCount = dateTasks.filter(t =>
      t.status === 'blocked' || t.blockedBy?.length
    ).length;
    const rate = dateTasks.length > 0 ? (blockedCount / dateTasks.length) * 100 : 0;

    points.push({
      date,
      value: Math.round(rate),
    });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get priority distribution over time
 */
export function getPriorityDistributionTrend(
  tasks: UnifiedTask[],
  days: number = 30
): Array<{ date: string; critical: number; high: number; medium: number; low: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recentTasks = tasks.filter(t => t.createdAt >= cutoff);
  const grouped = groupByDate(recentTasks, t => t.createdAt);

  const points: Array<{ date: string; critical: number; high: number; medium: number; low: number }> = [];

  for (const [date, dateTasks] of grouped) {
    points.push({
      date,
      critical: dateTasks.filter(t => t.priority === 'critical').length,
      high: dateTasks.filter(t => t.priority === 'high').length,
      medium: dateTasks.filter(t => t.priority === 'medium').length,
      low: dateTasks.filter(t => t.priority === 'low').length,
    });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Calculate overall quality metrics for a period
 */
export function calculateQualityMetrics(
  tasks: UnifiedTask[],
  periodDays: number = 7
): QualityMetrics {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);

  const periodTasks = tasks.filter(t =>
    t.updatedAt >= startDate && t.updatedAt <= endDate
  );

  const completedTasks = periodTasks.filter(t => t.status === 'completed');

  // Calculate average cycle time
  const cycleTimes = completedTasks
    .map(t => calculateCycleTime(t))
    .filter((ct): ct is number => ct !== null);

  const avgCycleTime = cycleTimes.length > 0
    ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
    : 0;

  // Priority breakdown
  const priorityBreakdown: Record<TaskPriority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const task of completedTasks) {
    priorityBreakdown[task.priority]++;
  }

  // Blocker rate
  const blockedTasks = periodTasks.filter(t => t.blockedBy?.length || t.status === 'blocked');
  const blockerRate = periodTasks.length > 0
    ? (blockedTasks.length / periodTasks.length) * 100
    : 0;

  // Velocity trend (compare to previous period)
  const prevStartDate = new Date(startDate);
  prevStartDate.setDate(prevStartDate.getDate() - periodDays);

  const prevPeriodCompleted = tasks.filter(t =>
    t.status === 'completed' &&
    t.implementation?.completedAt &&
    t.implementation.completedAt >= prevStartDate &&
    t.implementation.completedAt < startDate
  ).length;

  let velocityTrend: 'increasing' | 'stable' | 'decreasing' = 'stable';
  if (completedTasks.length > prevPeriodCompleted * 1.1) {
    velocityTrend = 'increasing';
  } else if (completedTasks.length < prevPeriodCompleted * 0.9) {
    velocityTrend = 'decreasing';
  }

  return {
    period: periodDays === 1 ? 'day' : periodDays === 7 ? 'week' : 'month',
    startDate,
    endDate,
    tasksCompleted: completedTasks.length,
    averageCycleTimeDays: Math.round(avgCycleTime * 10) / 10,
    priorityBreakdown,
    blockerRate: Math.round(blockerRate),
    velocityTrend,
  };
}

/**
 * Get comprehensive trend analysis
 */
export function getTrendAnalysis(tasks: UnifiedTask[], days: number = 30): TrendAnalysis {
  return {
    completionVelocity: getCompletionVelocity(tasks, days),
    averageCycleTime: getCycleTimeTrend(tasks, days),
    blockerRate: getBlockerRateTrend(tasks, days),
    priorityDistribution: getPriorityDistributionTrend(tasks, days),
  };
}

/**
 * Generate quality insights and recommendations
 */
/**
 * NOTE: Task IDs are included in recommendations for agent reliability
 * (AX "Structure > Instruction" principle)
 */
export function generateQualityInsights(tasks: UnifiedTask[]): QualityInsights {
  const weekMetrics = calculateQualityMetrics(tasks, 7);
  const monthMetrics = calculateQualityMetrics(tasks, 30);

  const highlights: string[] = [];
  const concerns: string[] = [];
  const recommendations: string[] = [];

  // Find current blockers and stale tasks for ID inclusion
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  const staleTasks = tasks.filter(t => {
    const ageInDays = (Date.now() - t.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return t.status === 'ready' && ageInDays > 14;
  });
  const criticalTasks = tasks.filter(t => t.priority === 'critical' && t.status !== 'completed');

  // Velocity analysis
  if (weekMetrics.velocityTrend === 'increasing') {
    highlights.push(`Velocity increasing: ${weekMetrics.tasksCompleted} tasks this week`);
  } else if (weekMetrics.velocityTrend === 'decreasing') {
    concerns.push('Velocity decreasing compared to last week');
    if (blockedTasks.length > 0) {
      const ids = blockedTasks.slice(0, 3).map(t => t.id).join(', ');
      recommendations.push(`Review blockers to improve throughput: ${ids}`);
    } else {
      recommendations.push('Review blockers and priorities to improve throughput');
    }
  }

  // Cycle time analysis
  if (weekMetrics.averageCycleTimeDays < 2) {
    highlights.push(`Fast cycle time: ${weekMetrics.averageCycleTimeDays} days average`);
  } else if (weekMetrics.averageCycleTimeDays > 7) {
    concerns.push(`Slow cycle time: ${weekMetrics.averageCycleTimeDays} days average`);
    if (staleTasks.length > 0) {
      const ids = staleTasks.slice(0, 3).map(t => t.id).join(', ');
      recommendations.push(`Break down stale tasks into smaller deliverables: ${ids}`);
    } else {
      recommendations.push('Break down large tasks into smaller deliverables');
    }
  }

  // Blocker analysis
  if (weekMetrics.blockerRate > 30) {
    if (blockedTasks.length > 0) {
      const ids = blockedTasks.slice(0, 3).map(t => t.id).join(', ');
      concerns.push(`High blocker rate: ${weekMetrics.blockerRate}% - blocked: ${ids}`);
    } else {
      concerns.push(`High blocker rate: ${weekMetrics.blockerRate}% of tasks blocked`);
    }
    recommendations.push('Review dependency chains and improve task sequencing');
  } else if (weekMetrics.blockerRate < 10) {
    highlights.push(`Low blocker rate: ${weekMetrics.blockerRate}%`);
  }

  // Priority balance
  const criticalPct = weekMetrics.priorityBreakdown.critical /
    (weekMetrics.tasksCompleted || 1) * 100;

  if (criticalPct > 40) {
    if (criticalTasks.length > 0) {
      const ids = criticalTasks.slice(0, 3).map(t => t.id).join(', ');
      concerns.push(`High proportion of critical tasks - review: ${ids}`);
    } else {
      concerns.push('High proportion of critical tasks - consider strategic review');
    }
  }

  // Calculate health score (0-100)
  let healthScore = 70; // Base score

  // Velocity impact
  if (weekMetrics.velocityTrend === 'increasing') healthScore += 10;
  if (weekMetrics.velocityTrend === 'decreasing') healthScore -= 15;

  // Cycle time impact
  if (weekMetrics.averageCycleTimeDays < 2) healthScore += 10;
  if (weekMetrics.averageCycleTimeDays > 7) healthScore -= 15;

  // Blocker impact
  if (weekMetrics.blockerRate < 10) healthScore += 10;
  if (weekMetrics.blockerRate > 30) healthScore -= 20;

  // Clamp to 0-100
  healthScore = Math.max(0, Math.min(100, healthScore));

  // Generate summary
  const summary = healthScore >= 80
    ? 'Project quality is excellent with good velocity and low blockers.'
    : healthScore >= 60
    ? 'Project quality is acceptable but could use some improvements.'
    : healthScore >= 40
    ? 'Project quality needs attention - review blockers and task sizing.'
    : 'Project quality is concerning - immediate review recommended.';

  return {
    summary,
    highlights,
    concerns,
    recommendations,
    healthScore,
  };
}

/**
 * Format trend data as ASCII chart for CLI display
 */
export function formatTrendChart(points: TimeSeriesPoint[], width: number = 40): string {
  if (points.length === 0) return 'No data available';

  const values = points.map(p => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const lines: string[] = [];

  // Header
  lines.push(`Max: ${max} | Min: ${min}`);
  lines.push('');

  // Simple sparkline-style chart
  const barChars = '▁▂▃▄▅▆▇█';
  const sparkline = values.map(v => {
    const normalized = (v - min) / range;
    const index = Math.floor(normalized * (barChars.length - 1));
    return barChars[index];
  }).join('');

  lines.push(sparkline);
  lines.push('');
  lines.push(`${points[0].date} → ${points[points.length - 1].date}`);

  return lines.join('\n');
}

/**
 * Get comparative metrics between two periods
 */
export function compareMetrics(
  tasks: UnifiedTask[],
  period1Days: number,
  period2Days: number
): {
  period1: QualityMetrics;
  period2: QualityMetrics;
  changes: {
    velocityChange: number;
    cycleTimeChange: number;
    blockerRateChange: number;
  };
} {
  const period1 = calculateQualityMetrics(tasks, period1Days);

  // Shift dates for period2
  const shiftedTasks = tasks.map(t => ({
    ...t,
    createdAt: new Date(t.createdAt.getTime() - period1Days * 24 * 60 * 60 * 1000),
    updatedAt: new Date(t.updatedAt.getTime() - period1Days * 24 * 60 * 60 * 1000),
    implementation: t.implementation ? {
      ...t.implementation,
      startedAt: t.implementation.startedAt
        ? new Date(t.implementation.startedAt.getTime() - period1Days * 24 * 60 * 60 * 1000)
        : undefined,
      completedAt: t.implementation.completedAt
        ? new Date(t.implementation.completedAt.getTime() - period1Days * 24 * 60 * 60 * 1000)
        : undefined,
    } : undefined,
  }));

  const period2 = calculateQualityMetrics(shiftedTasks, period2Days);

  return {
    period1,
    period2,
    changes: {
      velocityChange: period1.tasksCompleted - period2.tasksCompleted,
      cycleTimeChange: period1.averageCycleTimeDays - period2.averageCycleTimeDays,
      blockerRateChange: period1.blockerRate - period2.blockerRate,
    },
  };
}
