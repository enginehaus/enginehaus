/**
 * Utility CLI commands: hooks, verify, update-instructions, update
 */

import { Command } from 'commander';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CliContext } from '../cli-context.js';
import { expandPath } from '../../utils/paths.js';
import { getClientConfigPath } from '../../clients/index.js';
import {
  updateEnginehausSection,
  detectBuildCommands,
  generateClaudeMd,
} from '../../onboarding/index.js';
import { checkForUpdates } from '../../utils/version-check.js';

export function registerUtilityCommands(program: Command, ctx: CliContext): void {
  const { coordination } = ctx;

  // ==========================================================================
  // Hooks Commands
  // ==========================================================================

  const hooksCmd = program
    .command('hooks')
    .description('Manage cross-client hooks');

  hooksCmd
    .command('status')
    .description('Show which hooks are installed, per client')
    .action(async () => {
      const { detectClients } = await import('../../hooks/client-detection.js');
      const cwd = process.cwd();
      const clients = detectClients(cwd);

      console.log('\n🔧 Enginehaus Hooks Status\n');

      if (clients.length === 0) {
        console.log('  No MCP clients detected in this project.');
        console.log('  Run "enginehaus init" to set up hooks.\n');
        return;
      }

      for (const client of clients) {
        const tier = client.tier === 1 ? '✅ Tier 1 (native hooks)' : '⚠️  Tier 2 (server-side only)';
        console.log(`  ${client.name}: ${tier}`);
        if (client.tier === 1) {
          const { existsSync } = await import('fs');
          const configExists = existsSync(client.configPath);
          console.log(`    Config: ${client.configPath} ${configExists ? '(exists)' : '(not created)'}`);
          console.log(`    Hooks: ${[
            client.hooksSupported.sessionStart ? 'SessionStart' : null,
            client.hooksSupported.preToolUse ? 'PreToolUse' : null,
            client.hooksSupported.postToolUse ? 'PostToolUse' : null,
          ].filter(Boolean).join(', ')}`);
        }
      }

      console.log(`\n  Server-side enforcement: ${process.env.EH_HOOKS_TIER === '1' ? 'disabled (EH_HOOKS_TIER=1)' : 'active'}`);
      console.log('');
    });

  hooksCmd
    .command('install')
    .description('Install hooks for all detected clients (idempotent)')
    .action(async () => {
      const { deployHookScripts, installAllHooks } = await import('../../hooks/install.js');
      const { detectClients } = await import('../../hooks/client-detection.js');
      const cwd = process.cwd();

      const packageRoot = path.resolve(path.dirname(process.argv[1]), '..', '..');
      const packageHooksDir = path.join(packageRoot, 'src', 'hooks');
      const globalHooksDir = deployHookScripts(packageHooksDir);

      const clients = detectClients(cwd);
      const results = installAllHooks(clients, cwd, globalHooksDir);

      console.log('\n🔧 Hook Installation\n');
      for (const [clientId, result] of Object.entries(results)) {
        if (result.installed.length > 0) {
          console.log(`  ✅ ${clientId}: ${result.installed.join(', ')}`);
        }
        if (result.skipped.length > 0) {
          console.log(`  ⏭  ${clientId}: already configured (${result.skipped.join(', ')})`);
        }
        if (result.errors.length > 0) {
          console.log(`  ❌ ${clientId}: ${result.errors.join(', ')}`);
        }
      }
      if (Object.keys(results).length === 0) {
        console.log('  No Tier 1 clients detected. Server-side enforcement is active for Tier 2 clients.');
      }
      console.log('');
    });

  hooksCmd
    .command('uninstall')
    .description('Remove enginehaus hooks from all detected clients')
    .action(async () => {
      const { detectClients } = await import('../../hooks/client-detection.js');
      const { uninstallHooksForClient } = await import('../../hooks/install.js');
      const cwd = process.cwd();

      const clients = detectClients(cwd);
      console.log('\n🔧 Hook Removal\n');
      for (const client of clients) {
        if (client.tier !== 1) continue;
        uninstallHooksForClient(client.id, cwd);
        console.log(`  🗑  Removed hooks for ${client.name}`);
      }
      console.log('');
    });

  // ==========================================================================
  // Verify Command: Quick MCP setup verification
  // ==========================================================================

  program
    .command('verify')
    .description('Verify MCP configuration for Claude Desktop')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const { existsSync, readFileSync } = await import('fs');

      interface VerifyResult {
        configExists: boolean;
        configValid: boolean;
        enginehausConfigured: boolean;
        commandPath: string | null;
        pathExists: boolean;
        issues: string[];
        fixes: string[];
      }

      const result: VerifyResult = {
        configExists: false,
        configValid: false,
        enginehausConfigured: false,
        commandPath: null,
        pathExists: false,
        issues: [],
        fixes: [],
      };

      // Get config path from client registry
      const configPath = getClientConfigPath('claude-desktop') || '';

      if (!configPath) {
        result.issues.push('Could not determine config path for this platform');
        result.fixes.push('Run: enginehaus doctor');
      }

      // Check 1: Config file exists
      result.configExists = existsSync(configPath);
      if (!result.configExists) {
        result.issues.push('Claude Desktop config file not found');
        result.fixes.push('Run: enginehaus init (in a project directory)');
        result.fixes.push('Or run: enginehaus setup');
      }

      // Check 2: Config is valid JSON
      if (result.configExists) {
        try {
          const configContent = readFileSync(configPath, 'utf-8');
          const config = JSON.parse(configContent);
          result.configValid = true;

          // Check 3: Enginehaus entry exists
          if (config.mcpServers?.enginehaus) {
            result.enginehausConfigured = true;
            const ehConfig = config.mcpServers.enginehaus;

            // Check 4: Command path is valid
            if (ehConfig.args && ehConfig.args.length > 0) {
              result.commandPath = ehConfig.args[0];
              result.pathExists = existsSync(ehConfig.args[0]);

              if (!result.pathExists) {
                result.issues.push(`Enginehaus entry points to missing file: ${ehConfig.args[0]}`);
                result.fixes.push('Run: enginehaus setup (to update path)');
                result.fixes.push('Or rebuild: npm run build');
              }
            }
          } else {
            result.issues.push('Enginehaus not configured in MCP servers');
            result.fixes.push('Run: enginehaus init (in a project directory)');
            result.fixes.push('Or run: enginehaus setup');
          }
        } catch (e) {
          result.issues.push('Config file is not valid JSON');
          result.fixes.push('Check for syntax errors in: ' + configPath);
          result.fixes.push('Or delete and run: enginehaus setup');
        }
      }

      // Output
      if (opts.json) {
        console.log(JSON.stringify({ configPath, ...result }, null, 2));
      } else {
        console.log('\n🔍 MCP Configuration Verification\n');
        console.log(`Config file: ${configPath}`);
        console.log('');

        // Status summary
        const checks = [
          { name: 'Config file exists', pass: result.configExists },
          { name: 'Config is valid JSON', pass: result.configValid },
          { name: 'Enginehaus configured', pass: result.enginehausConfigured },
          { name: 'Entry path exists', pass: result.pathExists },
        ];

        for (const check of checks) {
          const icon = check.pass ? '✅' : '❌';
          console.log(`  ${icon} ${check.name}`);
        }

        if (result.commandPath) {
          console.log(`\n  Path: ${result.commandPath}`);
        }

        // Issues and fixes
        if (result.issues.length > 0) {
          console.log('\nIssues found:');
          result.issues.forEach(issue => console.log(`  • ${issue}`));

          console.log('\nHow to fix:');
          result.fixes.forEach(fix => console.log(`  → ${fix}`));
        } else {
          console.log('\n✅ MCP configuration is valid!');
          console.log('   Claude Desktop should be able to use Enginehaus tools.');
          console.log('   (Restart Claude Desktop if you just configured it)');
        }
        console.log('');
      }
    });

  // ==========================================================================
  // Update Instructions Command: Refresh CLAUDE.md across all projects
  // ==========================================================================

  program
    .command('update-instructions')
    .description('Update Enginehaus instructions in CLAUDE.md across all linked projects')
    .option('--dry-run', 'Show what would be updated without making changes')
    .option('--project <slug>', 'Update only a specific project')
    .action(async (opts: { dryRun?: boolean; project?: string }) => {
      const { existsSync: exists, readFileSync: readFile, writeFileSync: writeFile } = await import('fs');
      await coordination.initialize();
      const projects = await coordination.listProjects();

      const targetProjects = opts.project
        ? projects.filter(p => p.slug === opts.project)
        : projects;

      if (opts.project && targetProjects.length === 0) {
        console.error(`\nProject not found: ${opts.project}`);
        console.error('Available projects: ' + projects.map(p => p.slug).join(', '));
        process.exit(1);
      }

      console.log(`\nUpdating Enginehaus instructions across ${targetProjects.length} project(s)...\n`);

      let updated = 0;
      let created = 0;
      let skipped = 0;

      for (const project of targetProjects) {
        const rootPath = expandPath(project.rootPath);

        if (!rootPath || rootPath === '/' || !exists(rootPath)) {
          console.log(`  [skip] ${project.slug} — path not found: ${rootPath || '(none)'}`);
          skipped++;
          continue;
        }

        const claudeMdPath = path.join(rootPath, 'CLAUDE.md');

        if (exists(claudeMdPath)) {
          const existing = readFile(claudeMdPath, 'utf-8');
          const updatedContent = updateEnginehausSection(existing);

          if (updatedContent === existing) {
            console.log(`  [current] ${project.slug} — already up to date`);
            skipped++;
            continue;
          }

          if (opts.dryRun) {
            console.log(`  [would update] ${project.slug} — ${claudeMdPath}`);
          } else {
            writeFile(claudeMdPath, updatedContent);
            console.log(`  [updated] ${project.slug} — ${claudeMdPath}`);
          }
          updated++;
        } else {
          // No CLAUDE.md — generate one
          const buildCommands = detectBuildCommands(rootPath);
          const content = generateClaudeMd({ project, buildCommands });

          if (opts.dryRun) {
            console.log(`  [would create] ${project.slug} — ${claudeMdPath}`);
          } else {
            writeFile(claudeMdPath, content);
            console.log(`  [created] ${project.slug} — ${claudeMdPath}`);
          }
          created++;
        }
      }

      console.log('');
      if (opts.dryRun) {
        console.log(`Dry run complete: ${updated} would update, ${created} would create, ${skipped} skipped`);
      } else {
        console.log(`Done: ${updated} updated, ${created} created, ${skipped} skipped`);
      }
      console.log('');
    });

  // ==========================================================================
  // Update Command: Check for and install updates
  // ==========================================================================

  program
    .command('update')
    .description('Check for updates and install the latest version')
    .option('--check', 'Check for updates without installing')
    .action(async (opts: { check?: boolean }) => {
      console.log('\n🔄 Checking for updates...\n');

      const result = await checkForUpdates();

      if (!result) {
        console.log('❌ Could not check for updates. Try again later or check manually:');
        console.log('   npm view enginehaus version\n');
        process.exit(1);
      }

      console.log(`Current version: v${result.currentVersion}`);
      console.log(`Latest version:  v${result.latestVersion}`);
      console.log('');

      if (!result.updateAvailable) {
        console.log('✅ You are running the latest version!\n');
        return;
      }

      // Determine update type
      let updateType = 'patch';
      if (result.isMajorUpdate) updateType = 'major';
      else if (result.isMinorUpdate) updateType = 'minor';

      console.log(`📦 ${updateType.charAt(0).toUpperCase() + updateType.slice(1)} update available!`);

      if (opts.check) {
        console.log('\nTo install: enginehaus update\n');
        return;
      }

      console.log('\nInstalling update...\n');

      try {
        execFileSync('npm', ['update', '-g', 'enginehaus'], { stdio: 'inherit' });

        console.log('\n✅ Update installed successfully!');
        console.log('');
        console.log('⚠️  Important: Restart Claude Desktop to use the new MCP server version.');
        console.log('');

        // Show changelog link if it exists
        console.log('📝 See what\'s new: https://github.com/enginehaus/enginehaus/releases');
        console.log('');
      } catch (error) {
        console.error('\n❌ Update failed. Try manually:');
        console.error('   npm update -g enginehaus\n');
        process.exit(1);
      }
    });
}
