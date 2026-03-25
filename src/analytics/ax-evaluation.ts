/**
 * AX Evaluation Framework
 *
 * Defines baselines, thresholds, and interpretation logic for Agent Experience metrics.
 * Turns raw instrumentation data into actionable insights about whether
 * Enginehaus achieves its stated goals.
 *
 * Core Hypothesis: Structure > Instruction
 * - Structural nudges (gates, validators) produce more reliable behavior than documentation
 * - Cross-session learning reduces redundant work
 * - Completion validation catches errors before they propagate
 */

// ============================================================================
// Baseline Definitions
// ============================================================================

/**
 * Baseline measurements establish "where we are now" before interventions.
 * These should be captured when first deploying AX features.
 */
export interface AXBaseline {
  /** When this baseline was captured */
  capturedAt: Date;

  /** Project this baseline applies to */
  projectId: string;

  /** Task Reopen Rate baseline (before completion validation) */
  reopenRate: {
    /** Percentage of completed tasks that were reopened */
    value: number;
    /** Sample size (total completions measured) */
    sampleSize: number;
    /** Period over which baseline was measured */
    periodDays: number;
  };

  /** Decision Duplication Rate baseline (before related learnings) */
  duplicationRate: {
    /** Percentage of decisions with >70% similarity to prior decisions */
    value: number;
    /** Sample size (total decisions measured) */
    sampleSize: number;
    /** Period over which baseline was measured */
    periodDays: number;
  };

  /** Optional: Agent compliance with gates before structural enforcement */
  compliance?: {
    /** Percentage of tasks with decisions logged (before enforcement) */
    decisionLoggingRate: number;
    /** Percentage of tasks with tests (before enforcement) */
    testingRate: number;
  };

  /** Notes about baseline context */
  notes?: string;
}

// ============================================================================
// Success Thresholds
// ============================================================================

/**
 * Success thresholds define what validates our hypotheses.
 * Each threshold has a rationale explaining why it was chosen.
 */
export interface AXThresholds {
  /**
   * Task Reopen Rate thresholds
   * Lower is better - indicates completion validation is catching issues
   */
  reopenRate: {
    /** Above this = concerning, completion validation may be too lenient */
    warning: number;
    /** Below this = good, completion validation is working */
    good: number;
    /** Below this = excellent, very few premature completions */
    excellent: number;
    /** Minimum improvement from baseline to claim success */
    minimumImprovementPercent: number;
  };

  /**
   * Decision Duplication Rate thresholds
   * Lower is better - indicates learnings are being surfaced and used
   */
  duplicationRate: {
    /** Above this = concerning, learnings may not be surfacing */
    warning: number;
    /** Below this = good, agents are building on prior knowledge */
    good: number;
    /** Below this = excellent, minimal redundant decisions */
    excellent: number;
    /** Minimum improvement from baseline to claim success */
    minimumImprovementPercent: number;
  };

  /**
   * Survey Score thresholds (0-1 normalized scale)
   * Higher is better
   */
  surveyScores: {
    /** Below this = needs attention */
    poor: number;
    /** Above this = acceptable */
    acceptable: number;
    /** Above this = good */
    good: number;
    /** Above this = excellent */
    excellent: number;
  };

  /**
   * Minimum sample sizes for statistical validity
   */
  minimumSamples: {
    /** Minimum completions to calculate reopen rate */
    completions: number;
    /** Minimum decisions to calculate duplication rate */
    decisions: number;
    /** Minimum survey responses for category analysis */
    surveyResponses: number;
  };
}

/**
 * Default thresholds based on initial research and industry benchmarks
 */
