/**
 * Wheelhaus Tool Schemas
 *
 * Human-facing observability dashboard for Enginehaus projects.
 * Primarily useful for reviewing project state visually — agents
 * should prefer get_briefing for orientation, not view_wheelhaus.
 */

/** URI for the Wheelhaus MCP App UI resource */
export const WHEELHAUS_UI_RESOURCE_URI = 'ui://wheelhaus/dashboard.html';

export const viewWheelhausSchema = {
  name: 'view_wheelhaus',
  description: 'View the Wheelhaus project dashboard — primarily for human review, not agent orientation (use get_briefing instead). Returns formatted Markdown views of tasks, decisions, health metrics, active sessions, and items waiting for human action. Best for: reviewing bottlenecks, checking the human queue, showing project state to stakeholders, or inspecting a specific task or decision.',
  _meta: {
    ui: {
      resourceUri: WHEELHAUS_UI_RESOURCE_URI,
    },
    'ui/resourceUri': WHEELHAUS_UI_RESOURCE_URI,
  },
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['dashboard', 'tasks', 'decisions', 'health', 'sessions', 'human-queue', 'bottlenecks', 'stream', 'ax'],
        description: 'Which view to display. "dashboard" shows everything; "stream" shows a unified priority-sorted feed of what needs attention. "human-queue" shows items waiting for human action. "bottlenecks" shows tasks blocking the most other work. "ax" shows agent experience metrics — productivity, friction, trends.',
      },
      taskId: {
        type: 'string',
        description: 'View a specific task by ID (full or short prefix). Shows full detail with dependencies, files, and related decisions.',
      },
      decisionId: {
        type: 'string',
        description: 'View a specific decision by ID. Shows rationale, category, and linked task.',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'json', 'both'],
        description: 'Output format. "markdown" for human-readable text (default), "json" for structured data, "both" for Markdown text + JSON resource.',
      },
    },
  },
};

export const wheelhausSchemas = [
  viewWheelhausSchema,
];
