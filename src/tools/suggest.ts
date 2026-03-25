/**
 * Consolidated Suggestion Tool
 *
 * Combines 3 suggestion tools into 1 with a `mode` parameter:
 * - get_task_suggestions → mode: "next"
 * - get_suggestions_by_category → mode: "by_category"
 * - analyze_task_health → mode: "health"
 *
 * All answer: "what should I work on?"
 */

import { CoordinationService } from '../core/services/coordination-service.js';
import { SuggestionCategory } from '../ai/task-suggestions.js';

export type SuggestMode = 'next' | 'by_category' | 'health';

export interface SuggestParams {
  mode: SuggestMode;
  // next/by_category options
  limit?: number;
  categories?: SuggestionCategory[];
  recentFiles?: string[];
  expertiseAreas?: string[];
  availableMinutes?: number;
}

export const suggestToolSchema = {
  name: 'suggest',
  description: 'Get intelligent task recommendations. Modes: "next" (top N suggestions), "by_category" (grouped by urgency/momentum/etc), "health" (project task health analysis)',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['next', 'by_category', 'health'],
        description: 'Suggestion mode',
      },
      limit: {
        type: 'number',
        description: 'Max suggestions to return (next mode, default: 5)',
      },
      categories: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['urgent', 'momentum', 'unblock', 'quick-win', 'strategic', 'maintenance', 'exploration'],
        },
        description: 'Filter by suggestion categories (next mode)',
      },
      recentFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files you recently worked on (for momentum suggestions)',
      },
      expertiseAreas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Your expertise areas (e.g., "typescript", "react", "api")',
      },
      availableMinutes: {
        type: 'number',
        description: 'How many minutes you have available (affects quick-win scoring)',
      },
    },
    required: ['mode'],
  },
};

export async function handleSuggest(
  service: CoordinationService,
  args: SuggestParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: any;

  switch (args.mode) {
    case 'next':
      result = await service.getTaskSuggestions({
        limit: args.limit,
        categories: args.categories,
        recentFiles: args.recentFiles,
        expertiseAreas: args.expertiseAreas,
        availableMinutes: args.availableMinutes,
      });
      break;

    case 'by_category':
      result = await service.getSuggestionsByCategory({
        recentFiles: args.recentFiles,
        expertiseAreas: args.expertiseAreas,
      });
      break;

    case 'health':
      result = await service.analyzeProjectTaskHealth();
      break;

    default:
      throw new Error(`Unknown suggest mode: ${args.mode}`);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
