/**
 * Coordination Tool Schemas
 *
 * Schema definitions for coordination context and task graph MCP tools.
 */

export const getCoordinationContextSchema = {
  name: 'get_coordination_context',
  description: 'Get project status, active tasks, bottlenecks, and role-specific recommendations for your next action.',
  inputSchema: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        enum: ['product-manager', 'ux-director', 'technical-lead', 'claude-code'],
        description: 'Role requesting context',
      },
    },
    required: ['role'],
  },
};

export const getTaskGraphSchema = {
  name: 'view_task_graph',
  description: 'Get visual ASCII task graph with multiple view modes. Developer view shows workable tasks, Lead view shows bottlenecks, Session view shows recent activity.',
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['developer', 'lead', 'session', 'full'],
        description: 'View mode: developer (what can I work on), lead (bottlenecks), session (recent activity), full (all dependencies)',
      },
      projectId: { type: 'string', description: 'Optional project ID' },
      maxDepth: { type: 'number', description: 'Max dependency depth for full view' },
    },
  },
};

export const getBriefingSchema = {
  name: 'get_briefing',
  description: 'Get a quick project briefing with recommendations, workable tasks, and bottlenecks. Also checks instructions health if version provided.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Optional project ID' },
      focus: { type: 'string', description: 'Optional focus area' },
      agentId: { type: 'string', description: 'Your agent ID — enables "your tasks" vs "other agents" breakdown (auto-injected if omitted)' },
      instructionsVersion: {
        type: 'string',
        description: 'Your instructions version (e.g., "2.1"). Used to check if your project instructions are current.',
      },
    },
  },
};

export const getClusterContextSchema = {
  name: 'get_task_context',
  description: 'Get a task with its full dependency tree, blocking/blocked relationships, and related decisions to understand the work cluster before starting.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to focus on' },
    },
    required: ['taskId'],
  },
};

export const whatChangedSchema = {
  name: 'what_changed',
  description: 'See what changed since a given time — completed tasks, new tasks, decisions logged. Use at session start to understand what happened while you were away.',
  inputSchema: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'ISO datetime or duration (e.g., "2h", "1d", "2026-03-08T00:00:00Z"). Default: 24h ago.',
      },
    },
  },
};

export const coordinationSchemas = [
  getTaskGraphSchema,
  getBriefingSchema,
  getClusterContextSchema,
  whatChangedSchema,
];
