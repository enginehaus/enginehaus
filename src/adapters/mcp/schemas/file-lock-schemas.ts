/**
 * File-Lock Tool Schemas
 *
 * Schema definitions for file-lock conflict detection MCP tools.
 */

export const getLockedFilesSchema = {
  name: 'get_locked_files',
  description: 'List all files currently claimed by active agent sessions, so you can avoid editing files another agent is working on.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const checkFileConflictsSchema = {
  name: 'check_file_conflicts',
  description: 'Check whether a task\'s files overlap with files being edited by other active sessions, and return the conflicting files and sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to check' },
    },
    required: ['taskId'],
  },
};

export const fileLockSchemas = [
  getLockedFilesSchema,
  checkFileConflictsSchema,
];
