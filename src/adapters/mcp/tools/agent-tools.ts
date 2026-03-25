/**
 * Agent Tools
 *
 * Agent registration and lookup.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { registerAgentSchema, listAgentsSchema, getAgentSchema, updateAgentSchema } from '../schemas/agent-schemas.js';
import { handleRegisterAgent, handleListAgents, handleGetAgent, handleUpdateAgent } from '../handlers/agent-handlers.js';

registry.register({
  ...registerAgentSchema,
  domain: 'agent',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRegisterAgent(ctx.service, args as any);
  },
});

registry.register({
  ...listAgentsSchema,
  domain: 'agent',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListAgents(ctx.service, args as any);
  },
});

registry.register({
  ...getAgentSchema,
  domain: 'agent',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetAgent(ctx.service, args as any);
  },
});

registry.register({
  ...updateAgentSchema,
  domain: 'agent',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleUpdateAgent(ctx.service, args as any);
  },
});
