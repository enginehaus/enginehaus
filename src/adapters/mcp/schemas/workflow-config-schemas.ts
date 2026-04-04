/**
 * Workflow Configuration Schemas
 *
 * Tool for configuring team workflow preferences.
 * Claude interprets natural language; this tool accepts structured config.
 */

export const configureWorkflowSchema = {
  name: 'configure_workflow',
  description: `Configure your team's workflow preferences. Accepts structured configuration that Enginehaus will enforce.

Use this after interpreting a user's natural language workflow description. For example:
- "We do trunk-based development" → branchStrategy: "trunk", commitTarget: "main"
- "Our definition of done is tests pass and at least one decision logged" → qualityGates: ["tests_passing", "min_decisions:1"]
- "We mob program" → sessionOwnership: "collective", driverRotation: true

Returns a diff of what will change and the updated configuration.`,
  inputSchema: {
    type: 'object',
    properties: {
      branchStrategy: {
        type: 'string',
        enum: ['feature', 'trunk', 'gitflow'],
        description: 'Branch strategy: "feature" (default), "trunk" (commit to main), or "gitflow"',
      },
      sessionOwnership: {
        type: 'string',
        enum: ['individual', 'collective'],
        description: 'Task ownership: "individual" (one agent per task) or "collective" (mob/pair)',
      },
      commitTarget: {
        type: 'string',
        enum: ['branch', 'main'],
        description: 'Where to commit: "branch" (feature branch) or "main" (trunk-based)',
      },
      releaseFrequency: {
        type: 'string',
        enum: ['continuous', 'sprint', 'manual'],
        description: 'Release cadence (informational, shown in briefings)',
      },
      driverRotation: {
        type: 'boolean',
        description: 'Enable driver rotation for mob/pair workflows',
      },
      qualityGates: {
        type: 'array',
        items: { type: 'string' },
        description: 'User-defined quality gates. Examples: "tests_passing", "min_decisions:1", "no_uncommitted_changes", "lint_clean". Replaces default heuristics.',
      },
    },
  },
};

export const getWorkflowConfigSchema = {
  name: 'get_workflow_config',
  description: `Get the current workflow configuration. Shows both defaults and any user customizations.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
};
