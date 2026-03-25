/**
 * Phase Tool Schemas
 *
 * Schema definitions for phase-based workflow MCP tools.
 */

export const listPhasesSchema = {
  name: 'list_phases',
  description: 'Show the 8 standard workflow phases (Context, Architecture, Implementation, etc.) with descriptions — use to understand the phase model before starting phased work.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const getTaskPhaseSchema = {
  name: 'get_task_phase',
  description: 'See which phase a task is on, which phases are completed or skipped, and what phase comes next.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to get phase progress for' },
    },
    required: ['taskId'],
  },
};

export const startTaskPhasesSchema = {
  name: 'start_task_phases',
  description: 'Initialize phase-based workflow for a task (starts at Phase 1: Context & Planning)',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to start phases for' },
    },
    required: ['taskId'],
  },
};

export const advancePhaseSchema = {
  name: 'advance_phase',
  description: 'Complete current phase and advance to next. Requires commit SHA to enforce commit discipline.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
      role: {
        type: 'string',
        enum: ['pm', 'ux', 'tech-lead', 'developer', 'qa', 'human'],
        description: 'REQUIRED: Your current role when advancing phase. Declaring role makes coordination visible.',
      },
      commitSha: { type: 'string', description: 'Git commit SHA for this phase (required for git protocol, optional for manual protocol)' },
      note: { type: 'string', description: 'Optional note about what was accomplished in this phase' },
    },
    required: ['taskId', 'role'],
  },
};

export const skipPhaseSchema = {
  name: 'skip_phase',
  description: 'Skip the current phase when it does not apply (e.g., skip Documentation for a bug fix) — records the skip for audit trail.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
      force: { type: 'boolean', description: 'Force skip even required phases (use with caution)' },
    },
    required: ['taskId'],
  },
};

export const phaseSchemas = [
  listPhasesSchema,
  getTaskPhaseSchema,
  startTaskPhasesSchema,
  advancePhaseSchema,
  skipPhaseSchema,
];
