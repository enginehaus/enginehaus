/**
 * Initiative Tool Schemas
 *
 * Schema definitions for initiative/outcome tracking MCP tools.
 */

export const createInitiativeSchema = {
  name: 'create_initiative',
  description: 'Define a measurable goal with success criteria. USE BEFORE STARTING MULTI-TASK EFFORTS - links work to outcomes so you can measure what actually delivered value. Example: "Reduce API latency by 50%" with clear success criteria.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Initiative title (e.g., "Improve page load time by 50%")' },
      description: { type: 'string', description: 'Detailed description of the initiative' },
      successCriteria: { type: 'string', description: 'What does success look like? (measurable if possible)' },
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
    },
    required: ['title'],
  },
};

export const getInitiativeSchema = {
  name: 'get_initiative',
  description: 'Get an initiative\'s title, success criteria, status, and all linked tasks with their contribution notes.',
  inputSchema: {
    type: 'object',
    properties: {
      initiativeId: { type: 'string', description: 'Initiative ID' },
    },
    required: ['initiativeId'],
  },
};

export const listInitiativesSchema = {
  name: 'list_initiatives',
  description: 'List all initiatives for a project with their status and success criteria, optionally filtered by status (active/succeeded/failed/pivoted/abandoned).',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
      status: {
        type: 'string',
        enum: ['active', 'succeeded', 'failed', 'pivoted', 'abandoned'],
        description: 'Filter by status',
      },
      limit: { type: 'number', description: 'Max initiatives to return (default: 50)' },
    },
  },
};

export const linkTaskToInitiativeSchema = {
  name: 'link_task_to_initiative',
  description: 'Connect a task to a strategic goal. USE WHEN TASK CONTRIBUTES TO A MEASURABLE INITIATIVE - enables outcome tracking. Include contribution notes explaining how this task helps achieve the goal.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to link' },
      initiativeId: { type: 'string', description: 'Initiative ID to link to' },
      contributionNotes: { type: 'string', description: 'How does this task contribute to the initiative?' },
    },
    required: ['taskId', 'initiativeId'],
  },
};

export const recordInitiativeOutcomeSchema = {
  name: 'record_initiative_outcome',
  description: 'Record what actually happened with an initiative. USE WHEN GOAL IS REACHED OR ABANDONED - captures learnings for future reference. Be honest: succeeded, failed, pivoted (changed approach), or abandoned (no longer relevant).',
  inputSchema: {
    type: 'object',
    properties: {
      initiativeId: { type: 'string', description: 'Initiative ID' },
      status: {
        type: 'string',
        enum: ['succeeded', 'failed', 'pivoted', 'abandoned'],
        description: 'Outcome status',
      },
      outcomeNotes: { type: 'string', description: 'What actually happened? Learnings and observations.' },
    },
    required: ['initiativeId', 'status', 'outcomeNotes'],
  },
};

export const updateInitiativeSchema = {
  name: 'update_initiative',
  description: 'Update an initiative\'s fields (title, description, success criteria, status, project, notes). USE TO REASSIGN AN INITIATIVE TO A DIFFERENT PROJECT or correct initiative details after creation. Note: changing projectId moves the initiative only — linked tasks retain their own project assignments.',
  inputSchema: {
    type: 'object',
    properties: {
      initiativeId: { type: 'string', description: 'Initiative ID' },
      title: { type: 'string', description: 'New title' },
      description: { type: 'string', description: 'New description' },
      successCriteria: { type: 'string', description: 'New success criteria' },
      status: {
        type: 'string',
        enum: ['active', 'succeeded', 'failed', 'pivoted', 'abandoned'],
        description: 'New status',
      },
      outcomeNotes: { type: 'string', description: 'Outcome notes (typically set with terminal status)' },
      projectId: { type: 'string', description: 'Reassign to a different project' },
    },
    required: ['initiativeId'],
  },
};

export const getInitiativeLearningsSchema = {
  name: 'get_initiative_learnings',
  description: 'Review what worked and failed in past initiatives. Shows success rates, patterns, and outcome notes. USE TO INFORM NEW INITIATIVES - learn from history before starting similar work.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
    },
  },
};

export const suggestInitiativesSchema = {
  name: 'suggest_initiatives',
  description: 'Analyze existing tasks and suggest initiative groupings. USE FOR MATURE PROJECTS WITHOUT INITIATIVES - discovers natural task clusters and proposes strategic goals. Returns suggestions with task lists, keywords, and draft titles ready to create.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project ID (default: active project)' },
      minClusterSize: { type: 'number', description: 'Minimum tasks per suggestion (default: 3)' },
      maxSuggestions: { type: 'number', description: 'Maximum suggestions to return (default: 5)' },
    },
  },
};

export const initiativeSchemas = [
  createInitiativeSchema,
  getInitiativeSchema,
  listInitiativesSchema,
  linkTaskToInitiativeSchema,
  recordInitiativeOutcomeSchema,
  updateInitiativeSchema,
  getInitiativeLearningsSchema,
  suggestInitiativesSchema,
];
