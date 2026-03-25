/**
 * Workflow Tools
 *
 * Primary interface: start_work and finish_work.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { startWorkSchema, finishWorkSchema } from '../schemas/workflow-schemas.js';
import { handleStartWork, handleFinishWork, type StartWorkParams, type FinishWorkParams } from '../handlers/workflow-handlers.js';

registry.register({
  ...startWorkSchema,
  domain: 'workflow',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleStartWork(
      { service: ctx.service, coordination: ctx.coordination, projectRoot: ctx.projectRoot, resolvedAgentId: ctx.resolvedAgentId },
      args as unknown as StartWorkParams,
    );
  },
});

registry.register({
  ...finishWorkSchema,
  domain: 'workflow',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleFinishWork(
      { service: ctx.service, coordination: ctx.coordination, projectRoot: ctx.projectRoot, resolvedAgentId: ctx.resolvedAgentId },
      args as unknown as FinishWorkParams,
    );
  },
});
