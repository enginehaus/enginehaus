/**
 * Thought Tool Schemas
 *
 * Schema definitions for low-friction thought capture MCP tools.
 */

export const captureThoughtSchema = {
  name: 'capture_thought',
  description: 'Capture a thought with minimal friction — single string input, stored as a draft decision for later review. Use this instead of log_decision when you have an observation, concern, or idea but don\'t want to stop and structure it. Review later with review_thoughts.',
  inputSchema: {
    type: 'object',
    properties: {
      thought: { type: 'string', description: 'The thought to capture — any observation, concern, idea, or potential decision' },
      taskId: { type: 'string', description: 'Associated task ID (optional — auto-detected from active task if omitted)' },
    },
    required: ['thought'],
  },
};

export const reviewThoughtsSchema = {
  name: 'review_thoughts',
  description: 'Review, promote, discard, or defer captured thoughts. Default action lists pending draft thoughts. Promote to convert a thought into an approved decision.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'promote', 'discard', 'defer'],
        description: 'Action to perform (default: list)',
      },
      decisionId: { type: 'string', description: 'Decision ID — required for promote/discard/defer actions' },
      category: {
        type: 'string',
        description: 'When promoting, optionally reclassify from "thought" to: architecture, tradeoff, dependency, pattern, other',
      },
    },
  },
};

export const thoughtSchemas = [
  captureThoughtSchema,
  reviewThoughtsSchema,
];
