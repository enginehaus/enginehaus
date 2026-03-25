/**
 * Config CLI commands: show, set, reset, sync, validate, export, history
 * Also registers the top-level `gates` command for testing custom quality gates.
 */

import { Command } from 'commander';
import { CliContext } from '../cli-context.js';
import { DEFAULT_CONFIG } from '../../config/types.js';
import { expandPath } from '../../utils/paths.js';
import { QualityService } from '../../quality/quality-service.js';

export function registerConfigCommands(program: Command, ctx: CliContext): void {
  const { coordination, resolveProject } = ctx;

  const configCmd = program
    .command('config')
    .description('View and manage configuration');

  configCmd
    .command('show')
    .description('Show configuration values')
    .argument('[path]', 'Dot-notation path to specific value (e.g., quality.coverage.minimum)')
    .option('--json', 'Output as JSON')
    .option('--defaults', 'Show default values instead of effective config')
    .action(async (configPath: string | undefined, opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (opts.defaults) {
        // Show default configuration
        if (configPath) {
          const parts = configPath.split('.');
          let value: unknown = DEFAULT_CONFIG;
          for (const part of parts) {
            if (value && typeof value === 'object' && part in value) {
              value = (value as Record<string, unknown>)[part];
            } else {
              console.error(`  Path not found: ${configPath}`);
              process.exit(1);
            }
          }
          if (opts.json) {
            console.log(JSON.stringify(value, null, 2));
          } else {
            console.log(`\n  ${configPath} = ${JSON.stringify(value, null, 2)}`);
          }
        } else {
          console.log(JSON.stringify(DEFAULT_CONFIG, null, 2));
        }
        return;
      }

      if (!project) {
        console.error('No active project. Use "enginehaus project init" or switch to a project directory.');
        process.exit(1);
      }

      const configManager = coordination.getConfigManager();
      const config = await configManager.getEffectiveConfig(project.id);

      if (configPath) {
        const value = await configManager.getConfigValue(project.id, configPath);
        if (value === undefined) {
          console.error(`  Path not found: ${configPath}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(value, null, 2));
        } else {
          console.log(`\n  ${configPath} = ${JSON.stringify(value, null, 2)}`);
        }
      } else {
        if (opts.json) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          console.log(`\nConfiguration for ${project.name}:\n`);
          console.log(JSON.stringify(config, null, 2));
        }
      }
    });

  configCmd
    .command('set')
    .description('Set a configuration value')
    .argument('<path>', 'Dot-notation path (e.g., quality.coverage.minimum)')
    .argument('<value>', 'Value to set (JSON parsed if possible)')
    .option('--reason <reason>', 'Reason for the change (for audit log)')
    .action(async (configPath: string, valueStr: string, opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (!project) {
        console.error('No active project. Use "enginehaus project init" or switch to a project directory.');
        process.exit(1);
      }

      // Parse value - try JSON first, then string
      let value: unknown;
      try {
        value = JSON.parse(valueStr);
      } catch {
        // If it looks like a boolean or number, parse it
        if (valueStr === 'true') value = true;
        else if (valueStr === 'false') value = false;
        else if (/^-?\d+$/.test(valueStr)) value = parseInt(valueStr, 10);
        else if (/^-?\d+\.\d+$/.test(valueStr)) value = parseFloat(valueStr);
        else value = valueStr;
      }

      const configManager = coordination.getConfigManager();

      // Get old value for display
      const oldValue = await configManager.getConfigValue(project.id, configPath);

      await configManager.setConfigValue(project.id, configPath, value, {
        changedBy: 'cli',
        reason: opts.reason,
      });

      console.log(`\n  Updated ${configPath}:`);
      console.log(`    ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
      console.log('');
    });

  configCmd
    .command('reset')
    .description('Reset configuration to defaults')
    .option('--reason <reason>', 'Reason for the reset (for audit log)')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (!project) {
        console.error('No active project. Use "enginehaus project init" or switch to a project directory.');
        process.exit(1);
      }

      if (!opts.confirm) {
        console.log(`\n  This will reset all configuration for "${project.name}" to defaults.`);
        console.log('  Use --confirm to proceed.\n');
        return;
      }

      const configManager = coordination.getConfigManager();
      await configManager.resetProjectConfig(project.id, {
        changedBy: 'cli',
        reason: opts.reason || 'Reset via CLI',
      });

      console.log(`\n  Configuration for "${project.name}" has been reset to defaults.\n`);
    });

  configCmd
    .command('sync')
    .description('Sync configuration from file')
    .option('--file <path>', 'Path to config file (auto-detected if not specified)')
    .action(async (opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (!project) {
        console.error('No active project. Use "enginehaus project init" or switch to a project directory.');
        process.exit(1);
      }

      const configManager = coordination.getConfigManager();
      const filePath = opts.file ? expandPath(opts.file) : undefined;
      const result = await configManager.syncFromFile(project.id, filePath, {
        changedBy: 'cli',
      });

      if (result.success) {
        console.log(`\n  Configuration synced successfully.`);
        if (result.fileHash) {
          console.log(`  File hash: ${result.fileHash.slice(0, 8)}...`);
        }
        if (result.warnings.length > 0) {
          console.log('\n  Warnings:');
          result.warnings.forEach(w => console.log(`    - ${w}`));
        }
      } else {
        console.error('\n  Failed to sync configuration:');
        result.errors.forEach(e => console.error(`    - ${e}`));
        process.exit(1);
      }
      console.log('');
    });

  configCmd
    .command('validate')
    .description('Validate current configuration')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (!project) {
        console.error('No active project. Use "enginehaus project init" or switch to a project directory.');
        process.exit(1);
      }

      const configManager = coordination.getConfigManager();
      const config = await configManager.getEffectiveConfig(project.id);

      const issues: { level: 'error' | 'warning' | 'info'; path: string; message: string }[] = [];

      // Validate required fields
      if (!config.project.name || config.project.name === 'Unnamed Project') {
        issues.push({ level: 'warning', path: 'project.name', message: 'Project name should be set' });
      }

      // Validate quality thresholds
      if (config.quality.coverage.minimum > config.quality.coverage.recommended) {
        issues.push({ level: 'error', path: 'quality.coverage', message: 'minimum cannot be greater than recommended' });
      }
      if (config.quality.coverage.recommended > config.quality.coverage.excellent) {
        issues.push({ level: 'error', path: 'quality.coverage', message: 'recommended cannot be greater than excellent' });
      }

      // Validate session settings
      if (config.workflow.sessions.expiryMinutes < 1) {
        issues.push({ level: 'error', path: 'workflow.sessions.expiryMinutes', message: 'must be at least 1 minute' });
      }
      if (config.workflow.sessions.heartbeatIntervalSeconds > config.workflow.sessions.expiryMinutes * 60) {
        issues.push({ level: 'warning', path: 'workflow.sessions', message: 'heartbeat interval is longer than expiry time' });
      }

      // Validate git config
      if (config.git.autoCreateBranches && !config.git.branchNaming.pattern) {
        issues.push({ level: 'warning', path: 'git.branchNaming.pattern', message: 'should be set when autoCreateBranches is enabled' });
      }

      if (opts.json) {
        console.log(JSON.stringify({
          valid: issues.filter(i => i.level === 'error').length === 0,
          issues,
        }, null, 2));
      } else {
        const errors = issues.filter(i => i.level === 'error');
        const warnings = issues.filter(i => i.level === 'warning');

        if (issues.length === 0) {
          console.log('\n  Configuration is valid.\n');
        } else {
          console.log(`\nConfiguration Validation for ${project.name}:\n`);

          if (errors.length > 0) {
            console.log('  Errors:');
            errors.forEach(e => console.log(`    [${e.path}] ${e.message}`));
            console.log('');
          }

          if (warnings.length > 0) {
            console.log('  Warnings:');
            warnings.forEach(w => console.log(`    [${w.path}] ${w.message}`));
            console.log('');
          }

          if (errors.length > 0) {
            process.exit(1);
          }
        }
      }
    });

  configCmd
    .command('export')
    .description('Export configuration to a file')
    .option('--output <path>', 'Output file path', 'enginehaus.config.json')
    .option('--pretty', 'Pretty print JSON', true)
    .action(async (opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (!project) {
        console.error('No active project. Use "enginehaus project init" or switch to a project directory.');
        process.exit(1);
      }

      const configManager = coordination.getConfigManager();
      const config = await configManager.getEffectiveConfig(project.id);

      // Remove internal metadata
      const exportConfig = { ...config };
      delete (exportConfig as Record<string, unknown>)._metadata;

      const outputPath = expandPath(opts.output);
      const json = opts.pretty ? JSON.stringify(exportConfig, null, 2) : JSON.stringify(exportConfig);

      const fs = await import('fs');
      fs.writeFileSync(outputPath, json);

      console.log(`\n  Configuration exported to: ${outputPath}\n`);
    });

  configCmd
    .command('history')
    .description('Show configuration change history')
    .option('--limit <n>', 'Number of entries to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      const configManager = coordination.getConfigManager();
      const history = await configManager.getConfigHistory({
        projectId: project?.id,
        limit: parseInt(opts.limit, 10),
      });

      if (opts.json) {
        console.log(JSON.stringify(history, null, 2));
      } else {
        console.log('\nConfiguration History:\n');

        if (history.length === 0) {
          console.log('  No configuration changes recorded.\n');
        } else {
          for (const entry of history) {
            const date = new Date(entry.changedAt).toLocaleString();
            const changedBy = entry.changedBy || 'unknown';
            const pathInfo = entry.configPath ? ` (${entry.configPath})` : '';

            console.log(`  [${date}] ${entry.changeType}${pathInfo}`);
            console.log(`    By: ${changedBy}`);
            if (entry.reason) {
              console.log(`    Reason: ${entry.reason}`);
            }
            if (entry.configPath && entry.oldValue !== undefined) {
              console.log(`    ${JSON.stringify(entry.oldValue)} → ${JSON.stringify(entry.newValue)}`);
            }
            console.log('');
          }
        }
      }
    });

  // ========================================================================
  // Top-level `gates` command for testing custom quality gates
  // ========================================================================

  const gatesCmd = program
    .command('gates')
    .description('Test and manage custom quality gates');

  gatesCmd
    .command('test')
    .description('Run custom quality gates against the current working tree')
    .argument('[gate-name]', 'Specific gate to test (runs all if omitted)')
    .option('--json', 'Output as JSON')
    .action(async (gateName: string | undefined, opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (!project) {
        console.error('No active project. Use "enginehaus project init" or switch to a project directory.');
        process.exit(1);
      }

      const configManager = coordination.getConfigManager();
      const qualityConfig = await configManager.getQualityConfig(project.id);
      const customGates = qualityConfig.gates?.custom;

      if (!customGates || customGates.length === 0) {
        console.log('\n  No custom quality gates configured.');
        console.log('  Add gates in your config under quality.gates.custom[].\n');
        return;
      }

      const gatesToRun = gateName
        ? customGates.filter(g => g.name === gateName)
        : customGates;

      if (gatesToRun.length === 0) {
        console.error(`\n  Gate "${gateName}" not found.`);
        console.log('  Available gates:');
        customGates.forEach(g => console.log(`    - ${g.name}${g.description ? `: ${g.description}` : ''}`));
        console.log('');
        process.exit(1);
      }

      const qualityService = new QualityService(project.rootPath);
      const results = await qualityService.validateCustomGates(gatesToRun, []);

      if (opts.json) {
        console.log(JSON.stringify({ results, passed: results.every(r => r.passed || r.severity === 'warning') }, null, 2));
      } else {
        console.log('\nCustom Quality Gates:\n');

        let hasErrors = false;
        for (const result of results) {
          const icon = result.passed ? 'PASS' : (result.severity === 'warning' ? 'WARN' : 'FAIL');
          const prefix = result.passed ? '  ' : '  ';
          console.log(`${prefix}[${icon}] ${result.gate}`);
          if (!result.passed) {
            console.log(`         ${result.details}`);
            if (result.severity === 'error') hasErrors = true;
          }
        }

        const passCount = results.filter(r => r.passed).length;
        const failCount = results.filter(r => !r.passed && r.severity === 'error').length;
        const warnCount = results.filter(r => !r.passed && r.severity === 'warning').length;

        console.log(`\n  ${passCount} passed, ${failCount} failed, ${warnCount} warnings\n`);

        if (hasErrors) {
          process.exit(1);
        }
      }
    });

  gatesCmd
    .command('list')
    .description('List configured custom quality gates')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      if (!project) {
        console.error('No active project.');
        process.exit(1);
      }

      const configManager = coordination.getConfigManager();
      const qualityConfig = await configManager.getQualityConfig(project.id);
      const customGates = qualityConfig.gates?.custom;

      if (opts.json) {
        console.log(JSON.stringify(customGates ?? [], null, 2));
      } else {
        if (!customGates || customGates.length === 0) {
          console.log('\n  No custom quality gates configured.\n');
        } else {
          console.log('\nCustom Quality Gates:\n');
          for (const gate of customGates) {
            console.log(`  ${gate.name}`);
            if (gate.description) console.log(`    Description: ${gate.description}`);
            console.log(`    Command: ${gate.command}`);
            console.log(`    Fail on: ${gate.failOn ?? 'exit-code'}`);
            if (gate.pattern) console.log(`    Pattern: ${gate.pattern}`);
            console.log(`    Severity: ${gate.severity ?? 'error'}`);
            console.log(`    Required: ${gate.required}`);
            console.log(`    Blocking: ${gate.blocking}`);
            if (gate.files && gate.files.length > 0) {
              console.log(`    Files: ${gate.files.join(', ')}`);
            }
            console.log('');
          }
        }
      }
    });
}
