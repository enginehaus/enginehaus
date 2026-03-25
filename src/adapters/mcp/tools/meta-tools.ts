/**
 * Meta Tools
 *
 * Tools about tools — discoverability and orientation.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';

const DOMAIN_LABELS: Record<string, string> = {
  workflow: 'Core Workflow (start here)',
  task: 'Task Management',
  session: 'Session & Claims',
  decision: 'Decisions & Rationale',
  phase: 'Phase Progression',
  project: 'Project Configuration',
  initiative: 'Initiatives & Goals',
  outcome: 'Outcome Tracking',
  artifact: 'Artifacts & Plans',
  dependency: 'Task Dependencies',
  quality: 'Quality Gates',
  checkpoint: 'Human Checkpoints',
  coordination: 'Coordination Context',
  consolidated: 'Consolidated Views',
  agent: 'Agent Management',
  dispatch: 'Multi-Agent Dispatch',
  contribution: 'Contribution Tracking',
  metrics: 'Metrics & Analytics',
  telemetry: 'Telemetry',
  validation: 'Validation',
  git: 'Git Integration',
  prompt: 'Prompt Templates',
  'file-lock': 'File Locking',
  'product-role': 'Product Roles',
  wheelhaus: 'Wheelhaus UI',
};

// Priority order for domain display — core domains first
const DOMAIN_ORDER = [
  'workflow', 'task', 'session', 'decision', 'phase',
  'project', 'initiative', 'outcome', 'artifact', 'dependency',
  'quality', 'checkpoint', 'coordination', 'consolidated',
  'agent', 'dispatch', 'contribution', 'metrics', 'telemetry',
  'validation', 'git', 'prompt', 'file-lock', 'product-role', 'wheelhaus',
];

registry.register({
  name: 'search_tools',
  description: 'Search for Enginehaus tools by keyword. Matches against tool names and descriptions. Use this when you know what you want to do but not the exact tool name.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keyword to search for (e.g., "add", "task", "decision", "quality")',
      },
    },
    required: ['query'],
  },
  domain: 'meta',
  aliases: ['tool_search', 'find_tool'],
  handler: async (_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    const query = args.query as string;
    if (!query || query.trim().length === 0) {
      return { content: [{ type: 'text', text: 'Please provide a search query.' }] };
    }

    const results = registry.search(query.trim());
    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No tools found matching "${query}". Try \`discover_tools()\` to see all available tools by category.`,
        }],
      };
    }

    const lines = [`## Tools matching "${query}" (${results.length} found)\n`];
    for (const t of results) {
      const brief = t.description.split(/\.\s/)[0] + '.';
      lines.push(`- **${t.name}** [${t.domain}]: ${brief}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
});

registry.register({
  name: 'discover_tools',
  description: 'Find available Enginehaus tools by category. Call this FIRST if you\'re unsure which tool to use. Returns tools grouped by domain with descriptions. Optionally filter by domain name.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Filter to a specific domain (e.g., "task", "decision", "workflow"). Omit to see all domains.',
      },
    },
  },
  domain: 'meta',
  handler: async (_ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    const filterDomain = args.domain as string | undefined;
    const byDomain = registry.listByDomain();

    if (filterDomain) {
      const tools = byDomain[filterDomain];
      if (!tools) {
        const available = Object.keys(byDomain).sort().join(', ');
        return {
          content: [{ type: 'text', text: `Unknown domain "${filterDomain}". Available domains: ${available}` }],
        };
      }
      const label = DOMAIN_LABELS[filterDomain] || filterDomain;
      const lines = [`## ${label} (${tools.length} tools)\n`];
      for (const t of tools) {
        // First sentence of description only
        const brief = t.description.split(/\.\s/)[0] + '.';
        lines.push(`- **${t.name}**: ${brief}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // Full categorized overview
    const lines: string[] = [
      `# Enginehaus Tools (${registry.size} total)\n`,
      'Use `discover_tools({ domain: "<name>" })` to see tools in a specific category.\n',
      '## Quick Start',
      '- **start_work** → claim highest priority task and get full context',
      '- **finish_work** → complete task with auto-generated docs',
      '- **log_decision** → record architectural choices (works with or without active task)',
      '- **add_task** → track discovered work\n',
      '## Categories\n',
    ];

    const sortedDomains = Object.keys(byDomain).sort((a, b) => {
      const ai = DOMAIN_ORDER.indexOf(a);
      const bi = DOMAIN_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    for (const domain of sortedDomains) {
      const tools = byDomain[domain];
      const label = DOMAIN_LABELS[domain] || domain;
      const names = tools.map(t => t.name).join(', ');
      lines.push(`- **${label}** (${tools.length}): ${names}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
});
