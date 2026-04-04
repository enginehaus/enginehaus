#!/usr/bin/env node
/**
 * Enginehaus CLI
 *
 * Command-line interface for AI coordination across multiple projects.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * TABLE OF CONTENTS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Section                              Line    Notes
 * ─────────────────────────────────────────────────────────────────────────────
 * Imports & Initialization             ~47     Storage, services, 15 command modules
 * Helper Functions                     ~98     resolveProject, resolveTaskById, etc.
 * Program Setup                        ~230    Version, description, options
 * Agent-Friendly CLI Infrastructure    ~260    --agent-help, error formatting
 * Command Registration                 ~420    All 15 extracted modules registered
 *
 * ── Extracted Commands (see src/bin/commands/) ─────────────────────────────
 * onboarding   (init/instructions/link/uninstall)  → onboarding-commands.ts
 * project      (list/active/init/delete)            → project-commands.ts
 * task         (list/show/add/next/claim/...)       → task-commands.ts
 * info         (status/map/briefing/stats/etc.)     → info-commands.ts
 * analytics    (analytics/analyze)                  → analytics-commands.ts
 * arch         (scan/list/show/health/graph)        → arch-commands.ts
 * initiative   (create/list/show/link/outcome)      → initiative-commands.ts
 * decision     (log/list/show)                      → decision-commands.ts
 * plan         (capture/list)                       → plan-commands.ts
 * handoff      (export/status/context)              → handoff-commands.ts
 * server       (serve/web/errors)                   → server-commands.ts
 * config       (show/set/reset/sync/etc.)           → config-commands.ts
 * setup        (MCP client setup)                   → setup-commands.ts
 * doctor       (diagnostic checks)                  → doctor-commands.ts
 * utility      (hooks/verify/update/update-instr)   → utility-commands.ts
 *
 * ── Inline (remaining) ───────────────────────────────────────────────────
 * help         ~539    Command reference
 * demo         ~593    Context survival demo
 * add/list/next ~606   Top-level shortcuts
 * completion   ~745    Shell completion scripts
 * branch       ~867    Branch lifecycle (stale/cleanup)
 * postAction   ~843    Passive update notification
 * program.parse ~949   Entry point
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Command } from 'commander';
// eslint-disable-next-line no-restricted-imports -- Bootstrap: creates storage instance for CoordinationService
import { SQLiteStorageService } from '../storage/sqlite-storage-service.js';
import { CoordinationService } from '../core/services/coordination-service.js';
import { UnifiedTask, TaskPriority, Project } from '../coordination/types.js';
import { getDataDir } from '../config/paths.js';
import * as os from 'os';
import * as path from 'path';
import { expandPath } from '../utils/paths.js';
import { shouldShowUpdateNotification } from '../utils/version-check.js';
import { getClient } from '../clients/index.js';
import { registerTaskCommands } from './commands/task-commands.js';
import { registerProjectCommands } from './commands/project-commands.js';
import { registerInitiativeCommands } from './commands/initiative-commands.js';
import { registerDecisionCommands } from './commands/decision-commands.js';
import { registerArchCommands } from './commands/arch-commands.js';
import { registerPlanCommands } from './commands/plan-commands.js';
import { registerHandoffCommands } from './commands/handoff-commands.js';
import { registerConfigCommands } from './commands/config-commands.js';
import { registerAnalyticsCommands } from './commands/analytics-commands.js';
import { registerSetupCommands } from './commands/setup-commands.js';
import { registerDoctorCommands } from './commands/doctor-commands.js';
import { registerServerCommands } from './commands/server-commands.js';
import { registerOnboardingCommands } from './commands/onboarding-commands.js';
import { registerInfoCommands } from './commands/info-commands.js';
import { registerUtilityCommands } from './commands/utility-commands.js';
import { registerAuditCommands } from './commands/audit-commands.js';
import { registerCiCommands } from './commands/ci-commands.js';
import { registerToolCommands } from './commands/tool-commands.js';
// Analysis engines are accessed via CoordinationService — not imported directly.
// This prevents behavior divergence between CLI and MCP interfaces.

// Initialize storage and service layer
const dataDir = getDataDir();
const storage = new SQLiteStorageService(dataDir);
const coordination = new CoordinationService(storage);

/**
 * Resolve which project to use for a command.
 * Priority: cwd auto-detection > explicit active project > null.
 *
 * If you're inside a project directory, that project wins.
 * Falls back to `project active <slug>` if cwd doesn't match any project.
 */