export const DEFAULT_AX_THRESHOLDS: AXThresholds = {
  reopenRate: {
    warning: 25,      // >25% reopened = problems with completion validation
    good: 15,         // <15% = completion validation is working
    excellent: 5,     // <5% = very reliable completions
    minimumImprovementPercent: 30, // Need 30% improvement over baseline
  },
  duplicationRate: {
    warning: 30,      // >30% duplicate decisions = learnings not surfacing
    good: 15,         // <15% = agents building on prior work
    excellent: 5,     // <5% = excellent knowledge reuse
    minimumImprovementPercent: 25, // Need 25% improvement over baseline
  },
  surveyScores: {
    poor: 0.4,        // <0.4 = needs immediate attention
    acceptable: 0.5,  // 0.5-0.6 = acceptable but room to improve
    good: 0.7,        // 0.7-0.8 = good experience
    excellent: 0.85,  // >0.85 = excellent experience
  },
  minimumSamples: {
    completions: 10,     // Need at least 10 completions for reopen rate
    decisions: 20,       // Need at least 20 decisions for duplication rate
    surveyResponses: 5,  // Need at least 5 surveys for category analysis
  },
};

// ============================================================================
// Interpretation Framework
// ============================================================================

export type MetricStatus = 'excellent' | 'good' | 'acceptable' | 'warning' | 'critical' | 'insufficient_data';

export interface MetricInterpretation {
  status: MetricStatus;
  value: number;
  threshold: string;
  interpretation: string;
  possibleCauses: string[];
  recommendedActions: string[];
}

/**
 * Interpret a reopen rate value against thresholds
 */
export function interpretReopenRate(
  value: number,
  sampleSize: number,
  thresholds: AXThresholds = DEFAULT_AX_THRESHOLDS,
  baseline?: number
): MetricInterpretation {
  // Check sample size
  if (sampleSize < thresholds.minimumSamples.completions) {
    return {
      status: 'insufficient_data',
      value,
      threshold: `Need ${thresholds.minimumSamples.completions} completions`,
      interpretation: `Only ${sampleSize} completions measured. Need more data for reliable analysis.`,
      possibleCauses: [],
      recommendedActions: ['Continue collecting data', 'Check if workflow is being used'],
    };
  }

  let status: MetricStatus;
  let threshold: string;
  let interpretation: string;
  let possibleCauses: string[] = [];
  let recommendedActions: string[] = [];

  if (value <= thresholds.reopenRate.excellent) {
    status = 'excellent';
    threshold = `≤${thresholds.reopenRate.excellent}%`;
    interpretation = 'Completion validation is highly effective. Very few tasks need rework after completion.';
    recommendedActions = ['Document what\'s working', 'Share patterns with other projects'];
  } else if (value <= thresholds.reopenRate.good) {
    status = 'good';
    threshold = `≤${thresholds.reopenRate.good}%`;
    interpretation = 'Completion validation is working well. Most completions are final.';
    recommendedActions = ['Monitor for changes', 'Review any reopened tasks for patterns'];
  } else if (value <= thresholds.reopenRate.warning) {
    status = 'acceptable';
    threshold = `≤${thresholds.reopenRate.warning}%`;
    interpretation = 'Completion validation is functioning but there\'s room for improvement.';
    possibleCauses = [
      'Completion checklist may be too lenient',
      'Tasks may lack clear acceptance criteria',
      'Agents may be rushing to complete',
    ];
    recommendedActions = [
      'Review completion validation thresholds',
      'Improve task descriptions with clearer acceptance criteria',
      'Check if quality gates are being run before completion',
    ];
  } else {
    status = 'warning';
    threshold = `>${thresholds.reopenRate.warning}%`;
    interpretation = 'High reopen rate indicates completion validation needs attention.';
    possibleCauses = [
      'Completion validation may be too lenient or disabled',
      'Tasks may be poorly specified',
      'Agents may not understand completion criteria',
      'Quality gates may not be enforced',
    ];
    recommendedActions = [
      'Enable or strengthen completion validation',
      'Review and improve task specifications',
      'Add explicit acceptance criteria to task templates',
      'Enable quality enforcement on completion',
      'Review specific reopened tasks to identify patterns',
    ];
  }

  // Add baseline comparison if available
  if (baseline !== undefined && baseline > 0) {
    const improvement = ((baseline - value) / baseline) * 100;
    if (improvement >= thresholds.reopenRate.minimumImprovementPercent) {
      interpretation += ` ${Math.round(improvement)}% improvement from baseline (${baseline}% → ${value}%).`;
    } else if (improvement > 0) {
      interpretation += ` Some improvement from baseline (${Math.round(improvement)}%), but below ${thresholds.reopenRate.minimumImprovementPercent}% target.`;
    } else {
      interpretation += ` No improvement from baseline (${baseline}%). Intervention may not be effective.`;
      recommendedActions.unshift('Investigate why intervention is not improving metrics');
    }
  }

  return { status, value, threshold, interpretation, possibleCauses, recommendedActions };
}

