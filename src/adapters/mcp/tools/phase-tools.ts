/**
 * Phase Tools
 *
 * Phase-based workflow management.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  listPhasesSchema,
  getTaskPhaseSchema,
  startTaskPhasesSchema,
  advancePhaseSchema,
  skipPhaseSchema,
} from '../schemas/phase-schemas.js';
import {
  handleListPhases,
  handleGetTaskPhase,
  handleStartTaskPhases,
  handleAdvancePhase,
  handleSkipPhase,
} from '../handlers/phase-handlers.js';

registry.register({
  ...listPhasesSchema,
  domain: 'phase',
  handler: async (_ctx: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListPhases();
  },
});

registry.register({
  ...getTaskPhaseSchema,
  domain: 'phase',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTaskPhase(ctx.service, args as any);
  },
});

registry.register({
  ...startTaskPhasesSchema,
  domain: 'phase',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleStartTaskPhases(ctx.service, args as any);
  },
});

registry.register({
  ...advancePhaseSchema,
  domain: 'phase',
  mutating: true,
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleAdvancePhase(ctx.service, args as any);
  },
});

registry.register({
  ...skipPhaseSchema,
  domain: 'phase',
  mutating: true,
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSkipPhase(ctx.service, args as any);
  },
});
