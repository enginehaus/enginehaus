/**
 * Doctor CLI command: diagnose Enginehaus installation and configuration issues
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { CliContext } from '../cli-context.js';
import { getDataDir } from '../../config/paths.js';
import { checkForUpdates, getCurrentVersion } from '../../utils/version-check.js';
import { INSTRUCTIONS_VERSION } from '../../instructions-version.js';
import { detectClients } from '../../hooks/client-detection.js';

export function registerDoctorCommands(program: Command, ctx: CliContext): void {
  const { coordination } = ctx;

  program
    .command('doctor')
    .description('Diagnose Enginehaus installation and configuration issues')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      interface CheckResult {
        name: string;
        status: 'ok' | 'warning' | 'error';
        message: string;
        fix?: string;
      }

      const checks: CheckResult[] = [];

      // import.meta.url = .../build/bin/commands/doctor-commands.js → up 3 to project root
      const projectDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
      const buildDir = path.join(projectDir, 'build');
      const indexJs = path.join(buildDir, 'index.js');
      const doctorDataDir = getDataDir();
      const dbPath = path.join(doctorDataDir, 'enginehaus.db');

      if (!opts.json) console.log('\n🩺 Enginehaus Doctor\n');

      // Check 1: Node version
      try {
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
        if (majorVersion >= 18) {
          checks.push({ name: 'Node.js version', status: 'ok', message: nodeVersion });
        } else {
          checks.push({
            name: 'Node.js version',
            status: 'error',
            message: `${nodeVersion} (requires >= 18)`,
            fix: 'Upgrade Node.js to version 18 or later',
          });
        }
      } catch {
        checks.push({ name: 'Node.js version', status: 'error', message: 'Could not detect', fix: 'Install Node.js 18+' });
      }

      // Check 1.5: Enginehaus version (update available?)
      try {
        const versionResult = await checkForUpdates();
        const currentVer = getCurrentVersion();
        if (versionResult && versionResult.updateAvailable) {
          checks.push({
            name: 'Enginehaus version',
            status: 'warning',
            message: `v${currentVer} (v${versionResult.latestVersion} available)`,
            fix: 'Run: enginehaus update',
          });
        } else {
          checks.push({ name: 'Enginehaus version', status: 'ok', message: `v${currentVer} (latest)` });
        }
      } catch {
        const currentVer = getCurrentVersion();
        checks.push({ name: 'Enginehaus version', status: 'ok', message: `v${currentVer}` });
      }

      // Check 2: Build exists
      if (existsSync(indexJs)) {
        checks.push({ name: 'Build', status: 'ok', message: 'Build directory exists' });
      } else {
        checks.push({
          name: 'Build',
          status: 'error',
          message: 'No build found',
          fix: 'Run: npm run build',
        });
      }

      // Check 3: CLI globally available
      try {
        execFileSync('which', ['enginehaus'], { stdio: 'pipe' });
        checks.push({ name: 'CLI globally linked', status: 'ok', message: 'enginehaus command available' });
      } catch {
        checks.push({
          name: 'CLI globally linked',
          status: 'warning',
          message: 'CLI not in PATH',
          fix: 'Run: npm link (or sudo npm link)',
        });
      }

      // Check 4: Database exists and is writable
      if (existsSync(dbPath)) {
        try {
          const stats = statSync(dbPath);
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
          checks.push({ name: 'Database', status: 'ok', message: `${sizeMB} MB at ${dbPath}` });
        } catch {
          checks.push({
            name: 'Database',
            status: 'error',
            message: 'Database exists but not readable',
            fix: 'Check file permissions on ' + dbPath,
          });
        }
      } else if (existsSync(doctorDataDir)) {
        checks.push({
          name: 'Database',
          status: 'warning',
          message: 'No database yet (will be created on first use)',
        });
      } else {
        checks.push({
          name: 'Database',
          status: 'warning',
          message: 'Data directory does not exist',
          fix: 'Will be created on first use',
        });
      }

      // Check 5: Claude Desktop config
      const platform = process.platform;
      let claudeConfigPath: string;
      if (platform === 'darwin') {
        claudeConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      } else if (platform === 'win32') {
        claudeConfigPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
      } else {
        claudeConfigPath = path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
      }

      if (existsSync(claudeConfigPath)) {
        try {
          const config = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
          if (config.mcpServers?.enginehaus) {
            const configuredPath = config.mcpServers.enginehaus.args?.[0];
            if (configuredPath === indexJs) {
              checks.push({ name: 'Claude Desktop config', status: 'ok', message: 'Enginehaus configured correctly' });
            } else if (existsSync(configuredPath)) {
              checks.push({
                name: 'Claude Desktop config',
                status: 'warning',
                message: 'Enginehaus configured but path differs from this installation',
                fix: `Update path in ${claudeConfigPath} to: ${indexJs}`,
              });
            } else {
              checks.push({
                name: 'Claude Desktop config',
                status: 'error',
                message: 'Enginehaus path invalid: ' + configuredPath,
                fix: `Update path in ${claudeConfigPath} to: ${indexJs}`,
              });
            }
          } else {
            checks.push({
              name: 'Claude Desktop config',
              status: 'error',
              message: 'Enginehaus not configured',
              fix: 'Run: enginehaus setup',
            });
          }
        } catch {
          checks.push({
            name: 'Claude Desktop config',
            status: 'error',
            message: 'Config file exists but is invalid JSON',
            fix: 'Check syntax in ' + claudeConfigPath,
          });
        }
      } else {
        checks.push({
          name: 'Claude Desktop config',
          status: 'warning',
          message: 'No Claude Desktop config found',
          fix: 'Run: enginehaus setup (or manually create config)',
        });
      }

      // Check 5b: Detected MCP clients — use the plugin detection system
      const cwd = process.cwd();
      const detectedClients = detectClients(cwd);

      if (detectedClients.length === 0) {
        checks.push({
          name: 'MCP clients',
          status: 'warning',
          message: 'No MCP clients detected',
          fix: 'Install an MCP-capable tool (Claude Code, Cursor, VS Code, etc.)',
        });
      } else {
        // MCP config paths differ from hook config paths — map clientId to where MCP servers are configured
        const mcpConfigMap: Record<string, { path: string; key: string }> = {
          'claude-code': { path: path.join(cwd, '.mcp.json'), key: 'mcpServers' },
          'vscode-copilot': { path: path.join(cwd, '.vscode', 'mcp.json'), key: 'servers' },
          'cursor': { path: path.join(cwd, '.cursor', 'mcp.json'), key: 'mcpServers' },
          'cline': { path: path.join(cwd, '.clinerules', 'mcp.json'), key: 'mcpServers' },
          'gemini-cli': { path: path.join(cwd, '.gemini', 'settings.json'), key: 'mcpServers' },
          'opencode': { path: path.join(cwd, 'opencode.json'), key: 'mcpServers' },
          'kiro-cli': { path: path.join(cwd, '.kiro', 'settings', 'mcp.json'), key: 'mcpServers' },
          'roo-code': { path: path.join(cwd, '.roo', 'mcp.json'), key: 'mcpServers' },
          'windsurf': { path: path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers' },
          'lm-studio': { path: path.join(os.homedir(), '.lmstudio', 'mcp.json'), key: 'mcpServers' },
        };

        for (const client of detectedClients) {
          const tierLabel = client.tier === 1 ? 'Tier 1' : 'Tier 2';
          const mcpCfg = mcpConfigMap[client.id];

          // For Claude Desktop, use its own configPath (which IS the MCP config)
          const mcpPath = client.id === 'claude-desktop' ? client.configPath : mcpCfg?.path;
          const serverKey = mcpCfg?.key || 'mcpServers';

          if (!mcpPath || !existsSync(mcpPath)) {
            checks.push({
              name: `${client.name} (${tierLabel})`,
              status: 'warning',
              message: 'Detected but not configured',
              fix: 'Run: enginehaus init',
            });
            continue;
          }

          try {
            const config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
            const servers = config[serverKey] || {};
            if (servers.enginehaus) {
              const hooksLabel = client.hooksSupported.preToolUse ? ', hooks active' : '';
              checks.push({ name: `${client.name} (${tierLabel})`, status: 'ok', message: `Configured${hooksLabel}` });
            } else {
              checks.push({
                name: `${client.name} (${tierLabel})`,
                status: 'warning',
                message: 'Detected but Enginehaus not configured',
                fix: 'Run: enginehaus init',
              });
            }
          } catch {
            checks.push({
              name: `${client.name}`,
              status: 'warning',
              message: 'MCP config exists but is invalid JSON',
            });
          }
        }
      }

      // Check 5c: Hook scripts deployed
      const globalHooksDir = path.join(os.homedir(), '.enginehaus', 'hooks');
      const expectedHooks = ['session-start', 'enforce-workflow', 'post-commit-reminder', 'detect-pipe-workaround', 'detect-context-loss', 'auto-decision-capture'];
      const hookExt = process.platform === 'win32' ? '.ps1' : '.sh';
      const missingHooks = expectedHooks.filter(h => !existsSync(path.join(globalHooksDir, h + hookExt)));
      if (missingHooks.length === 0) {
        checks.push({ name: 'Hook scripts', status: 'ok', message: `${expectedHooks.length} scripts deployed` });
      } else {
        checks.push({
          name: 'Hook scripts',
          status: 'warning',
          message: `Missing: ${missingHooks.join(', ')}`,
          fix: 'Run: enginehaus hooks install',
        });
      }

      // Check 6: Ports
      const checkPort = (port: number): boolean => {
        try {
          execFileSync('lsof', ['-i', `:${port}`], { stdio: 'pipe' });
          return false; // Port in use
        } catch {
          return true; // Port available
        }
      };

      const restAvailable = checkPort(4747);
      const mcpAvailable = checkPort(47470);

      if (restAvailable && mcpAvailable) {
        checks.push({ name: 'Ports 4747/47470', status: 'ok', message: 'Both ports available' });
      } else {
        const inUse = [];
        if (!restAvailable) inUse.push('4747');
        if (!mcpAvailable) inUse.push('47470');
        checks.push({
          name: 'Ports',
          status: 'warning',
          message: `Port(s) ${inUse.join(', ')} in use`,
          fix: inUse.length > 0 ? 'May be enginehaus already running, or kill process using: lsof -ti:PORT | xargs kill' : undefined,
        });
      }

      // Check 7: Active project
      try {
        await coordination.initialize();
        const project = await coordination.getActiveProject();
        if (project) {
          checks.push({ name: 'Active project', status: 'ok', message: `${project.name} (${project.slug})` });
        } else {
          checks.push({
            name: 'Active project',
            status: 'warning',
            message: 'No active project set',
            fix: 'Run: enginehaus project init --name "Project Name" in your project directory',
          });
        }
      } catch {
        checks.push({
          name: 'Active project',
          status: 'warning',
          message: 'Could not check (database not initialized)',
        });
      }

      // Check 8: CLAUDE.md instructions version
      const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
      if (existsSync(claudeMdPath)) {
        try {
          const claudeMdContent = readFileSync(claudeMdPath, 'utf-8');
          // Look for version in HTML comment: <!-- INSTRUCTIONS_VERSION: X.X -->
          const versionMatch = claudeMdContent.match(/<!--\s*INSTRUCTIONS_VERSION:\s*([\d.]+)\s*-->/);
          if (versionMatch) {
            const fileVersion = versionMatch[1];
            // Compare versions
            const fileParts = fileVersion.split('.').map(Number);
            const currentParts = INSTRUCTIONS_VERSION.split('.').map(Number);
            const fileMajor = fileParts[0] || 0;
            const fileMinor = fileParts[1] || 0;
            const currentMajor = currentParts[0] || 0;
            const currentMinor = currentParts[1] || 0;

            const isOutdated = fileMajor < currentMajor ||
              (fileMajor === currentMajor && fileMinor < currentMinor);

            if (isOutdated) {
              checks.push({
                name: 'CLAUDE.md instructions',
                status: 'warning',
                message: `v${fileVersion} ⚠ outdated (current: v${INSTRUCTIONS_VERSION})`,
                fix: 'Run: enginehaus instructions code',
              });
            } else {
              checks.push({
                name: 'CLAUDE.md instructions',
                status: 'ok',
                message: `v${fileVersion} ✓ current`,
              });
            }
          } else {
            checks.push({
              name: 'CLAUDE.md instructions',
              status: 'warning',
              message: 'No version found in CLAUDE.md',
              fix: 'Run: enginehaus instructions code (to regenerate with version)',
            });
          }
        } catch {
          checks.push({
            name: 'CLAUDE.md instructions',
            status: 'warning',
            message: 'Could not read CLAUDE.md',
          });
        }
      } else {
        checks.push({
          name: 'CLAUDE.md instructions',
          status: 'warning',
          message: 'Not found (optional for Claude Code)',
          fix: 'Run: enginehaus init (to generate CLAUDE.md)',
        });
      }

      // Check 9: Stale in-progress tasks (across all projects)
      try {
        await coordination.initialize();
        const projects = await coordination.listProjects();
        const staleTasks: Array<{ id: string; title: string; project: string }> = [];
        for (const p of projects) {
          const inProgress = await coordination.getTasks({ projectId: p.id, status: 'in-progress' as any });
          for (const t of inProgress) {
            // Check if there's an active session — if not, it's stale
            const session = await coordination.getActiveSessionForTask(t.id);
            if (!session) {
              staleTasks.push({ id: t.id.slice(0, 8), title: t.title, project: p.name });
            }
          }
        }
        if (staleTasks.length > 0) {
          checks.push({
            name: 'Stale in-progress tasks',
            status: 'warning',
            message: `${staleTasks.length} task(s) in-progress with no active session: ${staleTasks.map(t => `${t.id} (${t.project})`).join(', ')}`,
            fix: 'Release with: enginehaus task update <id> --status ready',
          });
        } else {
          checks.push({ name: 'Stale in-progress tasks', status: 'ok', message: 'None' });
        }
      } catch {
        // Skip if coordination not available
      }

      // Check 10: CLI pipe workaround patterns (from auto-detected decisions)
      try {
        const decisions = await coordination.getDecisions({ limit: 100 });
        const pipeWorkarounds = decisions.decisions.filter(d =>
          d.decision.includes('CLI pipe workaround detected')
        );
        if (pipeWorkarounds.length > 0) {
          const patterns = pipeWorkarounds.slice(0, 3).map(d =>
            d.decision.replace('CLI pipe workaround detected: ', '').slice(0, 60)
          );
          checks.push({
            name: 'CLI feature gaps (auto-detected)',
            status: 'warning',
            message: `${pipeWorkarounds.length} pipe workaround(s) detected by agents: ${patterns.join('; ')}`,
          });
        }
      } catch {
        // Skip if decisions not available
      }

      // Check 11: Stale branches for completed tasks
      try {
        const { findStaleBranches } = await import('../../git/git-analysis.js');
        const rootPath = process.cwd();
        const staleBranches = await findStaleBranches(rootPath, { staleDays: 7 });

        if (staleBranches.length > 0) {
          // Cross-reference with completed tasks
          const completedBranches: string[] = [];
          for (const branch of staleBranches) {
            if (branch.taskId) {
              const task = await ctx.resolveTaskById(branch.taskId);
              if (task?.status === 'completed') {
                completedBranches.push(`${branch.name} (${branch.daysSinceLastCommit}d, ${branch.isMerged ? 'merged' : 'unmerged'})`);
              }
            }
          }

          if (completedBranches.length > 0) {
            checks.push({
              name: 'Stale branches (completed tasks)',
              status: 'warning',
              message: `${completedBranches.length} branch(es) for completed tasks: ${completedBranches.slice(0, 3).join(', ')}${completedBranches.length > 3 ? ` (+${completedBranches.length - 3} more)` : ''}`,
              fix: 'enginehaus branch cleanup',
            });
          } else if (staleBranches.length > 0) {
            const merged = staleBranches.filter(b => b.isMerged).length;
            if (merged > 0) {
              checks.push({
                name: 'Stale branches',
                status: 'warning',
                message: `${merged} merged branch(es) can be cleaned up`,
                fix: 'enginehaus branch cleanup',
              });
            }
          }
        }
      } catch {
        // Git not available or not in a repo — skip
      }

      // Output results
      if (opts.json) {
        console.log(JSON.stringify(checks, null, 2));
      } else {
        checks.forEach(c => {
          const icon = c.status === 'ok' ? '✅' : c.status === 'warning' ? '⚠️' : '❌';
          console.log(`  ${icon} ${c.name}: ${c.message}`);
          if (c.fix) {
            console.log(`     → Fix: ${c.fix}`);
          }
        });

        const errors = checks.filter(c => c.status === 'error');
        const warnings = checks.filter(c => c.status === 'warning');

        console.log('');
        if (errors.length > 0) {
          console.log(`❌ ${errors.length} error(s) found. Fix them and run doctor again.`);
        } else if (warnings.length > 0) {
          console.log(`⚠️  ${warnings.length} warning(s). System should work but consider fixing.`);
        } else {
          console.log('✅ All checks passed! Enginehaus is ready to use.');
        }
        console.log('');
      }
    });
}
