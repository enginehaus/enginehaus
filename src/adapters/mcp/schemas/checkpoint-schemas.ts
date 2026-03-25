/**
 * Checkpoint Tool Schemas
 *
 * Schema definitions for human checkpoint MCP tools.
 */

export const requestHumanInputSchema = {
  name: 'request_human_input',
  description: 'Request human input at a workflow checkpoint. Pauses task and sets status to awaiting-human.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID requiring human input' },
      type: {
        type: 'string',
        enum: ['phase-gate', 'decision-required', 'review-required', 'approval-required'],
        description: 'Type of checkpoint',
      },
      reason: { type: 'string', description: 'Why human input is needed' },
      question: { type: 'string', description: 'Specific question for the human' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
            action: { type: 'string', enum: ['approve', 'reject', 'redirect'] },
          },
          required: ['id', 'label'],
        },
        description: 'Predefined options for the human to choose from',
      },
      context: { type: 'string', description: 'Additional context for the checkpoint' },
      requestedBy: { type: 'string', description: 'Agent/user requesting input (default: claude-code)' },
      phase: { type: 'number', description: 'Phase number if this is a phase gate' },
      timeoutMinutes: { type: 'number', description: 'Auto-timeout in minutes (optional)' },
      escalateTo: { type: 'string', description: 'User/role to escalate to on timeout' },
    },
    required: ['taskId', 'type', 'reason'],
  },
};

export const provideHumanInputSchema = {
  name: 'provide_human_input',
  description: 'Provide human response to a pending checkpoint. Resumes the paused task.',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: { type: 'string', description: 'Checkpoint ID to respond to' },
      respondedBy: { type: 'string', description: 'User providing the response' },
      decision: {
        type: 'string',
        enum: ['approve', 'reject', 'redirect'],
        description: 'Decision on the checkpoint',
      },
      response: { type: 'string', description: 'Free-form response text' },
      selectedOption: { type: 'string', description: 'ID of selected option (if options were provided)' },
    },
    required: ['checkpointId', 'respondedBy', 'decision'],
  },
};

export const getPendingCheckpointsSchema = {
  name: 'get_pending_checkpoints',
  description: 'List all checkpoints currently waiting for a human response, with their type, reason, and associated task.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Filter by project (default: active project)' },
    },
  },
};

export const getCheckpointSchema = {
  name: 'get_checkpoint',
  description: 'Get a checkpoint\'s full details including the question, options, human response (if answered), and linked task.',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: { type: 'string', description: 'Checkpoint ID' },
    },
    required: ['checkpointId'],
  },
};

export const getTasksAwaitingHumanSchema = {
  name: 'get_tasks_awaiting_human',
  description: 'List tasks paused in awaiting-human status so you can see what is blocked on human action.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Filter by project (default: active project)' },
    },
  },
};

export const checkpointSchemas = [
  requestHumanInputSchema,
  provideHumanInputSchema,
  getPendingCheckpointsSchema,
  getCheckpointSchema,
  getTasksAwaitingHumanSchema,
];
