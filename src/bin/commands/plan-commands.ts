/**
 * Plan CLI commands: capture, list
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { CliContext } from '../cli-context.js';

export function registerPlanCommands(program: Command, ctx: CliContext): void {
  const { coordination, getProjectId, resolveTaskById, registerCommand } = ctx;

  const planCmd = program
    .command('plan')
    .description('Manage implementation plans (captured from plan mode)');

  // Register command specs for agent-help
  registerCommand({
    command: 'plan capture',
    description: 'Capture a plan file as an Enginehaus artifact linked to the active task',
    example: 'enginehaus plan capture --file .claude/plans/my-plan.md',
    altExamples: [
      'enginehaus plan capture --file .claude/plans/my-plan.md --task abc123',
    ],
    args: [],
    options: [
      { flags: '-f, --file <path>', description: 'Path to the plan markdown file', required: true },
      { flags: '-t, --task <id>', description: 'Task ID to attach plan to (defaults to active in-progress task)', required: false },
    ],
  });

  registerCommand({
    command: 'plan list',
    description: 'List plan artifacts for a task or project',
    example: 'enginehaus plan list',
    altExamples: [
      'enginehaus plan list --task abc123',
      'enginehaus plan list --json',
    ],
    args: [],
    options: [
      { flags: '-t, --task <id>', description: 'Filter by task ID', required: false },
      { flags: '-n, --limit <n>', description: 'Max plans to show', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  // ── Command handlers ──────────────────────────────────────────────────────

  planCmd
    .command('capture')
    .description('Capture a plan file as an Enginehaus artifact\n\n  Examples:\n    enginehaus plan capture --file .claude/plans/my-plan.md\n    enginehaus plan capture --file .claude/plans/my-plan.md --task abc123')
    .requiredOption('-f, --file <path>', 'Path to the plan markdown file')
    .option('-t, --task <id>', 'Task ID to attach plan to (defaults to active in-progress task)')
    .action(async (opts) => {
      await coordination.initialize();

      // Read the plan file
      const planPath = path.resolve(opts.file);
      if (!fs.existsSync(planPath)) {
        console.error(`\n❌ Plan file not found: ${planPath}\n`);
        process.exit(1);
      }

      const content = fs.readFileSync(planPath, 'utf-8');
      if (!content.trim()) {
        console.error('\n❌ Plan file is empty\n');
        process.exit(1);
      }

      // Extract title from first # heading
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : path.basename(planPath, '.md');

      // Resolve task ID
      let taskId = opts.task;
      if (!taskId) {
        // Find the active in-progress task for this project
        const projectId = await getProjectId();
        const tasks = await coordination.getTasks({ projectId, status: 'in-progress' as any });
        if (tasks.length === 0) {
          console.error('\n❌ No in-progress task found. Use --task <id> to specify a task.\n');
          process.exit(1);
        }
        // Use the first in-progress task (most recently claimed)
        taskId = tasks[0].id;
      } else {
        // Resolve partial task ID
        const resolved = await resolveTaskById(taskId);
        if (!resolved) {
          console.error(`\n❌ Task not found: ${taskId}\n`);
          process.exit(1);
        }
        taskId = resolved.id;
      }

      // Store as artifact
      const result = await coordination.storeArtifact({
        taskId,
        type: 'design',
        content,
        contentType: 'text/markdown',
        title: `Plan: ${title}`,
      });

      if (result.success) {
        console.log(`\n✅ Plan captured as artifact: ${result.artifactId?.slice(0, 12)}`);
        console.log(`   Title: Plan: ${title}`);
        console.log(`   Task: ${taskId.slice(0, 12)}`);
        console.log(`   Size: ${result.contentSize} bytes`);
      } else {
        console.error(`\n❌ ${result.error}`);
        process.exit(1);
      }
      console.log('');
    });

  planCmd
    .command('list')
    .description('List plan artifacts\n\n  Examples:\n    enginehaus plan list\n    enginehaus plan list --task abc123')
    .option('-t, --task <id>', 'Filter by task ID')
    .option('-n, --limit <n>', 'Max plans to show', '10')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();

      const limit = parseInt(opts.limit, 10);

      let artifacts: Array<{ id: string; taskId: string; title?: string; contentSize?: number; createdAt: Date }>;

      if (opts.task) {
        // Resolve partial task ID
        const resolved = await resolveTaskById(opts.task);
        if (!resolved) {
          console.error(`\n❌ Task not found: ${opts.task}\n`);
          process.exit(1);
        }
        const taskArtifacts = await coordination.getArtifactsForTask(resolved.id, 'design');
        artifacts = taskArtifacts.slice(0, limit);
      } else {
        // Get all design artifacts for the active project
        const projectId = await getProjectId();
        const projectArtifacts = await coordination.getArtifactsForProject(projectId, 'design');
        artifacts = projectArtifacts.slice(0, limit);
      }

      if (opts.json) {
        console.log(JSON.stringify(artifacts.map(a => ({
          id: a.id,
          taskId: a.taskId,
          title: a.title,
          contentSize: a.contentSize,
          createdAt: a.createdAt,
        })), null, 2));
        return;
      }

      console.log(`\n📋 Plans (${artifacts.length}):\n`);
      if (artifacts.length === 0) {
        console.log('  No plans found. Plans are captured automatically when exiting plan mode.');
      } else {
        for (const a of artifacts) {
          const date = new Date(a.createdAt).toLocaleDateString();
          const size = a.contentSize ? `${(a.contentSize / 1024).toFixed(1)}KB` : '';
          console.log(`  📄 ${a.title || 'Untitled plan'}`);
          console.log(`     ID: ${a.id.slice(0, 12)} | Task: ${a.taskId.slice(0, 12)} | ${date} ${size}`);
        }
      }
      console.log('');
    });
}
