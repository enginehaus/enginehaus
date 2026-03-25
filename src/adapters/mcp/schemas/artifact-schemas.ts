/**
 * Artifact Tool Schemas
 *
 * Schema definitions for artifact management MCP tools.
 */

export const artifactLinkSchema = {
  name: 'link_artifact',
  description: 'Link an artifact (file, URL, design, doc) to a task for context assembly. Supports knowledge lineage tracking with origin chat URI and evolution history.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to attach artifact to' },
      type: {
        type: 'string',
        enum: ['design', 'doc', 'code', 'test', 'screenshot', 'url', 'reference', 'other'],
        description: 'Type of artifact',
      },
      uri: { type: 'string', description: 'URI or path to the artifact' },
      title: { type: 'string', description: 'Optional title for the artifact' },
      description: { type: 'string', description: 'Optional description' },
      parentArtifactId: { type: 'string', description: 'ID of parent artifact if this is derived/evolved from another artifact' },
    },
    required: ['taskId', 'type', 'uri'],
  },
};

export const artifactListSchema = {
  name: 'list_artifacts',
  description: 'List artifacts linked to a task. Shows metadata and content info. Use includeContent to get full content (for smaller artifacts).',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
      type: {
        type: 'string',
        enum: ['design', 'doc', 'code', 'test', 'screenshot', 'url', 'reference', 'other'],
        description: 'Optional filter by type',
      },
      includeContent: { type: 'boolean', description: 'Include full content in response (default: false)' },
    },
    required: ['taskId'],
  },
};

export const artifactRemoveSchema = {
  name: 'remove_artifact',
  description: 'Remove an artifact from a task',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Artifact ID to remove' },
    },
    required: ['artifactId'],
  },
};

export const artifactGetLineageSchema = {
  name: 'get_artifact_lineage',
  description: 'Get the full evolution lineage of an artifact - its origin, all transformations, and derived children. Use this to understand how knowledge has evolved.',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Artifact ID to trace lineage for' },
    },
    required: ['artifactId'],
  },
};

export const artifactStoreSchema = {
  name: 'store_artifact',
  description: 'Store artifact content directly in Enginehaus (not just a URI reference). Use for cross-agent handoff of text, markdown, JSON, or base64-encoded binary. Max 1MB. This enables the knowledge flywheel: capture insights from one chat to use in another.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to attach artifact to' },
      type: {
        type: 'string',
        enum: ['design', 'doc', 'code', 'test', 'screenshot', 'reference', 'other'],
        description: 'Artifact type'
      },
      content: { type: 'string', description: 'Content to store (text, markdown, JSON, or base64 for binary)' },
      contentType: {
        type: 'string',
        enum: ['text/plain', 'text/markdown', 'application/json', 'image/png', 'image/jpeg', 'image/svg+xml', 'application/octet-stream'],
        description: 'MIME type of the content'
      },
      title: { type: 'string', description: 'Title for the artifact' },
      description: { type: 'string', description: 'Description of the artifact' },
      parentArtifactId: { type: 'string', description: 'ID of parent artifact if this is derived/refined from another' },
    },
    required: ['taskId', 'type', 'content', 'contentType'],
  },
};

export const artifactGetSchema = {
  name: 'get_artifact',
  description: 'Retrieve full artifact content by ID. Returns the stored content along with metadata. Use this to fetch artifacts for cross-agent handoff.',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Artifact ID to retrieve' },
      includeContent: { type: 'boolean', description: 'Whether to include the full content (default: true)' },
    },
    required: ['artifactId'],
  },
};

export const captureInsightSchema = {
  name: 'capture_insight',
  description: 'Capture an insight, design, or decision from the conversation and attach it to a task. PROACTIVELY SUGGEST THIS when valuable content emerges ("Should I capture this as an artifact?"). If type is "decision", also creates a decision record for traceability.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to attach the insight to' },
      content: { type: 'string', description: 'The insight content to capture (markdown supported)' },
      type: {
        type: 'string',
        enum: ['design', 'rationale', 'requirement', 'note', 'decision'],
        description: 'Type of insight: design (architecture/UI), rationale (why), requirement (what), note (general), decision (creates decision record)',
      },
      title: { type: 'string', description: 'Optional title for the insight' },
    },
    required: ['taskId', 'content', 'type'],
  },
};

export const artifactSearchSchema = {
  name: 'search_artifacts',
  description: 'Search artifacts by content using full-text search. Use this to find prior decisions, designs, rationale, and institutional knowledge. "Did we discuss X before?" "What was the rationale for Y?"',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search terms to find in artifact title, description, and content' },
      type: {
        type: 'string',
        enum: ['design', 'doc', 'code', 'test', 'screenshot', 'reference', 'other'],
        description: 'Optional filter by artifact type',
      },
      projectId: { type: 'string', description: 'Optional project scope (default: active project)' },
      limit: { type: 'number', description: 'Max results to return (default: 10, max: 50)' },
    },
    required: ['query'],
  },
};

export const artifactSchemas = [
  artifactLinkSchema,
  artifactListSchema,
  artifactRemoveSchema,
  artifactGetLineageSchema,
  artifactStoreSchema,
  artifactGetSchema,
  captureInsightSchema,
  artifactSearchSchema,
];