/**
 * Interpret a decision duplication rate value against thresholds
 */
export function interpretDuplicationRate(
  value: number,
  sampleSize: number,
  thresholds: AXThresholds = DEFAULT_AX_THRESHOLDS,
  baseline?: number
): MetricInterpretation {
  // Check sample size
  if (sampleSize < thresholds.minimumSamples.decisions) {
    return {
      status: 'insufficient_data',
      value,
      threshold: `Need ${thresholds.minimumSamples.decisions} decisions`,
      interpretation: `Only ${sampleSize} decisions measured. Need more data for reliable analysis.`,
      possibleCauses: [],
      recommendedActions: ['Encourage decision logging', 'Continue collecting data'],
    };
  }

  let status: MetricStatus;
  let threshold: string;
  let interpretation: string;
  let possibleCauses: string[] = [];
  let recommendedActions: string[] = [];

  if (value <= thresholds.duplicationRate.excellent) {
    status = 'excellent';
    threshold = `≤${thresholds.duplicationRate.excellent}%`;
    interpretation = 'Related learnings are highly effective. Agents are building on prior knowledge.';
    recommendedActions = ['Document what\'s working', 'Share patterns with other projects'];
  } else if (value <= thresholds.duplicationRate.good) {
    status = 'good';
    threshold = `≤${thresholds.duplicationRate.good}%`;
    interpretation = 'Related learnings are working well. Most decisions build on prior work.';
    recommendedActions = ['Monitor for changes', 'Review any duplicate decisions for patterns'];
  } else if (value <= thresholds.duplicationRate.warning) {
    status = 'acceptable';
    threshold = `≤${thresholds.duplicationRate.warning}%`;
    interpretation = 'Related learnings are functioning but there\'s room for improvement.';
    possibleCauses = [
      'Learnings may not be surfacing at the right time',
      'Task relationships may be incomplete',
      'Agents may be ignoring surfaced learnings',
    ];
    recommendedActions = [
      'Review task relationship definitions',
      'Improve learnings display format',
      'Add nudges to reference prior decisions',
    ];
  } else {
    status = 'warning';
    threshold = `>${thresholds.duplicationRate.warning}%`;
    interpretation = 'High duplication rate indicates related learnings need attention.';
    possibleCauses = [
      'Related learnings may not be surfacing',
      'Task relationships may be missing',
      'Learnings display may be ignored or hard to read',
      'Similar tasks may not be linked',
    ];
    recommendedActions = [
      'Verify related learnings are being displayed at task start',
      'Review and improve task relationship definitions',
      'Make learnings more prominent in task context',
      'Add relationship suggestions for similar tasks',
      'Review specific duplicate decisions to identify patterns',
    ];
  }

  // Add baseline comparison if available
  if (baseline !== undefined && baseline > 0) {
    const improvement = ((baseline - value) / baseline) * 100;
    if (improvement >= thresholds.duplicationRate.minimumImprovementPercent) {
      interpretation += ` ${Math.round(improvement)}% improvement from baseline (${baseline}% → ${value}%).`;
    } else if (improvement > 0) {
      interpretation += ` Some improvement from baseline (${Math.round(improvement)}%), but below ${thresholds.duplicationRate.minimumImprovementPercent}% target.`;
    } else {
      interpretation += ` No improvement from baseline (${baseline}%). Intervention may not be effective.`;
      recommendedActions.unshift('Investigate why intervention is not improving metrics');
    }
  }

  return { status, value, threshold, interpretation, possibleCauses, recommendedActions };
}

