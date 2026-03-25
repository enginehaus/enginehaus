/**
 * Artifact & Dependency Tools
 *
 * Artifact management, dependencies, and task relationships.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  artifactLinkSchema,
  artifactListSchema,
  artifactRemoveSchema,
  artifactGetLineageSchema,
  artifactStoreSchema,
  artifactGetSchema,
  captureInsightSchema,
  artifactSearchSchema,
} from '../schemas/artifact-schemas.js';
import {
  addTaskDependencySchema,
  removeTaskDependencySchema,
  getBlockedTasksSchema,
  getTaskDependenciesSchema,
  linkTasksSchema,
  unlinkTasksSchema,
  getRelatedTasksSchema,
  suggestRelationshipsSchema,
  getRelatedLearningsSchema,
} from '../schemas/dependency-schemas.js';
import {
  handleArtifactLink,
  handleArtifactList,
  handleArtifactRemove,
  handleArtifactGetLineage,
  handleArtifactStore,
  handleArtifactGet,
  handleCaptureInsight,
  handleArtifactSearch,
} from '../handlers/artifact-handlers.js';
import {
  handleAddTaskDependency,
  handleRemoveTaskDependency,
  handleGetBlockedTasks,
  handleGetTaskDependencies,
  handleLinkTasks,
  handleUnlinkTasks,
  handleGetRelatedTasks,
  handleSuggestRelationships,
  handleGetRelatedLearnings,
} from '../handlers/dependency-handlers.js';

function artifactCtx(ctx: ToolContext) {
  return { service: ctx.service };
}

function depCtx(ctx: ToolContext) {
  return { service: ctx.service };
}

// --- Artifact tools ---

registry.register({
  ...artifactLinkSchema,
  domain: 'artifact',
  aliases: ['artifact_link'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleArtifactLink(artifactCtx(ctx), args as any);
  },
});

registry.register({
  ...artifactListSchema,
  domain: 'artifact',
  aliases: ['artifact_list'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleArtifactList(artifactCtx(ctx), args as any);
  },
});

registry.register({
  ...artifactRemoveSchema,
  domain: 'artifact',
  aliases: ['artifact_remove'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleArtifactRemove(artifactCtx(ctx), args as any);
  },
});

registry.register({
  ...artifactGetLineageSchema,
  domain: 'artifact',
  aliases: ['artifact_get_lineage'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleArtifactGetLineage(artifactCtx(ctx), args as any);
  },
});

registry.register({
  ...artifactStoreSchema,
  domain: 'artifact',
  aliases: ['artifact_store'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleArtifactStore(artifactCtx(ctx), args as any);
  },
});

registry.register({
  ...artifactGetSchema,
  domain: 'artifact',
  aliases: ['artifact_get'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleArtifactGet(artifactCtx(ctx), args as any);
  },
});

registry.register({
  ...captureInsightSchema,
  domain: 'artifact',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCaptureInsight(artifactCtx(ctx), args as any);
  },
});

registry.register({
  ...artifactSearchSchema,
  domain: 'artifact',
  aliases: ['artifact_search'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleArtifactSearch(artifactCtx(ctx), args as any);
  },
});

// --- Dependency tools ---

registry.register({
  ...addTaskDependencySchema,
  domain: 'dependency',
  aliases: ['add_task_dependency'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleAddTaskDependency(depCtx(ctx), args as any);
  },
});

registry.register({
  ...removeTaskDependencySchema,
  domain: 'dependency',
  aliases: ['remove_task_dependency'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleRemoveTaskDependency(depCtx(ctx), args as any);
  },
});

registry.register({
  ...getBlockedTasksSchema,
  domain: 'dependency',
  handler: async (ctx: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetBlockedTasks(depCtx(ctx));
  },
});

registry.register({
  ...getTaskDependenciesSchema,
  domain: 'dependency',
  aliases: ['get_task_dependencies'],
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTaskDependencies(depCtx(ctx), args as any);
  },
});

registry.register({
  ...linkTasksSchema,
  domain: 'dependency',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleLinkTasks(depCtx(ctx), args as any);
  },
});

registry.register({
  ...unlinkTasksSchema,
  domain: 'dependency',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleUnlinkTasks(depCtx(ctx), args as any);
  },
});

registry.register({
  ...getRelatedTasksSchema,
  domain: 'dependency',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetRelatedTasks(depCtx(ctx), args as any);
  },
});

registry.register({
  ...suggestRelationshipsSchema,
  domain: 'dependency',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSuggestRelationships(depCtx(ctx), args as any);
  },
});

registry.register({
  ...getRelatedLearningsSchema,
  domain: 'dependency',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetRelatedLearnings(depCtx(ctx), args as any);
  },
});
