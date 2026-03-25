/**
 * Outcome-Based Analytics Tool Schemas
 *
 * Schema definitions for outcome-based analytics and AX survey MCP tools.
 */

export const getOutcomeMetricsSchema = {
  name: 'get_outcome_metrics',
  description: 'Get outcome-based analytics that measure actual value: token efficiency, human time savings, quality outcomes. Replaces vanity metrics with actionable insights.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time period for metrics (default: week)',
      },
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
    },
  },
};

export const getValueDashboardSchema = {
  name: 'get_value_dashboard',
  description: 'Generate a comprehensive value dashboard with insights, trends, and recommendations. Shows what coordination is actually delivering.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time period for dashboard (default: week)',
      },
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
      includeTrends: { type: 'boolean', description: 'Include trend analysis vs previous period (default: true)' },
    },
  },
};

export const getAXMetricsSchema = {
  name: 'get_ax_metrics',
  description: 'Get Agent Experience (AX) metrics measuring the effectiveness of AX features. Tracks: (1) Task reopen rate - measures Completion Checklist Agent effectiveness, (2) Decision duplication rate - measures Related Learnings effectiveness. Use to evaluate whether AX features are actually improving agent behavior.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time period for metrics (default: week)',
      },
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
    },
  },
};

export const getAXSurveyQuestionsSchema = {
  name: 'get_survey',
  description: 'Get the AX (Agent Experience) survey questions. Use this to see what questions will be asked in the survey. Can filter by category or get minimal (required only) questions.',
  inputSchema: {
    type: 'object',
    properties: {
      minimal: { type: 'boolean', description: 'Only return required questions (default: false)' },
      category: {
        type: 'string',
        enum: ['tool_usability', 'context_quality', 'workflow_clarity', 'error_recovery', 'knowledge_gaps', 'coordination', 'overall'],
        description: 'Filter questions by category',
      },
    },
  },
};

export const submitAXSurveySchema = {
  name: 'submit_survey',
  description: 'Submit your Agent Experience survey responses. This participatory feedback helps improve Enginehaus for all agents. Answer honestly - your experience matters for AX research.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Current session ID (required)' },
      agentId: { type: 'string', description: 'Your agent identifier (required)' },
      taskId: { type: 'string', description: 'Associated task ID if applicable' },
      responses: {
        type: 'object',
        description: 'Survey responses keyed by question ID (see get_ax_survey_questions)',
        additionalProperties: true,
      },
      freeformFeedback: { type: 'string', description: 'Any additional feedback or suggestions' },
      context: {
        type: 'object',
        properties: {
          toolsUsed: { type: 'array', items: { type: 'string' }, description: 'Tools used this session' },
          errorsEncountered: { type: 'number', description: 'Number of errors encountered' },
          sessionDurationMs: { type: 'number', description: 'Session duration in milliseconds' },
          taskCompleted: { type: 'boolean', description: 'Whether the task was completed' },
        },
      },
    },
    required: ['sessionId', 'agentId', 'responses'],
  },
};

export const getAXSurveyAnalysisSchema = {
  name: 'get_feedback_analysis',
  description: 'Get aggregated analysis of AX survey responses. Shows category scores, trends, top issues and strengths, and recommendations for improving agent experience.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time period for analysis (default: week)',
      },
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
    },
  },
};

export const getAXEvaluationSchema = {
  name: 'get_ax_evaluation',
  description: 'Generate comprehensive AX evaluation report with interpreted metrics, health scores, and prioritized recommendations. Combines instrumentation data (reopen rates, duplication rates) with survey feedback to assess whether Enginehaus is achieving its agent experience goals.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time period for evaluation (default: week)',
      },
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
      includeRecommendations: {
        type: 'boolean',
        description: 'Include prioritized recommendations (default: true)',
      },
    },
  },
};

