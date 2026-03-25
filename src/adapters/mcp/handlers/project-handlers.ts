/**
 * Project Tool Handlers
 *
 * Handlers for project management MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { ProjectDomain } from '../../../coordination/types.js';
import { validateSchema, sanitizeString, sanitizeFilePath, SCHEMAS } from '../../../validation/validators.js';
import { expandPath } from '../../../utils/paths.js';

/**
 * Context required by project handlers
 */
export interface ProjectHandlerContext {
  service: CoordinationService;
}

// Parameter interfaces
export interface CreateProjectParams {
  name: string;
  slug: string;
  rootPath: string;
  domain: ProjectDomain;
  techStack?: string[];
  description?: string;
}

export interface ListProjectsParams {
  status?: 'active' | 'archived' | 'paused';
}

export interface GetProjectParams {
  projectId: string;
}

export interface SetActiveProjectParams {
  projectId: string;
}

export interface UpdateProjectParams {
  projectId: string;
  name?: string;
  description?: string;
  rootPath?: string;
  status?: 'active' | 'archived' | 'paused';
  techStack?: string[];
}

export interface DeleteProjectParams {
  projectId: string;
}

export async function handleCreateProject(
  ctx: ProjectHandlerContext,
  args: CreateProjectParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Validate input
  const validation = validateSchema(args as unknown as Record<string, unknown>, SCHEMAS.createProject);
  if (!validation.valid) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, errors: validation.errors }, null, 2) }],
      isError: true,
    };
  }

  // Sanitize inputs and delegate to CoordinationService
  const name = sanitizeString(args.name) || '';
  const slug = sanitizeString(args.slug)?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || '';
  const rootPath = sanitizeFilePath(args.rootPath) || '';
  const description = sanitizeString(args.description);

  const result = await ctx.service.createProjectWithResponse({
    name,
    slug,
    description,
    rootPath: expandPath(rootPath),
    domain: args.domain,
    techStack: args.techStack || [],
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleListProjects(
  ctx: ProjectHandlerContext,
  args: ListProjectsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.listProjectsWithResponse(args.status);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetProject(
  ctx: ProjectHandlerContext,
  args: GetProjectParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getProjectByIdOrSlug(args.projectId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleSetActiveProject(
  ctx: ProjectHandlerContext,
  args: SetActiveProjectParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.setActiveProjectWithResponse(args.projectId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetActiveProject(
  ctx: ProjectHandlerContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getActiveProjectWithResponse();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleUpdateProject(
  ctx: ProjectHandlerContext,
  args: UpdateProjectParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Expand rootPath before passing to service
  const result = await ctx.service.updateProjectByIdOrSlug(args.projectId, {
    name: args.name,
    description: args.description,
    rootPath: args.rootPath ? expandPath(args.rootPath) : undefined,
    status: args.status,
    techStack: args.techStack,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleDeleteProject(
  ctx: ProjectHandlerContext,
  args: DeleteProjectParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.deleteProjectByIdOrSlug(args.projectId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
