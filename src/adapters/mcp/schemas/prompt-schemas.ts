/**
 * Prompt Tool Schemas
 *
 * Schema definitions for prompt template MCP tools.
 */

export const listPromptsSchema = {
  name: 'list_prompts',
  description: 'List available prompt templates (feature implementation, bug investigation, refactoring, etc.) grouped by category.',
  inputSchema: {
    type: 'object',
    properties: {
      grouped: {
        type: 'boolean',
        description: 'Group templates by category (Development, Quality, Architecture, etc.)',
      },
    },
  },
};

export const getPromptSchema = {
  name: 'get_prompt',
  description: 'Get a specific prompt template (e.g., feature-implementation, bug-investigation) with placeholders filled from task context or custom values.',
  inputSchema: {
    type: 'object',
    properties: {
      templateId: {
        type: 'string',
        enum: [
          'feature-implementation',
          'bug-investigation',
          'refactoring',
          'security-review',
          'code-review',
          'architecture-decision',
          'test-coverage',
          'performance-optimization',
          'documentation',
          'migration',
        ],
        description: 'ID of the prompt template',
      },
      taskId: { type: 'string', description: 'Optional task ID to fill context from' },
      values: {
        type: 'object',
        description: 'Custom values to fill placeholders (e.g., { "FEATURE_NAME": "User Auth" })',
      },
    },
    required: ['templateId'],
  },
};

export const promptSchemas = [
  listPromptsSchema,
  getPromptSchema,
];