export const submitSessionFeedbackSchema = {
  name: 'submit_feedback',
  description: 'Submit productivity feedback for a session. Quick pulse rating (1-5) and optional friction tags help measure human time value.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID (required)' },
      taskId: { type: 'string', description: 'Associated task ID' },
      productivityRating: {
        type: 'number',
        minimum: 1,
        maximum: 5,
        description: 'Quick pulse: Was this session productive? (1=very unproductive, 5=very productive)',
      },
      frictionTags: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['repeated_context', 'wrong_context', 'tool_confusion', 'missing_files', 'slow_response', 'unclear_task', 'dependency_blocked', 'quality_rework', 'scope_creep', 'other'],
        },
        description: 'What slowed you down? (optional)',
      },
      notes: { type: 'string', description: 'Additional feedback notes' },
    },
    required: ['sessionId'],
  },
};

// ============================================================================
// Task Outcome Tracking (Real-world results)
// ============================================================================

export const recordTaskOutcomeSchema = {
  name: 'record_task_outcome',
  description: 'Record the real-world outcome of a completed task. Use AFTER the work ships (PR merged, deployed). Tracks what actually happened vs just completing the task. Essential for measuring true value delivery.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID (required)' },
      status: {
        type: 'string',
        enum: ['pending', 'shipped', 'rejected', 'rework', 'abandoned'],
        description: 'Outcome status: shipped=merged/deployed, rejected=PR rejected, rework=needed fixes, abandoned=never shipped',
      },
      prUrl: { type: 'string', description: 'URL to the PR (if applicable)' },
      prMerged: { type: 'boolean', description: 'Did the PR merge?' },
      prMergedAt: { type: 'string', format: 'date-time', description: 'When did the PR merge?' },
      reviewFeedback: { type: 'string', description: 'Summary of review feedback received' },
      ciPassed: { type: 'boolean', description: 'Did CI pass?' },
      ciFirstTryPass: { type: 'boolean', description: 'Did CI pass on first attempt? (no retries/fixes needed)' },
      testFailures: { type: 'number', description: 'Number of test failures encountered' },
      deployed: { type: 'boolean', description: 'Was the work deployed?' },
      deployedAt: { type: 'string', format: 'date-time', description: 'When was it deployed?' },
      deployEnvironment: { type: 'string', description: 'Where was it deployed? (production, staging, etc.)' },
      reworkRequired: { type: 'boolean', description: 'Was significant rework needed after completion?' },
      reworkReason: { type: 'string', description: 'Why was rework needed?' },
      reworkTaskId: { type: 'string', description: 'ID of follow-up task if rework created new task' },
      reviewerSatisfaction: {
        type: 'number',
        minimum: 1,
        maximum: 5,
        description: 'Reviewer satisfaction rating (1-5)',
      },
      notes: { type: 'string', description: 'Any additional context about the outcome' },
    },
    required: ['taskId', 'status'],
  },
};

export const getTaskOutcomeSchema = {
  name: 'get_task_outcome',
  description: 'Get the recorded outcome for a specific task. Shows what happened after completion: PR status, CI results, deployment status, rework needed.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID (required)' },
    },
    required: ['taskId'],
  },
};

export const getTaskOutcomeMetricsSchema = {
  name: 'get_task_outcome_metrics',
  description: 'Get aggregated outcome metrics for a project. Shows ship rate, rework rate, CI first-try pass rate, time-to-merge, and more. Measures true value delivery vs just activity.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
      period: {
        type: 'string',
        enum: ['day', 'week', 'month'],
        description: 'Time period for metrics (default: week)',
      },
    },
  },
};

export const outcomeSchemas = [
  getOutcomeMetricsSchema,
  getValueDashboardSchema,
  getAXSurveyQuestionsSchema,
  submitAXSurveySchema,
  getAXSurveyAnalysisSchema,
  submitSessionFeedbackSchema,
  // Task outcome tracking (real-world results)
  recordTaskOutcomeSchema,
  getTaskOutcomeSchema,
  getTaskOutcomeMetricsSchema,
];