async function resolveProject(): Promise<Project | null> {
  // 1. cwd-based detection takes priority — if you're in a project directory, use that project
  const cwd = process.cwd();
  const projects = await coordination.listProjects();

  const cwdMatch = projects.find(p => {
    const rootPath = expandPath(p.rootPath);
    return cwd === rootPath || cwd.startsWith(rootPath + path.sep);
  });

  if (cwdMatch) {
    return cwdMatch;
  }

  // 2. Fall back to explicit active project when cwd doesn't match any project
  const active = await coordination.getActiveProject();
  if (active) {
    return active;
  }

  return null;
}

/**
 * Get the project ID to use for queries, auto-detecting from cwd first.
 */
async function getProjectId(): Promise<string> {
  const project = await resolveProject();
  if (project?.id) return project.id;
  const activeProject = await coordination.getActiveProject();
  return activeProject?.id || 'default';
}

/**
 * Resolve a partial task ID to a full task.
 * Uses CoordinationService for consistent access patterns.
 */
async function resolveTaskById(taskId: string, projectId?: string): Promise<UnifiedTask | null> {
  // Try exact match first — if the user gave us a full UUID, trust them
  const exact = await coordination.getTask(taskId);
  if (exact) return exact;

  // Try partial match — prefer current project, fall back to all projects
  const projectTasks = await coordination.getTasks({ projectId });
  const projectMatches = projectTasks.filter(t => t.id.startsWith(taskId));
  if (projectMatches.length === 1) return projectMatches[0];
  if (projectMatches.length > 1) {
    console.error(`Multiple tasks match "${taskId}":`);
    projectMatches.forEach(t => console.error(`  ${t.id.slice(0, 8)} - ${t.title}`));
    return null;
  }

  // No match in current project — try all projects for partial matches
  if (projectId) {
    const allProjects = await coordination.listProjects();
    for (const p of allProjects) {
      if (p.id === projectId) continue;
      const tasks = await coordination.getTasks({ projectId: p.id });
      const matches = tasks.filter(t => t.id.startsWith(taskId));
      if (matches.length === 1) return matches[0];
    }
  }

  return null;
}

/**
 * Display related learnings from completed tasks
 * Surfaces cross-session knowledge when claiming tasks
 */
async function displayRelatedLearnings(taskId: string): Promise<void> {
  try {
    const result = await coordination.getRelatedLearnings(taskId);
    if (!result.success) return;

    const { learnings } = result;
    const hasLearnings = learnings.fromCompletedTasks.length > 0 ||
                         learnings.fromInitiatives.length > 0;

    if (!hasLearnings) return;

    console.log('\n📚 Related Learnings:');

    // Show summary if available
    if (learnings.summary && learnings.summary !== 'No related completed tasks found' &&
        learnings.summary !== 'Task not found') {
      console.log(`   ${learnings.summary}`);
    }

    // Show learnings from completed tasks
    if (learnings.fromCompletedTasks.length > 0) {
      console.log(`\n   From ${learnings.fromCompletedTasks.length} related task(s):`);
      for (const task of learnings.fromCompletedTasks.slice(0, 3)) {
        console.log(`   • ${task.taskTitle} (${task.relationshipType})`);
        if (task.implementationSummary) {
          const summary = task.implementationSummary.slice(0, 100);
          console.log(`     ${summary}${task.implementationSummary.length > 100 ? '...' : ''}`);
        }
        if (task.decisions.length > 0) {
          console.log(`     Decisions: ${task.decisions.slice(0, 2).map((d: any) => d.decision.slice(0, 50)).join('; ')}${task.decisions.length > 2 ? '...' : ''}`);
        }
        if (task.whatWorked && task.whatWorked.length > 0) {
          console.log(`     ✓ What worked: ${task.whatWorked[0]}`);
        }
        if (task.whatToAvoid && task.whatToAvoid.length > 0) {
          console.log(`     ⚠ Avoid: ${task.whatToAvoid[0]}`);
        }
      }
      if (learnings.fromCompletedTasks.length > 3) {
        console.log(`   ... and ${learnings.fromCompletedTasks.length - 3} more`);
      }
    }

    // Show relevant initiative outcomes
    if (learnings.fromInitiatives.length > 0) {
      console.log(`\n   Initiative insights:`);
      for (const init of learnings.fromInitiatives.slice(0, 2)) {
        const statusIcon = init.status === 'succeeded' ? '✓' :
                          init.status === 'failed' ? '✗' :
                          init.status === 'active' ? '→' : '○';
        console.log(`   ${statusIcon} ${init.title} (${init.status})`);
        if (init.outcomeNotes) {
          console.log(`     ${init.outcomeNotes.slice(0, 80)}${init.outcomeNotes.length > 80 ? '...' : ''}`);
        }
      }
    }

    // Show recommendations
    if (learnings.recommendations.length > 0) {
      console.log(`\n   💡 Recommendations:`);
      for (const rec of learnings.recommendations.slice(0, 3)) {
        console.log(`   - ${rec}`);
      }
    }
  } catch (error) {
    // Silently ignore learnings errors - they're advisory
  }
}

