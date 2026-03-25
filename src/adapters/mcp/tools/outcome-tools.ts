/**
 * Outcome Tools
 *
 * Outcome-based analytics, AX surveys, and task outcome tracking.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  getOutcomeMetricsSchema,
  getValueDashboardSchema,
  getAXMetricsSchema,
  getAXSurveyQuestionsSchema,
  submitAXSurveySchema,
  getAXSurveyAnalysisSchema,
  getAXEvaluationSchema,
  submitSessionFeedbackSchema,
  recordTaskOutcomeSchema,
  getTaskOutcomeSchema,
  getTaskOutcomeMetricsSchema,
} from '../schemas/outcome-schemas.js';
import {
  handleGetOutcomeMetrics,
  handleGetValueDashboard,
  handleGetAXMetrics,
  handleGetAXSurveyQuestions,
  handleSubmitAXSurvey,
  handleGetAXSurveyAnalysis,
  handleGetAXEvaluation,
  handleSubmitSessionFeedback,
  handleRecordTaskOutcome,
  handleGetTaskOutcome,
  handleGetTaskOutcomeMetrics,
} from '../handlers/outcome-handlers.js';

registry.register({
  ...getOutcomeMetricsSchema,
  domain: 'outcome',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetOutcomeMetrics(ctx.service, args as any);
  },
});

registry.register({
  ...getValueDashboardSchema,
  domain: 'outcome',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetValueDashboard(ctx.service, args as any);
  },
});

registry.register({
  ...getAXMetricsSchema,
  domain: 'outcome',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetAXMetrics(ctx.service, args as any);
  },
});

registry.register({
  ...getAXSurveyQuestionsSchema,
  domain: 'outcome',
  aliases: ['get_ax_survey_questions'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetAXSurveyQuestions(ctx.service, args as any);
  },
});

registry.register({
  ...submitAXSurveySchema,
  domain: 'outcome',
  aliases: ['submit_ax_survey'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSubmitAXSurvey(ctx.service, args as any);
  },
});

registry.register({
  ...getAXSurveyAnalysisSchema,
  domain: 'outcome',
  aliases: ['get_ax_survey_analysis'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetAXSurveyAnalysis(ctx.service, args as any);
  },
});

registry.register({
  ...getAXEvaluationSchema,
  domain: 'outcome',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetAXEvaluation(ctx.service, args as any);
  },
});

registry.register({
  ...submitSessionFeedbackSchema,
  domain: 'outcome',
  aliases: ['submit_session_feedback'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSubmitSessionFeedback(ctx.service, args as any);
  },
});

registry.register({
  ...recordTaskOutcomeSchema,
  domain: 'outcome',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRecordTaskOutcome(ctx.service, args as any);
  },
});

registry.register({
  ...getTaskOutcomeSchema,
  domain: 'outcome',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTaskOutcome(ctx.service, args as any);
  },
});

registry.register({
  ...getTaskOutcomeMetricsSchema,
  domain: 'outcome',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTaskOutcomeMetrics(ctx.service, args as any);
  },
});
