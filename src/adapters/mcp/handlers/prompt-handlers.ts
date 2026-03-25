/**
 * Prompt Tool Handlers
 *
 * Handlers for prompt template MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import {
  listTemplates,
  getTemplate,
  fillTemplate,
  getTemplatesByType,
  TemplateCategory,
} from '../../../prompts/templates.js';

/**
 * Context required by prompt handlers
 */
export interface PromptHandlerContext {
  service: CoordinationService;
}

// Parameter interfaces
export interface ListPromptsParams {
  grouped?: boolean;
}

export interface GetPromptParams {
  templateId: string;
  taskId?: string;
  values?: Record<string, string>;
}

export async function handleListPrompts(
  _ctx: PromptHandlerContext,
  args: ListPromptsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const templates = listTemplates();

  if (args.grouped) {
    const grouped = getTemplatesByType();
    const result: Record<string, any[]> = {};

    for (const [category, ids] of Object.entries(grouped)) {
      result[category] = ids.map(id => {
        const template = getTemplate(id);
        return template ? {
          id: template.id,
          name: template.name,
          description: template.description,
        } : null;
      }).filter(Boolean);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          grouped: result,
          count: templates.length,
          message: 'Templates grouped by category',
        }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          contextRequired: t.contextRequired,
          qualityChecklist: t.qualityChecklist,
        })),
        count: templates.length,
        message: 'Available prompt templates',
      }, null, 2),
    }],
  };
}

export async function handleGetPrompt(
  ctx: PromptHandlerContext,
  args: GetPromptParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const template = getTemplate(args.templateId as TemplateCategory);

  if (!template) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `Template not found: ${args.templateId}`,
          availableTemplates: listTemplates().map(t => t.id),
        }, null, 2),
      }],
      isError: true,
    };
  }

  // Build values from task context if provided via CoordinationService
  let values: Record<string, string> = args.values || {};

  if (args.taskId) {
    const taskContext = await ctx.service.getTaskContextForPrompt(args.taskId);
    if (taskContext.success && taskContext.values) {
      // Merge task values with any explicit overrides
      values = {
        ...taskContext.values,
        ...values,  // Allow explicit values to override
      };
    }
  }

  // Fill the template
  const filled = fillTemplate(args.templateId as TemplateCategory, values);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        template: {
          id: template.id,
          name: template.name,
          description: template.description,
        },
        prompt: filled,
        qualityChecklist: template.qualityChecklist,
        message: args.taskId
          ? `Prompt generated with context from task ${args.taskId.substring(0, 8)}`
          : 'Prompt template ready - fill placeholders as needed',
      }, null, 2),
    }],
  };
}
