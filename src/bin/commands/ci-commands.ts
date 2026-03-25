/**
 * CI CLI commands: quality gate validation for CI/CD pipelines
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { CliContext } from '../cli-context.js';
import { QualityService } from '../../quality/quality-service.js';

export function registerCiCommands(program: Command, _ctx: CliContext): void {
  const ciCmd = program
    .command('ci')
    .description('CI/CD integration commands');

  ciCmd
    .command('validate')
    .description('Run quality gate validation for CI pipelines')
    .option(
      '--format <format>',
      'Output format: github-annotations, junit-xml, or json',
      'json'
    )
    .option(
      '--fail-on-critical',
      'Exit with non-zero code only for critical issues'
    )
    .option(
      '--scan-changed',
      'Run security/privacy scan on files changed in this PR (uses git diff vs base branch)'
    )
    .option(
      '--base <branch>',
      'Base branch for --scan-changed diff comparison',
      'main'
    )
    .action(async (opts: { format: string; failOnCritical?: boolean; scanChanged?: boolean; base: string }) => {
      const validFormats = ['github-annotations', 'junit-xml', 'json'] as const;
      type OutputFormat = typeof validFormats[number];

      if (!validFormats.includes(opts.format as OutputFormat)) {
        console.error(
          `Invalid format: ${opts.format}. Must be one of: ${validFormats.join(', ')}`
        );
        process.exit(1);
      }

      const cwd = process.cwd();
      const qualityService = new QualityService(cwd);

      // Determine changed files for security/privacy scanning
      let changedFiles: string[] | undefined;
      if (opts.scanChanged) {
        try {
          const diff = execSync(
            `git diff --name-only --diff-filter=ACMR ${opts.base}...HEAD 2>/dev/null || git diff --name-only --diff-filter=ACMR HEAD~1`,
            { cwd, encoding: 'utf-8' }
          );
          changedFiles = diff.trim().split('\n').filter(f => f.length > 0);
        } catch {
          // Fallback: scan all tracked source files
          try {
            const tracked = execSync('git ls-files --cached', { cwd, encoding: 'utf-8' });
            changedFiles = tracked.trim().split('\n').filter(f => f.length > 0);
          } catch {
            changedFiles = undefined;
          }
        }
      }

      const result = await qualityService.validateForCI({
        outputFormat: opts.format as OutputFormat,
        failOnCritical: opts.failOnCritical ?? false,
        changedFiles,
      });

      // Write formatted output to stdout
      console.log(result.formatted);

      // Write summary to stderr so it doesn't interfere with parseable stdout
      if (opts.format !== 'json') {
        console.error(`\n${result.summary}`);
      }

      process.exit(result.exitCode);
    });
}
