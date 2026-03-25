/**
 * Server and Errors CLI commands: serve/web, errors
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { CliContext } from '../cli-context.js';

export function registerServerCommands(program: Command, ctx: CliContext): void {
  const { coordination, resolveProject } = ctx;

  // ============================================================================
  // Server Command
  // ============================================================================

  program
    .command('serve')
    .alias('web')
    .description('Start Wheelhaus (web console), REST API, and MCP server')
    .option('--web-port <port>', 'Wheelhaus web console port', '4747')
    .option('--api-port <port>', 'REST API port', '47470')
    .option('--api-only', 'Only start the REST API server')
    .option('--no-open', 'Don\'t open browser automatically')
    .action(async (opts) => {
      const { spawn } = await import('child_process');
      const net = await import('net');
      await coordination.initialize();

      const webPort = parseInt(opts.webPort);
      const apiPort = parseInt(opts.apiPort);

      // Check if ports are available
      async function isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
          const server = net.createServer();
          server.once('error', () => resolve(false));
          server.once('listening', () => {
            server.close();
            resolve(true);
          });
          server.listen(port);
        });
      }

      // Check API port
      if (!(await isPortAvailable(apiPort))) {
        console.error(`\n❌ Port ${apiPort} is already in use.`);
        console.error(`   Try: enginehaus serve --api-port ${apiPort + 10}`);
        process.exit(1);
      }

      // Check web port (if not api-only)
      if (!opts.apiOnly && !(await isPortAvailable(webPort))) {
        console.error(`\n❌ Port ${webPort} is already in use.`);
        console.error(`   Try: enginehaus serve --web-port ${webPort + 10}`);
        process.exit(1);
      }

      console.log('\n🚀 Starting Enginehaus...\n');

      // Start REST API server
      const { startServer } = await import('../../adapters/rest/server.js');
      await startServer(apiPort);

      if (opts.apiOnly) {
        console.log('\n┌─────────────────────────────────────────────────────────┐');
        console.log('│                   Enginehaus Running                     │');
        console.log('├─────────────────────────────────────────────────────────┤');
        console.log(`│  REST API:  http://localhost:${apiPort.toString().padEnd(24)}│`);
        console.log(`│  MCP:       stdio (add to Claude Code settings)         │`);
        console.log('└─────────────────────────────────────────────────────────┘');
        console.log('\nPress Ctrl+C to stop.\n');
        return;
      }

      // Start Web Console (Vite dev server)
      const webDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'web');

      // Check if web directory exists
      if (!fs.existsSync(webDir)) {
        console.error(`\n❌ Web console not found at: ${webDir}`);
        console.error('   The REST API is running. Web console may not be installed.');
        console.error(`   REST API: http://localhost:${apiPort}`);
        return;
      }

      const viteProcess = spawn('npx', ['vite', '--port', String(webPort), '--host'], {
        cwd: webDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let started = false;

      viteProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        // Suppress Vite's verbose output, show only essential info
        if (output.includes('ready in') && !started) {
          started = true;
          console.log('┌─────────────────────────────────────────────────────────┐');
          console.log('│                   Enginehaus Running                     │');
          console.log('├─────────────────────────────────────────────────────────┤');
          console.log(`│  Wheelhaus: http://localhost:${webPort.toString().padEnd(25)}│`);
          console.log(`│  REST API:  http://localhost:${apiPort.toString().padEnd(25)}│`);
          console.log(`│  MCP:       stdio (add to Claude Code settings)         │`);
          console.log('└─────────────────────────────────────────────────────────┘');
          console.log('\nPress Ctrl+C to stop.\n');

          // Auto-open browser unless --no-open
          if (opts.open !== false) {
            const url = `http://localhost:${webPort}`;
            const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
            spawn(openCmd, [url], { stdio: 'ignore', shell: true, detached: true }).unref();
          }
        }
      });

      viteProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        // Only show actual errors, not Vite's info output
        if (output.includes('error') || output.includes('Error')) {
          console.error(output);
        }
      });

      viteProcess.on('error', (err) => {
        console.error('\n❌ Failed to start web console:', err.message);
        console.error('   Make sure npm dependencies are installed in the web/ directory.');
        console.error('   Run: cd web && npm install');
      });

      viteProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`\n❌ Web console exited with code ${code}`);
        }
        process.exit(code || 0);
      });

      // Handle shutdown
      const cleanup = () => {
        console.log('\n\nShutting down...');
        viteProcess.kill();
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });

  // ============================================================================
  // Errors Command
  // ============================================================================

  program
    .command('errors')
    .description('Show recent MCP tool errors from the audit log')
    .option('-n, --limit <count>', 'Number of errors to show', '20')
    .option('-p, --period <period>', 'Time period: hour, day, week (default: day)', 'day')
    .option('--tool <name>', 'Filter by tool name')
    .option('--json', 'Output as JSON')
    .option('--all-projects', 'Show errors from all projects')
    .action(async (opts) => {
      await coordination.initialize();

      const project = opts.allProjects ? null : await resolveProject();

      // Calculate since date based on period
      const now = Date.now();
      let sinceMs: number;
      switch (opts.period) {
        case 'hour':
          sinceMs = now - 60 * 60 * 1000;
          break;
        case 'week':
          sinceMs = now - 7 * 24 * 60 * 60 * 1000;
          break;
        case 'day':
        default:
          sinceMs = now - 24 * 60 * 60 * 1000;
      }
      const since = new Date(sinceMs);

      // Query audit log for error events
      const auditResult = await coordination.queryAuditLog({
        eventTypes: ['error.tool_failed', 'error.validation_failed', 'error.internal'],
        projectId: project?.id,
        startTime: since,
        limit: parseInt(opts.limit, 10),
      });
      const events = auditResult.events;

      // Filter by tool if specified
      const filtered = opts.tool
        ? events.filter((e: any) => e.resourceId === opts.tool)
        : events;

      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        console.log('\n🚨 Recent Errors\n');

        if (filtered.length === 0) {
          console.log('  No errors found in the specified period.');
        } else {
          // Group by tool
          const byTool = new Map<string, typeof filtered>();
          for (const e of filtered) {
            const toolName = e.resourceId || 'unknown';
            if (!byTool.has(toolName)) {
              byTool.set(toolName, []);
            }
            byTool.get(toolName)!.push(e);
          }

          // Summary
          console.log(`Found ${filtered.length} errors in the last ${opts.period}:\n`);

          // Show by tool
          for (const [tool, errors] of byTool) {
            console.log(`  ${tool}: ${errors.length} error(s)`);
          }

          console.log('\nRecent errors:\n');

          // Show details (most recent first)
          for (const e of filtered.slice(0, 10)) {
            const time = new Date(e.timestamp).toLocaleString();
            const meta = e.metadata as { args?: unknown; stackTrace?: string } | undefined;

            console.log(`  [${time}] ${e.resourceId}`);
            console.log(`    Error: ${e.action}`);
            if (meta?.args) {
              const argsStr = JSON.stringify(meta.args);
              console.log(`    Args: ${argsStr.length > 80 ? argsStr.slice(0, 80) + '...' : argsStr}`);
            }
            console.log('');
          }

          if (filtered.length > 10) {
            console.log(`  ... and ${filtered.length - 10} more. Use --limit to see more.`);
          }
        }
      }
    });
}
