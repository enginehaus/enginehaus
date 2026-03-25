/**
 * Contribution Tool Schemas
 *
 * Schema definitions for collaborative task contribution MCP tools.
 */

export const contributeToTaskSchema = {
  name: 'contribute_to_task',
  description: 'Add a contribution to a collaborative task. Multiple agents can contribute opinions, analyses, reviews, or suggestions without exclusive ownership. Task must be in collaborative mode.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to contribute to' },
      content: { type: 'string', description: 'The contribution content (opinion, analysis, suggestion, etc.)' },
      type: {
        type: 'string',
        enum: ['opinion', 'analysis', 'review', 'suggestion', 'decision', 'other'],
        description: 'Type of contribution',
      },
      role: {
        type: 'string',
        enum: ['pm', 'ux', 'tech-lead', 'developer', 'qa', 'human'],
        description: 'Role perspective for this contribution (default: developer)',
      },
      agentId: { type: 'string', description: 'Agent identifier (auto-detected from MCP client if omitted)' },
    },
    required: ['taskId', 'content', 'type'],
  },
};

export const listContributionsSchema = {
  name: 'list_contributions',
  description: 'List contributions for a collaborative task, optionally filtered by agent or type.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to list contributions for' },
      agentId: { type: 'string', description: 'Filter by contributing agent' },
      type: {
        type: 'string',
        enum: ['opinion', 'analysis', 'review', 'suggestion', 'decision', 'other'],
        description: 'Filter by contribution type',
      },
      limit: { type: 'number', description: 'Maximum number of contributions to return' },
    },
    required: ['taskId'],
  },
};

export const getTaskContributorsSchema = {
  name: 'get_task_contributors',
  description: 'Get a summary of all agents who have contributed to a task, including contribution counts and types.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to get contributors for' },
    },
    required: ['taskId'],
  },
};

export const contributionSchemas = [
  contributeToTaskSchema,
  listContributionsSchema,
  getTaskContributorsSchema,
];
