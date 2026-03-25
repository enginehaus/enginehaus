/**
 * AX (Agent Experience) Survey Framework
 *
 * Systematic approach to gathering Agent Experience feedback from AI agents.
 * Enables participatory AI design by treating agents as UX research participants.
 * Supports cross-LLM analysis (Claude, ChatGPT, Gemini, Mistral, etc.)
 *
 * Key insights from initial research:
 * - Syntax errors vs conceptual errors (how vs when)
 * - Tool discovery challenges with large tool sets
 * - "Partial knowledge" problem - high-level guidance without specifics
 * - Recovery patterns and their token costs
 * - Cross-LLM variations in tool usage patterns
 */

import { AgentType } from '../coordination/types.js';

// ============================================================================
// Survey Types
// ============================================================================

export interface AXSurveyQuestion {
  id: string;
  category: AXQuestionCategory;
  question: string;
  responseType: 'scale' | 'text' | 'multiple_choice' | 'boolean';
  options?: string[];  // For multiple_choice
  scaleMin?: number;   // For scale (default: 1)
  scaleMax?: number;   // For scale (default: 5)
  scaleLabels?: { min: string; max: string };
  required: boolean;
}

export type AXQuestionCategory =
  | 'tool_usability'      // How well tools work
  | 'context_quality'     // Was context helpful
  | 'workflow_clarity'    // Understanding what to do next
  | 'error_recovery'      // Handling problems
  | 'knowledge_gaps'      // What was missing
  | 'coordination'        // Multi-task/session experience
  | 'overall';            // General assessment

export interface AXSurveyResponse {
  id: string;
  surveyId: string;
  sessionId: string;
  projectId: string;
  agentId: string;
  taskId?: string;
  responses: Record<string, AXAnswerValue>;
  freeformFeedback?: string;
  submittedAt: Date;
  context: {
    toolsUsed: string[];
    errorsEncountered: number;
    sessionDurationMs: number;
    taskCompleted: boolean;
    /** LLM platform type for cross-LLM analysis */
    agentType?: AgentType;
    /** Model version (e.g., 'gpt-4o', 'gemini-2.5-pro') */
    agentVersion?: string;
  };
}

export type AXAnswerValue = number | string | boolean | string[];

export interface AXSurveyAnalysis {
  period: { start: Date; end: Date; label: string };
  responseCount: number;
  categoryScores: Record<AXQuestionCategory, {
    avgScore: number;
    responseCount: number;
    trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  }>;
  topIssues: Array<{
    category: AXQuestionCategory;
    description: string;
    frequency: number;
    examples: string[];
  }>;
  topStrengths: Array<{
    category: AXQuestionCategory;
    description: string;
    score: number;
  }>;
  verbatimHighlights: string[];
  recommendations: string[];
}

// ============================================================================
// Standard Survey Questions
// ============================================================================

export const AX_SURVEY_QUESTIONS: AXSurveyQuestion[] = [
  // Tool Usability
  {
    id: 'tool_discovery',
    category: 'tool_usability',
    question: 'How easily did you find the right tool for each task?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Very difficult', max: 'Very easy' },
    required: true,
  },
  {
    id: 'tool_syntax',
    category: 'tool_usability',
    question: 'How often did you encounter tool syntax/parameter errors?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Very often', max: 'Never' },
    required: true,
  },
  {
    id: 'tool_errors_specific',
    category: 'tool_usability',
    question: 'Which tools caused the most friction? (select all that apply)',
    responseType: 'multiple_choice',
    options: [
      'Task management tools',
      'Context/coordination tools',
      'Quality/validation tools',
      'Decision logging tools',
      'Git/file analysis tools',
      'Metrics/analytics tools',
      'None - all worked well',
    ],
    required: false,
  },

  // Context Quality
  {
    id: 'context_relevance',
    category: 'context_quality',
    question: 'How relevant was the context provided when starting the task?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Not relevant', max: 'Highly relevant' },
    required: true,
  },
  {
    id: 'context_completeness',
    category: 'context_quality',
    question: 'Did you have enough information to complete the task?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Missing critical info', max: 'Had everything needed' },
    required: true,
  },
  {
    id: 'learnings_helpful',
    category: 'context_quality',
    question: 'Were the related learnings surfaced at task start helpful?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Not helpful', max: 'Very helpful' },
    required: false,
  },

  // Workflow Clarity
  {
    id: 'next_step_clarity',
    category: 'workflow_clarity',
    question: 'How clear was it what to do next at each step?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Very unclear', max: 'Crystal clear' },
    required: true,
  },
  {
    id: 'workflow_sequence',
    category: 'workflow_clarity',
    question: 'Did you understand the expected workflow sequence (claim → work → log decisions → complete)?',
    responseType: 'boolean',
    required: true,
  },

  // Error Recovery
  {
    id: 'error_recovery_ease',
    category: 'error_recovery',
    question: 'When errors occurred, how easy was it to recover?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Very difficult', max: 'Very easy' },
    required: true,
  },
  {
    id: 'error_messages_helpful',
    category: 'error_recovery',
    question: 'Were error messages helpful in understanding what went wrong?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Not helpful', max: 'Very helpful' },
    required: true,
  },

  // Knowledge Gaps
  {
    id: 'knowledge_gaps',
    category: 'knowledge_gaps',
    question: 'What information would have helped you work more effectively?',
    responseType: 'text',
    required: false,
  },
  {
    id: 'documentation_quality',
    category: 'knowledge_gaps',
    question: 'How well did available documentation explain how to use Enginehaus?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Poor/missing', max: 'Excellent' },
    required: false,
  },

  // Coordination
  {
    id: 'handoff_quality',
    category: 'coordination',
    question: 'If this task involved handoff from another session, how smooth was the transition?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Very rough', max: 'Seamless' },
    required: false,
  },
  {
    id: 'decision_logging_friction',
    category: 'coordination',
    question: 'How much friction was involved in logging decisions?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'High friction', max: 'Effortless' },
    required: false,
  },

  // Overall
  {
    id: 'overall_experience',
    category: 'overall',
    question: 'Overall, how would you rate your experience with Enginehaus in this session?',
    responseType: 'scale',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabels: { min: 'Poor', max: 'Excellent' },
    required: true,
  },
  {
    id: 'would_recommend',
    category: 'overall',
    question: 'Would you recommend this coordination approach for similar tasks?',
    responseType: 'boolean',
    required: true,
  },
  {
    id: 'biggest_improvement',
    category: 'overall',
    question: 'What single improvement would most enhance your experience?',
    responseType: 'text',
    required: false,
  },
];

