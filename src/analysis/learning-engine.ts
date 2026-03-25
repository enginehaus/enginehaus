/**
 * Cross-Project Learning Engine
 *
 * Aggregates decisions, outcomes, friction, and quality data across all projects
 * to surface organizational learnings and actionable recommendations.
 *
 * This is the "worldview" — the thing that turns individual project data
 * into organizational wisdom.
 */

import type { StorageAdapter } from '../storage/storage-adapter.js';

// ============================================================================
// Types
// ============================================================================

export interface DecisionPattern {
  category: string;
  count: number;
  projects: string[];
  /** Decisions containing workaround/friction language */
  workaroundSignals: number;
  recentExamples: Array<{
    decision: string;
    rationale?: string;
    projectId: string;
    createdAt: Date;
  }>;
}

export interface FrictionAnalysis {
  totalFeedback: number;
  avgProductivityRating: number | null;
  tagCounts: Record<string, number>;
  topFriction: Array<{
    tag: string;
    count: number;
    percentage: number;
  }>;
  projectBreakdown: Record<string, {
    feedbackCount: number;
    avgRating: number | null;
    topTag: string | null;
  }>;
}

export interface QualityTrends {
  gatePassRate: number;
  totalGateEvents: number;
  reworkRate: number;
  shipRate: number;
  decisionLoggingRate: number;
  failureBreakdown: Record<string, number>;
  projectComparison: Array<{
    projectId: string;
    projectName: string;
    gatePassRate: number;
    decisionRate: number;
    completionRate: number;
  }>;
}

export interface InitiativeLearnings {
  totalInitiatives: number;
  successRate: number;
  succeeded: Array<{ title: string; outcomeNotes?: string; taskCount: number }>;
  failed: Array<{ title: string; outcomeNotes?: string; taskCount: number }>;
  patterns: string[];
}

export interface Recommendation {
  type: 'structural_check' | 'error_message' | 'workflow_automation' | 'cross_project_learning' | 'documentation_gap';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: string;
}

export interface Worldview {
  generatedAt: Date;
  projectCount: number;
  totalDecisions: number;
  totalTasks: number;
  totalInitiatives: number;
  health: 'healthy' | 'needs_attention' | 'at_risk';
  healthReasons: string[];
  decisionPatterns: DecisionPattern[];
  friction: FrictionAnalysis;
  quality: QualityTrends;
  initiatives: InitiativeLearnings;
  recommendations: Recommendation[];
}

// ============================================================================
// Learning Engine
// ============================================================================

export class LearningEngine {
  constructor(private storage: StorageAdapter) {}

  /**
   * Analyze decision patterns across all projects.
   * Finds common categories, workaround language, and cross-project trends.
   */
  async analyzeDecisionPatterns(options: {
    since?: Date;
    limit?: number;
  } = {}): Promise<DecisionPattern[]> {
    const since = options.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    const limit = options.limit || 500;

    // Get all decisions across projects
    const decisions = await this.storage.getDecisions({ since, limit });

    // Group by category
    const byCategory = new Map<string, typeof decisions>();
    for (const d of decisions) {
      const cat = d.category || 'uncategorized';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(d);
    }

    // Workaround signal words
    const workaroundSignals = [
      'workaround', 'hack', 'temporary', 'had to', 'forced to',
      'no other way', 'limitation', 'worked around', 'bypass',
    ];

    const patterns: DecisionPattern[] = [];
    for (const [category, categoryDecisions] of byCategory) {
      const projects = [...new Set(categoryDecisions.map(d => d.projectId))];
      const workaroundCount = categoryDecisions.filter(d => {
        const text = `${d.decision} ${d.rationale || ''}`.toLowerCase();
        return workaroundSignals.some(signal => text.includes(signal));
      }).length;

      patterns.push({
        category,
        count: categoryDecisions.length,
        projects,
        workaroundSignals: workaroundCount,
        recentExamples: categoryDecisions.slice(0, 3).map(d => ({
          decision: d.decision,
          rationale: d.rationale,
          projectId: d.projectId,
          createdAt: d.createdAt,
        })),
      });
    }

    // Sort by count descending
    patterns.sort((a, b) => b.count - a.count);
    return patterns;
  }

