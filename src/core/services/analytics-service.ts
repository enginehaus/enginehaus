/**
 * AnalyticsService — extracted from CoordinationService
 *
 * Outcome-based analytics, coordination metrics, AX metrics,
 * AX surveys, AX evaluation reports, task outcome tracking,
 * and value dashboard.
 */

import type {
  TaskStatus,
  TaskPriority,
} from '../../coordination/types.js';
import type { ServiceContext } from './service-context.js';
import { audit, resolveProjectId } from './service-context.js';

export class AnalyticsService {
  constructor(private ctx: ServiceContext) {}

  // ── Coordination Metrics ──────────────────────────────────────────

  async getCoordinationMetrics(options: {
    period?: 'day' | 'week' | 'month';
    projectId?: string;
  } = {}): Promise<any> {
    const now = Date.now();
    let sinceMs: number;
    switch (options.period) {
      case 'day': sinceMs = now - 24 * 60 * 60 * 1000; break;
      case 'month': sinceMs = now - 30 * 24 * 60 * 60 * 1000; break;
      case 'week': default: sinceMs = now - 7 * 24 * 60 * 60 * 1000;
    }
    const since = new Date(sinceMs);

    const resolvedProjectId = await resolveProjectId(this.ctx.storage, options.projectId) || undefined;
    const metrics = await this.ctx.storage.getEffectivenessMetrics({
      projectId: resolvedProjectId,
      since,
    });

    const avgCycleTimeFormatted = metrics.avgCycleTimeMs !== null
      ? `${Math.round(metrics.avgCycleTimeMs / 60000)} min`
      : 'N/A';

    const te = metrics.tokenEfficiency;
    const tokenSavingsFormatted = te.estimatedTokensSaved >= 1000
      ? `~${(te.estimatedTokensSaved / 1000).toFixed(1)}K tokens`
      : `~${te.estimatedTokensSaved} tokens`;

    return {
      success: true,
      period: options.period || 'week',
      metrics: {
        tasksCompleted: metrics.tasksCompleted,
        tasksAbandoned: metrics.tasksAbandoned,
        avgCycleTime: avgCycleTimeFormatted,
        avgCycleTimeMs: metrics.avgCycleTimeMs,
        contextExpansions: metrics.contextExpansions,
        contextExpansionRate: `${Math.round(metrics.contextExpansionRate * 100)}%`,
        sessions: metrics.sessions,
        avgTasksPerSession: metrics.avgTasksPerSession.toFixed(1),
        completionRate: `${Math.round(metrics.completionRate * 100)}%`,
        qualityGatePassRate: `${Math.round(metrics.qualityGatePassRate * 100)}%`,
        tokenEfficiency: {
          minimalFetches: te.minimalFetches,
          minimalSufficient: te.minimalSufficient,
          minimalExpanded: te.minimalExpanded,
          fullFetches: te.fullFetches,
          efficiencyRate: `${te.efficiencyRate}%`,
          estimatedTokensSaved: tokenSavingsFormatted,
        },
      },
    };
  }

  // ── Outcome Metrics ──────────────────────────────────────────────