const program = new Command();

// Essential commands shown in default help (everything else hidden)
const essentialCommands = ['init', 'task', 'project', 'doctor', 'verify', 'update', 'instructions', 'serve', 'briefing'];

program
  .name('enginehaus')
  .description('AI coordination for multi-project development')
  .version('0.1.0')
  .configureHelp({
    // Only show essential commands in default help
    visibleCommands: (cmd) => {
      const commands = [...cmd.commands]; // Copy to mutable array
      // If we're at the top level, filter to essentials
      if (cmd.name() === 'enginehaus') {
        return commands.filter(c => essentialCommands.includes(c.name()));
      }
      // For subcommands, show all
      return commands;
    },
  })
  .addHelpText('after', `
Essential Commands (shown above):
  init          Set up Enginehaus in your project
  task          Manage tasks (list, next, complete)
  project       Manage projects (list, active, delete)
  doctor        Diagnose installation issues
  verify        Verify MCP configuration
  update        Check for and install updates
  instructions  Show setup instructions
  briefing      Get project status summary
  serve         Start Wheelhaus web console

Run 'enginehaus help all' for the complete command list.
Run 'enginehaus <command> --help' for command details.
`);

// ============================================================================
// Agent-Friendly CLI Infrastructure
// ============================================================================

/**
 * Command specification for agent-help output.
 * Enables agents to discover command syntax without parsing help text.
 */
interface CommandSpec {
  command: string;           // Full command path (e.g., 'initiative create')
  description: string;
  example: string;           // Primary example invocation
  altExamples?: string[];    // Alternative valid invocations
  args: {
    name: string;
    required: boolean;
    description: string;
    flag?: string;           // Equivalent flag if dual-pattern supported
  }[];
  options: {
    flags: string;           // e.g., '-d, --description <text>'
    description: string;
    required: boolean;
  }[];
}

/**
 * Registry of command specifications for agent-help.
 * Commands register themselves here for discoverability.
 */
const commandSpecs: CommandSpec[] = [];

/**
 * Register a command spec for agent-help output.
 */
function registerCommand(spec: CommandSpec): void {
  commandSpecs.push(spec);
}

/**
 * Generate JSON output for --agent-help.
 * This structured format allows agents to programmatically understand CLI syntax.
 */
function generateAgentHelp(): object {
  return {
    version: '0.1.0',
    description: 'Enginehaus CLI - Agent-friendly command reference',
    usage: {
      pattern: 'enginehaus <command> [subcommand] [args] [options]',
      note: 'Most commands support both positional arguments and equivalent --flag syntax',
    },
    commands: commandSpecs,
    tips: [
      'Use --json flag on most commands for structured output',
      'Partial UUIDs work for task/initiative IDs (first 8+ chars)',
      'Commands auto-detect project from current working directory',
    ],
  };
}

/**
 * Custom error handler that provides agent-friendly syntax hints.
 * When a command fails, suggest correct syntax with examples.
 */