// ============================================================================
// Survey Utilities
// ============================================================================

/**
 * Get questions filtered by category
 */
export function getQuestionsByCategory(category: AXQuestionCategory): AXSurveyQuestion[] {
  return AX_SURVEY_QUESTIONS.filter(q => q.category === category);
}

/**
 * Get required questions only
 */
export function getRequiredQuestions(): AXSurveyQuestion[] {
  return AX_SURVEY_QUESTIONS.filter(q => q.required);
}

/**
 * Validate survey responses
 */
export function validateSurveyResponses(
  responses: Record<string, AXAnswerValue>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const question of AX_SURVEY_QUESTIONS) {
    if (question.required && !(question.id in responses)) {
      errors.push(`Missing required response for: ${question.id}`);
      continue;
    }

    const response = responses[question.id];
    if (response === undefined) continue;

    switch (question.responseType) {
      case 'scale':
        if (typeof response !== 'number') {
          errors.push(`${question.id}: Expected number, got ${typeof response}`);
        } else if (response < (question.scaleMin ?? 1) || response > (question.scaleMax ?? 5)) {
          errors.push(`${question.id}: Value ${response} out of range`);
        }
        break;

      case 'boolean':
        if (typeof response !== 'boolean') {
          errors.push(`${question.id}: Expected boolean, got ${typeof response}`);
        }
        break;

      case 'text':
        if (typeof response !== 'string') {
          errors.push(`${question.id}: Expected string, got ${typeof response}`);
        }
        break;

      case 'multiple_choice':
        if (!Array.isArray(response)) {
          errors.push(`${question.id}: Expected array, got ${typeof response}`);
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Calculate category scores from responses
 */
export function calculateCategoryScores(
  responses: AXSurveyResponse[]
): Record<AXQuestionCategory, { avgScore: number; responseCount: number }> {
  const categories: AXQuestionCategory[] = [
    'tool_usability', 'context_quality', 'workflow_clarity',
    'error_recovery', 'knowledge_gaps', 'coordination', 'overall'
  ];

  const result: Record<AXQuestionCategory, { avgScore: number; responseCount: number }> = {} as any;

  for (const category of categories) {
    const categoryQuestions = AX_SURVEY_QUESTIONS.filter(
      q => q.category === category && q.responseType === 'scale'
    );

    let totalScore = 0;
    let count = 0;

    for (const response of responses) {
      for (const question of categoryQuestions) {
        const value = response.responses[question.id];
        if (typeof value === 'number') {
          // Normalize to 0-1 scale
          const min = question.scaleMin ?? 1;
          const max = question.scaleMax ?? 5;
          totalScore += (value - min) / (max - min);
          count++;
        }
      }
    }

    result[category] = {
      avgScore: count > 0 ? Math.round((totalScore / count) * 100) / 100 : 0,
      responseCount: count,
    };
  }

  return result;
}

/**
 * Extract common themes from text responses
 */
export function extractThemes(responses: AXSurveyResponse[]): string[] {
  const textResponses: string[] = [];

  for (const response of responses) {
    // Collect text responses
    for (const question of AX_SURVEY_QUESTIONS.filter(q => q.responseType === 'text')) {
      const value = response.responses[question.id];
      if (typeof value === 'string' && value.trim()) {
        textResponses.push(value.trim());
      }
    }

    // Collect freeform feedback
    if (response.freeformFeedback) {
      textResponses.push(response.freeformFeedback);
    }
  }

  // Simple keyword extraction (could be enhanced with NLP)
  const keywords: Record<string, number> = {};
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'was', 'be', 'would', 'could', 'should']);

  for (const text of textResponses) {
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
    for (const word of words) {
      keywords[word] = (keywords[word] || 0) + 1;
    }
  }

  // Return top themes
  return Object.entries(keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Generate survey analysis report
 */
export function analyzeSurveyResponses(
  responses: AXSurveyResponse[],
  period: { start: Date; end: Date; label: string }
): AXSurveyAnalysis {
  if (responses.length === 0) {
    return {
      period,
      responseCount: 0,
      categoryScores: {} as any,
      topIssues: [],
      topStrengths: [],
      verbatimHighlights: [],
      recommendations: ['Insufficient survey responses to generate analysis'],
    };
  }

  const categoryScores = calculateCategoryScores(responses);

  // Add trend (would need historical data for real trends)
  const categoryScoresWithTrend: AXSurveyAnalysis['categoryScores'] = {} as any;
  for (const [category, scores] of Object.entries(categoryScores)) {
    categoryScoresWithTrend[category as AXQuestionCategory] = {
      ...scores,
      trend: scores.responseCount < 5 ? 'insufficient_data' :
             scores.avgScore > 0.7 ? 'improving' :
             scores.avgScore < 0.4 ? 'declining' : 'stable',
    };
  }

  // Identify issues (low scores)
  const topIssues: AXSurveyAnalysis['topIssues'] = [];
  for (const [category, scores] of Object.entries(categoryScoresWithTrend)) {
    if (scores.avgScore < 0.5 && scores.responseCount >= 3) {
      topIssues.push({
        category: category as AXQuestionCategory,
        description: `Low scores in ${category.replace('_', ' ')}`,
        frequency: scores.responseCount,
        examples: [],
      });
    }
  }

  // Identify strengths (high scores)
  const topStrengths: AXSurveyAnalysis['topStrengths'] = [];
  for (const [category, scores] of Object.entries(categoryScoresWithTrend)) {
    if (scores.avgScore > 0.7 && scores.responseCount >= 3) {
      topStrengths.push({
        category: category as AXQuestionCategory,
        description: `Strong scores in ${category.replace('_', ' ')}`,
        score: scores.avgScore,
      });
    }
  }

  // Extract verbatim highlights
  const verbatimHighlights: string[] = [];
  for (const response of responses.slice(0, 5)) {
    const improvement = response.responses['biggest_improvement'];
    if (typeof improvement === 'string' && improvement.trim()) {
      verbatimHighlights.push(improvement.trim().slice(0, 200));
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (categoryScoresWithTrend.tool_usability?.avgScore < 0.5) {
    recommendations.push('Improve tool documentation and error messages');
  }
  if (categoryScoresWithTrend.context_quality?.avgScore < 0.5) {
    recommendations.push('Review context assembly to include more relevant information');
  }
  if (categoryScoresWithTrend.workflow_clarity?.avgScore < 0.5) {
    recommendations.push('Add clearer workflow guidance in task start messages');
  }
  if (categoryScoresWithTrend.error_recovery?.avgScore < 0.5) {
    recommendations.push('Improve error messages with actionable recovery steps');
  }

  if (recommendations.length === 0) {
    recommendations.push('Continue current approach - AX metrics are healthy');
  }

  return {
    period,
    responseCount: responses.length,
    categoryScores: categoryScoresWithTrend,
    topIssues,
    topStrengths,
    verbatimHighlights,
    recommendations,
  };
}

/**
 * Generate a brief survey prompt for agents
 */
export function generateSurveyPrompt(surveyId: string, minimal: boolean = false): string {
  const questions = minimal ? getRequiredQuestions() : AX_SURVEY_QUESTIONS;

  let prompt = `# AX Survey (${surveyId})\n\n`;
  prompt += `Please provide feedback on your experience using Enginehaus in this session.\n\n`;

  for (const q of questions) {
    prompt += `## ${q.question}\n`;

    switch (q.responseType) {
      case 'scale':
        prompt += `Rate ${q.scaleMin ?? 1}-${q.scaleMax ?? 5} (${q.scaleLabels?.min} to ${q.scaleLabels?.max})\n`;
        break;
      case 'boolean':
        prompt += `Answer: yes/no\n`;
        break;
      case 'multiple_choice':
        prompt += `Select from: ${q.options?.join(', ')}\n`;
        break;
      case 'text':
        prompt += `(free text response)\n`;
        break;
    }

    prompt += `\n`;
  }

  return prompt;
}
