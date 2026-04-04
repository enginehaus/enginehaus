/**
 * Workflow Configuration Tools
 *
 * User-facing workflow configuration via MCP.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { configureWorkflowSchema, getWorkflowConfigSchema } from '../schemas/workflow-config-schemas.js';
import {
  handleConfigureWorkflow,
  handleGetWorkflowConfig,
  type ConfigureWorkflowParams,
} from '../handlers/workflow-config-handlers.js';

registry.register({
  ...configureWorkflowSchema,
  domain: 'workflow',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleConfigureWorkflow(
      { service: ctx.service, resolvedAgentId: ctx.resolvedAgentId, getProjectContext: ctx.getProjectContext },
      args as unknown as ConfigureWorkflowParams,
    );
  },
});

registry.register({
  ...getWorkflowConfigSchema,
  domain: 'workflow',
  handler: async (ctx: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetWorkflowConfig(
      { service: ctx.service, resolvedAgentId: ctx.resolvedAgentId, getProjectContext: ctx.getProjectContext },
    );
  },
});
