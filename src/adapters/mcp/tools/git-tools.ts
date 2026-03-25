/**
 * Git Tools
 *
 * Git status and pull request creation.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { getGitStatusSchema, createPullRequestSchema } from '../schemas/git-schemas.js';
import { handleGetGitStatus, handleCreatePullRequest } from '../handlers/git-handlers.js';

registry.register({
  ...getGitStatusSchema,
  domain: 'git',
  handler: async (ctx: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetGitStatus({ coordination: ctx.coordination, service: ctx.service });
  },
});

registry.register({
  ...createPullRequestSchema,
  domain: 'git',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCreatePullRequest({ coordination: ctx.coordination, service: ctx.service }, args as any);
  },
});
