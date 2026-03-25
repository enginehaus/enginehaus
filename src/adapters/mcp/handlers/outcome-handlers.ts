/**
 * Outcome-Based Analytics Tool Handlers
 *
 * Handlers for outcome-based analytics and AX survey MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';

export interface GetOutcomeMetricsParams {
  period?: 'day' | 'week' | 'month';
  projectId?: string;
}

export interface GetValueDashboardParams {
  period?: 'day' | 'week' | 'month';
  projectId?: string;
  includeTrends?: boolean;
}

export interface GetAXMetricsParams {
  period?: 'day' | 'week' | 'month';
  projectId?: string;
}

export interface GetAXSurveyQuestionsParams {
  minimal?: boolean;
  category?: string;
}

export interface SubmitAXSurveyParams {
  sessionId: string;
  agentId: string;
  taskId?: string;
  responses: Record<string, unknown>;
  freeformFeedback?: string;
  context?: {
    toolsUsed?: string[];
    errorsEncountered?: number;
    sessionDurationMs?: number;
    taskCompleted?: boolean;
  };
}

export interface GetAXSurveyAnalysisParams {
  period?: 'day' | 'week' | 'month';
  projectId?: string;
}

export interface GetAXEvaluationParams {
  period?: 'day' | 'week' | 'month';
  projectId?: string;
  includeRecommendations?: boolean;
}

export interface SubmitSessionFeedbackParams {
  sessionId: string;
  taskId?: string;
  productivityRating?: number;
  frictionTags?: string[];
  notes?: string;
}

export async function handleGetOutcomeMetrics(
  service: CoordinationService,
  args: GetOutcomeMetricsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getOutcomeMetrics({
    period: args.period,
    projectId: args.projectId,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetValueDashboard(
  service: CoordinationService,
  args: GetValueDashboardParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getValueDashboard({
    period: args.period,
    projectId: args.projectId,
    includeTrends: args.includeTrends,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetAXMetrics(
  service: CoordinationService,
  args: GetAXMetricsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getAXMetrics({
    period: args.period,
    projectId: args.projectId,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetAXSurveyQuestions(
  service: CoordinationService,
  args: GetAXSurveyQuestionsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getAXSurveyQuestions({
    minimal: args.minimal,
    category: args.category,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleSubmitAXSurvey(
  service: CoordinationService,
  args: SubmitAXSurveyParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.submitAXSurvey({
    sessionId: args.sessionId,
    agentId: args.agentId,
    taskId: args.taskId,
    responses: args.responses,
    freeformFeedback: args.freeformFeedback,
    context: args.context,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetAXSurveyAnalysis(
  service: CoordinationService,
  args: GetAXSurveyAnalysisParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getAXSurveyAnalysis({
    period: args.period,
    projectId: args.projectId,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetAXEvaluation(
  service: CoordinationService,
  args: GetAXEvaluationParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getAXEvaluationReport({
    period: args.period,
    projectId: args.projectId,
    includeRecommendations: args.includeRecommendations,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleSubmitSessionFeedback(
  service: CoordinationService,
  args: SubmitSessionFeedbackParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.submitSessionFeedback({
    sessionId: args.sessionId,
    taskId: args.taskId,
    productivityRating: args.productivityRating,
    frictionTags: args.frictionTags || [],
    notes: args.notes,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

// ============================================================================
// Task Outcome Tracking (Real-world results)
// ============================================================================

export interface RecordTaskOutcomeParams {
  taskId: string;
  status: 'pending' | 'shipped' | 'rejected' | 'rework' | 'abandoned';
  prUrl?: string;
  prMerged?: boolean;
  prMergedAt?: string;
  reviewFeedback?: string;
  ciPassed?: boolean;
  ciFirstTryPass?: boolean;
  testFailures?: number;
  deployed?: boolean;
  deployedAt?: string;
  deployEnvironment?: string;
  reworkRequired?: boolean;
  reworkReason?: string;
  reworkTaskId?: string;
  reviewerSatisfaction?: number;
  notes?: string;
}

export interface GetTaskOutcomeParams {
  taskId: string;
}

export interface GetTaskOutcomeMetricsParams {
  projectId?: string;
  period?: 'day' | 'week' | 'month';
}

export async function handleRecordTaskOutcome(
  service: CoordinationService,
  args: RecordTaskOutcomeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.recordTaskOutcome({
    taskId: args.taskId,
    status: args.status,
    prUrl: args.prUrl,
    prMerged: args.prMerged,
    prMergedAt: args.prMergedAt ? new Date(args.prMergedAt) : undefined,
    reviewFeedback: args.reviewFeedback,
    ciPassed: args.ciPassed,
    ciFirstTryPass: args.ciFirstTryPass,
    testFailures: args.testFailures,
    deployed: args.deployed,
    deployedAt: args.deployedAt ? new Date(args.deployedAt) : undefined,
    deployEnvironment: args.deployEnvironment,
    reworkRequired: args.reworkRequired,
    reworkReason: args.reworkReason,
    reworkTaskId: args.reworkTaskId,
    reviewerSatisfaction: args.reviewerSatisfaction,
    notes: args.notes,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetTaskOutcome(
  service: CoordinationService,
  args: GetTaskOutcomeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getTaskOutcome(args.taskId);
  return {
    content: [{
      type: 'text',
      text: result ? JSON.stringify(result, null, 2) : 'No outcome recorded for this task.',
    }],
  };
}

export async function handleGetTaskOutcomeMetrics(
  service: CoordinationService,
  args: GetTaskOutcomeMetricsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getTaskOutcomeMetrics({
    projectId: args.projectId,
    period: args.period,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
