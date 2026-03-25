/**
 * Project Tool Schemas
 *
 * Schema definitions for project management MCP tools.
 */

export const createProjectSchema = {
  name: 'create_project',
  description: 'Register a new project with its root path, domain, and tech stack so tasks and decisions can be scoped to it.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Project display name' },
      slug: { type: 'string', description: 'Unique project slug (e.g., "actual", "shima")' },
      rootPath: { type: 'string', description: 'Absolute path to project root directory' },
      domain: {
        type: 'string',
        enum: ['web', 'mobile', 'api', 'infrastructure', 'ml', 'other'],
        description: 'Project domain/type',
      },
      techStack: {
        type: 'array',
        items: { type: 'string' },
        description: 'Technology stack (e.g., ["typescript", "react", "node"])',
      },
      description: { type: 'string', description: 'Project description' },
    },
    required: ['name', 'slug', 'rootPath', 'domain'],
  },
};

export const listProjectsSchema = {
  name: 'list_projects',
  description: 'List all registered projects with their status, domain, and tech stack, optionally filtered by status (active/archived/paused).',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'archived', 'paused'],
        description: 'Filter by project status (optional)',
      },
    },
  },
};

export const getProjectSchema = {
  name: 'get_project',
  description: 'Get a project\'s full configuration including root path, domain, tech stack, status, and settings by ID or slug.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID or slug' },
    },
    required: ['projectId'],
  },
};

export const setActiveProjectSchema = {
  name: 'set_active_project',
  description: 'Switch the active project so that task, decision, and metric operations default to it — use when working across multiple projects.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID or slug to set as active' },
    },
    required: ['projectId'],
  },
};

export const getActiveProjectSchema = {
  name: 'get_active_project',
  description: 'Return which project is currently active (the default target for tasks, decisions, and metrics).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const updateProjectSchema = {
  name: 'update_project',
  description: 'Modify a project\'s name, description, root path, status, or tech stack.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID or slug' },
      name: { type: 'string', description: 'New project name' },
      description: { type: 'string', description: 'New project description' },
      rootPath: { type: 'string', description: 'New project root path' },
      status: {
        type: 'string',
        enum: ['active', 'archived', 'paused'],
        description: 'New project status',
      },
      techStack: {
        type: 'array',
        items: { type: 'string' },
        description: 'Updated technology stack',
      },
    },
    required: ['projectId'],
  },
};

export const deleteProjectSchema = {
  name: 'delete_project',
  description: 'Permanently delete a project and its associations — fails if the project is currently active (switch active project first).',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID or slug to delete' },
    },
    required: ['projectId'],
  },
};

export const projectSchemas = [
  createProjectSchema,
  listProjectsSchema,
  getProjectSchema,
  setActiveProjectSchema,
  getActiveProjectSchema,
  updateProjectSchema,
  deleteProjectSchema,
];
