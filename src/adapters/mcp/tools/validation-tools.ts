/**
 * Validation Tools
 *
 * Quality gate validation and CI integration.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { validateQualityGatesSchema, validateForCiSchema } from '../schemas/validation-schemas.js';
import { handleValidateQualityGates, handleValidateForCi } from '../handlers/validation-handlers.js';

registry.register({
  ...validateQualityGatesSchema,
  domain: 'validation',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleValidateQualityGates(
      { service: ctx.service, coordination: ctx.coordination, projectRoot: ctx.projectRoot },
      args as any,
    );
  },
});

registry.register({
  ...validateForCiSchema,
  domain: 'validation',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleValidateForCi(
      { service: ctx.service, coordination: ctx.coordination, projectRoot: ctx.projectRoot },
      args as any,
    );
  },
});
