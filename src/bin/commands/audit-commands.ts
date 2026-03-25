/**
 * Audit CLI commands: detect untracked work, orphaned branches, and dogfooding gaps
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { CliContext } from '../cli-context.js';

interface AuditFinding {
  type: 'untracked-branch' | 'untracked-worktree' | 'stale-claim' | 'orphaned-branch';
  severity: 'error' | 'warning' | 'info';
  message: string;
  fix?: string;
}

export function registerAuditCommands(program: Command, ctx: CliContext): void {
  const { coordination } = ctx;

  const auditCmd = program
    .command('audit')
    .description('Detect untracked work, orphaned branches, and coordination gaps');

  auditCmd
    .command('untracked')
    .description('Find branches and worktrees with no matching in-progress task')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      await coordination.initialize();
      const findings: AuditFinding[] = [];
      const rootPath = process.cwd();

      // 1. Get all in-progress tasks
      const project = await ctx.resolveProject();
      const projectId = project?.id;
      const inProgressTasks = projectId
        ? await coordination.getTasks({ projectId, status: 'in-progress' as any })
        : [];
      const taskBranchNames = new Set(
        inProgressTasks
          .map(t => t.id.slice(0, 8))
      );

      // 2. Check git worktrees
      try {
        const worktreeOutput = execFileSync('git', ['worktree', 'list', '--porcelain'], {
          cwd: rootPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const worktrees = worktreeOutput
          .split('\n\n')
          .filter(block => block.trim())
          .map(block => {
            const lines = block.split('\n');
            const worktreePath = lines.find(l => l.startsWith('worktree '))?.replace('worktree ', '');
            const branch = lines.find(l => l.startsWith('branch '))?.replace('branch refs/heads/', '');
            return { path: worktreePath, branch };
          })
          .filter(w => w.branch && w.branch !== 'main' && w.branch !== 'master');

        for (const wt of worktrees) {
          // Check if worktree branch matches any in-progress task
          const hasTask = [...taskBranchNames].some(prefix => wt.branch?.includes(prefix));
          if (!hasTask && wt.branch) {
            findings.push({
              type: 'untracked-worktree',
              severity: 'error',
              message: `Worktree "${wt.branch}" at ${wt.path} has no matching in-progress task`,
              fix: `enginehaus task add -t "..." -p high && enginehaus task claim <id>`,
            });
          }
        }
      } catch {
        // Not a git repo or worktrees not available
      }

      // 3. Check local feature branches
      try {
        const branchOutput = execFileSync('git', ['branch', '--format=%(refname:short)'], {
          cwd: rootPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const branches = branchOutput
          .split('\n')
          .filter(b => b.trim())
          .filter(b => b !== 'main' && b !== 'master')
          .filter(b => b.startsWith('feature/'));

        for (const branch of branches) {
          // Extract potential task ID prefix from branch name
          const taskIdMatch = branch.match(/feature\/(?:task-)?([a-f0-9]{8})/);
          const branchTaskPrefix = taskIdMatch?.[1];

          if (branchTaskPrefix) {
            // Has a task ID pattern — check if that task is actually in-progress
            const hasActiveTask = taskBranchNames.has(branchTaskPrefix);
            if (!hasActiveTask) {
              // Check if the task exists at all
              const task = await ctx.resolveTaskById(branchTaskPrefix);
              if (task) {
                if (task.status === 'in-progress') {
                  // Task exists and is in-progress — it's tracked
                  continue;
                } else if (task.status === 'completed') {
                  findings.push({
                    type: 'orphaned-branch',
                    severity: 'info',
                    message: `Branch "${branch}" — task ${branchTaskPrefix} is completed`,
                    fix: `git branch -d ${branch}`,
                  });
                } else {
                  findings.push({
                    type: 'orphaned-branch',
                    severity: 'warning',
                    message: `Branch "${branch}" — task ${branchTaskPrefix} is ${task.status} (not in-progress)`,
                    fix: `enginehaus task claim ${branchTaskPrefix} or git branch -d ${branch}`,
                  });
                }
              } else {
                findings.push({
                  type: 'untracked-branch',
                  severity: 'warning',
                  message: `Branch "${branch}" references task ${branchTaskPrefix} which doesn't exist`,
                  fix: `enginehaus task add -t "..." && git branch -d ${branch}`,
                });
              }
            }
          } else {
            // No task ID in branch name at all
            findings.push({
              type: 'untracked-branch',
              severity: 'warning',
              message: `Branch "${branch}" has no task ID in its name`,
              fix: `enginehaus task add -t "..." -p high && enginehaus task claim <id>`,
            });
          }
        }
      } catch {
        // Not a git repo
      }

      // 4. Check for stale in-progress claims (task claimed but no active session)
      for (const task of inProgressTasks) {
        try {
          const session = await coordination.getActiveSessionForTask(task.id);
          if (!session) {
            findings.push({
              type: 'stale-claim',
              severity: 'warning',
              message: `Task "${task.title}" (${task.id.slice(0, 8)}) is in-progress but has no active session`,
              fix: `enginehaus task release ${task.id.slice(0, 8)} or enginehaus task claim ${task.id.slice(0, 8)}`,
            });
          }
        } catch {
          // Session check failed — skip
        }
      }

      // Output
      if (opts.json) {
        console.log(JSON.stringify({ findings, summary: summarize(findings) }, null, 2));
        return;
      }

      if (findings.length === 0) {
        console.log('\n  ✅ All work is tracked. No untracked branches or worktrees found.\n');
        return;
      }

      const errors = findings.filter(f => f.severity === 'error');
      const warnings = findings.filter(f => f.severity === 'warning');
      const infos = findings.filter(f => f.severity === 'info');

      console.log(`\n  🔍 Audit: ${findings.length} finding(s)\n`);

      if (errors.length > 0) {
        console.log('  ❌ Untracked work (no task):');
        for (const f of errors) {
          console.log(`     ${f.message}`);
          if (f.fix) console.log(`     → ${f.fix}`);
        }
        console.log('');
      }

      if (warnings.length > 0) {
        console.log('  ⚠️  Needs attention:');
        for (const f of warnings) {
          console.log(`     ${f.message}`);
          if (f.fix) console.log(`     → ${f.fix}`);
        }
        console.log('');
      }

      if (infos.length > 0) {
        console.log('  ℹ️  Cleanup opportunities:');
        for (const f of infos) {
          console.log(`     ${f.message}`);
          if (f.fix) console.log(`     → ${f.fix}`);
        }
        console.log('');
      }

      console.log(`  Summary: ${errors.length} untracked, ${warnings.length} warnings, ${infos.length} cleanup\n`);
    });

  ctx.registerCommand({
    command: 'audit untracked',
    description: 'Find branches and worktrees with no matching in-progress task',
    example: 'enginehaus audit untracked',
    altExamples: ['enginehaus audit untracked --json'],
    args: [],
    options: [{ flags: '--json', description: 'Output as JSON', required: false }],
  });
}

function summarize(findings: AuditFinding[]): { errors: number; warnings: number; infos: number; clean: boolean } {
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const infos = findings.filter(f => f.severity === 'info').length;
  return { errors, warnings, infos, clean: findings.length === 0 };
}