  async getOutcomeMetrics(params: {
    period?: 'day' | 'week' | 'month';
    projectId?: string;
  } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    if (!projectId) {
      return { success: false, error: 'No active project. Set a project first.' };
    }

    const period = params.period || 'week';
    const now = Date.now();
    const periodMs = {
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    }[period];

    const since = new Date(now - periodMs);
    const until = new Date(now);

    const raw = await this.ctx.storage.getOutcomeRawData({ projectId, since, until });
    const previousSince = new Date(since.getTime() - periodMs);
    const previousUntil = new Date(since.getTime() - 1);
    const previousRaw = await this.ctx.storage.getOutcomeRawData({ projectId, since: previousSince, until: previousUntil });
    const feedback = await this.ctx.storage.getSessionFeedback({ projectId, since, until });

    // Token efficiency
    const minimalSufficiencyRate = raw.contextFetchMinimal > 0
      ? raw.minimalSufficientCount / raw.contextFetchMinimal : 1;
    const estimatedTokensSaved = raw.minimalSufficientCount * 1000;
    const avgToolCallsPerTask = raw.tasksClaimed > 0 ? raw.toolCalls / raw.tasksClaimed : 0;
    const avgSessionsPerTask = raw.tasksClaimed > 0 ? raw.sessions / raw.tasksClaimed : 0;

    // Human time metrics
    const cycleTimes = raw.cycleTimes.filter(ct => ct !== null) as number[];
    const avgCycleTimeMs = cycleTimes.length > 0
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null;
    const sessionDurations = raw.sessionDurations.filter(sd => sd !== null) as number[];
    const avgSessionDurationMs = sessionDurations.length > 0
      ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length : null;
    const avgTasksPerSession = raw.sessions > 0 ? raw.tasksCompleted / raw.sessions : 0;
    const taskReopeningRate = raw.tasksClaimed > 0 ? raw.tasksReopened / raw.tasksClaimed : 0;
    const multiSessionTaskRate = raw.tasksClaimed > 0 ? raw.multiSessionTasks / raw.tasksClaimed : 0;

    // Feedback metrics
    const ratingsWithValue = feedback.filter(f => f.productivityRating !== undefined);
    const avgProductivityRating = ratingsWithValue.length > 0
      ? ratingsWithValue.reduce((sum, f) => sum + (f.productivityRating || 0), 0) / ratingsWithValue.length : null;
    const frictionCounts: Record<string, number> = {};
    for (const f of feedback) {
      for (const tag of f.frictionTags) {
        frictionCounts[tag] = (frictionCounts[tag] || 0) + 1;
      }
    }
    const topFriction = Object.entries(frictionCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([tag, count]) => `${tag} (${count})`);

    // Quality outcomes
    const totalGates = raw.qualityGatePassed + raw.qualityGateFailed;
    const qualityGatePassRate = totalGates > 0 ? raw.qualityGatePassed / totalGates : 1;
    const firstAttemptSuccessRate = raw.tasksClaimed > 0 ? raw.singleSessionCompletions / raw.tasksClaimed : 0;
    const reworkRate = raw.tasksCompleted > 0 ? raw.tasksReworked / raw.tasksCompleted : 0;
    const artifactCreationRate = raw.tasksClaimed > 0 ? raw.artifacts / raw.tasksClaimed : 0;
    const decisionLoggingRate = raw.tasksClaimed > 0 ? raw.decisions / raw.tasksClaimed : 0;
    const totalOutcomes = raw.tasksCompleted + raw.tasksAbandoned;
    const completionRate = totalOutcomes > 0 ? raw.tasksCompleted / totalOutcomes : 0;
    const abandonmentRate = totalOutcomes > 0 ? raw.tasksAbandoned / totalOutcomes : 0;

    return {
      success: true,
      metrics: {
        period: { start: since.toISOString(), end: until.toISOString(), label: `Last ${period}` },
        tokenEfficiency: {
          minimalContextFetches: raw.contextFetchMinimal,
          fullContextFetches: raw.contextFetchFull,
          contextExpansions: raw.contextExpansions,
          minimalSufficiencyRate: `${Math.round(minimalSufficiencyRate * 100)}%`,
          estimatedTokensSaved,
          avgToolCallsPerTask: avgToolCallsPerTask.toFixed(1),
          avgSessionsPerTask: avgSessionsPerTask.toFixed(1),
          tokenSavingsNote: 'Heuristic estimate based on context fetch patterns, not actual LLM token counts',
        },
        humanTime: {
          avgCycleTime: this.formatDuration(avgCycleTimeMs),
          avgSessionDuration: this.formatDuration(avgSessionDurationMs),
          avgTasksPerSession: avgTasksPerSession.toFixed(1),
          taskReopeningRate: `${Math.round(taskReopeningRate * 100)}%`,
          multiSessionTaskRate: `${Math.round(multiSessionTaskRate * 100)}%`,
          avgProductivityRating: avgProductivityRating !== null ? avgProductivityRating.toFixed(1) : 'N/A',
          topFriction: topFriction.length > 0 ? topFriction : ['None reported'],
        },
        qualityOutcomes: {
          qualityGatePassRate: `${Math.round(qualityGatePassRate * 100)}%`,
          firstAttemptSuccessRate: `${Math.round(firstAttemptSuccessRate * 100)}%`,
          reworkRate: `${Math.round(reworkRate * 100)}%`,
          artifactCreationRate: artifactCreationRate.toFixed(1),
          decisionLoggingRate: decisionLoggingRate.toFixed(1),
          completionRate: `${Math.round(completionRate * 100)}%`,
          abandonmentRate: `${Math.round(abandonmentRate * 100)}%`,
        },
        rawCounts: {
          tasksCompleted: raw.tasksCompleted,
          tasksAbandoned: raw.tasksAbandoned,
          tasksClaimed: raw.tasksClaimed,
          tasksReopened: raw.tasksReopened,
          sessions: raw.sessions,
          artifacts: raw.artifacts,
          decisions: raw.decisions,
        },
        cycleTimeTrend: this.computeCycleTimeTrend(cycleTimes, previousRaw.cycleTimes),
      },
    };
  }