/**
 * Interpret a survey category score against thresholds
 */
export function interpretSurveyScore(
  category: string,
  value: number,
  responseCount: number,
  thresholds: AXThresholds = DEFAULT_AX_THRESHOLDS
): MetricInterpretation {
  // Check sample size
  if (responseCount < thresholds.minimumSamples.surveyResponses) {
    return {
      status: 'insufficient_data',
      value,
      threshold: `Need ${thresholds.minimumSamples.surveyResponses} responses`,
      interpretation: `Only ${responseCount} responses for ${category}. Need more data.`,
      possibleCauses: [],
      recommendedActions: ['Encourage survey participation', 'Prompt for surveys after task completion'],
    };
  }

  let status: MetricStatus;
  let threshold: string;
  let interpretation: string;
  let possibleCauses: string[] = [];
  let recommendedActions: string[] = [];

  // Category-specific interpretations
  const categoryInsights: Record<string, { poor: string[]; actions: string[] }> = {
    tool_usability: {
      poor: ['Tool documentation may be unclear', 'Tool parameters may be confusing', 'Error messages may be unhelpful'],
      actions: ['Improve tool descriptions', 'Add parameter examples', 'Enhance error messages'],
    },
    context_quality: {
      poor: ['Context may be irrelevant or incomplete', 'File lists may be outdated', 'Learnings may not surface'],
      actions: ['Review context assembly logic', 'Update file mappings', 'Improve learnings display'],
    },
    workflow_clarity: {
      poor: ['Workflow sequence unclear', 'Next steps not obvious', 'Documentation lacking'],
      actions: ['Add workflow guidance to task start', 'Improve CLAUDE.md documentation', 'Add phase indicators'],
    },
    error_recovery: {
      poor: ['Error messages unhelpful', 'Recovery steps unclear', 'Errors occur frequently'],
      actions: ['Improve error messages', 'Add recovery suggestions', 'Fix common error sources'],
    },
    knowledge_gaps: {
      poor: ['Documentation missing', 'Examples lacking', 'Patterns not documented'],
      actions: ['Add missing documentation', 'Create examples', 'Document common patterns'],
    },
    coordination: {
      poor: ['Handoffs difficult', 'Decision logging friction', 'Multi-session context lost'],
      actions: ['Improve handoff context', 'Simplify decision logging', 'Enhance session continuity'],
    },
    overall: {
      poor: ['General experience issues', 'Multiple pain points', 'Systemic problems'],
      actions: ['Review other categories for root causes', 'Conduct targeted research', 'Prioritize top issues'],
    },
  };

  const insights = categoryInsights[category] || categoryInsights.overall;

  if (value >= thresholds.surveyScores.excellent) {
    status = 'excellent';
    threshold = `≥${thresholds.surveyScores.excellent}`;
    interpretation = `Excellent ${category.replace('_', ' ')} scores. Agents report very positive experience.`;
    recommendedActions = ['Document what\'s working', 'Maintain current approach'];
  } else if (value >= thresholds.surveyScores.good) {
    status = 'good';
    threshold = `≥${thresholds.surveyScores.good}`;
    interpretation = `Good ${category.replace('_', ' ')} scores. Agents are generally satisfied.`;
    recommendedActions = ['Monitor for changes', 'Look for incremental improvements'];
  } else if (value >= thresholds.surveyScores.acceptable) {
    status = 'acceptable';
    threshold = `≥${thresholds.surveyScores.acceptable}`;
    interpretation = `Acceptable ${category.replace('_', ' ')} scores, but room for improvement.`;
    possibleCauses = insights.poor.slice(0, 2);
    recommendedActions = insights.actions.slice(0, 2);
  } else {
    status = value >= thresholds.surveyScores.poor ? 'warning' : 'critical';
    threshold = `<${thresholds.surveyScores.acceptable}`;
    interpretation = `Low ${category.replace('_', ' ')} scores. This category needs attention.`;
    possibleCauses = insights.poor;
    recommendedActions = insights.actions;
  }

  return { status, value, threshold, interpretation, possibleCauses, recommendedActions };
}

