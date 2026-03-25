/**
 * File-Lock Tools
 *
 * File-lock conflict detection.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import { getLockedFilesSchema, checkFileConflictsSchema } from '../schemas/file-lock-schemas.js';
import { handleGetLockedFiles, handleCheckFileConflicts } from '../handlers/file-lock-handlers.js';

registry.register({
  ...getLockedFilesSchema,
  domain: 'file-lock',
  handler: async (ctx: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetLockedFiles(ctx.service);
  },
});

registry.register({
  ...checkFileConflictsSchema,
  domain: 'file-lock',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCheckFileConflicts(ctx.service, args as any);
  },
});
