/**
 * Insight Loop — Self-Updating Agent Loop
 *
 * Wires the event orchestrator to the learning engine so that
 * recommendations, friction alerts, and quality insights are
 * surfaced automatically — not just on manual `enginehaus analyze`.
 *
 * Three capabilities:
 * 1. Event subscribers that trigger micro-analysis on key events
 * 2. Recommendation-to-task auto-creation pipeline
 * 3. Insight generation for session briefings
 */

import { EventOrchestrator, TaskEventPayload, QualityEventPayload, SessionEventPayload } from '../events/event-orchestrator.js';
import { LearningEngine, Recommendation } from './learning-engine.js';
import type { CoordinationService } from '../core/services/coordination-service.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';

// ============================================================================
// Types
// ============================================================================

export interface InsightSummary {
  recommendations: Recommendation[];
  frictionTrend: {
    avgProductivity: number | null;
    topFrictionTags: Array<{ tag: string; count: number }>;
  } | null;
  staleInitiatives: Array<{
    title: string;
    daysSinceLastCompletion: number | null;
    linkedTaskCount: number;
  }>;
  generatedAt: Date;
}

export interface InsightLoopOptions {
  /** Enable recommendation-to-task auto-creation (default: true) */
  autoCreateTasks?: boolean;
  /** Max auto-created tasks per analysis run (default: 3) */
  maxAutoTasks?: number;
  /** Lookback period in days for analysis (default: 30) */
  lookbackDays?: number;
}

// Marker prefix for auto-generated task descriptions (for deduplication)
const AUTO_INSIGHT_MARKER = '[auto-insight]';

// ============================================================================
// Insight Loop
// ============================================================================

export class InsightLoop {
  private engine: LearningEngine;
  private subscriptionIds: string[] = [];
  private options: Required<InsightLoopOptions>;
  private events: EventOrchestrator | null;
  private coordination: CoordinationService | null;

  constructor(
    private storage: StorageAdapter,
    deps?: {
      events?: EventOrchestrator;
      coordination?: CoordinationService;
    },
    options: InsightLoopOptions = {}
  ) {
    this.engine = new LearningEngine(storage);
    this.events = deps?.events ?? null;
    this.coordination = deps?.coordination ?? null;
    this.options = {
      autoCreateTasks: options.autoCreateTasks ?? true,
      maxAutoTasks: options.maxAutoTasks ?? 3,
      lookbackDays: options.lookbackDays ?? 30,
    };
  }

  /**
   * Create an InsightLoop for briefing-only use (no event subscriptions).
   */
  static forBriefing(storage: StorageAdapter, options?: InsightLoopOptions): InsightLoop {
    return new InsightLoop(storage, undefined, options);
  }

  /**
   * Activate the insight loop — subscribe to events and start listening.
   * Call this once during server/CLI initialization.
   * Requires events and coordination dependencies.
   */
  activate(): void {
    if (!this.events) throw new Error('InsightLoop.activate() requires an EventOrchestrator');
    if (!this.coordination) throw new Error('InsightLoop.activate() requires a CoordinationService');

    const events = this.events;

    // 1. Quality gate failures → analyze quality trends
    const qualitySubId = events.subscribe(
      ['quality.gate_failed'],
      async (event) => {
        await this.onQualityGateFailed(event as QualityEventPayload);
      }
    );
    this.subscriptionIds.push(qualitySubId);

    // 2. Task released (abandoned) → check for abandonment patterns
    const releaseSubId = events.subscribe(
      ['task.released'],
      async (event) => {
        await this.onTaskReleased(event as TaskEventPayload);
      }
    );
    this.subscriptionIds.push(releaseSubId);

    // 3. Task completed → run post-completion micro-analysis
    const completeSubId = events.subscribe(
      ['task.completed'],
      async (event) => {
        await this.onTaskCompleted(event as TaskEventPayload);
      }
    );
    this.subscriptionIds.push(completeSubId);

    // 4. Session completed → generate recommendations for next session
    const sessionSubId = events.subscribe(
      ['session.completed'],
      async (event) => {
        await this.onSessionCompleted(event as SessionEventPayload);
      }
    );
    this.subscriptionIds.push(sessionSubId);
  }