// ============================================================================
// Longitudinal Tracking
// ============================================================================

export interface AXSnapshot {
  /** When this snapshot was taken */
  timestamp: Date;

  /** Period this snapshot covers */
  period: 'day' | 'week' | 'month';

  /** Project ID */
  projectId: string;

  /** Reopen rate for this period */
  reopenRate: number;
  reopenSampleSize: number;

  /** Duplication rate for this period */
  duplicationRate: number;
  duplicationSampleSize: number;

  /** Survey scores by category */
  surveyScores: Record<string, number>;
  surveyResponseCount: number;

  /** Overall AX health score (0-100) */
  healthScore: number;
}

/**
 * Calculate overall AX health score from individual metrics
 * Weighted average: completion validation (30%), learnings (30%), surveys (40%)
 */
export function calculateHealthScore(
  reopenRate: number,
  duplicationRate: number,
  avgSurveyScore: number,
  thresholds: AXThresholds = DEFAULT_AX_THRESHOLDS
): number {
  // Normalize reopen rate (lower is better, 0-100 scale inverted)
  const reopenScore = Math.max(0, 100 - (reopenRate / thresholds.reopenRate.warning) * 100);

  // Normalize duplication rate (lower is better, 0-100 scale inverted)
  const duplicationScore = Math.max(0, 100 - (duplicationRate / thresholds.duplicationRate.warning) * 100);

  // Normalize survey score (already 0-1, convert to 0-100)
  const surveyScore = avgSurveyScore * 100;

  // Weighted average
  const healthScore = (reopenScore * 0.3) + (duplicationScore * 0.3) + (surveyScore * 0.4);

  return Math.round(Math.min(100, Math.max(0, healthScore)));
}

/**
 * Detect anomalies in a series of snapshots
 */
export function detectAnomalies(
  snapshots: AXSnapshot[],
  threshold: number = 2 // Standard deviations
): Array<{
  snapshot: AXSnapshot;
  metric: string;
  deviation: number;
  direction: 'increase' | 'decrease';
}> {
  if (snapshots.length < 3) return [];

  const anomalies: Array<{
    snapshot: AXSnapshot;
    metric: string;
    deviation: number;
    direction: 'increase' | 'decrease';
  }> = [];

  // Calculate stats for each metric
  const metrics = ['reopenRate', 'duplicationRate', 'healthScore'] as const;

  for (const metric of metrics) {
    const values = snapshots.map(s => s[metric]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    );

    if (stdDev === 0) continue;

    // Check latest snapshot for anomaly
    const latest = snapshots[snapshots.length - 1];
    const deviation = (latest[metric] - mean) / stdDev;

    if (Math.abs(deviation) > threshold) {
      anomalies.push({
        snapshot: latest,
        metric,
        deviation: Math.round(deviation * 10) / 10,
        direction: deviation > 0 ? 'increase' : 'decrease',
      });
    }
  }

  return anomalies;
}

// ============================================================================
// Comprehensive Evaluation Report
// ============================================================================

export interface AXEvaluationReport {
  /** When this report was generated */
  generatedAt: Date;

  /** Project ID */
  projectId: string;

  /** Period covered */
  period: { start: Date; end: Date; label: string };

  /** Overall health score (0-100) */
  healthScore: number;
  healthStatus: MetricStatus;

  /** Individual metric interpretations */
  metrics: {
    reopenRate: MetricInterpretation;
    duplicationRate: MetricInterpretation;
    surveyScores: Record<string, MetricInterpretation>;
  };

