/**
 * Task CLI commands: list, show, add, next, claim/start, release, update, complete/finish
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CliContext } from '../cli-context.js';
import { UnifiedTask, TaskPriority } from '../../coordination/types.js';

/** Checkout or create a feature branch in the given repo. */
async function checkoutBranch(repoPath: string, branchName: string): Promise<void> {
  let branchExists = false;
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoPath, stdio: 'pipe' });
    branchExists = true;
  } catch {
    // Branch doesn't exist — expected
  }

  if (branchExists) {
    execFileSync('git', ['checkout', branchName], { cwd: repoPath, stdio: 'pipe' });
    console.log(`   Branch: ${branchName} (existing)`);
  } else {
    execFileSync('git', ['checkout', '-b', branchName], { cwd: repoPath, stdio: 'pipe' });
    console.log(`   Branch: ${branchName} (created)`);
  }
}

export function registerTaskCommands(program: Command, ctx: CliContext): void {
  const { coordination, resolveProject, resolveTaskById, displayRelatedLearnings, registerCommand } = ctx;

  const taskCmd = program
    .command('task')
    .alias('tasks')
    .description('Manage tasks');

  // Register task command specs for agent-help
  registerCommand({
    command: 'task list',
    description: 'List tasks in the current project',
    example: 'enginehaus task list',
    altExamples: [
      'enginehaus task list --status ready',
      'enginehaus task list -s ready -n 10 --compact',
      'enginehaus task list -s in-progress --json',
      'enginehaus task list --sort created -n 5',
    ],
    args: [],
    options: [
      { flags: '-s, --status <status>', description: 'Filter by status (ready, in-progress, completed, blocked, all)', required: false },
      { flags: '-p, --priority <priority>', description: 'Filter by priority (critical, high, medium, low)', required: false },
      { flags: '-n, --limit <limit>', description: 'Show top N tasks', required: false },
      { flags: '--sort <field>', description: 'Sort by: priority (default), created, updated, title', required: false },
      { flags: '--compact', description: 'One-line-per-task format', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
      { flags: '--all-projects', description: 'Show tasks from all projects', required: false },
    ],
  });

  registerCommand({
    command: 'task next',
    description: 'Get and claim the next priority task',
    example: 'enginehaus task next',
    altExamples: [
      'enginehaus task next --no-claim',
      'enginehaus task next -p high',
    ],
    args: [],
    options: [
      { flags: '-p, --priority <priority>', description: 'Filter by minimum priority', required: false },
      { flags: '-a, --agent <agentId>', description: 'Agent identifier (default: code)', required: false },
      { flags: '--no-claim', description: 'Just show the next task without claiming it', required: false },
    ],
  });

  registerCommand({
    command: 'task claim',
    description: 'Claim a specific task and start a session',
    example: 'enginehaus task claim abc123',
    altExamples: [
      'enginehaus task claim --id abc123',
      'enginehaus task claim a6ed375a-b2c9-4753-98b9-6cdc2f794a27',
      'enginehaus task claim abc123 --force',
    ],
    args: [
      { name: 'taskId', required: true, description: 'Task ID (full or partial)', flag: '--id' },
    ],
    options: [
      { flags: '--id <taskId>', description: 'Task ID (alternative to positional)', required: false },
      { flags: '-f, --force', description: 'Force claim: bypass capacity limits and override existing session locks', required: false },
    ],
  });

  registerCommand({
    command: 'task show',
    description: 'Show task details',
    example: 'enginehaus task show abc123',
    altExamples: [
      'enginehaus task show --id abc123 --json',
    ],
    args: [
      { name: 'taskId', required: true, description: 'Task ID (full or partial)', flag: '--id' },
    ],
    options: [
      { flags: '--id <taskId>', description: 'Task ID (alternative to positional)', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  registerCommand({
    command: 'task flag',
    description: 'Flag a task as needing human attention',
    example: 'enginehaus task flag abc123 -r "Need approval on API design"',
    altExamples: [
      'enginehaus task flag abc123 -r "Blocked on design decision" -q "Should we use REST or GraphQL?"',
    ],
    args: [
      { name: 'taskId', required: true, description: 'Task ID (full or partial)', flag: '--id' },
    ],
    options: [
      { flags: '--id <taskId>', description: 'Task ID (alternative to positional)', required: false },
      { flags: '-r, --reason <reason>', description: 'Why human attention is needed', required: true },
      { flags: '-q, --question <question>', description: 'Specific question for the human', required: false },
    ],
  });

  registerCommand({
    command: 'task search',
    description: 'Search tasks by content across titles, descriptions, and tags',
    example: 'enginehaus task search "messaging"',
    altExamples: [
      'enginehaus task search "auth" -s ready',
      'enginehaus task search "launch" --limit 5',
    ],
    args: [
      { name: 'query', required: true, description: 'Search query' },
    ],
    options: [
      { flags: '-s, --status <status>', description: 'Filter by status (ready, in-progress, completed, blocked, all)', required: false },
      { flags: '--limit <limit>', description: 'Max results (default: 20)', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  registerCommand({
    command: 'task add',
    description: 'Create a new task',
    example: 'enginehaus task add -t "Fix login bug" -p high',
    altExamples: [
      'enginehaus task add --title "New feature" --priority medium -d "Description"',
      'enginehaus task add -t "Update docs" -p low --type docs',
    ],
    args: [],
    options: [
      { flags: '-t, --title <title>', description: 'Task title', required: true },
      { flags: '-p, --priority <priority>', description: 'Priority (critical, high, medium, low)', required: true },
      { flags: '-d, --description <description>', description: 'Task description', required: false },
      { flags: '-f, --files <files>', description: 'Comma-separated list of files', required: false },
      { flags: '--type <type>', description: 'Task type: code, docs, infra, test, other (affects quality gates)', required: false },
      { flags: '--tags <tags>', description: 'Comma-separated tags for categorization (e.g. "oss-launch,ax")', required: false },
    ],
  });

  registerCommand({
    command: 'task complete',
    description: 'Complete a task with smart documentation from git history',
    example: 'enginehaus task complete abc123 -s "Implemented feature X"',
    altExamples: [
      'enginehaus task complete --id abc123 --summary "Fixed the bug"',
      'enginehaus task complete abc123 -s "Done" --force --reason "trivial change"',
    ],
    args: [
      { name: 'taskId', required: true, description: 'Task ID (full or partial)', flag: '--id' },
    ],
    options: [
      { flags: '--id <taskId>', description: 'Task ID (alternative to positional)', required: false },
      { flags: '-s, --summary <summary>', description: 'Brief summary of what was done', required: true },
      { flags: '--since <datetime>', description: 'ISO datetime to analyze git history from', required: false },
      { flags: '-f, --force', description: 'Bypass quality enforcement (requires --reason)', required: false },
      { flags: '--reason <reason>', description: 'Reason for bypassing quality checks (required with --force)', required: false },
    ],
  });

  registerCommand({
    command: 'task release',
    description: 'Release a claimed task back to ready status',
    example: 'enginehaus task release abc123',
    altExamples: [
      'enginehaus task release abc123 -r blocked -n "Waiting for API"',
    ],
    args: [
      { name: 'taskId', required: true, description: 'Task ID (full or partial)', flag: '--id' },
    ],
    options: [
      { flags: '--id <taskId>', description: 'Task ID (alternative to positional)', required: false },
      { flags: '-r, --reason <reason>', description: 'Reason: test, redirect, blocked, stuck, scope_change, user_requested, context_limit, other', required: false },
      { flags: '-n, --notes <notes>', description: 'Additional context about the abandonment', required: false },
      { flags: '--no-prompt', description: 'Skip the reason prompt', required: false },
    ],
  });

  // ── Command handlers ──────────────────────────────────────────────────────

  taskCmd
    .command('list')
    .description('List tasks')
    .option('-s, --status <status>', 'Filter by status (ready, in-progress, completed, blocked, all)', 'all')
    .option('-p, --priority <priority>', 'Filter by priority (critical, high, medium, low)')
    .option('--tags <tags>', 'Filter by tags (comma-separated, matches ANY)')
    .option('--json', 'Output as JSON')
    .option('--all-projects', 'Show tasks from all projects, not just detected/active project')
    .option('-n, --limit <limit>', 'Show top N tasks (e.g. -n 10)')
    .option('--sort <field>', 'Sort by: priority (default), created, updated, title')
    .option('--compact', 'One-line-per-task format for scanning')
    .action(async (opts) => {
      await coordination.initialize();

      const project = opts.allProjects ? null : await resolveProject();
      const filter: any = {};
      if (opts.status !== 'all') {
        filter.status = opts.status;
      }
      if (opts.priority) {
        filter.priority = opts.priority;
      }
      if (opts.tags) {
        filter.tags = opts.tags.split(',').map((t: string) => t.trim());
      }

      if (project) {
        filter.projectId = project.id;
      }

      let tasks: UnifiedTask[] = [];
      if (opts.allProjects) {
        const projects = await coordination.listProjects();
        for (const p of projects) {
          const projectTasks = await coordination.getTasks({ ...filter, projectId: p.id });
          tasks.push(...projectTasks);
        }
      } else {
        tasks = await coordination.getTasks(filter);
      }

      // Sort tasks
      const sortField = opts.sort || 'priority';
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      tasks.sort((a, b) => {
        if (sortField === 'priority') {
          const pd = (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
          if (pd !== 0) return pd;
          return (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0);
        }
        if (sortField === 'created') return (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0);
        if (sortField === 'updated') return (b.updatedAt?.getTime?.() || 0) - (a.updatedAt?.getTime?.() || 0);
        if (sortField === 'title') return a.title.localeCompare(b.title);
        return 0;
      });

      // Apply limit
      const totalCount = tasks.length;
      if (opts.limit) {
        tasks = tasks.slice(0, parseInt(opts.limit));
      }

      if (opts.json) {
        console.log(JSON.stringify(tasks, null, 2));
      } else {
        if (tasks.length === 0) {
          console.log(`\nNo tasks found${project ? ` for ${project.name}` : ''}.\n`);
          return;
        }

        const limitNote = opts.limit && totalCount > tasks.length
          ? ` (showing ${tasks.length} of ${totalCount})`
          : '';
        console.log(`\nTasks for ${project?.name || 'all projects'} (${totalCount})${limitNote}:\n`);

        if (opts.compact) {
          // One-line format: [PRIORITY] ID  STATUS  TITLE
          const priorityColors: Record<string, string> = {
            critical: '\x1b[31m', high: '\x1b[33m', medium: '\x1b[36m', low: '\x1b[37m',
          };
          const reset = '\x1b[0m';
          for (const t of tasks) {
            const color = priorityColors[t.priority] || reset;
            const tags = t.tags?.length ? ` [${t.tags.join(',')}]` : '';
            console.log(`  ${color}${t.priority.slice(0, 4).padEnd(4)}${reset} ${t.id.slice(0, 8)} ${t.status.padEnd(14)} ${t.title}${tags}`);
          }
        } else {
          tasks.forEach(t => {
            const priorityColors: Record<string, string> = {
              critical: '\x1b[31m',
              high: '\x1b[33m',
              medium: '\x1b[36m',
              low: '\x1b[37m',
            };
            const reset = '\x1b[0m';
            const color = priorityColors[t.priority] || reset;

            console.log(`  ${color}[${t.priority.toUpperCase()}]${reset} ${t.title}`);
            console.log(`    ID: ${t.id.slice(0, 8)}...`);
            console.log(`    Status: ${t.status}`);
            if (t.tags && t.tags.length > 0) {
              console.log(`    Tags: ${t.tags.join(', ')}`);
            }
            if (t.files && t.files.length > 0) {
              console.log(`    Files: ${t.files.slice(0, 3).join(', ')}${t.files.length > 3 ? '...' : ''}`);
            }
            console.log('');
          });
        }
      }
    });

  taskCmd
    .command('search <query>')
    .description('Search tasks by content across titles, descriptions, and tags')
    .option('-s, --status <status>', 'Filter by status (ready, in-progress, completed, blocked, all)')
    .option('--limit <limit>', 'Max results (default: 20)')
    .option('--json', 'Output as JSON')
    .action(async (query: string, opts: any) => {
      await coordination.initialize();

      const project = await resolveProject();
      const status = opts.status === 'all' ? undefined : opts.status;

      const tasks = await coordination.searchTasks(query, {
        projectId: project?.id,
        status,
        limit: opts.limit ? parseInt(opts.limit) : 20,
      });

      if (opts.json) {
        console.log(JSON.stringify(tasks, null, 2));
      } else {
        if (tasks.length === 0) {
          console.log(`\nNo tasks matching "${query}".\n`);
          return;
        }

        console.log(`\n${tasks.length} task(s) matching "${query}":\n`);
        tasks.forEach(t => {
          const priorityColors: Record<string, string> = {
            critical: '\x1b[31m',
            high: '\x1b[33m',
            medium: '\x1b[36m',
            low: '\x1b[37m',
          };
          const reset = '\x1b[0m';
          const color = priorityColors[t.priority] || reset;

          console.log(`  ${color}[${t.priority.toUpperCase()}]${reset} ${t.title}`);
          console.log(`    ID: ${t.id.slice(0, 8)}  Status: ${t.status}`);
          if (t.tags && t.tags.length > 0) {
            console.log(`    Tags: ${t.tags.join(', ')}`);
          }
          // Show first 120 chars of description for context
          const desc = t.description.replace(/\n/g, ' ').slice(0, 120);
          if (desc) console.log(`    ${desc}${t.description.length > 120 ? '...' : ''}`);
          console.log('');
        });
      }
    });

  taskCmd
    .command('flag <taskId>')
    .description('Flag a task as needing human attention')
    .requiredOption('-r, --reason <reason>', 'Why human attention is needed')
    .option('-q, --question <question>', 'Specific question for the human')
    .action(async (taskId: string, opts: any) => {
      await coordination.initialize();
      const project = await resolveProject();
      const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';
      const resolvedTask = await resolveTaskById(taskId, projectId);
      if (!resolvedTask) {
        console.error(`Task not found: ${taskId}`);
        return;
      }

      // Update status to awaiting-human
      await coordination.updateTask(resolvedTask.id, { status: 'awaiting-human' as any });

      console.log(`\n✅ Task flagged for human attention:\n`);
      console.log(`  ID: ${resolvedTask.id.slice(0, 8)}`);
      console.log(`  Title: ${resolvedTask.title}`);
      console.log(`  Reason: ${opts.reason}`);
      if (opts.question) console.log(`  Question: ${opts.question}`);
      console.log(`  Status: awaiting-human`);
      console.log(`\nThis will appear in the briefing under "Waiting for Human Action".\n`);
    });

  taskCmd
    .command('next')
    .description('Get and claim the next priority task')
    .option('-p, --priority <priority>', 'Filter by minimum priority')
    .option('-a, --agent <agentId>', 'Agent identifier (default: code)')
    .option('--no-claim', 'Just show the next task without claiming it')
    .action(async (opts) => {
      await coordination.initialize();

      const project = await resolveProject();
      const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';
      const agentId = opts.agent || 'code';

      const { task, assignedToOthers } = await coordination.getNextAvailableTask({ agentId, projectId });

      if (!task) {
        if (assignedToOthers.length > 0) {
          console.log(`\nNo tasks available for agent '${agentId}'.`);
          console.log(`${assignedToOthers.length} task(s) assigned to others:\n`);
          assignedToOthers.slice(0, 5).forEach((t: any) => {
            console.log(`  - ${t.title.slice(0, 50)}${t.title.length > 50 ? '...' : ''}`);
            console.log(`    Assigned to: ${t.assignedTo}`);
          });
          if (assignedToOthers.length > 5) {
            console.log(`  ... and ${assignedToOthers.length - 5} more`);
          }
          console.log('');
        } else {
          console.log(`\nNo ready tasks available${project ? ` for ${project.name}` : ''}.\n`);
        }
        return;
      }

      if (opts.claim !== false) {
        const claimResult = await coordination.claimTask(task.id, agentId);

        if (!claimResult.success) {
          if (claimResult.conflict) {
            console.log(`\n⚠️  Task already claimed by ${claimResult.conflict.agentId}`);
            console.log(`   Use 'enginehaus task show ${task.id.slice(0, 8)}' to see details\n`);
            return;
          }
          if (claimResult.capacityExceeded) {
            console.log(`\n⚠️  You already have tasks in progress:`);
            claimResult.capacityExceeded.currentTasks.forEach(t => {
              console.log(`   - ${t.taskTitle} (${t.taskId.slice(0, 8)})`);
            });
            console.log(`\n   Complete or release a task first.\n`);
            return;
          }
        }
      }

      console.log(`\nNext task${project ? ` for ${project.name}` : ''}:\n`);
      console.log(`  Title: ${task.title}`);
      console.log(`  ID: ${task.id}`);
      console.log(`  Priority: ${task.priority}`);
      console.log(`  Description: ${task.description.slice(0, 200)}${task.description.length > 200 ? '...' : ''}`);
      if (task.files && task.files.length > 0) {
        console.log(`  Files: ${task.files.join(', ')}`);
      }
      if (opts.claim !== false) {
        console.log(`\n  ✓ Task claimed - session started`);
        await displayRelatedLearnings(task.id);
      }
      console.log('');
    });

  taskCmd
    .command('claim [taskId]')
    .alias('start')
    .description('Claim a specific task and start a session\n\n  Aliases: task start\n\n  Examples:\n    enginehaus task claim abc123\n    enginehaus task start abc123\n    enginehaus task claim --id abc123\n    enginehaus task claim abc123 --force')
    .option('--id <taskId>', 'Task ID (alternative to positional arg)')
    .option('-f, --force', 'Force claim: bypass capacity limits and override existing session locks')
    .action(async (taskIdArg, opts) => {
      await coordination.initialize();

      const taskId = taskIdArg || opts.id;
      if (!taskId) {
        console.error('\n❌ Missing required argument: taskId\n');
        console.error('📖 Correct syntax:');
        console.error('   enginehaus task claim abc123');
        console.error('   enginehaus task claim --id abc123\n');
        process.exit(1);
      }

      const project = await resolveProject();
      const projectId = project?.id || 'default';

      const task = await resolveTaskById(taskId, projectId);
      if (!task) {
        console.log(`\n❌ Task not found: ${taskId}\n`);
        console.log(`   Did you mean: enginehaus task list`);
        return;
      }

      if (task.status === 'completed') {
        console.log(`\n⚠️  Task already completed: ${task.title}\n`);
        return;
      }

      const agentId = `cli-${os.userInfo().username}`;
      const force = !!opts.force;
      const claimResult = await coordination.claimTask(task.id, agentId, { force });

      if (!claimResult.success) {
        if (claimResult.conflict) {
          console.log(`\n⚠️  Task already claimed by ${claimResult.conflict.agentId}`);
          console.log(`   Use --force to override.\n`);
          return;
        }
        if (claimResult.capacityExceeded) {
          console.log(`\n⚠️  You already have tasks in progress:`);
          claimResult.capacityExceeded.currentTasks.forEach(t => {
            console.log(`   - ${t.taskTitle} (${t.taskId.slice(0, 8)})`);
          });
          console.log(`\n   Use 'enginehaus task release <id>' to release one first.`);
          console.log(`   Or use --force to bypass capacity limits.\n`);
          return;
        }
        console.log(`\n❌ Failed to claim task\n`);
        return;
      }

      console.log(`\n✅ Task claimed: ${task.title}`);
      console.log(`   ID: ${task.id.slice(0, 8)}`);
      console.log(`   Session started`);

      // Auto-create feature branch (with optional worktree isolation)
      const taskProject = await coordination.getProject(task.projectId);
      if (taskProject?.rootPath) {
        const repoPath = taskProject.rootPath.startsWith('~')
          ? path.join(os.homedir(), taskProject.rootPath.slice(2))
          : taskProject.rootPath;

        try {
          execFileSync('git', ['rev-parse', '--git-dir'], { cwd: repoPath, stdio: 'pipe' });

          const branchName = coordination.generateTaskBranchName(task.id, task.title);

          // Check if worktree isolation is enabled
          let useWorktree = false;
          try {
            const configManager = coordination.getConfigManager();
            const workflowConfig = await configManager.getWorkflowConfig(task.projectId);
            useWorktree = workflowConfig.tasks.useWorktree ?? false;
          } catch {
            // Config unavailable — default to no worktree
          }

          if (useWorktree) {
            // Create isolated worktree for this task
            const { createWorktree } = await import('../../git/git-analysis.js');
            const projectDirName = path.basename(repoPath);
            const worktreePath = path.resolve(repoPath, '..', `${projectDirName}--${task.id.slice(0, 8)}`);

            const result = await createWorktree(repoPath, worktreePath, branchName);
            if (result.success) {
              console.log(`   Worktree: ${result.path}`);
              console.log(`   Branch: ${branchName}`);
              console.log(`   → Work in that directory.`);
            } else {
              console.log(`   ⚠️  Worktree creation failed: ${result.error}`);
              console.log(`   Falling back to branch checkout...`);
              // Fall back to regular branch checkout
              await checkoutBranch(repoPath, branchName);
            }
          } else {
            await checkoutBranch(repoPath, branchName);
          }

          // Only update the gitBranch — do NOT spread the stale task object
          // which still has the pre-claim status (ready), overwriting in-progress
          const freshTask = await coordination.getTask(task.id);
          const implementationUpdate: any = {
            ...freshTask?.implementation,
            gitBranch: branchName,
          };
          if (useWorktree) {
            const projectDirName = path.basename(repoPath);
            implementationUpdate.worktreePath = path.resolve(repoPath, '..', `${projectDirName}--${task.id.slice(0, 8)}`);
          }
          await coordination.updateTask(task.id, {
            implementation: implementationUpdate,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('not a git repository') && !msg.includes('rev-parse')) {
            console.log(`   ⚠️  Branch creation failed: ${msg}`);
          }
        }
      }

      await displayRelatedLearnings(task.id);
      console.log('');
    });

  taskCmd
    .command('release [taskId]')
    .description('Release a claimed task back to ready status\n\n  Examples:\n    enginehaus task release abc123\n    enginehaus task release --id abc123 -r blocked -n "Waiting for API"')
    .option('--id <taskId>', 'Task ID (alternative to positional arg)')
    .option('-r, --reason <reason>', 'Reason for releasing: test, redirect, blocked, stuck, scope_change, user_requested, context_limit, other')
    .option('-n, --notes <notes>', 'Additional context about the abandonment')
    .option('--no-prompt', 'Skip the reason prompt')
    .action(async (taskIdArg, opts) => {
      await coordination.initialize();

      const taskId = taskIdArg || opts.id;
      if (!taskId) {
        console.error('\n❌ Missing required argument: taskId\n');
        console.error('📖 Correct syntax:');
        console.error('   enginehaus task release abc123');
        console.error('   enginehaus task release --id abc123\n');
        process.exit(1);
      }

      const project = await resolveProject();
      const projectId = project?.id || 'default';

      const task = await resolveTaskById(taskId, projectId);
      if (!task) {
        console.log(`\n❌ Task not found: ${taskId}\n`);
        console.log(`   Did you mean: enginehaus task list`);
        return;
      }

      if (task.status === 'completed') {
        const cleaned = await coordination.cleanupDanglingSessions();
        if (cleaned > 0) {
          console.log(`\n✅ Cleaned up ${cleaned} dangling session(s) for completed tasks.`);
          console.log(`   Task: ${task.title}\n`);
          return;
        }
        console.log(`\n⚠️  Cannot release completed task: ${task.title}\n`);
        return;
      }

      if (task.status === 'ready') {
        console.log(`\n⚠️  Task is not claimed: ${task.title}\n`);
        return;
      }

      const validReasons = ['test', 'redirect', 'blocked', 'stuck', 'scope_change', 'user_requested', 'context_limit', 'other'];
      let reason = opts.reason;
      if (reason && !validReasons.includes(reason)) {
        console.log(`\n❌ Invalid reason: ${reason}`);
        console.log(`   Valid reasons: ${validReasons.join(', ')}\n`);
        return;
      }

      if (!reason && opts.prompt !== false) {
        console.log(`\n📋 Why are you releasing this task?`);
        console.log(`   1. test          - Test/exploration, not real work`);
        console.log(`   2. redirect      - Redirected to different priority`);
        console.log(`   3. blocked       - Blocked by external dependency`);
        console.log(`   4. stuck         - Agent stuck, couldn't proceed`);
        console.log(`   5. scope_change  - Task scope changed`);
        console.log(`   6. user_requested - User requested stop`);
        console.log(`   7. context_limit - Hit context/token limits`);
        console.log(`   8. other         - Other reason`);
        console.log(`   (Press Enter to skip)\n`);
        console.log(`   💡 Tip: Use --reason <reason> to set reason directly`);
      }

      const activeSessions = await coordination.getActiveSessions(task.projectId);
      const activeSession = activeSessions.find(s => s.taskId === task.id);

      if (activeSession) {
        const cliAgentId = `cli-${os.userInfo().username}`;
        const releaseResult = await coordination.releaseTaskWithResponse(activeSession.id, false, {
          reason: reason as any,
          notes: opts.notes,
          agentId: cliAgentId,
        });
        if (!releaseResult.success) {
          console.log(`\n⚠️  ${releaseResult.message}\n`);
          return;
        }
      } else {
        await coordination.updateTask(task.id, { status: 'ready' });
      }

      console.log(`\n✅ Task released: ${task.title}`);
      console.log(`   ID: ${task.id.slice(0, 8)}`);
      console.log(`   Status: ready`);
      if (reason) {
        console.log(`   Reason: ${reason}`);
      }
      if (opts.notes) {
        console.log(`   Notes: ${opts.notes}`);
      }
      console.log('');
    });

  taskCmd
    .command('show [taskId]')
    .description('Show task details\n\n  Examples:\n    enginehaus task show abc123\n    enginehaus task show --id abc123 --json')
    .option('--id <taskId>', 'Task ID (alternative to positional arg)')
    .option('--json', 'Output as JSON')
    .action(async (taskIdArg, opts) => {
      await coordination.initialize();

      const taskId = taskIdArg || opts.id;
      if (!taskId) {
        console.error('\n❌ Missing required argument: taskId\n');
        console.error('📖 Correct syntax:');
        console.error('   enginehaus task show abc123');
        console.error('   enginehaus task show --id abc123\n');
        process.exit(1);
      }

      const project = await resolveProject();
      const projectId = project?.id || 'default';

      const task = await resolveTaskById(taskId, projectId);
      if (!task) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(task, null, 2));
      } else {
        console.log('\nTask Details:\n');
        console.log(`  Title: ${task.title}`);
        console.log(`  ID: ${task.id}`);
        console.log(`  Priority: ${task.priority}`);
        console.log(`  Status: ${task.status}`);
        console.log(`  Description:\n    ${task.description.replace(/\n/g, '\n    ')}`);

        if (task.files && task.files.length > 0) {
          console.log(`  Files:`);
          task.files.forEach(f => console.log(`    - ${f}`));
        }

        if (task.strategicContext) {
          console.log('  Strategic Context:', JSON.stringify(task.strategicContext, null, 4).replace(/\n/g, '\n    '));
        }

        if (task.references && task.references.length > 0) {
          console.log(`  References:`);
          task.references.forEach((r: any) => console.log(`    - ${r.label ? r.label + ': ' : ''}${r.url}${r.type ? ' (' + r.type + ')' : ''}`));
        }

        if (task.implementation?.gitBranch) {
          console.log(`  Git Branch: ${task.implementation.gitBranch}`);
        }

        if (task.createdBy) console.log(`  Created By: ${task.createdBy}`);
        if (task.assignedTo) console.log(`  Assigned To: ${task.assignedTo}`);
        if (task.lastModifiedBy) console.log(`  Last Modified By: ${task.lastModifiedBy}`);
        console.log(`  Created: ${task.createdAt}`);
        console.log(`  Updated: ${task.updatedAt}`);
        console.log('');
      }
    });

  taskCmd
    .command('add')
    .description('Create a new task')
    .requiredOption('-t, --title <title>', 'Task title')
    .requiredOption('-p, --priority <priority>', 'Priority (critical, high, medium, low)')
    .option('-d, --description <description>', 'Task description')
    .option('-f, --files <files>', 'Comma-separated list of files')
    .option('--type <type>', 'Task type: code, docs, infra, test, other (affects quality gates)')
    .option('--tags <tags>', 'Comma-separated tags for categorization')
    .option('--ref <url>', 'Add an external reference URL (repeatable)', (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action(async (opts) => {
      await coordination.initialize();

      const validPriorities: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
      if (!validPriorities.includes(opts.priority)) {
        console.error(`Invalid priority: ${opts.priority}. Must be one of: ${validPriorities.join(', ')}`);
        process.exit(1);
      }

      const validTypes = ['code', 'docs', 'infra', 'test', 'other'];
      if (opts.type && !validTypes.includes(opts.type)) {
        console.error(`Invalid type: ${opts.type}. Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }

      const project = await resolveProject();
      const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';

      const references = opts.ref && opts.ref.length > 0
        ? opts.ref.map((url: string) => ({ url }))
        : undefined;

      const task = await coordination.createTask({
        projectId,
        title: opts.title,
        description: opts.description || '',
        priority: opts.priority as TaskPriority,
        files: opts.files ? opts.files.split(',').map((f: string) => f.trim()) : [],
        type: opts.type,
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined,
        references,
        createdBy: 'cli-user',
      });

      console.log(`\n✅ Task created:\n`);
      console.log(`  ID: ${task.id}`);
      console.log(`  Title: ${task.title}`);
      console.log(`  Priority: ${task.priority}`);
      if (opts.type) console.log(`  Type: ${opts.type}`);
      if (opts.tags) console.log(`  Tags: ${opts.tags}`);
      if (references) console.log(`  References: ${references.map((r: { url: string }) => r.url).join(', ')}`);
      console.log(`  Project: ${project?.name || 'default'}`);
      console.log(`  Status: ${task.status}`);
      console.log('');
    });

  taskCmd
    .command('update <taskId>')
    .description('Update a task')
    .option('-t, --title <title>', 'New task title')
    .option('-p, --priority <priority>', 'New priority (critical, high, medium, low)')
    .option('-s, --status <status>', 'New status (ready, in-progress, blocked, completed)')
    .option('-d, --description <description>', 'New description')
    .option('-f, --files <files>', 'New files list (comma-separated)')
    .option('--project <project>', 'Move task to project (by slug or ID)')
    .action(async (taskId, opts) => {
      await coordination.initialize();

      const project = await resolveProject();
      const projectId = project?.id || 'default';

      let task = await resolveTaskById(taskId, projectId);
      if (!task && opts.project) {
        task = await resolveTaskById(taskId, undefined);
      }
      if (!task) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }

      if (opts.priority) {
        const validPriorities: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
        if (!validPriorities.includes(opts.priority)) {
          console.error(`Invalid priority: ${opts.priority}. Must be one of: ${validPriorities.join(', ')}`);
          process.exit(1);
        }
      }

      if (opts.status) {
        const validStatuses = ['ready', 'in-progress', 'blocked', 'completed'];
        if (!validStatuses.includes(opts.status)) {
          console.error(`Invalid status: ${opts.status}. Must be one of: ${validStatuses.join(', ')}`);
          process.exit(1);
        }
      }

      let targetProjectId: string | undefined;
      if (opts.project) {
        const projects = await coordination.listProjects();
        const targetProject = projects.find(p => p.slug === opts.project || p.id === opts.project || p.id.startsWith(opts.project));
        if (!targetProject) {
          console.error(`Project not found: ${opts.project}`);
          console.error('Available projects:');
          projects.forEach(p => console.error(`  ${p.slug} (${p.id.substring(0, 8)}...)`));
          process.exit(1);
        }
        targetProjectId = targetProject.id;
      }

      const updates: Partial<UnifiedTask> = {};
      if (opts.title) updates.title = opts.title;
      if (opts.priority) updates.priority = opts.priority as TaskPriority;
      if (opts.status) updates.status = opts.status;
      if (opts.description) updates.description = opts.description;
      if (opts.files) updates.files = opts.files.split(',').map((f: string) => f.trim());
      if (targetProjectId) updates.projectId = targetProjectId;

      if (Object.keys(updates).length === 0) {
        console.error('No updates provided. Use --help for options.');
        process.exit(1);
      }

      const updated = await coordination.updateTask(task.id, updates);

      console.log(`\n✅ Task updated:\n`);
      console.log(`  ID: ${updated!.id}`);
      console.log(`  Title: ${updated!.title}`);
      console.log(`  Priority: ${updated!.priority}`);
      console.log(`  Status: ${updated!.status}`);
      if (targetProjectId) {
        const projects = await coordination.listProjects();
        const newProject = projects.find(p => p.id === targetProjectId);
        console.log(`  Project: ${newProject?.name || targetProjectId}`);
      }
      if (updated!.files && updated!.files.length > 0) {
        console.log(`  Files: ${updated!.files.join(', ')}`);
      }
      console.log(`\n  Updated fields: ${Object.keys(updates).join(', ')}`);
      console.log('');
    });

  taskCmd
    .command('complete [taskId]')
    .alias('finish')
    .description('Complete a task with smart documentation from git history\n\n  Aliases: task finish\n\n  Examples:\n    enginehaus task complete abc123 -s "Implemented feature X"\n    enginehaus task finish abc123 -s "Done"\n    enginehaus task complete --id abc123 --summary "Fixed the bug"')
    .option('--id <taskId>', 'Task ID (alternative to positional arg)')
    .requiredOption('-s, --summary <summary>', 'Brief summary of what was done')
    .option('--since <datetime>', 'ISO datetime to analyze git history from')
    .option('-f, --force', 'Bypass quality enforcement (requires --reason)')
    .option('--reason <reason>', 'Reason for bypassing quality checks (required with --force)')
    .action(async (taskIdArg, opts) => {
      await coordination.initialize();

      const taskId = taskIdArg || opts.id;
      if (!taskId) {
        console.error('\n❌ Missing required argument: taskId\n');
        console.error('📖 Correct syntax:');
        console.error('   enginehaus task complete abc123 -s "Summary"');
        console.error('   enginehaus task complete --id abc123 --summary "Summary"\n');
        process.exit(1);
      }

      if (opts.force && !opts.reason) {
        console.error('\n❌ --force requires --reason\n');
        console.error('📖 Correct syntax:');
        console.error('   enginehaus task complete abc123 -s "Summary" --force --reason "trivial change"');
        console.error('   enginehaus task complete abc123 -s "Summary" --force --reason "no code changes"\n');
        process.exit(1);
      }

      const project = await resolveProject();
      const projectId = project?.id || 'default';

      const task = await resolveTaskById(taskId, projectId);
      if (!task) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }

      console.log(`\n🔍 Completing task: ${task.title}...\n`);

      const result = await coordination.completeTaskSmart({
        taskId: task.id,
        summary: opts.summary,
        defaultProjectRoot: process.cwd(),
        enforceQuality: !opts.force,
      });

      if (!result.success) {
        if (result.uncommittedChanges) {
          console.error(`\n❌ Cannot complete with uncommitted changes:\n`);
          const uc = result.uncommittedChanges;
          if (uc.modifiedFiles?.length) console.error(`   Modified: ${uc.modifiedFiles.join(', ')}`);
          if (uc.untrackedFiles?.length) console.error(`   Untracked: ${uc.untrackedFiles.join(', ')}`);
          if (uc.stagedFiles?.length) console.error(`   Staged: ${uc.stagedFiles.join(', ')}`);
          console.error(`\n   Options:`);
          console.error(`     - Commit: git add <files> && git commit -m "..."`);
          console.error(`     - Move scratch: mv <file> .enginehaus/scratch/`);
          console.error(`     - Discard: git checkout -- <file>`);
          console.error(`\n   Tip: Use .enginehaus/scratch/ for planning files to avoid this.\n`);
          process.exit(1);
        }
        if (result.qualityEnforced && result.qualityGaps?.length) {
          console.error(`\n❌ Quality enforcement blocked completion:\n`);
          result.qualityGaps.forEach((gap: any) => console.error(`   • ${gap}`));
          console.error(`\nTo complete anyway, use: enginehaus task complete ${task.id.slice(0, 8)} -s "${opts.summary}" --force --reason "your reason"`);
          console.error(`Or fix the quality gaps and try again.\n`);
          process.exit(1);
        }
        console.error(`\n❌ ${result.error || 'Failed to complete task'}\n`);
        process.exit(1);
      }

      if (opts.force && result.qualityGaps?.length) {
        console.log(`⚠️  Bypassing quality enforcement (--force):`);
        result.qualityGaps.forEach((gap: any) => console.log(`   • ${gap}`));
        console.log(`   Reason: ${opts.reason}`);
        console.log('');
      }

      console.log(`✅ Task completed: ${task.title}\n`);
      console.log(`  Summary: ${opts.summary}`);
      if (result.gitAnalysis) {
        console.log(`  Git Analysis:`);
        console.log(`    Files changed: ${result.gitAnalysis.filesChanged}`);
        console.log(`    Commits: ${result.gitAnalysis.commits}`);
        console.log(`    Lines: +${result.gitAnalysis.linesAdded} / -${result.gitAnalysis.linesRemoved}`);
      }
      if (result.generatedDocs) {
        if (result.generatedDocs.architectureDecisions > 0) {
          console.log(`  Architecture Decisions: ${result.generatedDocs.architectureDecisions}`);
        }
      }
      if (result.workflowWarnings?.length) {
        console.log(`  Warnings:`);
        result.workflowWarnings.forEach((w: any) => console.log(`    ⚠️  ${w}`));
      }
      if ((result as any).surveyDue) {
        const survey = (result as any).surveyDue;
        console.log(`\n  💬 AX Feedback Survey`);
        console.log(`     ${survey.reason}`);
        console.log('');
        for (const q of survey.questions) {
          console.log(`     ${q.id}: ${q.question}`);
          if (q.options) {
            console.log(`       Options: ${q.options.join(', ')}`);
          }
        }
        console.log('');
        console.log(`     Submit: enginehaus feedback -s <session-id> -r <1-5> -f <friction-tags> -n "notes"`);
      }
      console.log('');
    });
}