function setupAgentFriendlyErrors(): void {
  program.configureOutput({
    writeErr: (str) => {
      // Check if this is an "unknown option" error
      const unknownOptionMatch = str.match(/error: unknown option '([^']+)'/i);
      if (unknownOptionMatch) {
        const badOption = unknownOptionMatch[1];
        console.error(`\n❌ Unknown option: ${badOption}\n`);

        // Try to find the command being invoked and suggest correct syntax
        const args = process.argv.slice(2);
        const cmdPath = args.filter(a => !a.startsWith('-')).join(' ');
        const matchingSpec = commandSpecs.find(s =>
          s.command === cmdPath || cmdPath.startsWith(s.command)
        );

        if (matchingSpec) {
          console.error(`📖 Correct syntax for '${matchingSpec.command}':`);
          console.error(`   ${matchingSpec.example}\n`);
          if (matchingSpec.altExamples && matchingSpec.altExamples.length > 0) {
            console.error('   Alternative forms:');
            matchingSpec.altExamples.forEach(ex => console.error(`   ${ex}`));
            console.error('');
          }
          console.error('   Available options:');
          matchingSpec.options.forEach(opt => {
            const req = opt.required ? ' (required)' : '';
            console.error(`   ${opt.flags}${req}`);
          });
        }
        console.error('\n💡 Tip: Use `enginehaus <command> --agent-help` for JSON syntax specs\n');
        return;
      }

      // Check if this is a "missing argument" error
      const missingArgMatch = str.match(/error: missing required argument '([^']+)'/i);
      if (missingArgMatch) {
        const missingArg = missingArgMatch[1];
        console.error(`\n❌ Missing required argument: ${missingArg}\n`);

        const args = process.argv.slice(2);
        const cmdPath = args.filter(a => !a.startsWith('-')).join(' ');
        const matchingSpec = commandSpecs.find(s =>
          cmdPath.startsWith(s.command.split(' ').slice(0, -1).join(' '))
        );

        if (matchingSpec) {
          console.error(`📖 Correct syntax:`);
          console.error(`   ${matchingSpec.example}\n`);

          const argSpec = matchingSpec.args.find(a => a.name === missingArg);
          if (argSpec?.flag) {
            console.error(`   You can also use: ${argSpec.flag} <value>`);
          }
        }
        console.error('\n💡 Tip: Use `enginehaus <command> --agent-help` for JSON syntax specs\n');
        return;
      }

      // Default: pass through the error
      process.stderr.write(str);
    },
  });
}

// Initialize agent-friendly error handling
setupAgentFriendlyErrors();

// Add global --agent-help option
program.option('--agent-help', 'Output command specs as JSON for agent consumption');

// Handle --agent-help before parsing commands
program.hook('preAction', (thisCommand) => {
  if (process.argv.includes('--agent-help')) {
    // Find specs relevant to the current command path
    const cmdPath = thisCommand.name();
    const parentPath = thisCommand.parent?.name();
    const fullPath = parentPath && parentPath !== 'enginehaus'
      ? `${parentPath} ${cmdPath}`
      : cmdPath;

    const relevantSpecs = fullPath === 'enginehaus'
      ? commandSpecs
      : commandSpecs.filter(s => s.command.startsWith(fullPath));

    if (relevantSpecs.length > 0) {
      console.log(JSON.stringify({ commands: relevantSpecs }, null, 2));
    } else {
      console.log(JSON.stringify(generateAgentHelp(), null, 2));
    }
    process.exit(0);
  }
});

// ============================================================================
// Onboarding Commands (extracted to commands/)
// ============================================================================

