/**
 * Prompt Tools
 *
 * Prompt template listing and retrieval.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { listPromptsSchema, getPromptSchema } from '../schemas/prompt-schemas.js';
import { handleListPrompts, handleGetPrompt } from '../handlers/prompt-handlers.js';

registry.register({
  ...listPromptsSchema,
  domain: 'prompt',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListPrompts({ service: ctx.service }, args as any);
  },
});

registry.register({
  ...getPromptSchema,
  domain: 'prompt',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetPrompt({ service: ctx.service }, args as any);
  },
});
