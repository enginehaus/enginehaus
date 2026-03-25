/**
 * Quality Tool Schemas
 *
 * Schema definitions for quality expectations MCP tools.
 */

export const getQualityExpectationsSchema = {
  name: 'get_quality_expectations',
  description: 'Get the quality checklist for a task (tests required, docs needed, review criteria) so you know what must be satisfied before completion.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
    },
    required: ['taskId'],
  },
};

export const checkQualityComplianceSchema = {
  name: 'check_quality_compliance',
  description: 'Validate completed items against the task\'s quality checklist and return a pass/fail report with any gaps.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
      completedItems: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of completed quality items',
      },
    },
    required: ['taskId', 'completedItems'],
  },
};

export const qualitySchemas = [
  getQualityExpectationsSchema,
  checkQualityComplianceSchema,
];
