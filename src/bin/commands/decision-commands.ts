/**
 * Decision CLI commands: log, list, show
 */

import { Command } from 'commander';
import * as os from 'os';
import { CliContext } from '../cli-context.js';

export function registerDecisionCommands(program: Command, ctx: CliContext): void {
  const { coordination, getProjectId, resolveTaskById, registerCommand } = ctx;

  const decisionCmd = program
    .command('decision')
    .description('Manage implementation decisions');

  // Register decision command specs for agent-help
  registerCommand({
    command: 'decision log',
    description: 'Log an implementation decision',
    example: 'enginehaus decision log "Use SQLite over PostgreSQL" -r "Simpler deployment"',
    altExamples: [
      'enginehaus decision log --decision "Choice" --rationale "Reason" -c architecture',
      'enginehaus decision log "Decision" -c tradeoff -t abc123',
    ],
    args: [
      { name: 'decision', required: true, description: 'The decision text', flag: '--decision' },
    ],
    options: [
      { flags: '-d, --decision <text>', description: 'Decision text (alternative to positional)', required: false },
      { flags: '-r, --rationale <text>', description: 'Why this decision was made', required: false },
      { flags: '-i, --impact <text>', description: 'Expected impact or consequences', required: false },
      { flags: '-c, --category <cat>', description: 'Category: architecture, tradeoff, dependency, pattern, other', required: false },
      { flags: '-t, --task <id>', description: 'Associated task ID (optional — omit for strategic decisions)', required: false },
      { flags: '--tags <tags>', description: 'Comma-separated tags for categorizing (e.g., "positioning,gtm")', required: false },
    ],
  });

  registerCommand({
    command: 'decision list',
    description: 'List logged decisions',
    example: 'enginehaus decision list',
    altExamples: [
      'enginehaus decision list --category architecture',
      'enginehaus decision list -t abc123 --json',
    ],
    args: [],
    options: [
      { flags: '-t, --task <id>', description: 'Filter by task ID', required: false },
      { flags: '-c, --category <cat>', description: 'Filter by category', required: false },
      { flags: '-p, --period <period>', description: 'Time period: day, week, month, all', required: false },
      { flags: '-n, --limit <n>', description: 'Max decisions to show', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  // ── Command handlers ──────────────────────────────────────────────────────

  decisionCmd
    .command('log [decision]')
    .description('Log an implementation decision\n\n  Examples:\n    enginehaus decision log "Use SQLite over PostgreSQL" -r "Simpler deployment"\n    enginehaus decision log --decision "Choice" -c architecture')
    .option('-d, --decision <text>', 'Decision text (alternative to positional arg)')
    .option('-r, --rationale <text>', 'Why this decision was made')
    .option('-i, --impact <text>', 'Expected impact or consequences')
    .option('-c, --category <cat>', 'Category: architecture, tradeoff, dependency, pattern, other')
    .option('-t, --task <id>', 'Associated task ID (optional — omit for strategic decisions)')
    .option('--tags <tags>', 'Comma-separated tags for categorizing (e.g., "positioning,gtm")')
    .option('--ref <url>', 'Add an external reference URL (repeatable)', (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action(async (decisionArg: string | undefined, opts) => {
      // Support dual pattern: positional arg OR --decision flag
      const decision = decisionArg || opts.decision;
      if (!decision) {
        console.error('\n❌ Missing required argument: decision\n');
        console.error('📖 Correct syntax:');
        console.error('   enginehaus decision log "Your decision text"');
        console.error('   enginehaus decision log --decision "Your decision text"\n');
        process.exit(1);
      }
      await coordination.initialize();
      const projectId = await getProjectId();

      // Accept any category — domain profiles may define custom categories (e.g., tone, methodology)
      // Default categories for reference: architecture, tradeoff, dependency, pattern, other

      // Resolve task ID: explicit --task, or auto-detect from active session
      let resolvedTaskId = opts.task;
      let autoLinked = false;

      if (opts.task) {
        // Explicit task ID provided - resolve partial ID
        const resolvedTask = await resolveTaskById(opts.task, projectId);
        if (!resolvedTask) {
          console.error(`Task not found: ${opts.task}`);
          return;
        }
        resolvedTaskId = resolvedTask.id;
      } else {
        // No explicit task - try to find active session for current agent
        const agentId = `cli-${os.userInfo().username}`;
        const activeSessions = await coordination.getActiveSessions(projectId);
        const mySession = activeSessions.find(s => s.agentId === agentId);
        if (mySession?.taskId) {
          resolvedTaskId = mySession.taskId;
          autoLinked = true;
        }
      }

      // Build scope from tags if provided
      const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined;
      const scope = tags ? { tags } : undefined;

      // Build references from --ref flags
      const references = opts.ref && opts.ref.length > 0
        ? opts.ref.map((url: string) => ({ url }))
        : undefined;

      const result = await coordination.logDecision({
        decision,
        rationale: opts.rationale,
        impact: opts.impact,
        category: opts.category as any,
        taskId: resolvedTaskId,
        projectId,
        createdBy: 'cli-user',
        scope,
        references,
      });

      console.log(`\n✓ Decision logged: ${result.decisionId.slice(0, 8)}`);
      console.log(`  "${decision}"`);
      if (opts.rationale) console.log(`  Rationale: ${opts.rationale}`);
      if (opts.impact) console.log(`  Impact: ${opts.impact}`);
      if (tags) console.log(`  Tags: ${tags.join(', ')}`);
      if (references) console.log(`  References: ${references.map((r: { url: string }) => r.url).join(', ')}`);
      if (autoLinked && resolvedTaskId) {
        const task = await coordination.getTask(resolvedTaskId);
        console.log(`  Linked to: ${task?.title || resolvedTaskId.slice(0, 8)} (auto-detected)`);
      } else if (!resolvedTaskId) {
        console.log('  (unattached — strategic decision, not linked to a task)');
      }
      if (result.similarity?.hasSimilar && result.similarity.highestScore > 0.5) {
        console.log(`  ⚠ Similar decision exists (${Math.round(result.similarity.highestScore * 100)}% match)`);
        for (const sim of result.similarity.similarDecisions.slice(0, 2)) {
          console.log(`    → "${sim.decision}" (${Math.round(sim.score * 100)}%)`);
        }
      }
      console.log('');
    });

  decisionCmd
    .command('list')
    .description('List logged decisions')
    .option('-t, --task <id>', 'Filter by task ID')
    .option('-c, --category <cat>', 'Filter by category')
    .option('-p, --period <period>', 'Time period: day, week, month, all (default: all)')
    .option('-n, --limit <n>', 'Max decisions to show', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();
      const projectId = await getProjectId();

      const result = await coordination.getDecisions({
        projectId,
        taskId: opts.task,
        category: opts.category,
        period: opts.period || 'all',
        limit: parseInt(opts.limit),
      });

      if (opts.json) {
        console.log(JSON.stringify(result.decisions, null, 2));
      } else {
        console.log(`\nDecisions (${result.decisions.length}):\n`);
        for (const d of result.decisions) {
          const category = d.category ? ` [${d.category}]` : '';
          const date = new Date(d.createdAt).toLocaleDateString();
          console.log(`  ${d.id.slice(0, 8)}${category} - ${date}`);
          console.log(`    "${d.decision}"`);
          if (d.rationale) console.log(`    Rationale: ${d.rationale}`);
          if (d.impact) console.log(`    Impact: ${d.impact}`);
          if (d.taskId) console.log(`    Task: ${d.taskId.slice(0, 8)}`);
          console.log('');
        }
      }
    });

  decisionCmd
    .command('show <id>')
    .description('Show details of a specific decision')
    .action(async (id: string) => {
      await coordination.initialize();

      // Support partial IDs - first try direct lookup
      let decisionResult = await coordination.getDecision(id);

      if (!decisionResult.success) {
        // Try partial ID match by listing recent decisions
        const listResult = await coordination.getDecisions({ limit: 100 });
        const match = listResult.decisions.find(d => d.id.startsWith(id));
        if (match) {
          decisionResult = await coordination.getDecision(match.id);
        }
      }

      if (!decisionResult.success || !decisionResult.decision) {
        console.error(`Decision not found: ${id}`);
        process.exit(1);
      }

      const decision = decisionResult.decision;
      console.log('\nDecision Details:\n');
      console.log(`  ID: ${decision.id}`);
      console.log(`  Decision: ${decision.decision}`);
      if (decision.rationale) console.log(`  Rationale: ${decision.rationale}`);
      if (decision.impact) console.log(`  Impact: ${decision.impact}`);
      if (decision.category) console.log(`  Category: ${decision.category}`);
      if (decision.taskId) console.log(`  Task: ${decision.taskId}`);
      console.log(`  Created: ${new Date(decision.createdAt).toLocaleString()}`);
      console.log('');
    });
}
