/**
 * Analytics & cross-project learning CLI commands: analytics, analyze
 */

import { Command } from 'commander';
import { CliContext } from '../cli-context.js';

export function registerAnalyticsCommands(program: Command, ctx: CliContext): void {
  const { coordination, storage, resolveProject, registerCommand } = ctx;

  // ── Agent-help specs ────────────────────────────────────────────────────

  registerCommand({
    command: 'analytics',
    description: 'Show outcome-based analytics that measure actual value delivered',
    example: 'enginehaus analytics',
    altExamples: [
      'enginehaus analytics --dashboard',
      'enginehaus analytics -p month --json',
    ],
    args: [],
    options: [
      { flags: '-p, --period <period>', description: 'Time period: day, week, month (default: week)', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
      { flags: '--dashboard', description: 'Show value dashboard with insights and recommendations', required: false },
    ],
  });

  registerCommand({
    command: 'analyze',
    description: 'Cross-project learning analysis — surfaces patterns and recommendations',
    example: 'enginehaus analyze recommendations',
    altExamples: [
      'enginehaus analyze decisions',
      'enginehaus analyze friction -p 7',
      'enginehaus analyze quality --json',
      'enginehaus analyze worldview',
    ],
    args: [
      { name: 'view', required: false, description: 'Analysis view: decisions, friction, quality, recommendations, worldview (default: recommendations)' },
    ],
    options: [
      { flags: '-p, --period <days>', description: 'Lookback period in days (default: 30)', required: false },
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Analytics Command (Outcome-Based)
  // ════════════════════════════════════════════════════════════════════════

  program
    .command('analytics')
    .description('Show outcome-based analytics that measure actual value delivered')
    .option('-p, --period <period>', 'Time period: day, week, month (default: week)', 'week')
    .option('--json', 'Output as JSON')
    .option('--dashboard', 'Show value dashboard with insights and recommendations')
    .action(async (opts) => {
      await coordination.initialize();

      const project = await resolveProject();
      if (!project) {
        console.error('\n❌ No project found. Set an active project or run from a project directory.\n');
        process.exit(1);
      }

      if (opts.dashboard) {
        // Show value dashboard
        const result = await coordination.getValueDashboard({
          period: opts.period as 'day' | 'week' | 'month',
          projectId: project.id,
          includeTrends: true,
        });

        if (!result.success || !result.dashboard) {
          console.error(`\n❌ ${result.error}\n`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.dashboard, null, 2));
        } else {
          const d = result.dashboard;
          console.log(`\n📊 Value Dashboard - ${d.period} (${project.name}):\n`);

          console.log('  Summary:');
          console.log(`    Tokens saved (heuristic): ~${d.summary.tokensEstimatedSaved.toLocaleString()}`);
          console.log(`    First-attempt success: ${d.summary.firstAttemptSuccessRate}`);
          console.log(`    Quality gate pass rate: ${d.summary.qualityGatePassRate}`);
          console.log(`    Productivity rating: ${d.summary.avgProductivityRating}`);

          if (d.insights.length > 0) {
            console.log('\n  Insights:');
            for (const insight of d.insights) {
              const icon = insight.type === 'positive' ? '✅' : insight.type === 'negative' ? '⚠️' : 'ℹ️';
              console.log(`    ${icon} ${insight.title}`);
              console.log(`       ${insight.description}`);
              if (insight.recommendation) {
                console.log(`       → ${insight.recommendation}`);
              }
            }
          }

          console.log('\n  Limitations:');
          for (const limit of d.limitations) {
            console.log(`    • ${limit}`);
          }
          console.log('');
        }
      } else {
        // Show outcome metrics
        const result = await coordination.getOutcomeMetrics({
          period: opts.period as 'day' | 'week' | 'month',
          projectId: project.id,
        });

        if (!result.success || !result.metrics) {
          console.error(`\n❌ ${result.error}\n`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.metrics, null, 2));
        } else {
          const m = result.metrics;
          console.log(`\n📊 Outcome Analytics - ${m.period.label} (${project.name}):\n`);

          console.log('  Token Efficiency:');
          console.log(`    Minimal context fetches: ${m.tokenEfficiency.minimalContextFetches}`);
          console.log(`    Full context fetches: ${m.tokenEfficiency.fullContextFetches}`);
          console.log(`    Minimal sufficiency rate: ${m.tokenEfficiency.minimalSufficiencyRate}`);
          console.log(`    Estimated tokens saved (heuristic): ~${m.tokenEfficiency.estimatedTokensSaved.toLocaleString()}`);
          console.log(`    Avg tool calls/task: ${m.tokenEfficiency.avgToolCallsPerTask}`);
          console.log(`    Avg sessions/task: ${m.tokenEfficiency.avgSessionsPerTask}`);

          console.log('\n  Human Time:');
          console.log(`    Avg cycle time: ${m.humanTime.avgCycleTime}`);
          console.log(`    Avg session duration: ${m.humanTime.avgSessionDuration}`);
          console.log(`    Tasks/session: ${m.humanTime.avgTasksPerSession}`);
          console.log(`    Task reopening rate: ${m.humanTime.taskReopeningRate}`);
          console.log(`    Multi-session rate: ${m.humanTime.multiSessionTaskRate}`);
          console.log(`    Productivity rating: ${m.humanTime.avgProductivityRating}`);
          console.log(`    Top friction: ${m.humanTime.topFriction.join(', ')}`);

          console.log('\n  Quality Outcomes:');
          console.log(`    Quality gate pass: ${m.qualityOutcomes.qualityGatePassRate}`);
          console.log(`    First-attempt success: ${m.qualityOutcomes.firstAttemptSuccessRate}`);
          console.log(`    Rework rate: ${m.qualityOutcomes.reworkRate}`);
          console.log(`    Artifacts/task: ${m.qualityOutcomes.artifactCreationRate}`);
          console.log(`    Decisions/task: ${m.qualityOutcomes.decisionLoggingRate}`);
          console.log(`    Completion rate: ${m.qualityOutcomes.completionRate}`);
          console.log(`    Abandonment rate: ${m.qualityOutcomes.abandonmentRate}`);

          console.log('\n  Raw Counts:');
          console.log(`    Completed: ${m.rawCounts.tasksCompleted} | Abandoned: ${m.rawCounts.tasksAbandoned} | Claimed: ${m.rawCounts.tasksClaimed}`);
          console.log(`    Reopened: ${m.rawCounts.tasksReopened} | Sessions: ${m.rawCounts.sessions}`);
          console.log(`    Artifacts: ${m.rawCounts.artifacts} | Decisions: ${m.rawCounts.decisions}`);

          if ((m as any).cycleTimeTrend) {
            const trend = (m as any).cycleTimeTrend;
            const icon = trend.direction === 'improving' ? '↓' :
                         trend.direction === 'declining' ? '↑' :
                         trend.direction === 'stable' ? '→' : '?';
            console.log('\n  Cycle Time Trend:');
            if (trend.direction === 'insufficient_data') {
              console.log('    Insufficient data for comparison');
            } else {
              const formatMs = (ms: number | null) => ms !== null
                ? ms < 60000 ? `${Math.round(ms / 1000)}s`
                  : ms < 3600000 ? `${Math.round(ms / 60000)}m`
                    : `${(ms / 3600000).toFixed(1)}h`
                : 'N/A';
              console.log(`    ${icon} ${trend.direction} (${trend.changePercent !== null ? `${trend.changePercent > 0 ? '+' : ''}${trend.changePercent}%` : 'N/A'})`);
              console.log(`    Current avg: ${formatMs(trend.currentAvgMs)} | Previous avg: ${formatMs(trend.previousAvgMs)}`);
            }
          }
          console.log('');
        }
      }
    });

  // ════════════════════════════════════════════════════════════════════════
  // Cross-Project Learning Analysis
  // ════════════════════════════════════════════════════════════════════════

  program
    .command('analyze')
    .description('Cross-project learning analysis — surfaces patterns and recommendations from all project data')
    .argument('[view]', 'Analysis view: decisions, friction, quality, recommendations, worldview (default: recommendations)', 'recommendations')
    .option('-p, --period <days>', 'Lookback period in days (default: 30)', '30')
    .option('--json', 'Output as JSON')
    .action(async (view: string, opts: { period: string; json?: boolean }) => {
      await coordination.initialize();

      const sinceDays = parseInt(opts.period, 10);
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

      if (view === 'decisions') {
        const patterns = await coordination.analyzeDecisionPatterns({ since });

        if (opts.json) {
          console.log(JSON.stringify(patterns, null, 2));
          return;
        }

        console.log(`\n🧠 Decision Patterns (last ${sinceDays} days):\n`);
        if (patterns.length === 0) {
          console.log('  No decisions found. Use log_decision to capture architectural choices.\n');
          return;
        }

        for (const p of patterns) {
          const projectStr = p.projects.length === 1 ? '1 project' : `${p.projects.length} projects`;
          const workaroundStr = p.workaroundSignals > 0 ? ` ⚠️ ${p.workaroundSignals} workarounds` : '';
          console.log(`  ${p.category}: ${p.count} decisions across ${projectStr}${workaroundStr}`);
          for (const ex of p.recentExamples.slice(0, 2)) {
            console.log(`    • "${ex.decision}"`);
            if (ex.rationale) console.log(`      → ${ex.rationale}`);
          }
          console.log('');
        }

      } else if (view === 'friction') {
        const friction = await coordination.analyzeFrictionPatterns({ since });

        if (opts.json) {
          console.log(JSON.stringify(friction, null, 2));
          return;
        }

        console.log(`\n🔧 Friction Analysis (last ${sinceDays} days):\n`);
        if (friction.totalFeedback === 0) {
          console.log('  No session feedback found. Use the feedback command to log friction.\n');
          return;
        }

        console.log(`  Total feedback entries: ${friction.totalFeedback}`);
        if (friction.avgProductivityRating !== null) {
          console.log(`  Average productivity: ${friction.avgProductivityRating.toFixed(1)}/5`);
        }
        console.log('');

        if (friction.topFriction.length > 0) {
          console.log('  Top friction sources:');
          for (const f of friction.topFriction) {
            const bar = '█'.repeat(Math.max(1, Math.round(f.percentage / 5)));
            console.log(`    ${f.tag.padEnd(22)} ${bar} ${f.count} (${f.percentage}%)`);
          }
          console.log('');
        }

        const projectIds = Object.keys(friction.projectBreakdown);
        if (projectIds.length > 1) {
          console.log('  Per-project breakdown:');
          for (const [pid, pd] of Object.entries(friction.projectBreakdown)) {
            const rating = pd.avgRating !== null ? ` rating: ${pd.avgRating.toFixed(1)}` : '';
            const topTag = pd.topTag ? ` top friction: ${pd.topTag}` : '';
            console.log(`    ${pid.slice(0, 8)}... ${pd.feedbackCount} entries${rating}${topTag}`);
          }
          console.log('');
        }

      } else if (view === 'quality') {
        const quality = await coordination.analyzeQualityTrends({ since });

        if (opts.json) {
          console.log(JSON.stringify(quality, null, 2));
          return;
        }

        console.log(`\n✅ Quality Trends (last ${sinceDays} days):\n`);
        console.log(`  Gate pass rate: ${(quality.gatePassRate * 100).toFixed(0)}% (${quality.totalGateEvents} events)`);
        if (quality.failureBreakdown && Object.keys(quality.failureBreakdown).length > 0) {
          const sorted = Object.entries(quality.failureBreakdown).sort(([, a], [, b]) => b - a);
          console.log(`  Failure breakdown:`);
          for (const [reason, count] of sorted) {
            console.log(`    ${reason}: ${count}`);
          }
        }
        console.log(`  Ship rate: ${(quality.shipRate * 100).toFixed(0)}%`);
        console.log(`  Rework rate: ${(quality.reworkRate * 100).toFixed(0)}%`);
        console.log(`  Decisions logged: ${quality.decisionLoggingRate}`);
        console.log('');

        if (quality.projectComparison.length > 0) {
          console.log('  Project comparison:');
          console.log('    Project'.padEnd(30) + 'Gate Pass'.padEnd(12) + 'Decisions'.padEnd(12) + 'Completion');
          console.log('    ' + '─'.repeat(60));
          for (const pc of quality.projectComparison) {
            const name = pc.projectName.length > 26 ? pc.projectName.slice(0, 23) + '...' : pc.projectName;
            console.log(
              '    ' + name.padEnd(26) +
              `${(pc.gatePassRate * 100).toFixed(0)}%`.padEnd(12) +
              `${pc.decisionRate.toFixed(1)}/task`.padEnd(12) +
              `${(pc.completionRate * 100).toFixed(0)}%`
            );
          }
          console.log('');
        }

      } else if (view === 'recommendations') {
        const recommendations = await coordination.generateRecommendations({ since });

        if (opts.json) {
          console.log(JSON.stringify(recommendations, null, 2));
          return;
        }

        console.log(`\n💡 Recommendations (last ${sinceDays} days):\n`);
        if (recommendations.length === 0) {
          console.log('  No recommendations — keep up the good work!\n');
          return;
        }

        for (const r of recommendations) {
          const icon = r.priority === 'high' ? '🔴' : r.priority === 'medium' ? '🟡' : '🟢';
          const typeLabel = r.type.replace(/_/g, ' ');
          console.log(`  ${icon} [${typeLabel}] ${r.title}`);
          console.log(`     ${r.description}`);
          console.log(`     Evidence: ${r.evidence}`);
          console.log('');
        }

      } else if (view === 'worldview') {
        const worldview = await coordination.generateWorldview({ since });

        if (opts.json) {
          console.log(JSON.stringify(worldview, null, 2));
          return;
        }

        const healthIcon = worldview.health === 'healthy' ? '🟢' :
                            worldview.health === 'needs_attention' ? '🟡' : '🔴';

        console.log(`\n🌍 Organizational Worldview (last ${sinceDays} days):\n`);
        console.log(`  Health: ${healthIcon} ${worldview.health}`);
        for (const reason of worldview.healthReasons) {
          console.log(`    • ${reason}`);
        }
        console.log('');

        console.log('  Scope:');
        console.log(`    Projects: ${worldview.projectCount} | Tasks: ${worldview.totalTasks} | Decisions: ${worldview.totalDecisions} | Initiatives: ${worldview.totalInitiatives}`);
        console.log('');

        // Decision patterns summary
        if (worldview.decisionPatterns.length > 0) {
          console.log('  Decision patterns:');
          for (const p of worldview.decisionPatterns.slice(0, 5)) {
            const workaround = p.workaroundSignals > 0 ? ` (⚠️ ${p.workaroundSignals} workarounds)` : '';
            console.log(`    ${p.category}: ${p.count} across ${p.projects.length} project(s)${workaround}`);
          }
          console.log('');
        }

        // Initiative learnings
        if (worldview.initiatives.totalInitiatives > 0) {
          console.log(`  Initiatives: ${(worldview.initiatives.successRate * 100).toFixed(0)}% success rate (${worldview.initiatives.totalInitiatives} total)`);
          for (const pattern of worldview.initiatives.patterns) {
            console.log(`    • ${pattern}`);
          }
          console.log('');
        }

        // Top recommendations
        if (worldview.recommendations.length > 0) {
          console.log('  Top recommendations:');
          for (const r of worldview.recommendations.slice(0, 3)) {
            const icon = r.priority === 'high' ? '🔴' : r.priority === 'medium' ? '🟡' : '🟢';
            console.log(`    ${icon} ${r.title}`);
          }
          console.log('');
        }

      } else {
        console.error(`\n❌ Unknown view: "${view}". Options: decisions, friction, quality, recommendations, worldview\n`);
        process.exit(1);
      }
    });

  // ════════════════════════════════════════════════════════════════════════
  // Feedback Submission
  // ════════════════════════════════════════════════════════════════════════

  registerCommand({
    command: 'feedback',
    description: 'Submit session feedback (productivity rating, friction tags, notes)',
    example: 'enginehaus feedback -s <session-id> -r 4 -f tool_confusion,slow_response -n "notes"',
    altExamples: [
      'enginehaus feedback -s abc123 -r 5',
      'enginehaus feedback -s abc123 -r 3 -f repeated_context -n "Had to re-explain context twice"',
    ],
    args: [],
    options: [
      { flags: '-s, --session <id>', description: 'Session ID (required)', required: true },
      { flags: '-t, --task <id>', description: 'Associated task ID', required: false },
      { flags: '-r, --rating <1-5>', description: 'Productivity rating (1=very unproductive, 5=very productive)', required: false },
      { flags: '-f, --friction <tags>', description: 'Comma-separated friction tags', required: false },
      { flags: '-n, --notes <text>', description: 'Additional feedback notes', required: false },
    ],
  });

  program
    .command('feedback')
    .description('Submit session feedback (productivity rating, friction tags, notes)')
    .requiredOption('-s, --session <id>', 'Session ID')
    .option('-t, --task <id>', 'Associated task ID')
    .option('-r, --rating <rating>', 'Productivity rating 1-5 (1=very unproductive, 5=very productive)')
    .option('-f, --friction <tags>', 'Comma-separated friction tags: repeated_context, wrong_context, tool_confusion, missing_files, slow_response, unclear_task, dependency_blocked, quality_rework, scope_creep, other')
    .option('-n, --notes <text>', 'Additional feedback notes')
    .action(async (opts: { session: string; task?: string; rating?: string; friction?: string; notes?: string }) => {
      await coordination.initialize();

      const validTags = ['repeated_context', 'wrong_context', 'tool_confusion', 'missing_files', 'slow_response', 'unclear_task', 'dependency_blocked', 'quality_rework', 'scope_creep', 'other'];

      const rating = opts.rating ? parseInt(opts.rating, 10) : undefined;
      if (rating !== undefined && (isNaN(rating) || rating < 1 || rating > 5)) {
        console.error('\n❌ Rating must be between 1 and 5.\n');
        process.exit(1);
      }

      const frictionTags: string[] = opts.friction
        ? opts.friction.split(',').map(t => t.trim()).filter(Boolean)
        : [];

      const invalidTags = frictionTags.filter(t => !validTags.includes(t));
      if (invalidTags.length > 0) {
        console.error(`\n❌ Invalid friction tags: ${invalidTags.join(', ')}`);
        console.error(`   Valid tags: ${validTags.join(', ')}\n`);
        process.exit(1);
      }

      const result = await coordination.submitSessionFeedback({
        sessionId: opts.session,
        taskId: opts.task,
        productivityRating: rating,
        frictionTags,
        notes: opts.notes,
      });

      if (result.success) {
        console.log(`\n✅ Feedback recorded (${result.feedbackId})`);
        if (rating) console.log(`   Productivity: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`);
        if (frictionTags.length > 0) console.log(`   Friction: ${frictionTags.join(', ')}`);
        if (opts.notes) console.log(`   Notes: ${opts.notes}`);
        console.log('');
      } else {
        console.error(`\n❌ ${result.message}\n`);
        process.exit(1);
      }
    });

  // ════════════════════════════════════════════════════════════════════════
  // Metrics Reset
  // ════════════════════════════════════════════════════════════════════════

  program
    .command('metrics-reset')
    .description('Reset quality gate metrics to start with a clean baseline')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (opts: { confirm?: boolean }) => {
      await coordination.initialize();

      const eventTypes = ['quality_gate_passed', 'quality_gate_failed'];

      if (!opts.confirm) {
        console.log('\n⚠️  This will delete all quality_gate_passed and quality_gate_failed metric events.');
        console.log('   Other metrics (sessions, tasks, context) are unaffected.');
        console.log('   Re-run with --confirm to proceed.\n');
        return;
      }

      if (!storage) {
        console.error('\n❌ Storage not available.\n');
        process.exit(1);
      }

      const deleted = await storage.deleteMetricsByType(eventTypes);
      console.log(`\n✅ Reset quality gate metrics: ${deleted} events deleted.`);
      console.log('   Quality gate pass rate will now reflect only new completions.\n');
    });
}