registerOnboardingCommands(program, { coordination, storage, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Project Commands (extracted to commands/project-commands.ts)
// ============================================================================

registerProjectCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Task Commands (extracted to commands/task-commands.ts)
// ============================================================================

registerTaskCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Info Commands (extracted to commands/)
// ============================================================================

registerInfoCommands(program, { coordination, storage, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Analytics Command (extracted to commands/analytics-commands.ts)
// ============================================================================

registerAnalyticsCommands(program, { coordination, storage, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Architecture: BIM for Applications (extracted to commands/arch-commands.ts)
// ============================================================================

registerArchCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Initiative Commands (extracted to commands/initiative-commands.ts)
// ============================================================================

registerInitiativeCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Decision Commands (extracted to commands/decision-commands.ts)
// ============================================================================

registerDecisionCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Plan Commands (extracted to commands/plan-commands.ts)
// ============================================================================

registerPlanCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Handoff Commands (extracted to commands/handoff-commands.ts)
// ============================================================================

registerHandoffCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Server Command (extracted to commands/server-commands.ts)
// ============================================================================

registerServerCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Config Commands (extracted to commands/config-commands.ts)
// ============================================================================

registerConfigCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Setup Command (extracted to commands/setup-commands.ts)
// ============================================================================

registerSetupCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Doctor Command (extracted to commands/doctor-commands.ts)
// ============================================================================

registerDoctorCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Utility Commands (extracted to commands/utility-commands.ts)
// ============================================================================

registerUtilityCommands(program, { coordination, storage, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Audit Commands (extracted to commands/audit-commands.ts)
// ============================================================================

registerAuditCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// CI Commands (extracted to commands/ci-commands.ts)
// ============================================================================

registerCiCommands(program, { coordination, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Tool Commands: Generic MCP tool passthrough (commands/tool-commands.ts)
// ============================================================================

registerToolCommands(program, { coordination, storage, resolveProject, getProjectId, resolveTaskById, displayRelatedLearnings, registerCommand });

// ============================================================================
// Help All Command: Show complete command list
// ============================================================================

program
  .command('help')
  .argument('[scope]', 'Scope: "all" for complete list, or command name')
  .description('Show help for Enginehaus commands')
  .action((scope: string | undefined) => {
    if (scope === 'all') {
      // Show all commands
      console.log('\nEnginehaus - Complete Command Reference\n');
      console.log('Usage: enginehaus [command] [options]\n');

      const categories: Record<string, string[]> = {
        'Getting Started': ['init', 'doctor', 'verify', 'update', 'instructions', 'setup'],
        'Task Management': ['task', 'briefing', 'status', 'map'],
        'Project Management': ['project', 'link'],
        'Knowledge & Decisions': ['decision', 'initiative'],
        'Coordination': ['handoff', 'health', 'validate'],
        'Analytics': ['stats', 'metrics', 'analytics', 'feedback'],
        'Web Console': ['serve'],
        'Configuration': ['config', 'errors'],
        'MCP Tools': ['tool'],
      };

      for (const [category, cmds] of Object.entries(categories)) {
        console.log(`${category}:`);
        for (const cmdName of cmds) {
          const cmd = program.commands.find(c => c.name() === cmdName);
          if (cmd) {
            console.log(`  ${cmdName.padEnd(14)} ${cmd.description()}`);
          }
        }
        console.log('');
      }

      console.log('Global Options:');
      console.log('  --agent-help    Output command specs as JSON');
      console.log('  -V, --version   Show version number');
      console.log('  -h, --help      Show this help\n');
    } else if (scope) {
      // Show help for specific command
      const cmd = program.commands.find(c => c.name() === scope);
      if (cmd) {
        cmd.outputHelp();
      } else {
        console.error(`Unknown command: ${scope}`);
        console.error('Run "enginehaus help all" to see all commands.');
        process.exit(1);
      }
    } else {
      // No scope - show default help
      program.outputHelp();
    }
  });

// ============================================================================
// Demo
// ============================================================================

// ============================================================================
// Top-Level Shortcuts (eh add, eh list, eh next)
// ============================================================================

program
  .command('add')
  .description('Quick add a task (shortcut for: task add)')
  .argument('<title>', 'Task title')
  .option('-c, --critical', 'Set priority to critical')
  .option('-h, --high', 'Set priority to high')
  .option('-l, --low', 'Set priority to low')
  .option('-d, --description <description>', 'Task description')
  .option('-f, --files <files>', 'Comma-separated list of files')
  .option('--type <type>', 'Task type: code, docs, infra, test, other')
  .action(async (title, opts) => {
    await coordination.initialize();

    const priority: TaskPriority = opts.critical ? 'critical' : opts.high ? 'high' : opts.low ? 'low' : 'medium';

    const project = await resolveProject();
    const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';

    const task = await coordination.createTask({
      projectId,
      title,
      description: opts.description || '',
      priority,
      files: opts.files ? opts.files.split(',').map((f: string) => f.trim()) : [],
      type: opts.type,
      createdBy: 'cli-user',
    });

    console.log(`\n  ✓ ${task.title} [${task.priority}]\n`);
    console.log(`    ID: ${task.id.slice(0, 8)}`);
    if (project) console.log(`    Project: ${project.name}`);
    console.log('');
  });

program
  .command('list')
  .description('List tasks (shortcut for: task list)')
  .option('-s, --status <status>', 'Filter by status (ready, in-progress, completed, blocked, all)', 'all')
  .option('-p, --priority <priority>', 'Filter by priority')
  .option('-n, --limit <limit>', 'Show top N tasks')
  .option('--sort <field>', 'Sort by: priority (default), created, updated, title')
  .option('--compact', 'One-line-per-task format')
  .option('--json', 'Output as JSON')
  .option('--all-projects', 'Show tasks from all projects')
  .action(async (opts) => {
    await coordination.initialize();

    const project = opts.allProjects ? null : await resolveProject();
    const filter: any = {};
    if (opts.status !== 'all') filter.status = opts.status;
    if (opts.priority) filter.priority = opts.priority;
    if (project) filter.projectId = project.id;

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

    // Sort
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

    const totalCount = tasks.length;
    if (opts.limit) tasks = tasks.slice(0, parseInt(opts.limit));

    if (opts.json) {
      console.log(JSON.stringify(tasks, null, 2));
      return;
    }

    if (tasks.length === 0) {
      console.log(`\nNo tasks found${project ? ` for ${project.name}` : ''}.\n`);
      return;
    }

    const limitNote = opts.limit && totalCount > tasks.length ? ` (showing ${tasks.length} of ${totalCount})` : '';
    console.log(`\nTasks${project ? ` for ${project.name}` : ''} (${totalCount})${limitNote}:\n`);

    const priorityColors: Record<string, string> = {
      critical: '\x1b[31m', high: '\x1b[33m', medium: '\x1b[36m', low: '\x1b[37m',
    };
    const reset = '\x1b[0m';

    if (opts.compact) {
      for (const t of tasks) {
        const color = priorityColors[t.priority] || reset;
        console.log(`  ${color}${t.priority.slice(0, 4).padEnd(4)}${reset} ${t.id.slice(0, 8)} ${t.status.padEnd(14)} ${t.title}`);
      }
    } else {
      tasks.forEach(t => {
        const color = priorityColors[t.priority] || reset;
        console.log(`  ${color}[${t.priority.toUpperCase()}]${reset} ${t.title}`);
        console.log(`    ${t.id.slice(0, 8)}  ${t.status}`);
      });
    }
    console.log('');
  });

program
  .command('next')
  .description('Get and claim the next priority task (shortcut for: task next)')
  .option('-a, --agent <agentId>', 'Agent identifier', 'code')
  .option('--no-claim', 'Just show the next task without claiming it')
  .action(async (opts) => {
    await coordination.initialize();

    const project = await resolveProject();
    const projectId = project?.id || (await coordination.getActiveProject())?.id || 'default';
    const agentId = opts.agent;

    const { task, assignedToOthers } = await coordination.getNextAvailableTask({ agentId, projectId });

    if (!task) {
      if (assignedToOthers.length > 0) {
        console.log(`\nNo tasks available for '${agentId}'. ${assignedToOthers.length} assigned to others.\n`);
      } else {
        console.log(`\nNo ready tasks available.\n`);
      }
      return;
    }

    if (opts.claim !== false) {
      const claimResult = await coordination.claimTask(task.id, agentId);
      if (!claimResult.success) {
        if (claimResult.conflict) {
          console.log(`\n  Already claimed by ${claimResult.conflict.agentId}\n`);
          return;
        }
        if (claimResult.capacityExceeded) {
          console.log(`\n  You already have tasks in progress. Complete or release one first.\n`);
          return;
        }
      }
    }

    console.log(`\n  ${task.title} [${task.priority}]`);
    console.log(`  ${task.id.slice(0, 8)}  ${task.description.slice(0, 100)}${task.description.length > 100 ? '...' : ''}`);
    if (task.files && task.files.length > 0) {
      console.log(`  Files: ${task.files.join(', ')}`);
    }
    if (opts.claim !== false) {
      console.log(`\n  ✓ Claimed`);
      await displayRelatedLearnings(task.id);
    }
    console.log('');
  });

program
  .command('done')
  .description('Complete current task (shortcut for: task complete)')
  .argument('<taskId>', 'Task ID (full or partial)')
  .option('-s, --summary <summary>', 'Summary of what was done')
  .option('-f, --force', 'Bypass quality enforcement')
  .option('--reason <reason>', 'Reason for bypassing quality')
  .option('--unmerged-ok', 'Allow completion from an unmerged branch')
  .action(async (taskIdArg, opts) => {
    await coordination.initialize();
    const project = await resolveProject();
    const projectId = project?.id || 'default';
    const task = await resolveTaskById(taskIdArg, projectId);
    if (!task) {
      console.error(`\n❌ Task not found: ${taskIdArg}\n`);
      return;
    }
    const summary = opts.summary || 'Completed';
    const result = await coordination.completeTaskSmart({
      taskId: task.id,
      summary,
      defaultProjectRoot: process.cwd(),
      enforceQuality: !opts.force,
      allowUnmerged: opts.unmergedOk || false,
    });
    if (!result.success) {
      console.log(`\n❌ ${result.error}\n`);
      return;
    }
    console.log(`\n✅ Done: ${task.title}\n   ${summary}\n`);
  });

program
  .command('decide')
  .description('Log a decision (shortcut for: decision log)')
  .argument('<decision>', 'What was decided')
  .option('-r, --rationale <rationale>', 'Why this choice was made')
  .option('-c, --category <category>', 'Category: architecture, tradeoff, dependency, pattern, other')
  .action(async (decision, opts) => {
    await coordination.initialize();
    const result = await coordination.logDecision({
      decision,
      rationale: opts.rationale,
      category: opts.category || 'other',
      createdBy: 'cli-user',
    });
    console.log(`\n✓ Decision logged: ${result.decisionId.slice(0, 8)}\n  "${decision}"\n`);
  });

// ============================================================================
// Session Heartbeat — keeps active sessions alive during long work
// ============================================================================

program
  .command('heartbeat')
  .description('Refresh active session heartbeats (used by hooks to prevent session expiry)')
  .action(async () => {
    await coordination.initialize();
    const project = await resolveProject();
    if (!project) { process.exit(0); return; }

    const tasks = await coordination.getTasks({ projectId: project.id, status: 'in-progress' });
    if (tasks.length === 0) { process.exit(0); return; }

    // Refresh heartbeat for each in-progress task's active session
    for (const task of tasks) {
      if (task.implementation?.sessionId) {
        try {
          await storage.updateSessionHeartbeat(task.implementation.sessionId);
        } catch {
          // Non-critical — session may have been cleaned up
        }
      }
    }
  });

// ============================================================================
// Shell Completion
// ============================================================================

program
  .command('completion')
  .description('Generate shell completion scripts')
  .argument('<shell>', 'Shell type: bash, zsh, or fish')
  .action(async (shell: string) => {
    const commands = [
      'init', 'add', 'list', 'next', 'done', 'decide', 'project', 'task',
      'briefing', 'status', 'stats', 'health', 'metrics', 'decision',
      'initiative', 'serve', 'doctor', 'verify', 'update', 'instructions',
      'validate', 'handoff', 'analytics', 'feedback', 'config', 'errors',
      'map', 'link', 'setup', 'demo', 'completion'
    ];
    const subcommands: Record<string, string[]> = {
      project: ['list', 'active', 'show', 'create', 'delete'],
      task: ['list', 'next', 'show', 'add', 'claim', 'release', 'complete', 'block', 'unblock'],
      decision: ['log', 'list', 'show'],
      initiative: ['create', 'list', 'show', 'link', 'outcome', 'learnings'],
      handoff: ['prepare', 'continue'],
      config: ['show', 'set', 'reset'],
    };

    switch (shell.toLowerCase()) {
      case 'bash':
        console.log(`# Enginehaus bash completion
# Add to ~/.bashrc: eval "$(enginehaus completion bash)"

_enginehaus_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "\${prev}" in
    enginehaus|eh)
      COMPREPLY=( $(compgen -W "${commands.join(' ')}" -- "\${cur}") )
      return 0
      ;;
    ${Object.entries(subcommands).map(([cmd, subs]) =>
      `${cmd})\n      COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "\${cur}") )\n      return 0\n      ;;`
    ).join('\n    ')}
  esac
}

complete -F _enginehaus_completions enginehaus
complete -F _enginehaus_completions eh`);
        break;

      case 'zsh':
        console.log(`# Enginehaus zsh completion
# Add to ~/.zshrc: eval "$(enginehaus completion zsh)"

_enginehaus() {
  local -a commands subcommands

  commands=(
    ${commands.map(c => `'${c}:${c} command'`).join('\n    ')}
  )

  case "\${words[2]}" in
    ${Object.entries(subcommands).map(([cmd, subs]) =>
      `${cmd})\n      subcommands=(${subs.map(s => `'${s}'`).join(' ')})\n      _describe '${cmd} subcommand' subcommands\n      ;;`
    ).join('\n    ')}
    *)
      _describe 'command' commands
      ;;
  esac
}

compdef _enginehaus enginehaus
compdef _enginehaus eh`);
        break;

      case 'fish':
        console.log(`# Enginehaus fish completion
# Save to ~/.config/fish/completions/enginehaus.fish

# Main commands
${commands.map(c => `complete -c enginehaus -n "__fish_use_subcommand" -a "${c}" -d "${c} command"`).join('\n')}

# Subcommands
${Object.entries(subcommands).map(([cmd, subs]) =>
  subs.map(s => `complete -c enginehaus -n "__fish_seen_subcommand_from ${cmd}" -a "${s}"`).join('\n')
).join('\n')}

# Also alias eh
${commands.map(c => `complete -c eh -n "__fish_use_subcommand" -a "${c}" -d "${c} command"`).join('\n')}`);
        break;

      default:
        console.error(`Unknown shell: ${shell}`);
        console.error('Supported shells: bash, zsh, fish');
        process.exit(1);
    }
  });

// ============================================================================
// Passive Update Notification (runs after each command)
// ============================================================================

// Commands that should skip update notification (to avoid noise)
const skipUpdateNotificationFor = ['update', 'help', '--help', '-h', '--version', '-V'];

program.hook('postAction', async (thisCommand) => {
  // Skip for certain commands
  const cmdName = thisCommand.name();
  if (skipUpdateNotificationFor.includes(cmdName)) return;

  // Check for update (non-blocking, uses cache)
  try {
    const notification = await shouldShowUpdateNotification();
    if (notification.show && notification.message) {
      console.log(`\n💡 ${notification.message}\n`);
    }
  } catch {
    // Silently ignore - don't let update check failures affect CLI
  }
});

// ============================================================================
// Branch Lifecycle Management
// ============================================================================

const branchCmd = program
  .command('branch')
  .description('Branch lifecycle management — detect stale branches, clean up merged');

branchCmd
  .command('stale')
  .description('List stale feature branches (no commits in 14+ days)')
  .option('-d, --days <days>', 'Staleness threshold in days (default: 14)', '14')
  .option('--json', 'Output as JSON')
  .action(async (opts: { days: string; json?: boolean }) => {
    const { findStaleBranches } = await import('../git/git-analysis.js');
    const rootPath = process.cwd();
    const staleDays = parseInt(opts.days, 10);
    const staleBranches = await findStaleBranches(rootPath, { staleDays });

    if (opts.json) {
      console.log(JSON.stringify(staleBranches, null, 2));
      return;
    }

    if (staleBranches.length === 0) {
      console.log(`\n  No stale branches (threshold: ${staleDays} days).\n`);
      return;
    }

    const merged = staleBranches.filter(b => b.isMerged).length;
    console.log(`\n  ${staleBranches.length} stale branch(es) (${merged} merged, ${staleBranches.length - merged} unmerged):\n`);
    for (const b of staleBranches) {
      const icon = b.isMerged ? '✓' : '!';
      const status = b.isMerged ? 'merged' : 'unmerged';
      const taskStr = b.taskId ? ` [task ${b.taskId}]` : '';
      console.log(`  ${icon} ${b.name}${taskStr}`);
      console.log(`    ${b.daysSinceLastCommit}d ago | ${status} | ${b.lastCommitMessage.slice(0, 60)}`);
    }
    if (merged > 0) {
      console.log(`\n  Run \`enginehaus branch cleanup\` to delete ${merged} merged branch(es).\n`);
    } else {
      console.log('');
    }
  });

branchCmd
  .command('cleanup')
  .description('Delete local feature branches that have been merged to main')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .action(async (opts: { dryRun?: boolean }) => {
    const { findStaleBranches, cleanupMergedBranches } = await import('../git/git-analysis.js');
    const rootPath = process.cwd();

    if (opts.dryRun) {
      const staleBranches = await findStaleBranches(rootPath, { staleDays: 0 });
      const merged = staleBranches.filter(b => b.isMerged);
      if (merged.length === 0) {
        console.log('\n  No merged feature branches to clean up.\n');
        return;
      }
      console.log(`\n  Would delete ${merged.length} merged branch(es):\n`);
      for (const b of merged) {
        console.log(`    ${b.name}`);
      }
      console.log('');
      return;
    }

    const deleted = await cleanupMergedBranches(rootPath);
    if (deleted.length === 0) {
      console.log('\n  No merged feature branches to clean up.\n');
    } else {
      console.log(`\n  Deleted ${deleted.length} merged branch(es):\n`);
      for (const name of deleted) {
        console.log(`    ✓ ${name}`);
      }
      console.log('');
    }
  });

// ============================================================================
// Run
// ============================================================================

program.parse();
