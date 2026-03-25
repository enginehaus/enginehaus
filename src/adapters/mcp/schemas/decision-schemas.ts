/**
 * Decision Tool Schemas
 *
 * Schema definitions for in-flight decision logging MCP tools.
 */

export const logDecisionSchema = {
  name: 'log_decision',
  description: 'Record architectural choices, tradeoffs, or design decisions. Works with OR without an active task — use for strategic planning, GTM positioning, roadmap decisions, etc. Decisions logged here appear in briefings and help future agents understand why. Categories: architecture, tradeoff, dependency, pattern.',
  inputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', description: 'The decision made (e.g., "Use SQLite over Postgres")' },
      rationale: { type: 'string', description: 'Why this decision was made' },
      impact: { type: 'string', description: 'Expected impact or consequences' },
      category: {
        type: 'string',
        description: 'Category of decision. Software defaults: architecture, tradeoff, dependency, pattern, other. Custom categories supported via domain profiles.',
      },
      taskId: { type: 'string', description: 'Associated task ID (optional — omit for strategic/unattached decisions)' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorizing unattached decisions (e.g., "positioning", "gtm", "roadmap")',
      },
      references: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to external resource' },
            label: { type: 'string', description: 'Human-readable label' },
            type: { type: 'string', enum: ['design', 'spec', 'pr', 'doc', 'external'], description: 'Reference type' },
          },
          required: ['url'],
        },
        description: 'External references supporting this decision (design docs, PRs, specs, etc.)',
      },
      scope: {
        type: 'object',
        description: 'Structured scope for matching decisions to tasks by layer, glob pattern, or file path',
        properties: {
          layers: {
            type: 'array',
            items: { type: 'string', enum: ['interface', 'service', 'storage', 'handler', 'cli', 'rest', 'mcp'] },
            description: 'Architectural layers this decision applies to',
          },
          patterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Glob patterns (e.g., "src/adapters/**")',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Explicit file paths',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Freeform labels',
          },
        },
      },
    },
    required: ['decision'],
  },
};

export const getDecisionsSchema = {
  name: 'list_decisions',
  description: 'List architectural decisions for the active project, optionally filtered by task, category, or time period.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Filter by task ID' },
      category: {
        type: 'string',
        description: 'Filter by category. Software defaults: architecture, tradeoff, dependency, pattern, other. Custom categories supported via domain profiles.',
      },
      period: {
        type: 'string',
        enum: ['day', 'week', 'month', 'all'],
        description: 'Time period (default: all)',
      },
      limit: { type: 'number', description: 'Max decisions to return (default: 50)' },
    },
  },
};

export const getDecisionSchema = {
  name: 'get_decision',
  description: 'Retrieve a single decision by ID, returning the full rationale, impact, category, scope, and linked task.',
  inputSchema: {
    type: 'object',
    properties: {
      decisionId: { type: 'string', description: 'Decision ID' },
    },
    required: ['decisionId'],
  },
};

export const batchLogDecisionsSchema = {
  name: 'batch_log_decisions',
  description: 'Log multiple decisions in a single call. Reduces sequential log_decision calls when you have several decisions to record at once.',
  inputSchema: {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        description: 'Array of decisions to log',
        items: {
          type: 'object',
          properties: {
            decision: { type: 'string', description: 'The decision made' },
            rationale: { type: 'string', description: 'Why this decision was made' },
            category: {
              type: 'string',
              description: 'Category of decision. Software defaults: architecture, tradeoff, dependency, pattern, other. Custom categories supported via domain profiles.',
            },
            taskId: { type: 'string', description: 'Associated task ID' },
          },
          required: ['decision'],
        },
      },
    },
    required: ['decisions'],
  },
};

export const decisionSchemas = [
  logDecisionSchema,
  getDecisionsSchema,
  getDecisionSchema,
  batchLogDecisionsSchema,
];
