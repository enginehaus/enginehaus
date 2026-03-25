/**
 * Dependency Tool Handlers
 *
 * Handlers for task dependency and relationship MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';

/**
 * Context required by dependency handlers
 */
export interface DependencyHandlerContext {
  service: CoordinationService;
}

// Parameter interfaces
export interface AddTaskDependencyParams {
  blockerTaskId: string;
  blockedTaskId: string;
}

export interface RemoveTaskDependencyParams {
  blockerTaskId: string;
  blockedTaskId: string;
}

export interface GetTaskDependenciesParams {
  taskId: string;
}

export type RelationshipType = 'related_to' | 'part_of' | 'informed_by' | 'supersedes' | 'similar_to' | 'duplicates';

export interface LinkTasksParams {
  sourceTaskId: string;
  targetTaskId: string;
  relationshipType: RelationshipType;
  description?: string;
  bidirectional?: boolean;
}

export interface UnlinkTasksParams {
  sourceTaskId: string;
  targetTaskId: string;
  relationshipType?: RelationshipType;
  bidirectional?: boolean;
}

export interface GetRelatedTasksParams {
  taskId: string;
  relationshipType?: RelationshipType;
  direction?: 'outgoing' | 'incoming' | 'both';
  includeTaskDetails?: boolean;
}

export interface SuggestRelationshipsParams {
  taskId: string;
  minOverlapScore?: number;
  limit?: number;
}

export interface GetRelatedLearningsParams {
  taskId: string;
}

export async function handleAddTaskDependency(
  ctx: DependencyHandlerContext,
  args: AddTaskDependencyParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Prevent self-dependency
  if (args.blockerTaskId === args.blockedTaskId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, message: 'A task cannot block itself' }, null, 2),
      }],
    };
  }

  const result = await ctx.service.addTaskDependency(args.blockerTaskId, args.blockedTaskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleRemoveTaskDependency(
  ctx: DependencyHandlerContext,
  args: RemoveTaskDependencyParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.removeTaskDependency(args.blockerTaskId, args.blockedTaskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetBlockedTasks(
  ctx: DependencyHandlerContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const blockedTasks = await ctx.service.getBlockedTasks();
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        blockedTasks: blockedTasks.map(t => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          blockedBy: t.blockedBy,
        })),
        count: blockedTasks.length,
      }, null, 2),
    }],
  };
}

export async function handleGetTaskDependencies(
  ctx: DependencyHandlerContext,
  args: GetTaskDependenciesParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getTaskDependenciesWithDetails(args.taskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleLinkTasks(
  ctx: DependencyHandlerContext,
  args: LinkTasksParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.linkTasks({
    sourceTaskId: args.sourceTaskId,
    targetTaskId: args.targetTaskId,
    relationshipType: args.relationshipType,
    description: args.description,
    bidirectional: args.bidirectional,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleUnlinkTasks(
  ctx: DependencyHandlerContext,
  args: UnlinkTasksParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.unlinkTasks({
    sourceTaskId: args.sourceTaskId,
    targetTaskId: args.targetTaskId,
    relationshipType: args.relationshipType,
    bidirectional: args.bidirectional,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetRelatedTasks(
  ctx: DependencyHandlerContext,
  args: GetRelatedTasksParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getRelatedTasks({
    taskId: args.taskId,
    relationshipType: args.relationshipType,
    direction: args.direction,
    includeTaskDetails: args.includeTaskDetails,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleSuggestRelationships(
  ctx: DependencyHandlerContext,
  args: SuggestRelationshipsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.suggestRelationships({
    taskId: args.taskId,
    minOverlapScore: args.minOverlapScore,
    limit: args.limit,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetRelatedLearnings(
  ctx: DependencyHandlerContext,
  args: GetRelatedLearningsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getRelatedLearnings(args.taskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
