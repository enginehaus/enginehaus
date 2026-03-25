/**
 * Thought Tools
 *
 * Low-friction thought capture and review.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  captureThoughtSchema,
  reviewThoughtsSchema,
} from '../schemas/thought-schemas.js';
import {
  handleCaptureThought,
  handleReviewThoughts,
} from '../handlers/thought-handlers.js';

registry.register({
  ...captureThoughtSchema,
  domain: 'decision',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCaptureThought({ service: ctx.service, resolvedAgentId: ctx.resolvedAgentId }, args as any);
  },
});

registry.register({
  ...reviewThoughtsSchema,
  domain: 'decision',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleReviewThoughts(ctx.service, args as any);
  },
});
