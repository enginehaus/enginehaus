/**
 * Session Tool Schemas
 *
 * Schema definitions for session management and handoff MCP tools.
 */

export const claimTaskSchema = {
  name: 'claim_task',
  description: 'Explicitly claim a task before starting work. Prevents conflicts with other agents and starts session timer. NOTE: get_next_task does this automatically - only use claim_task when you want to claim a specific task without getting context.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to claim' },
      agentId: { type: 'string', description: 'Agent identifier (auto-detected from MCP client if omitted)' },
      force: { type: 'boolean', description: 'Force claim even if conflicts or capacity exceeded (default: false)' },
      capacity: { type: 'number', description: 'Max concurrent tasks for this agent (default: 1, 0 = unlimited)' },
    },
    required: ['taskId'],
  },
};

export const releaseTaskSchema = {
  name: 'release_task',
  description: 'Release a task claim without completing it. Use when abandoning work or switching tasks. complete_task_smart automatically releases claims, so you rarely need this directly. Provide reason for abandonments to enable interpretable metrics.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to release' },
      completed: { type: 'boolean', description: 'True if task was completed, false if abandoning (default: false)' },
      reason: {
        type: 'string',
        enum: ['test', 'redirect', 'blocked', 'stuck', 'scope_change', 'user_requested', 'context_limit', 'other'],
        description: 'Why the task is being released. Critical for interpretable abandonment metrics.',
      },
      notes: { type: 'string', description: 'Additional context about the abandonment' },
    },
    required: ['sessionId'],
  },
};

export const sessionHeartbeatSchema = {
  name: 'session_heartbeat',
  description: 'Send heartbeat to keep session alive. Sessions expire after 5 minutes without heartbeat.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to keep alive' },
    },
    required: ['sessionId'],
  },
};

export const getTaskSessionStatusSchema = {
  name: 'get_task_session_status',
  description: 'Check whether a task has an active agent session and see its claim history, so you know if someone else is working on it.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to check' },
    },
    required: ['taskId'],
  },
};

export const getHandoffContextSchema = {
  name: 'get_handoff_context',
  description: 'Get context optimized for agent-to-agent handoff. USE WHEN PASSING WORK TO ANOTHER AGENT - includes decisions, progress, and file state. More complete than generate_continuation_prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to hand off' },
      fromAgent: { type: 'string', description: 'Current agent identifier' },
      toAgent: { type: 'string', description: 'Target agent identifier' },
      sessionId: { type: 'string', description: 'Optional session ID' },
    },
    required: ['taskId', 'fromAgent', 'toAgent'],
  },
};

export const generateContinuationPromptSchema = {
  name: 'generate_continuation_prompt',
  description: 'Generate a ready-to-paste prompt that another agent can use to continue work on a task, including progress, decisions, and file context.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
      targetAgent: { type: 'string', description: 'Target agent (e.g., claude-code, cursor, claude-desktop)' },
      fromAgent: { type: 'string', description: 'Source agent identifier' },
      includeFiles: { type: 'boolean', description: 'Include file list in prompt (default: true)' },
    },
    required: ['taskId', 'targetAgent'],
  },
};

export const compressSessionStateSchema = {
  name: 'compress_session_state',
  description: 'Get a token-efficient summary of a session (progress, decisions, files touched) for embedding in a handoff prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to compress' },
    },
    required: ['sessionId'],
  },
};

export const getHandoffStatusSchema = {
  name: 'get_handoff_status',
  description: 'See which tasks have active agent sessions and recent decisions, so you can coordinate before claiming overlapping work.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Optional task ID filter' },
      sessionId: { type: 'string', description: 'Optional session ID filter' },
    },
  },
};

export const quickHandoffSchema = {
  name: 'quick_handoff',
  description: 'Quick handoff to Claude Code. Auto-detects current task from active session, generates a compact continuation prompt, and returns it ready-to-paste. Use this when nudged to hand off implementation work.',
  inputSchema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'Brief context about what you were investigating or what needs to be done' },
      taskId: { type: 'string', description: 'Optional: explicit task ID (auto-detected from session if not provided)' },
    },
  },
};

export const sessionSchemas = [
  claimTaskSchema,
  releaseTaskSchema,
  getHandoffContextSchema,
  getHandoffStatusSchema,
  quickHandoffSchema,
];
