/**
 * Artifact Tool Handlers
 *
 * Handlers for artifact management MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { ArtifactType } from '../../../coordination/types.js';

/**
 * Context required by artifact handlers
 */
export interface ArtifactHandlerContext {
  service: CoordinationService;
}

// Parameter interfaces
export interface ArtifactLinkParams {
  taskId: string;
  type: string;
  uri: string;
  title?: string;
  description?: string;
  parentArtifactId?: string;
}

export interface ArtifactListParams {
  taskId: string;
  type?: string;
  includeContent?: boolean;
}

export interface ArtifactRemoveParams {
  artifactId: string;
}

export interface ArtifactGetLineageParams {
  artifactId: string;
}

export interface ArtifactStoreParams {
  taskId: string;
  type: ArtifactType;
  content: string;
  contentType: string;
  title?: string;
  description?: string;
  parentArtifactId?: string;
}

export interface ArtifactGetParams {
  artifactId: string;
  includeContent?: boolean;
}

export interface CaptureInsightParams {
  taskId: string;
  content: string;
  type: 'design' | 'rationale' | 'requirement' | 'note' | 'decision';
  title?: string;
}

export interface ArtifactSearchParams {
  query: string;
  type?: ArtifactType;
  projectId?: string;
  limit?: number;
}

export async function handleArtifactLink(
  ctx: ArtifactHandlerContext,
  args: ArtifactLinkParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await ctx.service.linkArtifact(args);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
    isError: !result.success,
  };
}

export async function handleArtifactList(
  ctx: ArtifactHandlerContext,
  args: ArtifactListParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.listArtifacts(args);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleArtifactRemove(
  ctx: ArtifactHandlerContext,
  args: ArtifactRemoveParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await ctx.service.removeArtifact(args.artifactId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
    isError: !result.success,
  };
}

export async function handleArtifactGetLineage(
  ctx: ArtifactHandlerContext,
  args: ArtifactGetLineageParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await ctx.service.getArtifactLineage(args.artifactId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
    isError: !result.success,
  };
}

export async function handleArtifactStore(
  ctx: ArtifactHandlerContext,
  args: ArtifactStoreParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await ctx.service.storeArtifact(args);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
    isError: !result.success,
  };
}

export async function handleArtifactGet(
  ctx: ArtifactHandlerContext,
  args: ArtifactGetParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const includeContent = args.includeContent !== false; // Default to true
  const result = await ctx.service.getArtifact(args.artifactId, includeContent);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
    isError: !result.success,
  };
}

export async function handleCaptureInsight(
  ctx: ArtifactHandlerContext,
  args: CaptureInsightParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await ctx.service.captureInsight({
    taskId: args.taskId,
    content: args.content,
    type: args.type,
    title: args.title,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
    isError: !result.success,
  };
}

export async function handleArtifactSearch(
  ctx: ArtifactHandlerContext,
  args: ArtifactSearchParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await ctx.service.searchArtifacts({
    query: args.query,
    type: args.type,
    projectId: args.projectId,
    limit: args.limit,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
    isError: !result.success,
  };
}
