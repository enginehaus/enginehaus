/**
 * Dependency Tool Schemas
 *
 * Schema definitions for task dependency and relationship MCP tools.
 */

export const addTaskDependencySchema = {
  name: 'add_dependency',
  description: 'Add a dependency between tasks. The blocker task must be completed before the blocked task can be started.',
  inputSchema: {
    type: 'object',
    properties: {
      blockerTaskId: { type: 'string', description: 'Task ID that blocks another task' },
      blockedTaskId: { type: 'string', description: 'Task ID that is blocked' },
    },
    required: ['blockerTaskId', 'blockedTaskId'],
  },
};

export const removeTaskDependencySchema = {
  name: 'remove_dependency',
  description: 'Remove a dependency between tasks',
  inputSchema: {
    type: 'object',
    properties: {
      blockerTaskId: { type: 'string', description: 'Task ID that was blocking' },
      blockedTaskId: { type: 'string', description: 'Task ID that was blocked' },
    },
    required: ['blockerTaskId', 'blockedTaskId'],
  },
};

export const getBlockedTasksSchema = {
  name: 'get_blocked_tasks',
  description: 'Get all tasks that are currently blocked by incomplete dependencies',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const getTaskDependenciesSchema = {
  name: 'get_dependencies',
  description: 'Get dependency information for a specific task (what it blocks and what blocks it)',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to get dependencies for' },
    },
    required: ['taskId'],
  },
};

export const linkTasksSchema = {
  name: 'link_tasks',
  description: 'Create a semantic relationship between two tasks. Use for "related to", "part of", "informed by", "supersedes", "similar to", or "duplicates" relationships. These are different from blocking dependencies - they capture context and associations.',
  inputSchema: {
    type: 'object',
    properties: {
      sourceTaskId: { type: 'string', description: 'Source task ID' },
      targetTaskId: { type: 'string', description: 'Target task ID' },
      relationshipType: {
        type: 'string',
        enum: ['related_to', 'part_of', 'informed_by', 'supersedes', 'similar_to', 'duplicates'],
        description: 'Type of relationship: related_to (general association), part_of (subtask of larger work), informed_by (learned from), supersedes (replaces), similar_to (overlapping concerns), duplicates (same work)'
      },
      description: { type: 'string', description: 'Optional description of the relationship' },
      bidirectional: { type: 'boolean', description: 'For symmetric relationships (related_to, similar_to), also create the reverse link', default: false },
    },
    required: ['sourceTaskId', 'targetTaskId', 'relationshipType'],
  },
};

export const unlinkTasksSchema = {
  name: 'unlink_tasks',
  description: 'Remove a semantic relationship between two tasks',
  inputSchema: {
    type: 'object',
    properties: {
      sourceTaskId: { type: 'string', description: 'Source task ID' },
      targetTaskId: { type: 'string', description: 'Target task ID' },
      relationshipType: {
        type: 'string',
        enum: ['related_to', 'part_of', 'informed_by', 'supersedes', 'similar_to', 'duplicates'],
        description: 'Specific relationship type to remove (omit to remove all relationships between these tasks)'
      },
      bidirectional: { type: 'boolean', description: 'Also remove the reverse relationship', default: false },
    },
    required: ['sourceTaskId', 'targetTaskId'],
  },
};

export const getRelatedTasksSchema = {
  name: 'get_related_tasks',
  description: 'Get all semantic relationships for a task. Returns related tasks with relationship types and optional full task details.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to get relationships for' },
      relationshipType: {
        type: 'string',
        enum: ['related_to', 'part_of', 'informed_by', 'supersedes', 'similar_to', 'duplicates'],
        description: 'Filter by specific relationship type'
      },
      direction: {
        type: 'string',
        enum: ['outgoing', 'incoming', 'both'],
        description: 'Filter by relationship direction',
        default: 'both'
      },
      includeTaskDetails: { type: 'boolean', description: 'Include full task details for related tasks', default: false },
    },
    required: ['taskId'],
  },
};

export const suggestRelationshipsSchema = {
  name: 'suggest_relationships',
  description: 'Get AI suggestions for task relationships based on file overlap. Finds tasks that share files and suggests linking them.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to find suggestions for' },
      minOverlapScore: { type: 'number', description: 'Minimum file overlap score (0-1)', default: 0.1 },
      limit: { type: 'number', description: 'Maximum suggestions to return', default: 10 },
    },
    required: ['taskId'],
  },
};

export const getRelatedLearningsSchema = {
  name: 'get_related_learnings',
  description: 'Get learnings from related completed tasks. Returns implementation summaries, decisions, quality metrics, and recommendations from tasks that have semantic relationships with the given task. Enables cross-session learning - agents inherit context from related work.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to get related learnings for' },
    },
    required: ['taskId'],
  },
};

export const dependencySchemas = [
  addTaskDependencySchema,
  removeTaskDependencySchema,
  getBlockedTasksSchema,
  getTaskDependenciesSchema,
  linkTasksSchema,
  unlinkTasksSchema,
  getRelatedTasksSchema,
  suggestRelationshipsSchema,
  getRelatedLearningsSchema,
];
