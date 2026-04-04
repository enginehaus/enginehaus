/**
 * Tool CLI commands: generic passthrough to MCP tool registry
 *
 * Gives CLI access to every registered MCP tool without per-tool CLI code.
 * Usage:
 *   enginehaus tool list                          # List all tools
 *   enginehaus tool search <query>                # Search by keyword
 *   enginehaus tool run <name> [--param value]    # Run any MCP tool
 */

import { Command } from 'commander';
import type { CliContext } from '../cli-context.js';
import { registry, type ToolContext } from '../../adapters/mcp/tool-registry.js';
import { GitService } from '../../git/git-service.js';
import { QualityService } from '../../quality/quality-service.js';
import { CoordinationEngine } from '../../coordination/engine.js';
import type { TelemetryService } from '../../telemetry/index.js';

// Trigger tool self-registration by importing the index
import '../../adapters/mcp/tools/index.js';

export function registerToolCommands(program: Command, ctx: CliContext): void {
  const { coordination, storage, registerCommand } = ctx;

  const toolCmd = program
    .command('tool')
    .description('Run any MCP tool from the CLI');

  // -- Agent help specs --
  registerCommand({
    command: 'tool list',
    description: 'List all available MCP tools',
    example: 'enginehaus tool list',
    altExamples: ['enginehaus tool list --domain task', 'enginehaus tool list --json'],
    args: [],
    options: [
      { flags: '--domain <domain>', description: 'Filter by domain', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  registerCommand({
    command: 'tool search',
    description: 'Search tools by keyword',
    example: 'enginehaus tool search artifact',
    args: [{ name: 'query', required: true, description: 'Search keyword' }],
    options: [
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  registerCommand({
    command: 'tool run',
    description: 'Run any MCP tool with --param value arguments',
    example: 'enginehaus tool run store_artifact --taskId abc123 --type design --content "..."',
    altExamples: [
      'enginehaus tool run advance_phase --taskId abc --commitSha a1b2c3',
      'enginehaus tool run validate_quality_gates --taskId abc',
    ],
    args: [{ name: 'name', required: true, description: 'Tool name (e.g. store_artifact)' }],
    options: [
      { flags: '--json', description: 'Output raw JSON result', required: false },
      { flags: '--schema', description: 'Show tool parameter schema', required: false },
    ],
  });

  // ── tool list ──────────────────────────────────────────────────────────────

  toolCmd
    .command('list')
    .description('List all available MCP tools')
    .option('--domain <domain>', 'Filter by domain')
    .option('--json', 'Output as JSON')
    .action(async (opts: { domain?: string; json?: boolean }) => {
      const byDomain = registry.listByDomain();

      if (opts.json) {
        console.log(JSON.stringify(byDomain, null, 2));
        return;
      }

      for (const [domain, tools] of Object.entries(byDomain)) {
        if (opts.domain && domain !== opts.domain) continue;
        console.log(`\n${domain} (${tools.length}):`);
        for (const t of tools) {
          console.log(`  ${t.name.padEnd(40)} ${t.description.slice(0, 60)}`);
        }
      }
      console.log(`\n${registry.size} tools total. Use 'enginehaus tool run <name> --help' for details.`);
    });

  // ── tool search ────────────────────────────────────────────────────────────

  toolCmd
    .command('search <query>')
    .description('Search tools by keyword')
    .option('--json', 'Output as JSON')
    .action(async (query: string, opts: { json?: boolean }) => {
      const results = registry.search(query);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No tools matching "${query}".`);
        return;
      }

      console.log(`\n${results.length} tool(s) matching "${query}":\n`);
      for (const t of results) {
        console.log(`  ${t.name.padEnd(40)} [${t.domain}] ${t.description.slice(0, 50)}`);
      }
    });

  // ── tool run <name> [-- args] ──────────────────────────────────────────────

  toolCmd
    .command('run <name>')
    .description('Run any MCP tool\n\n  Pass tool parameters as --key value pairs.\n  Examples:\n    enginehaus tool run store_artifact --taskId abc --type design --content "..."\n    enginehaus tool run advance_phase --taskId abc --commitSha a1b2c3')
    .option('--json', 'Output raw JSON result')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (name: string, opts: { json?: boolean }, cmd: Command) => {
      // Resolve the tool
      const def = registry.resolve(name);
      if (!def) {
        // Suggest similar tools
        const suggestions = registry.search(name);
        console.error(`Unknown tool: ${name}`);
        if (suggestions.length > 0) {
          console.error(`\nDid you mean:`);
          for (const s of suggestions.slice(0, 5)) {
            console.error(`  ${s.name}`);
          }
        }
        process.exit(1);
      }

      // Show tool schema when --schema flag is passed
      const rawArgs = cmd.args.slice(1); // skip the tool name
      if (rawArgs.includes('--schema')) {
        console.log(`\n${def.name}`);
        console.log(`  ${def.description}\n`);
        const props = (def.inputSchema as any)?.properties || {};
        const required = (def.inputSchema as any)?.required || [];
        if (Object.keys(props).length > 0) {
          console.log('Parameters:');
          for (const [key, schema] of Object.entries(props) as [string, any][]) {
            const req = required.includes(key) ? ' (required)' : '';
            const type = schema.type || 'any';
            const desc = schema.description || '';
            console.log(`  --${key.padEnd(25)} ${type.padEnd(10)} ${desc.slice(0, 50)}${req}`);
          }
        } else {
          console.log('No parameters.');
        }
        return;
      }

      // Parse --key value pairs from remaining args
      const toolArgs = parseToolArgs(rawArgs);

      // Coerce types based on schema
      const props = (def.inputSchema as any)?.properties || {};
      for (const [key, val] of Object.entries(toolArgs)) {
        const schemaProp = props[key] as any;
        if (!schemaProp) continue;
        if (schemaProp.type === 'number' || schemaProp.type === 'integer') {
          toolArgs[key] = Number(val);
        } else if (schemaProp.type === 'boolean') {
          toolArgs[key] = val === 'true' || val === true;
        } else if (schemaProp.type === 'array' && typeof val === 'string') {
          try { toolArgs[key] = JSON.parse(val); } catch { toolArgs[key] = (val as string).split(','); }
        } else if (schemaProp.type === 'object' && typeof val === 'string') {
          try { toolArgs[key] = JSON.parse(val); } catch { /* leave as string */ }
        }
      }

      // Build ToolContext from CLI context
      const toolCtx = await buildToolContext(coordination, storage);

      try {
        const result = await def.handler(toolCtx, toolArgs);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Pretty-print text content
        for (const item of result.content) {
          if (item.type === 'text') {
            console.log(item.text);
          } else {
            console.log(JSON.stringify(item, null, 2));
          }
        }

        if (result.isError) {
          process.exit(1);
        }
      } catch (err: any) {
        console.error(`Error running ${name}: ${err.message}`);
        process.exit(1);
      }
    });
}

/**
 * Parse --key value pairs from a raw args array.
 * Handles: --key value, --key=value, --flag (boolean true)
 */
export function parseToolArgs(raw: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  let i = 0;
  while (i < raw.length) {
    const arg = raw[i];
    if (arg === '--json') { i++; continue; } // skip our own flag

    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value
        args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else if (i + 1 < raw.length && !raw[i + 1].startsWith('--')) {
        // --key value
        args[arg.slice(2)] = raw[i + 1];
        i++;
      } else {
        // --flag (boolean)
        args[arg.slice(2)] = true;
      }
    }
    i++;
  }
  return args;
}

/**
 * Build a ToolContext that bridges the CLI environment to the MCP tool handlers.
 */
async function buildToolContext(
  coordinationService: any,
  sqliteStorage?: any,
): Promise<ToolContext> {
  const projectRoot = process.cwd();

  // Use the CLI's existing storage instance (already initialized by CoordinationService)
  const storageForEngine = sqliteStorage || coordinationService['storage'];

  // Ensure storage is initialized (SQLiteStorageService initializes lazily)
  if (storageForEngine && typeof storageForEngine.initialize === 'function') {
    await storageForEngine.initialize();
  }

  // Create CoordinationEngine (same as MCP server does)
  const gitService = new GitService(projectRoot);
  const qualityService = new QualityService(projectRoot);
  const engine = new CoordinationEngine(gitService, qualityService, storageForEngine);

  // No-op telemetry for CLI (telemetry is only used in the MCP server wrapper, not in handlers)
  const noopTelemetry = {
    startChain: async () => {},
    endChain: async () => {},
    recordToolCall: async () => {},
    getSummary: async () => ({}),
  } as unknown as TelemetryService;

  return {
    service: coordinationService,
    coordination: engine,
    projectRoot,
    resolvedAgentId: process.env.ENGINEHAUS_AGENT_ID || 'cli-user',
    telemetry: noopTelemetry,
    sessionState: { taskCount: 0 },
    getProjectContext: async () => {
      try {
        return await coordinationService.getActiveProjectContext();
      } catch {
        return null;
      }
    },
  };
}