  /**
   * Deactivate the insight loop — unsubscribe from all events.
   */
  deactivate(): void {
    if (this.events) {
      for (const id of this.subscriptionIds) {
        this.events.unsubscribe(id);
      }
    }
    this.subscriptionIds = [];
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private async onQualityGateFailed(event: QualityEventPayload): Promise<void> {
    try {
      const quality = await this.engine.analyzeQualityTrends({
        since: this.lookbackDate(),
      });

      // If pass rate has dropped below 70%, create a task to investigate
      if (quality.gatePassRate < 0.7 && quality.totalGateEvents >= 5 && this.options.autoCreateTasks) {
        await this.createInsightTask({
          title: `Investigate low quality gate pass rate (${(quality.gatePassRate * 100).toFixed(0)}%)`,
          description: `Quality gate pass rate is ${(quality.gatePassRate * 100).toFixed(0)}% over the last ${this.options.lookbackDays} days (${quality.totalGateEvents} events). Review whether gates are too strict or agents need better guidance.`,
          priority: 'high',
          deduplicationKey: 'low-quality-gate-rate',
        });
      }
    } catch (err) {
      // Insight loop errors should never break the main flow
      console.error('[insight-loop] Error in onQualityGateFailed:', err);
    }
  }

  private async onTaskReleased(event: TaskEventPayload): Promise<void> {
    try {
      // Count recent releases (potential abandonment pattern)
      const since = this.lookbackDate();
      const recentEvents = this.events!.getRecentEvents({
        eventTypes: ['task.released'],
        since,
      });

      // 3+ releases in the lookback period is a pattern worth flagging
      if (recentEvents.length >= 3 && this.options.autoCreateTasks) {
        await this.createInsightTask({
          title: `Task abandonment pattern detected (${recentEvents.length} releases in ${this.options.lookbackDays}d)`,
          description: `${recentEvents.length} tasks were released/abandoned in the last ${this.options.lookbackDays} days. Review if tasks are poorly scoped, blocked by missing context, or need decomposition.`,
          priority: 'medium',
          deduplicationKey: 'task-abandonment-pattern',
        });
      }
    } catch (err) {
      console.error('[insight-loop] Error in onTaskReleased:', err);
    }
  }

  private async onTaskCompleted(event: TaskEventPayload): Promise<void> {
    try {
      const task = event.task;

      // 1. Check if decisions were logged during this task
      const decisions = await this.storage.getDecisions({
        taskId: task.id,
      });

      if (decisions.length === 0) {
        // Log a metric for tracking — the aggregate will be caught by generateRecommendations()
        await this.storage.logMetric({
          eventType: 'quality_gate_failed',
          projectId: task.projectId,
          taskId: task.id,
          metadata: { gate: 'decision_logging', reason: 'No decisions logged during task' },
        });
      }

      // 2. Post-completion reflection: compare decisions against related learnings
      if (decisions.length > 0 && this.coordination) {
        await this.reflectOnCompletion(task.id, task.projectId, decisions);
      }

      // 3. Check friction thresholds after each completion
      if (this.options.autoCreateTasks) {
        await this.checkFrictionThresholds();
      }
    } catch (err) {
      console.error('[insight-loop] Error in onTaskCompleted:', err);
    }
  }

  private async onSessionCompleted(_event: SessionEventPayload): Promise<void> {
    try {
      // Generate recommendations and auto-create tasks for high-priority ones
      if (this.options.autoCreateTasks) {
        const recommendations = await this.engine.generateRecommendations({
          since: this.lookbackDate(),
        });

        const highPriority = recommendations.filter(r => r.priority === 'high');
        let created = 0;

        for (const rec of highPriority) {
          if (created >= this.options.maxAutoTasks) break;

          const didCreate = await this.createInsightTask({
            title: rec.title,
            description: `${rec.description}\n\nEvidence: ${rec.evidence}`,
            priority: rec.priority === 'high' ? 'high' : 'medium',
            deduplicationKey: `rec-${rec.type}-${rec.title.slice(0, 50)}`,
          });

          if (didCreate) created++;
        }
      }
    } catch (err) {
      console.error('[insight-loop] Error in onSessionCompleted:', err);
    }
  }

  // ============================================================================
  // Insight Generation (for briefings)
  // ============================================================================

  /**
   * Generate insights for inclusion in session briefings.
   * This is called by the `enginehaus briefing` command.
   */
  async generateInsights(): Promise<InsightSummary> {
    const since = this.lookbackDate();

    const [recommendations, friction, initiatives] = await Promise.all([
      this.engine.generateRecommendations({ since }),
      this.engine.analyzeFrictionPatterns({ since }),
      this.getStaleInitiatives(),
    ]);

    // Only surface top 3 recommendations
    const topRecommendations = recommendations.slice(0, 3);

    const frictionTrend = friction.totalFeedback > 0
      ? {
          avgProductivity: friction.avgProductivityRating,
          topFrictionTags: friction.topFriction.slice(0, 3),
        }
      : null;

    return {
      recommendations: topRecommendations,
      frictionTrend,
      staleInitiatives: initiatives,
      generatedAt: new Date(),
    };
  }

  /**
   * Format insights as text for CLI briefing output.
   */
  formatInsights(insights: InsightSummary): string {
    const lines: string[] = [];
    const BOLD = '\x1b[1m';
    const RESET = '\x1b[0m';
    const DIM = '\x1b[2m';
    const YELLOW = '\x1b[33m';
    const RED = '\x1b[31m';

    const hasContent = insights.recommendations.length > 0
      || insights.frictionTrend !== null
      || insights.staleInitiatives.length > 0;

    if (!hasContent) return '';

    lines.push(`${BOLD}═══ LEARNING ENGINE INSIGHTS ═══${RESET}`);
    lines.push('');

    // Recommendations
    if (insights.recommendations.length > 0) {
      lines.push(`${BOLD}Top Recommendations:${RESET}`);
      for (const rec of insights.recommendations) {
        const icon = rec.priority === 'high' ? RED : YELLOW;
        lines.push(`  ${icon}[${rec.priority}]${RESET} ${rec.title}`);
        lines.push(`  ${DIM}${rec.description.slice(0, 100)}${RESET}`);
      }
      lines.push('');
    }

    // Friction trends
    if (insights.frictionTrend) {
      const ft = insights.frictionTrend;
      const ratingStr = ft.avgProductivity !== null
        ? `${ft.avgProductivity.toFixed(1)}/5`
        : 'no data';
      lines.push(`${BOLD}Friction:${RESET} Productivity ${ratingStr}`);
      if (ft.topFrictionTags.length > 0) {
        const tags = ft.topFrictionTags.map(t => `${t.tag}(${t.count})`).join(', ');
        lines.push(`  ${DIM}Top sources: ${tags}${RESET}`);
      }
      lines.push('');
    }

    // Stale initiatives
    if (insights.staleInitiatives.length > 0) {
      lines.push(`${BOLD}Stale Initiatives:${RESET}`);
      for (const init of insights.staleInitiatives) {
        const daysStr = init.daysSinceLastCompletion !== null
          ? `${init.daysSinceLastCompletion}d since last completion`
          : 'no completions yet';
        lines.push(`  ${YELLOW}!${RESET} ${init.title} ${DIM}(${daysStr}, ${init.linkedTaskCount} tasks)${RESET}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Post-Completion Reflection
  // ============================================================================

  /**
   * After a task completes, compare the decisions logged against
   * what the learning engine would have recommended. Logs a metric
   * capturing the "reflection" for future analysis.
   */
  private async reflectOnCompletion(
    taskId: string,
    projectId: string,
    decisions: Array<{ decision: string; rationale?: string; category?: string }>
  ): Promise<void> {
    try {
      // Get related learnings that were available at claim time
      const result = await this.coordination!.getRelatedLearnings(taskId);

      // Count how many related decisions existed
      const relatedDecisionCount = result.learnings.fromCompletedTasks.reduce(
        (sum: any, t: any) => sum + t.decisions.length, 0
      );
      const relatedRecommendations = result.learnings.recommendations?.length ?? 0;

      // Log the reflection as a metric for trend analysis
      await this.storage.logMetric({
        eventType: 'task_completed',
        projectId,
        taskId,
        metadata: {
          reflection: true,
          decisionsLogged: decisions.length,
          relatedDecisionsAvailable: relatedDecisionCount,
          relatedRecommendationsAvailable: relatedRecommendations,
          decisionCategories: [...new Set(decisions.map(d => d.category).filter(Boolean))],
        },
      });
    } catch {
      // Reflection is best-effort — don't break completion
    }
  }

  // ============================================================================
  // Friction Threshold Alerting
  // ============================================================================

  /**
   * Check if any friction tag has crossed the alert threshold (3+ in 7 days).
   * If so, auto-create a task to investigate and fix the root cause.
   */
  private async checkFrictionThresholds(): Promise<void> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const friction = await this.engine.analyzeFrictionPatterns({ since: sevenDaysAgo });

      for (const tag of friction.topFriction) {
        if (tag.count >= 3) {
          await this.createInsightTask({
            title: `Recurring friction: "${tag.tag}" reported ${tag.count} times in 7 days`,
            description: `The friction tag "${tag.tag}" has been reported ${tag.count} times in the last 7 days (${tag.percentage}% of all friction). This indicates a systemic issue that should be investigated and fixed structurally.`,
            priority: tag.count >= 5 ? 'high' : 'medium',
            deduplicationKey: `friction-threshold-${tag.tag}`,
          });
        }
      }
    } catch {
      // Friction check is best-effort
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private lookbackDate(): Date {
    return new Date(Date.now() - this.options.lookbackDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Create a task from an insight, with deduplication.
   * Returns true if a task was created, false if duplicate detected.
   */
  private async createInsightTask(params: {
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    deduplicationKey: string;
  }): Promise<boolean> {
    // Check for existing non-completed task with the same dedup key
    const projectId = this.storage.getActiveProjectIdOrDefault();
    const existingTasks = await this.storage.getTasks({ projectId });

    const markedDescription = `${AUTO_INSIGHT_MARKER}[${params.deduplicationKey}] ${params.description}`;

    const duplicate = existingTasks.find(t =>
      t.status !== 'completed' &&
      t.description.includes(`${AUTO_INSIGHT_MARKER}[${params.deduplicationKey}]`)
    );

    if (duplicate) return false;

    await this.coordination!.createTask({
      title: params.title,
      description: markedDescription,
      priority: params.priority,
      projectId,
    });

    return true;
  }

  /**
   * Find active initiatives that look stale (created 7+ days ago with linked tasks).
   */
  private async getStaleInitiatives(): Promise<InsightSummary['staleInitiatives']> {
    try {
      const activeInitiatives = await this.storage.listInitiatives({ status: 'active' });
      const stale: InsightSummary['staleInitiatives'] = [];
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      for (const init of activeInitiatives) {
        // An initiative is "stale" if it was created 7+ days ago and has linked tasks
        if (init.taskCount > 0 && new Date(init.createdAt) < sevenDaysAgo) {
          const daysSinceCreation = Math.floor(
            (Date.now() - new Date(init.createdAt).getTime()) / (24 * 60 * 60 * 1000)
          );
          stale.push({
            title: init.title,
            daysSinceLastCompletion: daysSinceCreation,
            linkedTaskCount: init.taskCount,
          });
        }
      }

      return stale;
    } catch {
      // Initiative queries may fail if no initiatives exist — that's fine
      return [];
    }
  }
}
