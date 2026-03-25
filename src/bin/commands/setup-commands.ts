/**
 * Setup CLI command: first-time Enginehaus setup, MCP config generation
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CliContext } from '../cli-context.js';

export function registerSetupCommands(program: Command, ctx: CliContext): void {
  const { registerCommand } = ctx;

  registerCommand({
    command: 'setup',
    description: 'Set up Enginehaus for first-time use',
    example: 'enginehaus setup',
    altExamples: [
      'enginehaus setup --show-config',
      'enginehaus setup --claude-code',
      'enginehaus setup --skip-link --skip-claude',
    ],
    args: [],
    options: [
      { flags: '--skip-link', description: 'Skip npm link step', required: false },
      { flags: '--skip-claude', description: 'Skip Claude Desktop configuration', required: false },
      { flags: '--claude-code', description: 'Configure for Claude Code instead of Claude Desktop', required: false },
      { flags: '--show-config', description: 'Just output the MCP config JSON (no file changes)', required: false },
      { flags: '--mcp-port <port>', description: 'MCP server port', required: false },
      { flags: '--rest-port <port>', description: 'REST API port', required: false },
    ],
  });

  program
    .command('setup')
    .description('Set up Enginehaus for first-time use')
    .option('--skip-link', 'Skip npm link step')
    .option('--skip-claude', 'Skip Claude Desktop configuration')
    .option('--claude-code', 'Configure for Claude Code instead of Claude Desktop')
    .option('--show-config', 'Just output the MCP config JSON (no file changes)')
    .option('--mcp-port <port>', 'MCP server port', '47470')
    .option('--rest-port <port>', 'REST API port', '4747')
    .action(async (opts) => {
      const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');

      // import.meta.url = .../build/bin/commands/setup-commands.js → up 3 to project root
      const projectDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
      const buildDir = path.join(projectDir, 'build');
      const indexJs = path.join(buildDir, 'index.js');

      // Handle --show-config: just output the JSON and exit
      if (opts.showConfig) {
        const stdioConfig = { type: 'stdio', command: 'node', args: [indexJs] };
        const bareConfig = { command: 'node', args: [indexJs] };

        console.log('\n📋 MCP Configuration for Enginehaus\n');
        console.log('Enginehaus auto-configures these tools during `eh init`.');
        console.log('To manually add Enginehaus to any MCP-compatible tool:\n');

        console.log('─── Claude Code (.mcp.json in project root) ───');
        console.log(JSON.stringify({ mcpServers: { enginehaus: stdioConfig } }, null, 2));

        console.log('\n─── Cursor (.cursor/mcp.json in project root) ───');
        console.log(JSON.stringify({ mcpServers: { enginehaus: stdioConfig } }, null, 2));

        console.log('\n─── VS Code / Copilot (.vscode/mcp.json in project root) ───');
        console.log(JSON.stringify({ servers: { enginehaus: stdioConfig } }, null, 2));

        const platform = process.platform;
        let desktopPath: string;
        if (platform === 'darwin') {
          desktopPath = '~/Library/Application Support/Claude/claude_desktop_config.json';
        } else if (platform === 'win32') {
          desktopPath = '%APPDATA%\\Claude\\claude_desktop_config.json';
        } else {
          desktopPath = '~/.config/claude/claude_desktop_config.json';
        }
        console.log(`\n─── Claude Desktop (${desktopPath}) ───`);
        console.log(JSON.stringify({ mcpServers: { enginehaus: bareConfig } }, null, 2));

        console.log('\n─── Windsurf (~/.codeium/windsurf/mcp_config.json) ───');
        console.log(JSON.stringify({ mcpServers: { enginehaus: stdioConfig } }, null, 2));

        console.log('\n─── Kiro CLI (.kiro/settings/mcp.json) ───');
        console.log(JSON.stringify({ mcpServers: { enginehaus: stdioConfig } }, null, 2));

        console.log('\nCLI shortcut: claude mcp add enginehaus -- node ' + indexJs);
        console.log('');
        return;
      }

      console.log('\n🚀 Enginehaus Setup\n');
      const steps: { name: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error'; message?: string }[] = [
        { name: 'Check build', status: 'pending' },
        { name: 'Link CLI globally', status: 'pending' },
        { name: 'Check ports', status: 'pending' },
        { name: 'Configure Claude Desktop', status: 'pending' },
        { name: 'Verify installation', status: 'pending' },
      ];

      const printSteps = () => {
        steps.forEach(s => {
          const icon = s.status === 'done' ? '✅' :
                       s.status === 'running' ? '🔄' :
                       s.status === 'skipped' ? '⏭️' :
                       s.status === 'error' ? '❌' : '⬜';
          const msg = s.message ? ` - ${s.message}` : '';
          console.log(`  ${icon} ${s.name}${msg}`);
        });
      };

      // Step 1: Check/run build
      steps[0].status = 'running';

      if (!existsSync(indexJs)) {
        steps[0].message = 'Building...';
        try {
          execFileSync('npm', ['run', 'build'], { cwd: projectDir, stdio: 'pipe' });
          steps[0].status = 'done';
          steps[0].message = 'Built successfully';
        } catch (error) {
          steps[0].status = 'error';
          steps[0].message = 'Build failed - run npm run build manually';
          printSteps();
          console.log('\n❌ Setup failed. Fix build errors and try again.\n');
          process.exit(1);
        }
      } else {
        steps[0].status = 'done';
        steps[0].message = 'Build exists';
      }

      // Step 2: npm link
      steps[1].status = 'running';
      if (opts.skipLink) {
        steps[1].status = 'skipped';
        steps[1].message = 'Skipped by user';
      } else {
        try {
          execFileSync('npm', ['link'], { cwd: projectDir, stdio: 'pipe' });
          steps[1].status = 'done';
          steps[1].message = 'CLI available globally';
        } catch (error) {
          // Try to detect if it's a permissions issue
          const errMsg = error instanceof Error ? error.message : String(error);
          if (errMsg.includes('EACCES') || errMsg.includes('permission')) {
            steps[1].status = 'error';
            steps[1].message = 'Permission denied - try: sudo npm link';
          } else {
            steps[1].status = 'done';
            steps[1].message = 'Already linked or symlinked';
          }
        }
      }

      // Step 3: Check ports
      steps[2].status = 'running';
      const checkPort = (port: number): boolean => {
        try {
          execFileSync('lsof', ['-i', `:${port}`], { stdio: 'pipe' });
          return false; // Port in use
        } catch {
          return true; // Port available
        }
      };

      const mcpPort = parseInt(opts.mcpPort, 10);
      const restPort = parseInt(opts.restPort, 10);
      const mcpAvailable = checkPort(mcpPort);
      const restAvailable = checkPort(restPort);

      if (mcpAvailable && restAvailable) {
        steps[2].status = 'done';
        steps[2].message = `Ports ${restPort} and ${mcpPort} available`;
      } else {
        const inUse = [];
        if (!mcpAvailable) inUse.push(mcpPort);
        if (!restAvailable) inUse.push(restPort);
        steps[2].status = 'done';
        steps[2].message = `Ports ${inUse.join(', ')} in use (may be enginehaus already running)`;
      }

      // Step 4: Claude configuration (Desktop or Code)
      const targetApp = opts.claudeCode ? 'Claude Code' : 'Claude Desktop';
      steps[3].name = `Configure ${targetApp}`;
      steps[3].status = 'running';
      if (opts.skipClaude) {
        steps[3].status = 'skipped';
        steps[3].message = 'Skipped by user';
      } else {
        // Detect config location based on target app
        const platform = process.platform;
        let claudeConfigPath: string;

        if (opts.claudeCode) {
          // Claude Code uses .mcp.json in project root
          claudeConfigPath = path.join(process.cwd(), '.mcp.json');
        } else {
          // Claude Desktop uses claude_desktop_config.json
          if (platform === 'darwin') {
            claudeConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
          } else if (platform === 'win32') {
            claudeConfigPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
          } else {
            claudeConfigPath = path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
          }
        }

        // Build the enginehaus server config
        const enginehausConfig: Record<string, unknown> = {
          command: 'node',
          args: [indexJs],
        };
        // Claude Code uses .mcp.json format with type field
        if (opts.claudeCode) {
          enginehausConfig.type = 'stdio';
        }

        // Check if config exists
        if (existsSync(claudeConfigPath)) {
          try {
            const config = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
            const servers = config.mcpServers || {};

            // Check if enginehaus is already configured
            if (servers.enginehaus) {
              // Verify path is correct
              const currentPath = servers.enginehaus.args?.[0];
              if (currentPath === indexJs) {
                steps[3].status = 'done';
                steps[3].message = `Already configured in ${targetApp}`;
              } else {
                // Update config
                servers.enginehaus = enginehausConfig;
                config.mcpServers = servers;
                writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
                steps[3].status = 'done';
                steps[3].message = `Updated path in ${targetApp} config`;
              }
            } else {
              // Add enginehaus entry
              servers.enginehaus = enginehausConfig;
              config.mcpServers = servers;
              writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
              steps[3].status = 'done';
              steps[3].message = `Added to ${targetApp} config`;
            }
          } catch (error) {
            steps[3].status = 'error';
            steps[3].message = `Could not parse ${targetApp} config - check format`;
          }
        } else {
          // Create config directory and file
          try {
            mkdirSync(path.dirname(claudeConfigPath), { recursive: true });
            const config = {
              mcpServers: {
                enginehaus: enginehausConfig,
              },
            };
            writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
            steps[3].status = 'done';
            steps[3].message = `Created ${targetApp} config`;
          } catch (error) {
            steps[3].status = 'error';
            steps[3].message = `Could not create ${targetApp} config file`;
          }
        }
      }

      // Step 5: Verify installation
      steps[4].status = 'running';
      try {
        // Try to run a simple command
        const result = execFileSync('enginehaus', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
        steps[4].status = 'done';
        steps[4].message = `Version ${result.trim()}`;
      } catch {
        // Fall back to running directly
        try {
          const result = execFileSync('node', [path.join(buildDir, 'bin', 'enginehaus.js'), '--version'], { encoding: 'utf8', stdio: 'pipe' });
          steps[4].status = 'done';
          steps[4].message = `Version ${result.trim()} (via node)`;
        } catch {
          steps[4].status = 'error';
          steps[4].message = 'Could not verify - try running enginehaus --help';
        }
      }

      // Print final status
      console.log('');
      printSteps();

      const errors = steps.filter(s => s.status === 'error');
      if (errors.length > 0) {
        console.log('\n⚠️  Setup completed with warnings. Check errors above.\n');
      } else {
        console.log('\n✅ Setup complete!\n');
        console.log('Next steps:');
        console.log(`  1. Restart ${targetApp} to load the MCP server`);
        console.log('  2. In a project directory, run: enginehaus init');
        console.log('  3. Try: enginehaus task add -t "My first task" -p medium');
        console.log('');
        console.log('For troubleshooting: enginehaus doctor');
        console.log('For config output only: enginehaus setup --show-config');
        console.log('');
      }
    });
}