  /**
   * Analyze friction patterns from session feedback across all projects.
   */
  async analyzeFrictionPatterns(options: {
    since?: Date;
  } = {}): Promise<FrictionAnalysis> {
    const since = options.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const feedback = await this.storage.getSessionFeedback({ since });

    if (feedback.length === 0) {
      return {
        totalFeedback: 0,
        avgProductivityRating: null,
        tagCounts: {},
        topFriction: [],
        projectBreakdown: {},
      };
    }

    // Aggregate friction tags
    const tagCounts: Record<string, number> = {};
    let ratingSum = 0;
    let ratingCount = 0;

    const projectData = new Map<string, {
      feedbackCount: number;
      ratingSum: number;
      ratingCount: number;
      tagCounts: Record<string, number>;
    }>();

    for (const fb of feedback) {
      if (fb.productivityRating) {
        ratingSum += fb.productivityRating;
        ratingCount++;
      }

      for (const tag of fb.frictionTags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }

      // Per-project tracking
      if (!projectData.has(fb.projectId)) {
        projectData.set(fb.projectId, {
          feedbackCount: 0, ratingSum: 0, ratingCount: 0, tagCounts: {},
        });
      }
      const pd = projectData.get(fb.projectId)!;
      pd.feedbackCount++;
      if (fb.productivityRating) {
        pd.ratingSum += fb.productivityRating;
        pd.ratingCount++;
      }
      for (const tag of fb.frictionTags) {
        pd.tagCounts[tag] = (pd.tagCounts[tag] || 0) + 1;
      }
    }

    // Build top friction list
    const totalTags = Object.values(tagCounts).reduce((a, b) => a + b, 0);
    const topFriction = Object.entries(tagCounts)
      .map(([tag, count]) => ({
        tag,
        count,
        percentage: totalTags > 0 ? Math.round((count / totalTags) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Build project breakdown
    const projectBreakdown: Record<string, {
      feedbackCount: number;
      avgRating: number | null;
      topTag: string | null;
    }> = {};

    for (const [projectId, pd] of projectData) {
      const topTag = Object.entries(pd.tagCounts).sort((a, b) => b[1] - a[1])[0];
      projectBreakdown[projectId] = {
        feedbackCount: pd.feedbackCount,
        avgRating: pd.ratingCount > 0 ? pd.ratingSum / pd.ratingCount : null,
        topTag: topTag ? topTag[0] : null,
      };
    }

    return {
      totalFeedback: feedback.length,
      avgProductivityRating: ratingCount > 0 ? ratingSum / ratingCount : null,
      tagCounts,
      topFriction,
      projectBreakdown,
    };
  }

  /**
   * Analyze quality trends across projects.
   */
  async analyzeQualityTrends(options: {
    since?: Date;
  } = {}): Promise<QualityTrends> {
    const since = options.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get metrics for quality gate events
    const metricsResult = await this.storage.getMetrics({
      since,
      eventTypes: ['quality_gate_passed', 'quality_gate_failed'],
    });
    const metrics = metricsResult.events;

    const passed = metrics.filter((m: { eventType: string }) => m.eventType === 'quality_gate_passed').length;
    const failed = metrics.filter((m: { eventType: string }) => m.eventType === 'quality_gate_failed').length;
    const totalGateEvents = passed + failed;
    const gatePassRate = totalGateEvents > 0 ? passed / totalGateEvents : 0;

    // Build failure breakdown from metadata (if available)
    const failureBreakdown: Record<string, number> = {};
    const failedEvents = metrics.filter((m: { eventType: string }) => m.eventType === 'quality_gate_failed');
    for (const event of failedEvents) {
      const meta = event.metadata as Record<string, unknown> | undefined;
      const reasons = (meta?.gapReasons as string[]) || ['uncategorized-legacy'];
      for (const reason of reasons) {
        failureBreakdown[reason] = (failureBreakdown[reason] || 0) + 1;
      }
    }

    // Get all projects for comparison
    const projects = await this.storage.listProjects();
    const projectComparison: QualityTrends['projectComparison'] = [];

    // Get all decisions across projects for decision rate
    const allDecisions = await this.storage.getDecisions({ since, limit: 1000 });
    const decisionsByProject = new Map<string, number>();
    for (const d of allDecisions) {
      decisionsByProject.set(d.projectId, (decisionsByProject.get(d.projectId) || 0) + 1);
    }

    for (const project of projects) {
      if (project.status !== 'active') continue;

      const projectMetrics = metrics.filter((m: { projectId: string }) => m.projectId === project.id);
      const projectPassed = projectMetrics.filter((m: { eventType: string }) => m.eventType === 'quality_gate_passed').length;
      const projectTotal = projectMetrics.length;

      // Get task counts for this project
      const tasks = await this.storage.getTasks({ projectId: project.id });
      const completed = tasks.filter(t => t.status === 'completed').length;
      const total = tasks.length;

      projectComparison.push({
        projectId: project.id,
        projectName: project.name,
        gatePassRate: projectTotal > 0 ? projectPassed / projectTotal : 0,
        decisionRate: total > 0 ? (decisionsByProject.get(project.id) || 0) / total : 0,
        completionRate: total > 0 ? completed / total : 0,
      });
    }

    // Get outcome metrics for rework/ship rates
    const outcomes = await this.storage.getOutcomeMetrics({ since });

    return {
      gatePassRate,
      totalGateEvents,
      failureBreakdown,
      reworkRate: outcomes.reworkRate,
      shipRate: outcomes.shipRate,
      decisionLoggingRate: allDecisions.length,
      projectComparison,
    };
  }

  /**
   * Analyze initiative outcomes for organizational learning.
   */
  async analyzeInitiativeOutcomes(): Promise<InitiativeLearnings> {
    const learnings = await this.storage.getInitiativeLearnings({});

    const patterns: string[] = [];

    // Detect patterns from succeeded vs failed
    if (learnings.succeededInitiatives.length > 0) {
      const avgSuccessTaskCount = learnings.succeededInitiatives
        .reduce((sum, i) => sum + i.taskCount, 0) / learnings.succeededInitiatives.length;
      patterns.push(`Successful initiatives average ${avgSuccessTaskCount.toFixed(1)} tasks`);
    }

    if (learnings.failedInitiatives.length > 0) {
      const avgFailTaskCount = learnings.failedInitiatives
        .reduce((sum, i) => sum + i.taskCount, 0) / learnings.failedInitiatives.length;
      patterns.push(`Failed initiatives average ${avgFailTaskCount.toFixed(1)} tasks`);

      // Check if failed initiatives tend to be larger
      if (learnings.succeededInitiatives.length > 0) {
        const avgSuccessTaskCount = learnings.succeededInitiatives
          .reduce((sum, i) => sum + i.taskCount, 0) / learnings.succeededInitiatives.length;
        if (avgFailTaskCount > avgSuccessTaskCount * 1.5) {
          patterns.push('Failed initiatives tend to be larger — consider breaking down ambitious goals');
        }
      }
    }

    if (learnings.summary.successRate > 0.7) {
      patterns.push('High initiative success rate — good goal-setting discipline');
    } else if (learnings.summary.successRate < 0.3 && learnings.summary.total > 3) {
      patterns.push('Low initiative success rate — consider setting more incremental goals');
    }

    return {
      totalInitiatives: learnings.summary.total,
      successRate: learnings.summary.successRate,
      succeeded: learnings.succeededInitiatives.map(i => ({
        title: i.title,
        outcomeNotes: i.outcomeNotes,
        taskCount: i.taskCount,
      })),
      failed: learnings.failedInitiatives.map(i => ({
        title: i.title,
        outcomeNotes: i.outcomeNotes,
        taskCount: i.taskCount,
      })),
      patterns,
    };
  }

  /**
   * Generate actionable recommendations by synthesizing all analysis.
   */
  async generateRecommendations(options: {
    since?: Date;
  } = {}): Promise<Recommendation[]> {
    const since = options.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [decisionPatterns, friction, quality, initiatives] = await Promise.all([
      this.analyzeDecisionPatterns({ since }),
      this.analyzeFrictionPatterns({ since }),
      this.analyzeQualityTrends({ since }),
      this.analyzeInitiativeOutcomes(),
    ]);

    const recommendations: Recommendation[] = [];

    // 1. Workaround signals → structural check candidates
    for (const pattern of decisionPatterns) {
      if (pattern.workaroundSignals > 0) {
        const ratio = pattern.workaroundSignals / pattern.count;
        if (ratio >= 0.3 || pattern.workaroundSignals >= 3) {
          recommendations.push({
            type: 'structural_check',
            priority: ratio >= 0.5 ? 'high' : 'medium',
            title: `Workaround pattern in "${pattern.category}" decisions`,
            description: `${pattern.workaroundSignals}/${pattern.count} decisions in "${pattern.category}" contain workaround language. This suggests a systemic gap that could be addressed with a structural check.`,
            evidence: pattern.recentExamples.map(e => `"${e.decision}"`).join(', '),
          });
        }
      }
    }

    // 2. Friction patterns → workflow automation candidates
    for (const f of friction.topFriction) {
      if (f.count >= 3) {
        recommendations.push({
          type: 'workflow_automation',
          priority: f.percentage >= 30 ? 'high' : 'medium',
          title: `Recurring friction: ${f.tag}`,
          description: `"${f.tag}" reported ${f.count} times (${f.percentage}% of all friction). Consider automating or eliminating this friction source.`,
          evidence: `${f.count} reports across sessions`,
        });
      }
    }

    // 3. Quality gaps → documentation or enforcement
    if (quality.gatePassRate < 0.7 && quality.totalGateEvents > 5) {
      const breakdownStr = Object.entries(quality.failureBreakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(', ');
      recommendations.push({
        type: 'structural_check',
        priority: 'high',
        title: 'Low quality gate pass rate',
        description: `Only ${(quality.gatePassRate * 100).toFixed(0)}% of quality gate checks pass.${breakdownStr ? ` Failure breakdown: ${breakdownStr}.` : ''} Consider whether gates are too strict or if agents need better guidance.`,
        evidence: `${quality.totalGateEvents} gate events analyzed`,
      });
    }

    // 4. Projects without decisions → documentation gap
    for (const pc of quality.projectComparison) {
      if (pc.decisionRate === 0 && pc.completionRate > 0) {
        recommendations.push({
          type: 'documentation_gap',
          priority: 'medium',
          title: `No decisions logged for "${pc.projectName}"`,
          description: `Project "${pc.projectName}" has completed tasks but no decisions logged. Decision logging captures the "why" and helps future agents.`,
          evidence: `${(pc.completionRate * 100).toFixed(0)}% completion rate, 0 decisions`,
        });
      }
    }

    // 5. Initiative pattern insights
    for (const pattern of initiatives.patterns) {
      if (pattern.includes('Failed initiatives tend to be larger')) {
        recommendations.push({
          type: 'cross_project_learning',
          priority: 'medium',
          title: 'Break down large initiatives',
          description: pattern,
          evidence: `Based on ${initiatives.totalInitiatives} initiatives, ${(initiatives.successRate * 100).toFixed(0)}% success rate`,
        });
      }
    }

    // 6. Low productivity ratings → needs attention
    if (friction.avgProductivityRating !== null && friction.avgProductivityRating < 3.0) {
      recommendations.push({
        type: 'workflow_automation',
        priority: 'high',
        title: 'Low productivity ratings',
        description: `Average productivity rating is ${friction.avgProductivityRating.toFixed(1)}/5. Review top friction sources for improvement opportunities.`,
        evidence: `${friction.totalFeedback} feedback entries`,
      });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return recommendations;
  }

  /**
   * Generate a complete cross-project worldview.
   * This is the high-level organizational health summary.
   */
  async generateWorldview(options: {
    since?: Date;
  } = {}): Promise<Worldview> {
    const since = options.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [decisionPatterns, friction, quality, initiatives, recommendations] = await Promise.all([
      this.analyzeDecisionPatterns({ since }),
      this.analyzeFrictionPatterns({ since }),
      this.analyzeQualityTrends({ since }),
      this.analyzeInitiativeOutcomes(),
      this.generateRecommendations({ since }),
    ]);

    // Get counts
    const projects = await this.storage.listProjects();
    const activeProjects = projects.filter(p => p.status === 'active');
    const totalDecisions = decisionPatterns.reduce((sum, p) => sum + p.count, 0);

    // Count total tasks across projects
    let totalTasks = 0;
    for (const project of activeProjects) {
      const tasks = await this.storage.getTasks({ projectId: project.id });
      totalTasks += tasks.length;
    }

    // Determine health
    const healthReasons: string[] = [];
    let healthScore = 0; // 0 = healthy, negatives = problems

    if (quality.gatePassRate < 0.5 && quality.totalGateEvents > 5) {
      healthReasons.push(`Quality gate pass rate is low (${(quality.gatePassRate * 100).toFixed(0)}%)`);
      healthScore -= 2;
    }

    if (friction.avgProductivityRating !== null && friction.avgProductivityRating < 2.5) {
      healthReasons.push(`Productivity ratings are low (${friction.avgProductivityRating.toFixed(1)}/5)`);
      healthScore -= 2;
    }

    const highPriorityRecs = recommendations.filter(r => r.priority === 'high').length;
    if (highPriorityRecs >= 3) {
      healthReasons.push(`${highPriorityRecs} high-priority recommendations`);
      healthScore -= 1;
    }

    if (initiatives.successRate < 0.3 && initiatives.totalInitiatives > 3) {
      healthReasons.push(`Low initiative success rate (${(initiatives.successRate * 100).toFixed(0)}%)`);
      healthScore -= 1;
    }

    if (healthReasons.length === 0) {
      healthReasons.push('No significant issues detected');
    }

    const health: Worldview['health'] =
      healthScore <= -3 ? 'at_risk' :
      healthScore <= -1 ? 'needs_attention' :
      'healthy';

    return {
      generatedAt: new Date(),
      projectCount: activeProjects.length,
      totalDecisions,
      totalTasks,
      totalInitiatives: initiatives.totalInitiatives,
      health,
      healthReasons,
      decisionPatterns,
      friction,
      quality,
      initiatives,
      recommendations,
    };
  }
}
