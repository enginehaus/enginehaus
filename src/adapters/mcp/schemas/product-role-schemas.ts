/**
 * Product Role Tool Schemas
 *
 * Schemas for product manager, UX director, and technical lead MCP tools.
 */

export const recordStrategicDecisionSchema = {
  name: 'record_strategic_decision',
  description: 'Log a strategic business decision (as PM role) with rationale, impact, timeline, and cross-functional requirements so downstream agents inherit the context.',
  inputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', description: 'Strategic decision title' },
      rationale: { type: 'string', description: 'Business rationale and context' },
      impact: { type: 'string', description: 'Expected business impact' },
      timeline: { type: 'string', description: 'Implementation timeline' },
      stakeholders: {
        type: 'array',
        items: { type: 'string' },
        description: 'Affected roles and stakeholders',
      },
      requirements: {
        type: 'object',
        properties: {
          technical: { type: 'string' },
          ux: { type: 'string' },
          quality: { type: 'string' },
        },
      },
    },
    required: ['decision', 'rationale', 'impact', 'timeline'],
  },
};

export const recordUxRequirementsSchema = {
  name: 'record_ux_requirements',
  description: 'Log UX requirements (as UX role) including user experience goals, design patterns, and progressive disclosure strategy for a feature.',
  inputSchema: {
    type: 'object',
    properties: {
      feature: { type: 'string', description: 'Feature or interface being designed' },
      userExperience: { type: 'string', description: 'User experience requirements' },
      designPattern: { type: 'string', description: 'Design patterns and approaches' },
      progressiveDisclosure: { type: 'string', description: 'Progressive disclosure strategy' },
      technicalConstraints: { type: 'string', description: 'Technical constraints to consider' },
      responseTo: { type: 'string', description: 'Strategic decision this responds to' },
    },
    required: ['feature', 'userExperience', 'designPattern'],
  },
};

export const recordTechnicalPlanSchema = {
  name: 'record_technical_plan',
  description: 'Log a technical plan (as tech-lead role) with architecture, effort estimate, and quality gates, and optionally generate implementation tasks from it.',
  inputSchema: {
    type: 'object',
    properties: {
      feature: { type: 'string', description: 'Feature being implemented' },
      strategicContext: { type: 'string', description: 'Strategic business context' },
      uxContext: { type: 'string', description: 'UX requirements and constraints' },
      technicalApproach: { type: 'string', description: 'Technical implementation approach' },
      architecture: { type: 'string', description: 'Architectural considerations' },
      estimatedEffort: { type: 'string', description: 'Estimated implementation effort' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to be modified or created',
      },
      qualityGates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Quality validation requirements',
      },
      unifiedTasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            requirements: { type: 'string' },
            files: { type: 'array', items: { type: 'string' } },
          },
        },
        description: 'Unified implementation tasks',
      },
    },
    required: ['feature', 'strategicContext', 'technicalApproach'],
  },
};

export const productRoleSchemas = [
  recordStrategicDecisionSchema,
  recordUxRequirementsSchema,
  recordTechnicalPlanSchema,
];
