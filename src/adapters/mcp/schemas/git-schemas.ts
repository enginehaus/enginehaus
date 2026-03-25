/**
 * Git Tool Schemas
 *
 * Schema definitions for git-related MCP tools.
 */

export const getGitStatusSchema = {
  name: 'get_git_status',
  description: 'Get the current branch, uncommitted changes, and remote tracking status for the active project\'s repository.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const createPullRequestSchema = {
  name: 'create_pull_request',
  description: 'Create a GitHub pull request from a task\'s branch with auto-generated title and body from git history — requires GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO env vars for API access.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID (must have a git branch)' },
      baseBranch: { type: 'string', description: 'Target branch for PR (default: main)' },
    },
    required: ['taskId'],
  },
};

export const gitSchemas = [
  getGitStatusSchema,
  createPullRequestSchema,
];
