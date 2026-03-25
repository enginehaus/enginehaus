/**
 * Workflow Tool Schemas
 *
 * Primary interface for agent workflow: start_work and finish_work.
 * These composite tools orchestrate all coordination automatically.
 */

export const startWorkSchema = {
  name: 'start_work',
  description: `**PRIMARY TOOL** - Begin work on a task. Automatically handles everything:
- Picks highest priority task (or uses specified taskId)
- Claims the task and creates git branch
- Gets related learnings from similar completed work
- Loads file previews for task files
- Gets recent commits touching those files
- Retrieves relevant decisions
- Checks instructions health if version provided

Returns everything you need in ONE response. Just call this and start coding.`,
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Optional: specific task to work on. If not provided, picks highest priority ready task.'
      },
      agentId: {
        type: 'string',
        description: 'Agent identifier (default: claude-code)',
      },
      instructionsVersion: {
        type: 'string',
        description: 'Your instructions version (e.g., "2.1"). Used to check if your project instructions are current.',
      },
    },
  },
};

export const finishWorkSchema = {
  name: 'finish_work',
  description: `**PRIMARY TOOL** - Complete current task. Automatically:
- Validates quality gates (decisions logged, tests present)
- Completes task with auto-generated docs from git history
- Checks if this unblocks other tasks
- Suggests next task to work on

Provide a summary and optionally log decisions inline (avoids separate log_decision calls).`,
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Summary of what was implemented/changed',
      },
      taskId: {
        type: 'string',
        description: 'Optional: task ID to complete. Auto-detected from active session if not provided.',
      },
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            decision: { type: 'string', description: 'What was decided' },
            rationale: { type: 'string', description: 'Why this choice was made' },
            category: {
              type: 'string',
              enum: ['architecture', 'tradeoff', 'dependency', 'pattern', 'other'],
              description: 'Decision category (default: other)',
            },
          },
          required: ['decision', 'rationale'],
        },
        description: 'Log decisions inline at completion. Avoids needing separate log_decision calls.',
      },
      bypassQuality: {
        type: 'boolean',
        description: 'Set to true to bypass quality gates (not recommended). Requires reason.',
      },
      bypassReason: {
        type: 'string',
        description: 'Required if bypassQuality is true. Explains why quality gates are being bypassed.',
      },
    },
    required: ['summary'],
  },
};

export const workflowSchemas = [
  startWorkSchema,
  finishWorkSchema,
];
