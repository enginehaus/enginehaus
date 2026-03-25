/**
 * Agent Registry Tool Schemas
 *
 * Schema definitions for agent registry MCP tools.
 */

export const registerAgentSchema = {
  name: 'register_agent',
  description: 'Register an agent in the team registry with capabilities and strengths. USE AT SESSION START if your agent isn\'t registered yet. Enables capability-based task routing and multi-agent coordination.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Unique agent identifier (e.g., "claude-code", "cursor-ai", "trevor")' },
      name: { type: 'string', description: 'Human-readable display name' },
      agentType: {
        type: 'string',
        enum: ['claude', 'chatgpt', 'gemini', 'mistral', 'cursor', 'continue', 'custom', 'human'],
        description: 'Platform/LLM type',
      },
      agentVersion: { type: 'string', description: 'Model version (e.g., "claude-sonnet-4", "gpt-4o")' },
      capabilities: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['code', 'research', 'review', 'testing', 'docs', 'planning', 'debug'],
        },
        description: 'What this agent can do',
      },
      strengths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task types this agent excels at (free-form)',
      },
      limitations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Known limitations or things to avoid',
      },
      maxConcurrentTasks: { type: 'number', description: 'Max concurrent tasks (default: 1)' },
    },
    required: ['id', 'name', 'agentType', 'capabilities'],
  },
};

export const listAgentsSchema = {
  name: 'list_agents',
  description: 'List registered agents, optionally filtered by status, type, or capability. USE TO SEE WHO IS AVAILABLE for task assignment or handoff.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'inactive', 'busy'],
        description: 'Filter by agent status',
      },
      agentType: {
        type: 'string',
        enum: ['claude', 'chatgpt', 'gemini', 'mistral', 'cursor', 'continue', 'custom', 'human'],
        description: 'Filter by platform type',
      },
      capability: {
        type: 'string',
        enum: ['code', 'research', 'review', 'testing', 'docs', 'planning', 'debug'],
        description: 'Filter by capability',
      },
    },
  },
};

export const getAgentSchema = {
  name: 'get_agent',
  description: 'Get detailed profile for a specific agent including capabilities, strengths, and performance',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'Agent ID to look up' },
    },
    required: ['agentId'],
  },
};

export const updateAgentSchema = {
  name: 'update_agent',
  description: 'Update an agent\'s profile (capabilities, status, strengths, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: 'Agent ID to update' },
      name: { type: 'string', description: 'New display name' },
      capabilities: {
        type: 'array',
        items: { type: 'string', enum: ['code', 'research', 'review', 'testing', 'docs', 'planning', 'debug'] },
        description: 'Updated capabilities list',
      },
      strengths: { type: 'array', items: { type: 'string' }, description: 'Updated strengths' },
      limitations: { type: 'array', items: { type: 'string' }, description: 'Updated limitations' },
      status: {
        type: 'string',
        enum: ['active', 'inactive', 'busy'],
        description: 'Agent availability status',
      },
      maxConcurrentTasks: { type: 'number', description: 'Max concurrent tasks' },
    },
    required: ['agentId'],
  },
};

export const agentSchemas = [
  registerAgentSchema,
  listAgentsSchema,
  getAgentSchema,
  updateAgentSchema,
];
