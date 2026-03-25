/**
 * Initiative Tools
 *
 * Initiative/outcome tracking.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  createInitiativeSchema,
  getInitiativeSchema,
  listInitiativesSchema,
  linkTaskToInitiativeSchema,
  recordInitiativeOutcomeSchema,
  updateInitiativeSchema,
  getInitiativeLearningsSchema,
  suggestInitiativesSchema,
} from '../schemas/initiative-schemas.js';
import {
  handleCreateInitiative,
  handleGetInitiative,
  handleListInitiatives,
  handleLinkTaskToInitiative,
  handleRecordInitiativeOutcome,
  handleUpdateInitiative,
  handleGetInitiativeLearnings,
  handleSuggestInitiatives,
} from '../handlers/initiative-handlers.js';

registry.register({
  ...createInitiativeSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCreateInitiative(ctx.service, args as any);
  },
});

registry.register({
  ...getInitiativeSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetInitiative(ctx.service, args as any);
  },
});

registry.register({
  ...listInitiativesSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListInitiatives(ctx.service, args as any);
  },
});

registry.register({
  ...linkTaskToInitiativeSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleLinkTaskToInitiative(ctx.service, args as any);
  },
});

registry.register({
  ...recordInitiativeOutcomeSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRecordInitiativeOutcome(ctx.service, args as any);
  },
});

registry.register({
  ...updateInitiativeSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleUpdateInitiative(ctx.service, args as any);
  },
});

registry.register({
  ...getInitiativeLearningsSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetInitiativeLearnings(ctx.service, args as any);
  },
});

registry.register({
  ...suggestInitiativesSchema,
  domain: 'initiative',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSuggestInitiatives(ctx.service, args as any);
  },
});
