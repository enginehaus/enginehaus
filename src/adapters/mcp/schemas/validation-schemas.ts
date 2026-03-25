/**
 * Validation Tool Schemas
 *
 * Schemas for quality validation MCP tools.
 */

export const validateQualityGatesSchema = {
  name: 'validate_quality_gates',
  description: 'Run quality gate checks (file existence, requirement validation) against a task and return a pass/fail report with details.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID being validated' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to validate existence',
      },
      requirements: {
        type: 'array',
        items: { type: 'string' },
        description: 'Quality requirements to validate',
      },
    },
    required: ['taskId'],
  },
};

export const validateForCiSchema = {
  name: 'validate_for_ci',
  description: 'Validate quality gates for CI/CD with multiple output formats (GitHub Actions, JUnit XML, JSON)',
  inputSchema: {
    type: 'object',
    properties: {
      outputFormat: {
        type: 'string',
        enum: ['github-annotations', 'junit-xml', 'json'],
        description: 'Output format for CI/CD integration',
      },
      failOnCritical: {
        type: 'boolean',
        description: 'Exit with error code if critical issues found (default: true)',
      },
      taskId: {
        type: 'string',
        description: 'Optional task ID for context-specific validation',
      },
    },
    required: ['outputFormat'],
  },
};

export const validationSchemas = [
  validateQualityGatesSchema,
  validateForCiSchema,
];
