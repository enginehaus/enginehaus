/**
 * Info/status CLI commands: status, map, briefing, stats, validate, health, metrics
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { CliContext } from '../cli-context.js';
import { renderTaskGraph, generateBriefing, formatBriefing, GraphView } from '../../visualization/task-graph.js';
import { expandPath } from '../../utils/paths.js';

export function registerInfoCommands(program: Command, ctx: CliContext): void {
  const { coordination, storage, resolveProject } = ctx;

  // ==========================================================================
  // Status Command
  // ==========================================================================

  program
    .command('status')
    .description('Show current working context')
    .action(async () => {
      await coordination.initialize();

      const project = await resolveProject();

      console.log('\n\u{1f4cd} Current Status\n');

      // Project info
      console.log(`Project: ${project?.name || 'none'} (${project?.slug || '-'})`);
      if (project?.rootPath) {
        console.log(`Path: ${project.rootPath}`);
      }

      // Git info
      if (project?.rootPath) {
        const repoPath = project.rootPath.startsWith('~')
          ? path.join(os.homedir(), project.rootPath.slice(2))
          : project.rootPath;

        try {
          const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoPath, encoding: 'utf8' }).trim();
          console.log(`Branch: ${branch}`);

          const statusOutput = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8' }).trim();
          const changedFiles = statusOutput.split('\n').filter(l => l.length > 0).length;
          if (changedFiles > 0) {
            console.log(`Uncommitted: ${changedFiles} files`);
          } else {
            console.log('Working tree: clean');
          }
        } catch {
          console.log('Git: not a repository');
        }
      }

      // Get projectId for filtering
      const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';

      const statusSummary = await coordination.getProjectStatusSummary(projectId);
      console.log('');
      if (statusSummary.inProgressTasks.length > 0) {
        console.log('\u{1f528} In Progress:');
        statusSummary.inProgressTasks.forEach((t: any) => {
          console.log(`  [${t.priority.toUpperCase()}] ${t.title}`);
          console.log(`    ID: ${t.id.slice(0, 8)}...`);
        });
      } else {
        console.log('No tasks in progress.');
      }

      console.log('');
      console.log(`Ready tasks: ${statusSummary.readyCount}`);
      if (statusSummary.criticalCount > 0) {
        console.log(`  \u26a0\ufe0f  ${statusSummary.criticalCount} critical`);
      }
      if (statusSummary.highCount > 0) {
        console.log(`  \u26a1 ${statusSummary.highCount} high priority`);
      }
      console.log('');
    });

  // ==========================================================================
  // Map Command (Visual Task Graph)
  // ==========================================================================

  program
    .command('map')
    .description('Visual task map with dependency graph')
    .option('-v, --view <view>', 'View mode: developer, lead, session, full (default: developer)', 'developer')
    .option('-d, --depth <n>', 'Max dependency depth for full view', '3')
    .option('--no-color', 'Disable colored output')
    .action(async (opts) => {
      await coordination.initialize();

      const project = await resolveProject();
      const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';
      const tasks = await coordination.getTasks({ projectId });

      if (tasks.length === 0) {
        console.log(`\nNo tasks found${project ? ` for ${project.name}` : ''}.\n`);
        return;
      }

      const view = opts.view as GraphView;
      const graph = renderTaskGraph(tasks, {
        view,
        maxDepth: parseInt(opts.depth, 10),
      });

      console.log(`\n${project?.name || 'Tasks'} - ${view} view\n`);
      console.log(graph);
    });

  // ==========================================================================
  // Briefing Command
  // ==========================================================================

  program
    .command('whatchanged')
    .description('Show what changed since a given time — completed tasks, new tasks, decisions')
    .option('--since <time>', 'Duration or ISO datetime (e.g., "2h", "1d", "2026-03-08"). Default: 24h')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();
      const project = await resolveProject();

      // Parse since
      let since: Date;
      if (!opts.since) {
        since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      } else {
        const match = opts.since.match(/^(\d+)(m|h|d)$/);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2];
          const ms = unit === 'm' ? amount * 60000 : unit === 'h' ? amount * 3600000 : amount * 86400000;
          since = new Date(Date.now() - ms);
        } else {
          since = new Date(opts.since);
          if (isNaN(since.getTime())) {
            console.error(`Invalid time: ${opts.since}. Use "2h", "1d", or an ISO datetime.`);
            return;
          }
        }
      }

      const result = await coordination.getChangeSummary(since, project?.id);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const BOLD = '\x1b[1m';
        const RESET = '\x1b[0m';
        const DIM = '\x1b[2m';
        const GREEN = '\x1b[32m';
        const YELLOW = '\x1b[33m';
        const CYAN = '\x1b[36m';

        console.log(`\n${BOLD}═══ WHAT CHANGED ═══${RESET}`);
        console.log(`${DIM}Since ${since.toLocaleString()}${RESET}\n`);

        if (result.completedTasks.length > 0) {
          console.log(`${GREEN}${result.completedTasks.length} task(s) completed:${RESET}`);
          for (const t of result.completedTasks.slice(0, 10)) {
            console.log(`  ✓ ${t.title}${t.summary ? `\n    ${DIM}${t.summary.slice(0, 80)}${RESET}` : ''}`);
          }
          console.log('');
        }

        if (result.newTasks.length > 0) {
          console.log(`${CYAN}${result.newTasks.length} new task(s):${RESET}`);
          for (const t of result.newTasks.slice(0, 10)) {
            console.log(`  + [${t.priority}] ${t.title}`);
          }
          console.log('');
        }

        if (result.decisions.length > 0) {
          console.log(`${YELLOW}${result.decisions.length} decision(s) logged:${RESET}`);
          for (const d of result.decisions.slice(0, 10)) {
            console.log(`  • ${d.decision.slice(0, 80)}${d.decision.length > 80 ? '...' : ''}`);
          }
          console.log('');
        }

        if (result.completedTasks.length === 0 && result.newTasks.length === 0 && result.decisions.length === 0) {
          console.log('No changes in this period.\n');
        }
      }
    });

  program
    .command('briefing')
    .description('Quick project briefing with recommendations and learning engine insights')
    .option('-f, --focus <area>', 'Focus area (e.g., performance, security)')
    .option('--no-insights', 'Skip learning engine insights')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();

      const project = await resolveProject();
      const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';
      const tasks = await coordination.getTasks({ projectId });
      const strategicDecisions = await coordination.getDecisionsForBriefing(projectId);

      // Build per-task decision map for top ready tasks
      const readyTasks = tasks
        .filter(t => t.status === 'ready' || t.status === 'in-progress')
        .slice(0, 10);
      const taskDecisions = new Map<string, Array<{ decision: string; category?: string }>>();
      for (const task of readyTasks) {
        try {
          const result = await coordination.getDecisions({ taskId: task.id, limit: 3 });
          if (result.decisions.length > 0) {
            taskDecisions.set(task.id, result.decisions.map(d => ({
              decision: d.decision,
              category: d.category,
            })));
          }
        } catch {
          // Non-critical — skip
        }
      }

      const briefing = generateBriefing(tasks, strategicDecisions, { focus: opts.focus, taskDecisions });

      // Generate learning engine insights (unless --no-insights)
      let insights = null;
      if (opts.insights !== false) {
        try {
          insights = await coordination.generateBriefingInsights();
        } catch {
          // Insights are non-critical — don't break the briefing
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({ ...briefing, insights }, null, 2));
      } else {
        console.log(`\n${formatBriefing(briefing)}`);
        if (insights) {
          const insightText = coordination.formatBriefingInsights(insights);
          if (insightText) {
            console.log(insightText);
          }
        }

        // Stale branch detection
        try {
          const { findStaleBranches } = await import('../../git/git-analysis.js');
          const rootPath = project?.rootPath ? expandPath(project.rootPath) : process.cwd();
          const staleBranches = await findStaleBranches(rootPath, { staleDays: 14 });
          if (staleBranches.length > 0) {
            const merged = staleBranches.filter(b => b.isMerged).length;
            const unmerged = staleBranches.length - merged;
            console.log(`\x1b[1m\u2550\u2550\u2550 STALE BRANCHES \u2550\u2550\u2550\x1b[0m\n`);
            console.log(`  ${staleBranches.length} stale branch(es) (${merged} merged, ${unmerged} unmerged)\n`);
            for (const b of staleBranches.slice(0, 5)) {
              const icon = b.isMerged ? '\x1b[32m\u2713\x1b[0m' : '\x1b[33m!\x1b[0m';
              const branchStatus = b.isMerged ? 'merged' : 'unmerged';
              console.log(`  ${icon} ${b.name.slice(0, 60)} \x1b[2m(${b.daysSinceLastCommit}d, ${branchStatus})\x1b[0m`);
            }
            if (staleBranches.length > 5) {
              console.log(`  \x1b[2m... and ${staleBranches.length - 5} more\x1b[0m`);
            }
            if (merged > 0) {
              console.log(`\n  \x1b[2mClean up merged: enginehaus branch cleanup\x1b[0m`);
            }
            console.log('');
          }
        } catch {
          // Non-critical — don't break the briefing
        }

        // Tool error summary (last 7 days)
        try {
          if (storage) {
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const errorEvents = await storage.queryAuditLog({
              eventTypes: ['error.tool_failed'],
              startTime: weekAgo,
              limit: 500,
            });

            if (errorEvents.length > 0) {
              // Aggregate by tool
              const byTool: Record<string, number> = {};
              for (const evt of errorEvents) {
                byTool[evt.resourceId] = (byTool[evt.resourceId] || 0) + 1;
              }
              const sorted = Object.entries(byTool).sort((a, b) => b[1] - a[1]);
              const summary = sorted.slice(0, 5).map(([tool, count]) => `${tool} (${count})`).join(', ');

              console.log(`\x1b[1m\u2550\u2550\u2550 TOOL ERRORS (last 7 days) \u2550\u2550\u2550\x1b[0m\n`);
              console.log(`  \x1b[33m\u26a0\x1b[0m ${errorEvents.length} error(s): ${summary}`);
              console.log(`  \x1b[2mDetails: enginehaus errors --period week\x1b[0m`);
              console.log('');
            }
          }
        } catch {
          // Non-critical — don't break the briefing
        }
      }
    });

  // ==========================================================================
  // Stats Command
  // ==========================================================================

  program
    .command('stats')
    .description('Show coordination statistics')
    .option('--all-projects', 'Show stats for all projects, not just detected/active project')
    .action(async (opts) => {
      await coordination.initialize();

      const project = opts.allProjects ? null : await resolveProject();
      const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';

      const stats = await coordination.getTaskStats({
        projectId,
        allProjects: opts.allProjects,
      });

      console.log('\n\u{1f4ca} Enginehaus Statistics\n');
      console.log(`Project: ${project?.name || 'all projects'} (${project?.slug || '-'})`);
      console.log(`Total Projects: ${stats.projectCount}`);
      console.log('');
      console.log('Tasks:');
      console.log(`  Ready:       ${stats.tasks.ready}`);
      console.log(`  In Progress: ${stats.tasks.inProgress}`);
      console.log(`  Completed:   ${stats.tasks.completed}`);
      console.log(`  Blocked:     ${stats.tasks.blocked}`);
      console.log(`  Total:       ${stats.tasks.total}`);
      console.log('');

      if (stats.attention.critical > 0 || stats.attention.high > 0) {
        console.log('\u26a0\ufe0f  Attention needed:');
        if (stats.attention.critical > 0) console.log(`  ${stats.attention.critical} critical priority tasks`);
        if (stats.attention.high > 0) console.log(`  ${stats.attention.high} high priority tasks`);
        console.log('');
      }
    });

  // ==========================================================================
  // Validate Command (CI/CD Integration)
  // ==========================================================================

  program
    .command('validate')
    .description('Run quality validation for CI/CD pipelines')
    .option('-f, --format <format>', 'Output format: github, junit, json (default: github)', 'github')
    .option('--fail-on-critical', 'Only fail on critical issues (default: fail on any issue)')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .option('--standalone', 'Run without enginehaus database (uses current directory)')
    .action(async (opts) => {
      let repoPath: string;
      let projectName: string;

      // In standalone mode or CI, use current directory without database
      const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
      if (opts.standalone || isCI) {
        repoPath = process.cwd();
        projectName = path.basename(repoPath);
      } else {
        await coordination.initialize();
        const project = await resolveProject();
        if (!project) {
          console.error('No project detected. Run from a project directory, set active project, or use --standalone.');
          process.exit(1);
        }
        repoPath = project.rootPath.startsWith('~')
          ? path.join(os.homedir(), project.rootPath.slice(2))
          : project.rootPath;
        projectName = project.name;
      }

      // Import QualityService dynamically
      const { QualityService } = await import('../../quality/quality-service.js');
      const qualityService = new QualityService(repoPath);

      // Map format option to internal format
      const formatMap: Record<string, 'github-annotations' | 'junit-xml' | 'json'> = {
        'github': 'github-annotations',
        'junit': 'junit-xml',
        'json': 'json',
      };

      const outputFormat = formatMap[opts.format] || 'github-annotations';

      console.error(`\n\u{1f50d} Running quality validation for ${projectName}...\n`);

      const result = await qualityService.validateForCI({
        outputFormat,
        failOnCritical: opts.failOnCritical || false,
      });

      // Output the formatted result
      if (opts.output) {
        const fs = await import('fs/promises');
        await fs.writeFile(opts.output, result.formatted);
        console.error(`Output written to: ${opts.output}`);
      } else {
        console.log(result.formatted);
      }

      // Print summary to stderr so it doesn't interfere with piped output
      console.error('');
      console.error(`${result.passed ? '\u2705' : '\u274c'} ${result.summary}`);
      console.error(`  Total: ${result.metrics.total} | Critical: ${result.metrics.critical} | Errors: ${result.metrics.errors} | Warnings: ${result.metrics.warnings}`);
      console.error('');

      process.exit(result.exitCode);
    });

  // ==========================================================================
  // Health Command
  // ==========================================================================

  program
    .command('health')
    .description('Run session health check and cleanup stale sessions')
    .option('--timeout <ms>', 'Session timeout in milliseconds (default: 300000 = 5 minutes)', '300000')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();

      // Import health checker
      const { SessionHealthChecker } = await import('../../coordination/health-check.js');

      if (!storage) {
        console.error('Health command requires storage access.');
        process.exit(1);
      }

      const healthChecker = new SessionHealthChecker(storage, {
        checkIntervalMs: 0, // Not used for manual check
        sessionTimeoutMs: parseInt(opts.timeout, 10),
        verbose: false,
      });

      console.error('\n\u{1f3e5} Running session health check...\n');

      const result = await healthChecker.runCheck();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Health Check Results:');
        console.log(`  Timestamp: ${result.timestamp.toISOString()}`);
        console.log(`  Active Sessions: ${result.activeSessions}`);
        console.log(`  Expired Sessions: ${result.expiredSessions}`);
        console.log(`  Healthy Projects: ${result.healthyProjects}`);

        if (result.issues.length > 0) {
          console.log('\n\u26a0\ufe0f  Issues:');
          result.issues.forEach(issue => {
            console.log(`    - ${issue}`);
          });
        } else {
          console.log('\n\u2705 No issues found.');
        }

        if (result.expiredSessions > 0) {
          console.log(`\n\u{1f9f9} Cleaned up ${result.expiredSessions} stale session(s).`);
        }
      }
      console.log('');
    });

  // ==========================================================================
  // Metrics Command
  // ==========================================================================

  program
    .command('metrics')
    .description('Show coordination effectiveness metrics')
    .option('-p, --period <period>', 'Time period: day, week, month (default: week)', 'week')
    .option('--json', 'Output as JSON')
    .option('--all-projects', 'Show metrics for all projects')
    .option('--by-agent', 'Show metrics breakdown by agent')
    .action(async (opts) => {
      await coordination.initialize();

      const project = opts.allProjects ? null : await resolveProject();

      // Calculate since date based on period
      const now = Date.now();
      let sinceMs: number;
      switch (opts.period) {
        case 'day':
          sinceMs = now - 24 * 60 * 60 * 1000;
          break;
        case 'month':
          sinceMs = now - 30 * 24 * 60 * 60 * 1000;
          break;
        case 'week':
        default:
          sinceMs = now - 7 * 24 * 60 * 60 * 1000;
      }
      const since = new Date(sinceMs);

      // Handle --by-agent option
      if (opts.byAgent) {
        const agentMetrics = await coordination.getMetricsByAgent({
          projectId: project?.id,
          since,
        });

        if (opts.json) {
          console.log(JSON.stringify({ agents: agentMetrics, period: opts.period, project: project?.name || 'all' }, null, 2));
        } else {
          console.log(`\n\u{1f4ca} Metrics by Agent - Last ${opts.period}${project ? ` (${project.name})` : ' (all projects)'}:\n`);

          if (agentMetrics.length === 0) {
            console.log('  No agent-attributed metrics found.\n');
            console.log('  (Note: Earlier events may not have agentId logged)');
          } else {
            for (const agent of agentMetrics) {
              console.log(`  ${agent.agentId}:`);
              console.log(`    Tasks claimed: ${agent.tasksClaimed}`);
              console.log(`    Tasks completed: ${agent.tasksCompleted}`);
              console.log(`    Sessions: ${agent.sessionsStarted}`);
              console.log('');
            }
          }
        }
        return;
      }

      const metrics = await coordination.getEffectivenessMetrics({
        projectId: project?.id,
        since,
      });

      if (opts.json) {
        console.log(JSON.stringify({ ...metrics, period: opts.period, project: project?.name || 'all' }, null, 2));
      } else {
        console.log(`\n\u{1f4ca} Metrics - Last ${opts.period}${project ? ` (${project.name})` : ' (all projects)'}:\n`);

        console.log(`  Tasks completed: ${metrics.tasksCompleted}`);
        console.log(`  Tasks abandoned: ${metrics.tasksAbandoned}`);

        if (metrics.avgCycleTimeMs !== null) {
          const avgMinutes = Math.round(metrics.avgCycleTimeMs / 60000);
          console.log(`  Avg cycle time: ${avgMinutes} min`);
        } else {
          console.log('  Avg cycle time: N/A');
        }

        console.log(`  Context expansions: ${metrics.contextExpansions} (${Math.round(metrics.contextExpansionRate * 100)}% of task fetches)`);
        console.log(`  Sessions: ${metrics.sessions}, avg ${metrics.avgTasksPerSession.toFixed(1)} tasks/session`);
        console.log(`  Completion rate: ${Math.round(metrics.completionRate * 100)}%`);
        console.log(`  Quality gate pass rate: ${Math.round(metrics.qualityGatePassRate * 100)}%`);

        // Token efficiency - shows whether minimal context was sufficient
        const te = metrics.tokenEfficiency;
        if (te.minimalFetches > 0 || te.fullFetches > 0) {
          console.log('');
          console.log('  \u{1f4ca} Token Efficiency:');
          console.log(`    Minimal fetches: ${te.minimalFetches}`);
          if (te.minimalFetches > 0) {
            const sufficientPct = te.minimalFetches > 0
              ? Math.round((te.minimalSufficient / te.minimalFetches) * 100)
              : 0;
            const expandedPct = 100 - sufficientPct;
            console.log(`      \u2192 Sufficient (no expand): ${te.minimalSufficient} (${sufficientPct}%)`);
            console.log(`      \u2192 Needed expansion: ${te.minimalExpanded} (${expandedPct}%)`);
          }
          console.log(`    Full fetches: ${te.fullFetches}`);
          if (te.estimatedTokensSaved > 0) {
            const formattedTokens = te.estimatedTokensSaved >= 1000
              ? `~${(te.estimatedTokensSaved / 1000).toFixed(1)}K`
              : `~${te.estimatedTokensSaved}`;
            console.log(`    Estimated savings (heuristic): ${formattedTokens} tokens`);
          }
          console.log(`    Efficiency rate: ${te.efficiencyRate}%`);
        }
        console.log('');
      }
    });
}
