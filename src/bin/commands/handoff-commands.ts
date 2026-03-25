/**
 * Handoff CLI commands: export, status, context
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { CliContext } from '../cli-context.js';

export function registerHandoffCommands(program: Command, ctx: CliContext): void {
  const { coordination, getProjectId, resolveTaskById } = ctx;

  const handoffCmd = program
    .command('handoff')
    .description('Manage session handoffs between agents');

  handoffCmd
    .command('export <taskId>')
    .description('Generate a continuation prompt for handing off to another agent')
    .option('-t, --target <agent>', 'Target agent (default: claude-code)', 'claude-code')
    .option('-f, --from <agent>', 'Source agent identifier', 'current-agent')
    .option('--no-files', 'Exclude file list from prompt')
    .option('--clipboard', 'Copy prompt to clipboard (macOS only)')
    .action(async (taskId: string, opts) => {
      await coordination.initialize();

      // Support partial task IDs
      const projectId = await getProjectId();
      const task = await resolveTaskById(taskId, projectId);

      if (!task) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }

      const result = await coordination.generateContinuationPrompt({
        taskId: task.id,
        targetAgent: opts.target,
        fromAgent: opts.from,
        includeFiles: opts.files !== false,
      });

      if (!result.success || !result.prompt) {
        console.error(`Failed to generate handoff: ${result.error || 'unknown error'}`);
        process.exit(1);
      }

      console.log(result.prompt);

      if (opts.clipboard) {
        try {
          execFileSync('pbcopy', [], { input: result.prompt });
          console.error('\n✓ Copied to clipboard');
        } catch {
          console.error('\n⚠ Could not copy to clipboard');
        }
      }
    });

  handoffCmd
    .command('status')
    .description('Show current session state summary')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();

      const status = await coordination.getHandoffStatus({});

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log('\n📋 Handoff Status\n');

        if (status.activeSessions && status.activeSessions.length > 0) {
          console.log('Active Sessions:');
          for (const s of status.activeSessions) {
            console.log(`  • ${s.taskTitle}`);
            console.log(`    Agent: ${s.agentId} | Duration: ${s.durationMinutes}m`);
            console.log(`    Task ID: ${s.taskId.slice(0, 8)}...`);
          }
        } else {
          console.log('  No active sessions');
        }

        if (status.recentDecisions && status.recentDecisions.length > 0) {
          console.log('\nRecent Decisions:');
          for (const d of status.recentDecisions.slice(0, 5)) {
            const date = new Date(d.createdAt).toLocaleDateString();
            console.log(`  • ${d.decision} (${date})`);
          }
        }

        console.log('');
      }
    });

  handoffCmd
    .command('context <taskId>')
    .description('Get full handoff context for a task')
    .option('-f, --from <agent>', 'Source agent', 'current-agent')
    .option('-t, --to <agent>', 'Target agent', 'next-agent')
    .option('--json', 'Output as JSON')
    .action(async (taskId: string, opts) => {
      await coordination.initialize();

      // Support partial task IDs
      const projectId = await getProjectId();
      const task = await resolveTaskById(taskId, projectId);

      if (!task) {
        console.error(`Task not found: ${taskId}`);
        process.exit(1);
      }

      const contextResult = await coordination.getHandoffContext({
        taskId: task.id,
        fromAgent: opts.from,
        toAgent: opts.to,
      });

      if (!contextResult.success || !contextResult.context) {
        console.error(`Failed to get handoff context: ${contextResult.error || 'unknown error'}`);
        process.exit(1);
      }

      const context = contextResult.context;

      if (opts.json) {
        console.log(JSON.stringify(context, null, 2));
      } else {
        console.log('\n📋 Handoff Context\n');
        console.log(`Task: ${context.task.title}`);
        console.log(`Status: ${context.task.status}`);
        console.log(`Priority: ${context.task.priority}`);

        if (context.task.files.length > 0) {
          console.log('\nFiles:');
          context.task.files.forEach(f => console.log(`  - ${f}`));
        }

        if (context.accomplishments.length > 0) {
          console.log('\nAccomplishments:');
          context.accomplishments.forEach(a => console.log(`  ✓ ${a}`));
        }

        if (context.decisions.length > 0) {
          console.log('\nDecisions Made:');
          context.decisions.forEach(d => {
            console.log(`  • ${d.decision}`);
            if (d.rationale) console.log(`    Rationale: ${d.rationale}`);
          });
        }

        console.log('\nCurrent State:');
        console.log(`  ${context.currentState.summary}`);

        if (context.nextSteps.length > 0) {
          console.log('\nNext Steps:');
          context.nextSteps.forEach(s => console.log(`  → ${s}`));
        }

        console.log('');
      }
    });
}
