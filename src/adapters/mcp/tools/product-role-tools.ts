/**
 * Product Role Tools
 *
 * Strategic decision, UX requirements, and technical plan recording.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { recordStrategicDecisionSchema, recordUxRequirementsSchema, recordTechnicalPlanSchema } from '../schemas/product-role-schemas.js';
import {
  handleRecordStrategicDecision,
  handleRecordUxRequirements,
  handleRecordTechnicalPlan,
} from '../handlers/product-role-handlers.js';

registry.register({
  ...recordStrategicDecisionSchema,
  domain: 'product-role',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRecordStrategicDecision({ coordination: ctx.coordination }, args as any);
  },
});

registry.register({
  ...recordUxRequirementsSchema,
  domain: 'product-role',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRecordUxRequirements({ coordination: ctx.coordination }, args as any);
  },
});

registry.register({
  ...recordTechnicalPlanSchema,
  domain: 'product-role',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRecordTechnicalPlan({ coordination: ctx.coordination }, args as any);
  },
});
