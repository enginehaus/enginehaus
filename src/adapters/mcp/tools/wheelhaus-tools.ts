/**
 * Wheelhaus Tools
 *
 * Project dashboard for human review.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { viewWheelhausSchema } from '../schemas/wheelhaus-schemas.js';
import { handleViewWheelhaus } from '../handlers/wheelhaus-handlers.js';

registry.register({
  ...viewWheelhausSchema,
  domain: 'wheelhaus',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleViewWheelhaus(ctx.service, args as any) as Promise<ToolResult>;
  },
});
