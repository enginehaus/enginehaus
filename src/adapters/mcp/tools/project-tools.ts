/**
 * Project Tools
 *
 * Project CRUD and active project management.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  createProjectSchema,
  listProjectsSchema,
  getProjectSchema,
  setActiveProjectSchema,
  getActiveProjectSchema,
  updateProjectSchema,
  deleteProjectSchema,
} from '../schemas/project-schemas.js';
import {
  handleCreateProject,
  handleListProjects,
  handleGetProject,
  handleSetActiveProject,
  handleGetActiveProject,
  handleUpdateProject,
  handleDeleteProject,
} from '../handlers/project-handlers.js';

function projectCtx(ctx: ToolContext) {
  return { service: ctx.service };
}

registry.register({
  ...createProjectSchema,
  domain: 'project',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCreateProject(projectCtx(ctx), args as any);
  },
});

registry.register({
  ...listProjectsSchema,
  domain: 'project',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleListProjects(projectCtx(ctx), args as any);
  },
});

registry.register({
  ...getProjectSchema,
  domain: 'project',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetProject(projectCtx(ctx), args as any);
  },
});

registry.register({
  ...setActiveProjectSchema,
  domain: 'project',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSetActiveProject(projectCtx(ctx), args as any);
  },
});

registry.register({
  ...getActiveProjectSchema,
  domain: 'project',
  handler: async (ctx: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetActiveProject(projectCtx(ctx));
  },
});

registry.register({
  ...updateProjectSchema,
  domain: 'project',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleUpdateProject(projectCtx(ctx), args as any);
  },
});

registry.register({
  ...deleteProjectSchema,
  domain: 'project',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleDeleteProject(projectCtx(ctx), args as any);
  },
});
