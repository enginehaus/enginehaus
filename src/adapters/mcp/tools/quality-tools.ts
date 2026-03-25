/**
 * Quality Tools
 *
 * Quality expectations and compliance checking.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { getQualityExpectationsSchema, checkQualityComplianceSchema } from '../schemas/quality-schemas.js';
import { handleGetQualityExpectations, handleCheckQualityCompliance } from '../handlers/quality-handlers.js';

registry.register({
  ...getQualityExpectationsSchema,
  domain: 'quality',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetQualityExpectations(ctx.service, args as any);
  },
});

registry.register({
  ...checkQualityComplianceSchema,
  domain: 'quality',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCheckQualityCompliance(ctx.service, args as any);
  },
});