  /** Baseline comparison if available */
  baselineComparison?: {
    reopenRateImprovement: number;
    duplicationRateImprovement: number;
    hypothesisValidated: boolean;
    validationNotes: string;
  };

  /** Detected anomalies */
  anomalies: Array<{
    metric: string;
    deviation: number;
    direction: 'increase' | 'decrease';
  }>;

  /** Prioritized recommendations */
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    category: string;
    action: string;
    rationale: string;
  }>;

  /** Summary for stakeholders */
  executiveSummary: string;
}

/**
 * Generate prioritized recommendations from metric interpretations
 */
export function generateRecommendations(
  reopenInterpretation: MetricInterpretation,
  duplicationInterpretation: MetricInterpretation,
  surveyInterpretations: Record<string, MetricInterpretation>
): AXEvaluationReport['recommendations'] {
  const recommendations: AXEvaluationReport['recommendations'] = [];

  // Priority based on status
  const statusPriority: Record<MetricStatus, 'high' | 'medium' | 'low'> = {
    critical: 'high',
    warning: 'high',
    acceptable: 'medium',
    good: 'low',
    excellent: 'low',
    insufficient_data: 'medium',
  };

  // Add reopen rate recommendations
  for (const action of reopenInterpretation.recommendedActions.slice(0, 2)) {
    recommendations.push({
      priority: statusPriority[reopenInterpretation.status],
      category: 'Completion Validation',
      action,
      rationale: reopenInterpretation.interpretation,
    });
  }

  // Add duplication rate recommendations
  for (const action of duplicationInterpretation.recommendedActions.slice(0, 2)) {
    recommendations.push({
      priority: statusPriority[duplicationInterpretation.status],
      category: 'Related Learnings',
      action,
      rationale: duplicationInterpretation.interpretation,
    });
  }

  // Add survey-based recommendations (prioritize lowest scores)
  const sortedCategories = Object.entries(surveyInterpretations)
    .filter(([_, interp]) => interp.status !== 'insufficient_data')
    .sort((a, b) => a[1].value - b[1].value);

  for (const [category, interp] of sortedCategories.slice(0, 3)) {
    for (const action of interp.recommendedActions.slice(0, 1)) {
      recommendations.push({
        priority: statusPriority[interp.status],
        category: category.replace('_', ' '),
        action,
        rationale: interp.interpretation,
      });
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations.slice(0, 10); // Top 10 recommendations
}

/**
 * Generate executive summary from evaluation results
 */
export function generateExecutiveSummary(
  healthScore: number,
  reopenInterpretation: MetricInterpretation,
  duplicationInterpretation: MetricInterpretation,
  baselineComparison?: AXEvaluationReport['baselineComparison']
): string {
  const parts: string[] = [];

  // Overall health
  if (healthScore >= 80) {
    parts.push(`AX health is strong (${healthScore}/100).`);
  } else if (healthScore >= 60) {
    parts.push(`AX health is acceptable (${healthScore}/100) with room for improvement.`);
  } else {
    parts.push(`AX health needs attention (${healthScore}/100).`);
  }

  // Key findings
  if (reopenInterpretation.status === 'warning' || reopenInterpretation.status === 'critical') {
    parts.push(`Completion validation is underperforming (${reopenInterpretation.value}% reopen rate).`);
  }

  if (duplicationInterpretation.status === 'warning' || duplicationInterpretation.status === 'critical') {
    parts.push(`Related learnings effectiveness is low (${duplicationInterpretation.value}% duplication rate).`);
  }

  // Baseline comparison
  if (baselineComparison) {
    if (baselineComparison.hypothesisValidated) {
      parts.push(`Hypothesis validated: ${baselineComparison.validationNotes}`);
    } else {
      parts.push(`Hypothesis not yet validated: ${baselineComparison.validationNotes}`);
    }
  }

  return parts.join(' ');
}
