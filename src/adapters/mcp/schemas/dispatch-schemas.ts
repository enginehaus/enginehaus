/**
 * Dispatch Queue Tool Schemas
 *
 * Schema definitions for human-triggered agent work assignment.
 */

export const dispatchTaskSchema = {
  name: 'dispatch_task',
  description: 'Queue a task for a specific agent. The agent will pick it up on their next start_work call, taking priority over natural task selection. Use for human-directed work assignment.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to dispatch' },
      targetAgent: { type: 'string', description: 'Agent ID to dispatch to (e.g., "claude-code", "cursor")' },
      dispatchedBy: { type: 'string', description: 'Who is dispatching (e.g., your name or "wheelhaus")' },
      priorityOverride: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Override the task\'s natural priority for this dispatch',
      },
      context: { type: 'string', description: 'Additional context or instructions for the agent' },
      expiresInMinutes: { type: 'number', description: 'Auto-expire dispatch after N minutes (default: no expiry)' },
    },
    required: ['taskId', 'targetAgent', 'dispatchedBy'],
  },
};

export const listDispatchesSchema = {
  name: 'list_dispatches',
  description: 'List dispatch queue entries, optionally filtered by status or target agent.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'claimed', 'recalled', 'expired'],
        description: 'Filter by dispatch status',
      },
      targetAgent: { type: 'string', description: 'Filter by target agent' },
      limit: { type: 'number', description: 'Maximum number of dispatches to return' },
    },
  },
};

export const recallDispatchSchema = {
  name: 'recall_dispatch',
  description: 'Cancel a pending dispatch before the agent picks it up. Only works for dispatches with status "pending".',
  inputSchema: {
    type: 'object',
    properties: {
      dispatchId: { type: 'string', description: 'Dispatch ID to recall' },
    },
    required: ['dispatchId'],
  },
};

export const dispatchSchemas = [
  dispatchTaskSchema,
  listDispatchesSchema,
  recallDispatchSchema,
];