  private computeCycleTimeTrend(
    currentCycleTimes: (number | null)[],
    previousCycleTimes: (number | null)[],
  ): {
    direction: 'improving' | 'stable' | 'declining' | 'insufficient_data';
    currentAvgMs: number | null;
    previousAvgMs: number | null;
    changePercent: number | null;
  } {
    const current = currentCycleTimes.filter((ct): ct is number => ct !== null);
    const previous = previousCycleTimes.filter((ct): ct is number => ct !== null);
    const currentAvg = current.length > 0 ? current.reduce((a, b) => a + b, 0) / current.length : null;
    const previousAvg = previous.length > 0 ? previous.reduce((a, b) => a + b, 0) / previous.length : null;

    if (currentAvg === null || previousAvg === null) {
      return { direction: 'insufficient_data', currentAvgMs: currentAvg, previousAvgMs: previousAvg, changePercent: null };
    }
    const changePercent = previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg) * 100 : null;
    let direction: 'improving' | 'stable' | 'declining';
    if (changePercent === null) direction = 'stable';
    else if (changePercent < -10) direction = 'improving';
    else if (changePercent > 10) direction = 'declining';
    else direction = 'stable';

    return {
      direction,
      currentAvgMs: Math.round(currentAvg),
      previousAvgMs: Math.round(previousAvg),
      changePercent: changePercent !== null ? Math.round(changePercent) : null,
    };
  }

  // ── Value Dashboard ──────────────────────────────────────────────

  async getValueDashboard(params: {
    period?: 'day' | 'week' | 'month';
    projectId?: string;
    includeTrends?: boolean;
  } = {}): Promise<any> {
    const metrics = await this.getOutcomeMetrics(params);
    if (!metrics.success || !metrics.metrics) {
      return { success: false, error: metrics.error };
    }

    const m = metrics.metrics;
    const insights: Array<{
      type: 'positive' | 'negative' | 'neutral';
      category: 'token_efficiency' | 'human_time' | 'quality';
      title: string;
      description: string;
      recommendation?: string;
    }> = [];

    const sufficiencyRate = parseInt(m.tokenEfficiency.minimalSufficiencyRate);
    if (sufficiencyRate >= 80) {
      insights.push({ type: 'positive', category: 'token_efficiency', title: 'High context efficiency', description: `${m.tokenEfficiency.minimalSufficiencyRate} of minimal context fetches were sufficient without expansion.` });
    } else if (sufficiencyRate < 50) {
      insights.push({ type: 'negative', category: 'token_efficiency', title: 'Frequent context expansion needed', description: `Only ${m.tokenEfficiency.minimalSufficiencyRate} of minimal fetches were sufficient.`, recommendation: 'Review tasks that needed expansion and update their file lists.' });
    }

    const reopeningRate = parseInt(m.humanTime.taskReopeningRate);
    if (reopeningRate > 20) {
      insights.push({ type: 'negative', category: 'human_time', title: 'High task reopening rate', description: `${m.humanTime.taskReopeningRate} of tasks were reopened after completion.`, recommendation: 'Review task definitions for clarity and completeness.' });
    }

    const multiSessionRate = parseInt(m.humanTime.multiSessionTaskRate);
    if (multiSessionRate > 50) {
      insights.push({ type: 'neutral', category: 'human_time', title: 'Tasks often span multiple sessions', description: `${m.humanTime.multiSessionTaskRate} of tasks required multiple sessions.`, recommendation: 'Consider breaking large tasks into smaller units.' });
    }

    const firstAttemptRate = parseInt(m.qualityOutcomes.firstAttemptSuccessRate);
    if (firstAttemptRate >= 70) {
      insights.push({ type: 'positive', category: 'quality', title: 'Strong first-attempt success', description: `${m.qualityOutcomes.firstAttemptSuccessRate} of tasks completed on first attempt.` });
    }

    const reworkRate = parseInt(m.qualityOutcomes.reworkRate);
    if (reworkRate > 15) {
      insights.push({ type: 'negative', category: 'quality', title: 'Elevated rework rate', description: `${m.qualityOutcomes.reworkRate} of completed tasks required rework.`, recommendation: 'Run quality gates before marking tasks complete.' });
    }

    const artifactRate = parseFloat(m.qualityOutcomes.artifactCreationRate);
    if (artifactRate < 0.3) {
      insights.push({ type: 'neutral', category: 'quality', title: 'Low knowledge capture', description: `Only ${m.qualityOutcomes.artifactCreationRate} artifacts created per task.`, recommendation: 'Document design decisions and learnings as artifacts.' });
    }

    if (m.humanTime.topFriction.length > 0 && m.humanTime.topFriction[0] !== 'None reported') {
      insights.push({ type: 'negative', category: 'human_time', title: `Common friction: ${m.humanTime.topFriction[0].split(' (')[0]}`, description: `Reported ${m.humanTime.topFriction[0].split('(')[1]?.replace(')', '') || ''} times this period.` });
    }

    return {
      success: true,
      dashboard: {
        generatedAt: new Date().toISOString(),
        projectId: await resolveProjectId(this.ctx.storage, params.projectId) || 'unknown',
        period: m.period.label,
        insights,
        summary: {
          tokensEstimatedSaved: m.tokenEfficiency.estimatedTokensSaved,
          firstAttemptSuccessRate: m.qualityOutcomes.firstAttemptSuccessRate,
          qualityGatePassRate: m.qualityOutcomes.qualityGatePassRate,
          avgProductivityRating: m.humanTime.avgProductivityRating,
        },
        limitations: [
          'Flow state preservation cannot be directly measured',
          'Cognitive load reduction is estimated via proxy metrics',
          'User satisfaction requires explicit feedback to measure accurately',
          'Token counts are estimated based on context size, not actual API usage',
        ],
      },
    };
  }

  // ── Task Outcome Tracking ────────────────────────────────────────

  async recordTaskOutcome(params: {
    taskId: string;
    status: 'pending' | 'shipped' | 'rejected' | 'rework' | 'abandoned';
    prUrl?: string; prMerged?: boolean; prMergedAt?: Date; reviewFeedback?: string;
    ciPassed?: boolean; ciFirstTryPass?: boolean; testFailures?: number;
    deployed?: boolean; deployedAt?: Date; deployEnvironment?: string;
    reworkRequired?: boolean; reworkReason?: string; reworkTaskId?: string;
    reviewerSatisfaction?: number; notes?: string;
  }): Promise<{ success: boolean; outcomeId?: string; message: string }> {
    const task = await this.ctx.storage.getTask(params.taskId);
    if (!task) return { success: false, message: `Task not found: ${params.taskId}` };

    const projectId = task.projectId;
    const outcomeId = `out-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let timeToMerge: number | undefined;
    let timeToProduction: number | undefined;
    if (task.implementation?.completedAt) {
      const completedAt = new Date(task.implementation.completedAt).getTime();
      if (params.prMergedAt) timeToMerge = params.prMergedAt.getTime() - completedAt;
      if (params.deployedAt) timeToProduction = params.deployedAt.getTime() - completedAt;
    }

    await this.ctx.storage.saveTaskOutcome({
      id: outcomeId, taskId: params.taskId, projectId, status: params.status,
      prUrl: params.prUrl, prMerged: params.prMerged, prMergedAt: params.prMergedAt,
      reviewFeedback: params.reviewFeedback, ciPassed: params.ciPassed,
      ciFirstTryPass: params.ciFirstTryPass, testFailures: params.testFailures,
      deployed: params.deployed, deployedAt: params.deployedAt,
      deployEnvironment: params.deployEnvironment, reworkRequired: params.reworkRequired,
      reworkReason: params.reworkReason, reworkTaskId: params.reworkTaskId,
      timeToMerge, timeToProduction,
      reviewerSatisfaction: params.reviewerSatisfaction, notes: params.notes,
    });

    await audit(this.ctx.storage, 'task.outcome_recorded', projectId, 'task_outcome', outcomeId, `Task outcome recorded: ${params.status}`, { metadata: { taskId: params.taskId, status: params.status, prMerged: params.prMerged, deployed: params.deployed } });

    return {
      success: true, outcomeId,
      message: `Outcome recorded: ${params.status}${params.prMerged ? ' (PR merged)' : ''}${params.deployed ? ' (deployed)' : ''}`,
    };
  }

  async getTaskOutcome(taskId: string): Promise<any> {
    return await this.ctx.storage.getTaskOutcome(taskId);
  }

  async getTaskOutcomeMetrics(params: {
    projectId?: string;
    period?: 'day' | 'week' | 'month';
  } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    if (!projectId) return { success: false, message: 'No active project' };

    const period = params.period || 'week';
    const now = new Date();
    let since: Date;
    switch (period) {
      case 'day': since = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case 'month': since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      default: since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const metrics = await this.ctx.storage.getOutcomeMetrics({ projectId, since, until: now });

    return {
      success: true,
      metrics: {
        period: { label: `Last ${period}`, startDate: since.toISOString(), endDate: now.toISOString() },
        totalOutcomes: metrics.totalOutcomes, byStatus: metrics.byStatus,
        shipRate: Math.round(metrics.shipRate * 100), reworkRate: Math.round(metrics.reworkRate * 100),
        avgTimeToMerge: metrics.avgTimeToMerge ? this.formatDuration(metrics.avgTimeToMerge) : undefined,
        avgTimeToProduction: metrics.avgTimeToProduction ? this.formatDuration(metrics.avgTimeToProduction) : undefined,
        ciFirstTryPassRate: Math.round(metrics.ciFirstTryPassRate * 100),
        avgReviewerSatisfaction: metrics.avgReviewerSatisfaction,
      },
      message: metrics.totalOutcomes > 0
        ? `${metrics.totalOutcomes} outcomes tracked. Ship rate: ${Math.round(metrics.shipRate * 100)}%`
        : 'No outcomes recorded yet. Use record_task_outcome after PR merge/deploy.',
    };
  }

  // ── AX Metrics ───────────────────────────────────────────────────

  async getAXMetrics(params: {
    period?: 'day' | 'week' | 'month';
    projectId?: string;
  } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    if (!projectId) return { success: false, error: 'No active project. Set a project first.' };

    const now = new Date();
    let startDate: Date;
    const period = params.period || 'week';
    switch (period) {
      case 'day': startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case 'month': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const statusChangeEvents = await this.ctx.storage.queryAuditLog({
      eventTypes: ['task.status_changed'],
      projectId, startTime: startDate, endTime: now, limit: 500,
    });

    const reopenEvents = statusChangeEvents.filter(e => {
      const metadata = e.metadata as { isReopen?: boolean } | undefined;
      return metadata?.isReopen === true;
    });

    const completionEvents = statusChangeEvents.filter(e => {
      const afterState = e.afterState as { status?: string } | undefined;
      return afterState?.status === 'completed';
    });

    const reopenedTasks = reopenEvents.slice(0, 10).map(e => ({
      taskId: e.resourceId,
      taskTitle: (e.metadata as { taskTitle?: string })?.taskTitle || 'Unknown',
      reopenedAt: e.timestamp.toISOString(),
      previousStatus: (e.metadata as { previousStatus?: string })?.previousStatus || 'completed',
      newStatus: (e.metadata as { newStatus?: string })?.newStatus || 'unknown',
    }));

    const similarityEvents = await this.ctx.storage.queryAuditLog({
      eventTypes: ['quality.check_run'],
      projectId, startTime: startDate, endTime: now, limit: 500,
    });

    const decisionSimilarityEvents = similarityEvents.filter(e => {
      const metadata = e.metadata as { checkType?: string } | undefined;
      return metadata?.checkType === 'decision_similarity';
    });

    let totalSimilarityScore = 0;
    let potentialDuplicates = 0;
    for (const event of decisionSimilarityEvents) {
      const metadata = event.metadata as { highestScore?: number; potentialDuplicate?: boolean } | undefined;
      if (metadata?.highestScore !== undefined) totalSimilarityScore += metadata.highestScore;
      if (metadata?.potentialDuplicate) potentialDuplicates++;
    }

    const allDecisions = await this.ctx.storage.getDecisions({ projectId, limit: 500 });
    const decisionsInPeriod = allDecisions.filter(d => d.createdAt && new Date(d.createdAt) >= startDate);
    const avgSimilarityScore = decisionSimilarityEvents.length > 0 ? Math.round(totalSimilarityScore / decisionSimilarityEvents.length) : 0;
    const reopenRate = completionEvents.length > 0 ? Math.round((reopenEvents.length / completionEvents.length) * 100) : 0;
    const duplicationRate = decisionsInPeriod.length > 0 ? Math.round((potentialDuplicates / decisionsInPeriod.length) * 100) : 0;

    const completionTrend: 'improving' | 'stable' | 'degrading' | 'insufficient_data' =
      completionEvents.length < 5 ? 'insufficient_data' : reopenRate < 10 ? 'improving' : reopenRate > 25 ? 'degrading' : 'stable';
    const learningsTrend: 'improving' | 'stable' | 'degrading' | 'insufficient_data' =
      decisionsInPeriod.length < 5 ? 'insufficient_data' : duplicationRate < 10 ? 'improving' : duplicationRate > 30 ? 'degrading' : 'stable';

    const recommendations: string[] = [];
    if (reopenRate > 20) recommendations.push('High task reopen rate - review completion checklist thresholds or task clarity');
    if (duplicationRate > 20) recommendations.push('High decision duplication - related learnings may not be surfacing effectively');
    if (completionEvents.length === 0) recommendations.push('No task completions in period - check workflow health');
    if (decisionsInPeriod.length === 0) recommendations.push('No decisions logged in period - encourage decision documentation');
    if (recommendations.length === 0) recommendations.push('AX metrics within healthy ranges');

    return {
      success: true,
      metrics: {
        period: { label: period, startDate: startDate.toISOString(), endDate: now.toISOString() },
        completionValidation: {
          taskReopenCount: reopenEvents.length, totalCompletions: completionEvents.length,
          reopenRate: `${reopenRate}%`, reopenedTasks, trend: completionTrend,
        },
        relatedLearnings: {
          totalDecisionsLogged: decisionsInPeriod.length, decisionsWithSimilarity: decisionSimilarityEvents.length,
          avgSimilarityScore, potentialDuplicates, duplicationRate: `${duplicationRate}%`, trend: learningsTrend,
        },
        interpretation: {
          completionChecklistEffective: reopenRate < 15,
          learningsSurfacingEffective: duplicationRate < 15,
          recommendations,
        },
      },
    };
  }

  // ── AX Survey Methods ────────────────────────────────────────────

  async submitAXSurvey(params: {
    sessionId: string; agentId: string; taskId?: string;
    responses: Record<string, unknown>; freeformFeedback?: string;
    context?: { toolsUsed?: string[]; errorsEncountered?: number; sessionDurationMs?: number; taskCompleted?: boolean };
  }): Promise<any> {
    const projectId = await this.ctx.storage.getActiveProjectId();
    if (!projectId) return { success: false, surveyResponseId: '', message: 'No active project' };

    const { validateSurveyResponses } = await import('../../ai/ax-survey.js');
    const validation = validateSurveyResponses(params.responses as Record<string, any>);
    if (!validation.valid) {
      return { success: false, surveyResponseId: '', message: 'Survey validation failed', validationErrors: validation.errors };
    }

    const responseId = `axr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.ctx.storage.saveAXSurveyResponse({
      id: responseId, surveyId: 'ax-survey-v1', sessionId: params.sessionId, projectId,
      agentId: params.agentId, taskId: params.taskId, responses: params.responses,
      freeformFeedback: params.freeformFeedback,
      context: { toolsUsed: params.context?.toolsUsed || [], errorsEncountered: params.context?.errorsEncountered || 0, sessionDurationMs: params.context?.sessionDurationMs || 0, taskCompleted: params.context?.taskCompleted || false },
    });

    return { success: true, surveyResponseId: responseId, message: 'Thank you for your feedback! Your responses help improve agent experience.' };
  }

  async getAXSurveyQuestions(params: { minimal?: boolean; category?: string } = {}): Promise<any> {
    const { AX_SURVEY_QUESTIONS, getRequiredQuestions, getQuestionsByCategory } = await import('../../ai/ax-survey.js');
    let questions = AX_SURVEY_QUESTIONS;
    if (params.minimal) questions = getRequiredQuestions();
    else if (params.category) questions = getQuestionsByCategory(params.category as any);
    return { questions, surveyId: 'ax-survey-v1' };
  }

  async getAXSurveyAnalysis(params: { period?: 'day' | 'week' | 'month'; projectId?: string } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    if (!projectId) return { success: false, error: 'No active project' };

    const now = new Date();
    let startDate: Date;
    const period = params.period || 'week';
    switch (period) {
      case 'day': startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case 'month': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const responses = await this.ctx.storage.getAXSurveyResponses({ projectId, since: startDate, until: now });
    const { analyzeSurveyResponses } = await import('../../ai/ax-survey.js');
    type AXSurveyResponseType = import('../../ai/ax-survey.js').AXSurveyResponse;

    const formattedResponses: AXSurveyResponseType[] = responses.map((r: typeof responses[0]) => ({
      ...r, responses: r.responses as Record<string, any>, context: r.context as any,
    }));

    const analysis = analyzeSurveyResponses(formattedResponses, { start: startDate, end: now, label: period });

    return {
      success: true,
      analysis: {
        period: { label: period, startDate: startDate.toISOString(), endDate: now.toISOString() },
        responseCount: analysis.responseCount,
        categoryScores: analysis.categoryScores as any,
        topIssues: analysis.topIssues.map((i: { category: string; description: string; frequency: number }) => ({ category: i.category, description: i.description, frequency: i.frequency })),
        topStrengths: analysis.topStrengths.map((s: { category: string; description: string; score: number }) => ({ category: s.category, description: s.description, score: s.score })),
        verbatimHighlights: analysis.verbatimHighlights,
        recommendations: analysis.recommendations,
      },
    };
  }

  // ── AX Evaluation ────────────────────────────────────────────────

  async getAXEvaluationReport(params: { period?: 'day' | 'week' | 'month'; projectId?: string; includeRecommendations?: boolean } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    if (!projectId) return { success: false, error: 'No active project. Set a project first.' };

    const { DEFAULT_AX_THRESHOLDS, interpretReopenRate, interpretDuplicationRate, interpretSurveyScore, calculateHealthScore, generateRecommendations, generateExecutiveSummary } = await import('../../analytics/ax-evaluation.js');

    const metricsResult = await this.getAXMetrics({ period: params.period, projectId });
    if (!metricsResult.success || !metricsResult.metrics) return { success: false, error: metricsResult.error || 'Failed to get AX metrics' };

    const surveyResult = await this.getAXSurveyAnalysis({ period: params.period, projectId });
    const metrics = metricsResult.metrics;

    const reopenRateNum = parseInt(metrics.completionValidation.reopenRate.replace('%', ''), 10) || 0;
    const duplicationRateNum = parseInt(metrics.relatedLearnings.duplicationRate.replace('%', ''), 10) || 0;

    const reopenInterpretation = interpretReopenRate(reopenRateNum, metrics.completionValidation.totalCompletions, DEFAULT_AX_THRESHOLDS);
    const duplicationInterpretation = interpretDuplicationRate(duplicationRateNum, metrics.relatedLearnings.totalDecisionsLogged, DEFAULT_AX_THRESHOLDS);

    const surveyInterpretations: Record<string, import('../../analytics/ax-evaluation.js').MetricInterpretation> = {};
    let avgSurveyScore = 0;

    if (surveyResult.success && surveyResult.analysis) {
      const categoryEntries = Object.entries(surveyResult.analysis.categoryScores);
      let totalScore = 0;
      for (const [category, data] of categoryEntries) {
        surveyInterpretations[category] = interpretSurveyScore(category, (data as any).avgScore, (data as any).responseCount, DEFAULT_AX_THRESHOLDS);
        totalScore += (data as any).avgScore;
      }
      avgSurveyScore = categoryEntries.length > 0 ? totalScore / categoryEntries.length : 0;
    }

    const healthScore = calculateHealthScore(reopenRateNum, duplicationRateNum, avgSurveyScore, DEFAULT_AX_THRESHOLDS);
    type MetricStatus = import('../../analytics/ax-evaluation.js').MetricStatus;
    let healthStatus: MetricStatus;
    if (healthScore >= 80) healthStatus = 'excellent';
    else if (healthScore >= 65) healthStatus = 'good';
    else if (healthScore >= 50) healthStatus = 'acceptable';
    else if (healthScore >= 30) healthStatus = 'warning';
    else healthStatus = 'critical';

    const recommendations = params.includeRecommendations !== false
      ? generateRecommendations(reopenInterpretation, duplicationInterpretation, surveyInterpretations) : [];
    const executiveSummary = generateExecutiveSummary(healthScore, reopenInterpretation, duplicationInterpretation);

    const report: import('../../analytics/ax-evaluation.js').AXEvaluationReport = {
      generatedAt: new Date(), projectId,
      period: { start: new Date(metrics.period.startDate), end: new Date(metrics.period.endDate), label: metrics.period.label },
      healthScore, healthStatus,
      metrics: { reopenRate: reopenInterpretation, duplicationRate: duplicationInterpretation, surveyScores: surveyInterpretations },
      anomalies: [], recommendations, executiveSummary,
    };

    return { success: true, report };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  formatDuration(ms: number | null): string {
    if (ms === null) return 'N/A';
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 24) { const days = Math.floor(hours / 24); return `${days}d ${hours % 24}h`; }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
}
