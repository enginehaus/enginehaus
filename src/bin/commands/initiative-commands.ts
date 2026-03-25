/**
 * Initiative CLI commands: create, list, show, link, outcome, update, learnings
 */

import { Command } from 'commander';
import { CliContext } from '../cli-context.js';

export function registerInitiativeCommands(program: Command, ctx: CliContext): void {
  const { coordination, registerCommand } = ctx;

  const initiativeCmd = program
    .command('initiative')
    .description('Manage initiatives (link tasks to goals and track outcomes)');

  // Register initiative command specs for agent-help
  registerCommand({
    command: 'initiative create',
    description: 'Create a new initiative (goal with success criteria)',
    example: 'enginehaus initiative create "Reduce API latency by 50%"',
    altExamples: [
      'enginehaus initiative create --title "Reduce API latency by 50%"',
      'enginehaus initiative create "My Goal" -d "Details" -s "P95 < 100ms"',
    ],
    args: [
      { name: 'title', required: true, description: 'Initiative title/goal', flag: '--title' },
    ],
    options: [
      { flags: '-t, --title <text>', description: 'Initiative title (alternative to positional)', required: false },
      { flags: '-d, --description <text>', description: 'Detailed description', required: false },
      { flags: '-s, --success <criteria>', description: 'What does success look like?', required: false },
    ],
  });

  // ── Command handlers ──────────────────────────────────────────────────────

  initiativeCmd
    .command('create [title]')
    .description('Create a new initiative (goal with success criteria)\n\n  Examples:\n    enginehaus initiative create "Reduce API latency by 50%"\n    enginehaus initiative create --title "My Goal" -s "Ship by Q1"')
    .option('-t, --title <text>', 'Initiative title (alternative to positional arg)')
    .option('-d, --description <text>', 'Detailed description')
    .option('-s, --success <criteria>', 'What does success look like?')
    .action(async (titleArg: string | undefined, opts) => {
      await coordination.initialize();

      // Support dual pattern: positional arg OR --title flag
      const title = titleArg || opts.title;
      if (!title) {
        console.error('\n❌ Missing required argument: title\n');
        console.error('📖 Correct syntax:');
        console.error('   enginehaus initiative create "Your initiative title"');
        console.error('   enginehaus initiative create --title "Your initiative title"\n');
        process.exit(1);
      }

      const result = await coordination.createInitiative({
        title,
        description: opts.description,
        successCriteria: opts.success,
      });

      if (result.success) {
        console.log(`\n✅ Initiative created: ${result.initiativeId?.slice(0, 12)}`);
        console.log(`   Title: ${title}`);
        if (opts.description) console.log(`   Description: ${opts.description}`);
        if (opts.success) console.log(`   Success: ${opts.success}`);
      } else {
        console.error(`\n❌ ${result.message}`);
        process.exit(1);
      }
      console.log('');
    });

  initiativeCmd
    .command('list')
    .description('List initiatives')
    .option('-s, --status <status>', 'Filter by status: active, succeeded, failed, pivoted, abandoned')
    .option('-n, --limit <n>', 'Max initiatives to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();

      const result = await coordination.listInitiatives({
        status: opts.status as any,
        limit: parseInt(opts.limit, 10),
      });

      if (opts.json) {
        console.log(JSON.stringify(result.initiatives, null, 2));
      } else {
        console.log(`\n📋 Initiatives (${result.count}):\n`);
        if (result.initiatives.length === 0) {
          console.log('  No initiatives found. Create one with `enginehaus initiative create <title>`');
        } else {
          for (const init of result.initiatives) {
            const statusIcon = {
              active: '🔵',
              succeeded: '✅',
              failed: '❌',
              pivoted: '↪️',
              abandoned: '⏹️',
            }[init.status as string];
            console.log(`  ${statusIcon} ${init.title}`);
            console.log(`     ID: ${init.id.slice(0, 12)} | Tasks: ${init.taskCount} | Status: ${init.status}`);
          }
        }
        console.log('');
      }
    });

  initiativeCmd
    .command('show <id>')
    .description('Show initiative details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts) => {
      await coordination.initialize();

      // Support partial ID matching
      const allInits = await coordination.listInitiatives({ limit: 100 });
      const match = allInits.initiatives.find((i: any) => i.id.startsWith(id));
      if (!match) {
        console.error(`\n❌ Initiative not found: ${id}\n`);
        process.exit(1);
      }

      const result = await coordination.getInitiative(match.id);
      if (!result.success || !result.initiative) {
        console.error(`\n❌ ${result.error}\n`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result.initiative, null, 2));
      } else {
        const init = result.initiative;
        console.log(`\n📋 Initiative: ${init.title}\n`);
        console.log(`  ID: ${init.id}`);
        console.log(`  Status: ${init.status}`);
        if (init.description) console.log(`  Description: ${init.description}`);
        if (init.successCriteria) console.log(`  Success Criteria: ${init.successCriteria}`);
        if (init.outcomeNotes) console.log(`  Outcome: ${init.outcomeNotes}`);
        console.log(`  Created: ${init.createdAt.toISOString()}`);

        if (init.tasks.length > 0) {
          console.log(`\n  Linked Tasks (${init.tasks.length}):`);
          for (const t of init.tasks) {
            console.log(`    - ${t.taskId.slice(0, 8)}${t.contributionNotes ? `: ${t.contributionNotes}` : ''}`);
          }
        }
        console.log('');
      }
    });

  initiativeCmd
    .command('link <taskId> <initiativeId>')
    .description('Link a task to an initiative')
    .option('-n, --notes <text>', 'How does this task contribute?')
    .action(async (taskId: string, initiativeId: string, opts) => {
      await coordination.initialize();

      // Support partial ID matching for initiative
      const allInits = await coordination.listInitiatives({ limit: 100 });
      const initMatch = allInits.initiatives.find((i: any) => i.id.startsWith(initiativeId));
      if (!initMatch) {
        console.error(`\n❌ Initiative not found: ${initiativeId}\n`);
        process.exit(1);
      }

      // Support partial ID matching for task
      const tasks = await coordination.getTasks({});
      const taskMatch = tasks.find(t => t.id.startsWith(taskId));
      if (!taskMatch) {
        console.error(`\n❌ Task not found: ${taskId}\n`);
        process.exit(1);
      }

      const result = await coordination.linkTaskToInitiative({
        taskId: taskMatch.id,
        initiativeId: initMatch.id,
        contributionNotes: opts.notes,
      });

      if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
      } else {
        console.error(`\n❌ ${result.message}\n`);
        process.exit(1);
      }
    });

  initiativeCmd
    .command('outcome <id>')
    .description('Record outcome for an initiative')
    .requiredOption('-s, --status <status>', 'Outcome: succeeded, failed, pivoted, abandoned')
    .requiredOption('-n, --notes <text>', 'What actually happened?')
    .action(async (id: string, opts) => {
      await coordination.initialize();

      // Support partial ID matching
      const allInits = await coordination.listInitiatives({ limit: 100 });
      const match = allInits.initiatives.find((i: any) => i.id.startsWith(id));
      if (!match) {
        console.error(`\n❌ Initiative not found: ${id}\n`);
        process.exit(1);
      }

      const validStatuses = ['succeeded', 'failed', 'pivoted', 'abandoned'];
      if (!validStatuses.includes(opts.status)) {
        console.error(`\n❌ Invalid status: ${opts.status}. Use: ${validStatuses.join(', ')}\n`);
        process.exit(1);
      }

      const result = await coordination.recordInitiativeOutcome({
        initiativeId: match.id,
        status: opts.status as 'succeeded' | 'failed' | 'pivoted' | 'abandoned',
        outcomeNotes: opts.notes,
      });

      if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
      } else {
        console.error(`\n❌ ${result.message}\n`);
        process.exit(1);
      }
    });

  initiativeCmd
    .command('update <id>')
    .description('Update an initiative\'s fields')
    .option('-t, --title <text>', 'New title')
    .option('-d, --description <text>', 'New description')
    .option('--success <text>', 'New success criteria')
    .option('-s, --status <status>', 'New status: active, succeeded, failed, pivoted, abandoned')
    .option('-p, --project <id>', 'Reassign to a different project')
    .option('-n, --notes <text>', 'Outcome notes')
    .action(async (id: string, opts) => {
      await coordination.initialize();

      // Support partial ID matching
      const allInits = await coordination.listInitiatives({ limit: 100 });
      const match = allInits.initiatives.find((i: any) => i.id.startsWith(id));
      if (!match) {
        console.error(`\n❌ Initiative not found: ${id}\n`);
        process.exit(1);
      }

      if (opts.status) {
        const validStatuses = ['active', 'succeeded', 'failed', 'pivoted', 'abandoned'];
        if (!validStatuses.includes(opts.status)) {
          console.error(`\n❌ Invalid status: ${opts.status}. Use: ${validStatuses.join(', ')}\n`);
          process.exit(1);
        }
      }

      const result = await coordination.updateInitiative({
        initiativeId: match.id,
        title: opts.title,
        description: opts.description,
        successCriteria: opts.success,
        status: opts.status as any,
        outcomeNotes: opts.notes,
        projectId: opts.project,
      });

      if (result.success) {
        console.log(`\n✅ ${result.message}\n`);
      } else {
        console.error(`\n❌ ${result.message}\n`);
        process.exit(1);
      }
    });

  initiativeCmd
    .command('learnings')
    .description('Get learnings from past initiatives (what worked, what failed)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();

      const result = await coordination.getInitiativeLearnings({});

      if (opts.json) {
        console.log(JSON.stringify(result.learnings, null, 2));
      } else {
        const l = result.learnings;
        console.log('\n📊 Initiative Learnings:\n');

        console.log('  Summary:');
        console.log(`    Total: ${l.summary.total} | Active: ${l.summary.active}`);
        console.log(`    Succeeded: ${l.summary.succeeded} | Failed: ${l.summary.failed}`);
        console.log(`    Pivoted: ${l.summary.pivoted} | Abandoned: ${l.summary.abandoned}`);
        console.log(`    Success Rate: ${Math.round(l.summary.successRate * 100)}%`);

        if (l.succeededInitiatives.length > 0) {
          console.log('\n  ✅ What Worked:');
          for (const init of l.succeededInitiatives) {
            console.log(`    - ${init.title} (${init.taskCount} tasks)`);
            if (init.outcomeNotes) console.log(`      ${init.outcomeNotes}`);
          }
        }

        if (l.failedInitiatives.length > 0) {
          console.log('\n  ❌ What Failed:');
          for (const init of l.failedInitiatives) {
            console.log(`    - ${init.title} (${init.taskCount} tasks)`);
            if (init.outcomeNotes) console.log(`      ${init.outcomeNotes}`);
          }
        }

        console.log('');
      }
    });
}
