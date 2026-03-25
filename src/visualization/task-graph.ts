/**
 * Task Graph - Visual Task Navigation with Context Generation
 *
 * Provides ASCII task graphs in terminal with multiple views:
 * - Developer view: "What can I work on now?" (unblocked tasks)
 * - Lead view: "Where are the bottlenecks?" (blocked chains)
 * - Session view: "What happened in this AI session?" (tasks touched, decisions made)
 *
 * Also generates token-efficient context prompts from task clusters.
 */

import { UnifiedTask, TaskPriority, TaskStatus, CoordinationSession, StrategicDecision } from '../coordination/types.js';
import { generateInitiativeNudge } from '../utils/initiative-suggestions.js';

// ============================================================================
// Types
// ============================================================================

export type GraphView = 'developer' | 'lead' | 'session' | 'full';

export interface GraphOptions {
  view?: GraphView;
  maxDepth?: number;
  showFiles?: boolean;
  showDecisions?: boolean;
  focusTaskId?: string;
  width?: number;
}

export interface TaskNode {
  task: UnifiedTask;
  depth: number;
  blockers: TaskNode[];
  blocking: TaskNode[];
  isWorkable: boolean;  // No unfinished blockers
  isBottleneck: boolean;  // Blocking multiple tasks
  clusterSize: number;  // Tasks in dependency chain
}

export interface TaskCluster {
  rootTask: UnifiedTask;
  tasks: UnifiedTask[];
  criticalPath: UnifiedTask[];
  bottlenecks: UnifiedTask[];
  workableTasks: UnifiedTask[];
}

export interface BriefingInitiative {
  id: string;
  title: string;
  status: string;
  taskCount: number;
  linkedTaskIds: string[];
}

export interface BriefingResult {
  summary: string;
  /** Strategic focus — active initiatives framing why work matters */
  currentFocus?: {
    initiatives: BriefingInitiative[];
    focusSummary: string;
  };
  /** Recently completed tasks — establishes momentum and context */
  recentCompletions: UnifiedTask[];
  workableNow: UnifiedTask[];
  bottlenecks: UnifiedTask[];
  inProgress: UnifiedTask[];
  recentDecisions: StrategicDecision[];
  /** Map of taskId → linked decisions (for showing WHY behind ready tasks) */
  taskDecisions?: Map<string, Array<{ decision: string; category?: string }>>;
  recommendations: string[];
  /** Tasks assigned to specific users - waiting for human action */
  assignedTasks: Array<{ task: UnifiedTask; assignedTo: string }>;
  /** Agent-specific: tasks in-progress for the requesting agent */
  agentInProgress?: UnifiedTask[];
  /** Agent-specific: tasks in-progress for other agents */
  otherAgentInProgress?: Array<{ task: UnifiedTask; agentId: string }>;
  /** Pending draft thoughts awaiting review */
  pendingThoughts?: Array<{ id: string; thought: string; taskId?: string; createdAt: Date }>;
}

// ============================================================================
// Status and Priority Symbols
// ============================================================================

const STATUS_ICONS: Record<TaskStatus, string> = {
  'ready': '○',           // Empty circle - ready to start
  'in-progress': '◐',     // Half circle - in progress
  'blocked': '●',         // Filled circle - blocked
  'awaiting-human': '⏸',  // Pause symbol - awaiting human input
  'completed': '✓',       // Checkmark - done
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  'critical': '\x1b[31m',  // Red
  'high': '\x1b[33m',      // Yellow
  'medium': '\x1b[36m',    // Cyan
  'low': '\x1b[37m',       // White
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

// ============================================================================
// Graph Building
// ============================================================================

/**
 * Build task nodes with dependency information
 */
export function buildTaskNodes(tasks: UnifiedTask[]): Map<string, TaskNode> {
  const nodes = new Map<string, TaskNode>();

  // First pass: create nodes
  for (const task of tasks) {
    nodes.set(task.id, {
      task,
      depth: 0,
      blockers: [],
      blocking: [],
      isWorkable: true,
      isBottleneck: false,
      clusterSize: 1,
    });
  }

  // Second pass: link dependencies
  for (const task of tasks) {
    const node = nodes.get(task.id)!;

    if (task.blockedBy) {
      for (const blockerId of task.blockedBy) {
        const blockerNode = nodes.get(blockerId);
        if (blockerNode) {
          node.blockers.push(blockerNode);
          blockerNode.blocking.push(node);
        }
      }
    }
  }

  // Third pass: calculate properties
  for (const node of nodes.values()) {
    // Check if workable (all blockers completed)
    node.isWorkable = node.task.status !== 'completed' &&
      node.task.status !== 'blocked' &&
      node.blockers.every(b => b.task.status === 'completed');

    // Check if bottleneck (blocking 2+ tasks)
    node.isBottleneck = node.blocking.length >= 2 && node.task.status !== 'completed';

    // Calculate cluster size (recursive)
    node.clusterSize = calculateClusterSize(node, new Set());
  }

  // Calculate depths
  calculateDepths(nodes);

  return nodes;
}

function calculateClusterSize(node: TaskNode, visited: Set<string>): number {
  if (visited.has(node.task.id)) return 0;
  visited.add(node.task.id);

  let size = 1;
  for (const blocked of node.blocking) {
    size += calculateClusterSize(blocked, visited);
  }
  return size;
}

function calculateDepths(nodes: Map<string, TaskNode>): void {
  // Find roots (no blockers)
  const roots = [...nodes.values()].filter(n => n.blockers.length === 0);

  // BFS to assign depths
  const queue: TaskNode[] = [...roots];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node.task.id)) continue;
    visited.add(node.task.id);

    for (const blocked of node.blocking) {
      blocked.depth = Math.max(blocked.depth, node.depth + 1);
      queue.push(blocked);
    }
  }
}

// ============================================================================
// View Renderers
// ============================================================================

/**
 * Render developer view - focus on what can be worked on now
 */
export function renderDeveloperView(tasks: UnifiedTask[], options: GraphOptions = {}): string {
  const { width = 80 } = options;
  const nodes = buildTaskNodes(tasks);
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}═══ DEVELOPER VIEW: What Can I Work On? ═══${RESET}`);
  lines.push('');

  // Workable tasks (ready + unblocked)
  const workable = [...nodes.values()]
    .filter(n => n.isWorkable && n.task.status !== 'completed')
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.task.priority] - priorityOrder[b.task.priority];
    });

  if (workable.length === 0) {
    lines.push(`${DIM}  No tasks ready to work on${RESET}`);
  } else {
    lines.push(`${BOLD}Ready to Start (${workable.length}):${RESET}`);
    lines.push('');

    for (const node of workable.slice(0, 10)) {
      const task = node.task;
      const color = PRIORITY_COLORS[task.priority];
      const icon = STATUS_ICONS[task.status];

      lines.push(`  ${color}${icon}${RESET} ${truncate(task.title, width - 20)}`);
      lines.push(`    ${DIM}ID: ${task.id.slice(0, 8)}  Priority: ${task.priority}${RESET}`);

      if (node.blocking.length > 0) {
        lines.push(`    ${DIM}Unblocks: ${node.blocking.length} task(s)${RESET}`);
      }

      if (task.files && task.files.length > 0) {
        lines.push(`    ${DIM}Files: ${task.files.slice(0, 3).join(', ')}${task.files.length > 3 ? '...' : ''}${RESET}`);
      }
      lines.push('');
    }

    if (workable.length > 10) {
      lines.push(`  ${DIM}... and ${workable.length - 10} more${RESET}`);
    }
  }

  // In-progress tasks
  const inProgress = [...nodes.values()]
    .filter(n => n.task.status === 'in-progress');

  if (inProgress.length > 0) {
    lines.push('');
    lines.push(`${BOLD}Currently In Progress (${inProgress.length}):${RESET}`);
    lines.push('');

    for (const node of inProgress) {
      const task = node.task;
      const color = PRIORITY_COLORS[task.priority];
      lines.push(`  ${color}◐${RESET} ${truncate(task.title, width - 10)}`);
    }
  }

  lines.push('');
  lines.push(`${DIM}Legend: ○ Ready  ◐ In Progress  ● Blocked  ✓ Completed${RESET}`);

  return lines.join('\n');
}

/**
 * Render lead view - focus on bottlenecks and blocked chains
 */
export function renderLeadView(tasks: UnifiedTask[], options: GraphOptions = {}): string {
  const { width = 80 } = options;
  const nodes = buildTaskNodes(tasks);
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}═══ LEAD VIEW: Where Are The Bottlenecks? ═══${RESET}`);
  lines.push('');

  // Bottleneck tasks
  const bottlenecks = [...nodes.values()]
    .filter(n => n.isBottleneck)
    .sort((a, b) => b.blocking.length - a.blocking.length);

  if (bottlenecks.length > 0) {
    lines.push(`${BOLD}🚧 Bottlenecks (blocking multiple tasks):${RESET}`);
    lines.push('');

    for (const node of bottlenecks) {
      const task = node.task;
      const color = PRIORITY_COLORS[task.priority];
      const icon = STATUS_ICONS[task.status];

      lines.push(`  ${color}${icon}${RESET} ${truncate(task.title, width - 30)} ${DIM}[blocks ${node.blocking.length}]${RESET}`);

      // Show what's being blocked
      const blockedTitles = node.blocking.slice(0, 3).map(b => b.task.title.slice(0, 25));
      lines.push(`    ${DIM}├─ ${blockedTitles.join(', ')}${node.blocking.length > 3 ? '...' : ''}${RESET}`);
      lines.push('');
    }
  } else {
    lines.push(`${DIM}  No bottlenecks detected${RESET}`);
    lines.push('');
  }

  // Blocked chains
  const blocked = [...nodes.values()]
    .filter(n => n.task.status === 'blocked')
    .sort((a, b) => a.depth - b.depth);

  if (blocked.length > 0) {
    lines.push(`${BOLD}🔴 Blocked Tasks (${blocked.length}):${RESET}`);
    lines.push('');

    for (const node of blocked.slice(0, 10)) {
      const task = node.task;
      const indent = '  '.repeat(Math.min(node.depth, 3) + 1);
      const chain = traceDependencyChain(node);

      lines.push(`${indent}● ${truncate(task.title, width - 20 - indent.length)}`);
      if (chain.length > 1) {
        lines.push(`${indent}${DIM}└─ waiting on: ${chain.slice(0, -1).map(t => t.title.slice(0, 15)).join(' → ')}${RESET}`);
      }
    }
  }

  // Summary stats
  lines.push('');
  lines.push(`${BOLD}Summary:${RESET}`);
  const stats = calculateStats(nodes);
  lines.push(`  Total: ${stats.total}  Ready: ${stats.ready}  In Progress: ${stats.inProgress}  Blocked: ${stats.blocked}  Done: ${stats.completed}`);

  return lines.join('\n');
}

/**
 * Render session view - what happened in the current AI session
 */
export function renderSessionView(
  tasks: UnifiedTask[],
  session: CoordinationSession | null,
  decisions: StrategicDecision[],
  options: GraphOptions = {}
): string {
  const { width = 80 } = options;
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}═══ SESSION VIEW: What Happened This Session? ═══${RESET}`);
  lines.push('');

  if (session) {
    const duration = Math.round((Date.now() - new Date(session.startTime).getTime()) / 60000);
    lines.push(`${BOLD}Session Info:${RESET}`);
    lines.push(`  Agent: ${session.agentId}`);
    lines.push(`  Duration: ${duration} minutes`);
    lines.push(`  Status: ${session.status}`);
    lines.push('');
  }

  // Tasks touched in session (in-progress or recently modified)
  const recentTasks = tasks.filter(t =>
    t.status === 'in-progress' ||
    (t.updatedAt && new Date(t.updatedAt).getTime() > Date.now() - 3600000)
  );

  if (recentTasks.length > 0) {
    lines.push(`${BOLD}Tasks Touched:${RESET}`);
    for (const task of recentTasks) {
      const icon = STATUS_ICONS[task.status];
      const color = PRIORITY_COLORS[task.priority];
      lines.push(`  ${color}${icon}${RESET} ${truncate(task.title, width - 10)}`);
    }
    lines.push('');
  }

  // Recent decisions
  const recentDecisions = decisions.slice(0, 5);
  if (recentDecisions.length > 0) {
    lines.push(`${BOLD}Decisions Made:${RESET}`);
    for (const decision of recentDecisions) {
      lines.push(`  • ${truncate(decision.decision, width - 10)}`);
      if (decision.rationale) {
        lines.push(`    ${DIM}${truncate(decision.rationale, width - 14)}${RESET}`);
      }
    }
    lines.push('');
  }

  // What's next
  const nodes = buildTaskNodes(tasks);
  const workable = [...nodes.values()]
    .filter(n => n.isWorkable && n.task.status !== 'completed')
    .slice(0, 3);

  if (workable.length > 0) {
    lines.push(`${BOLD}Ready Next:${RESET}`);
    for (const node of workable) {
      lines.push(`  ○ ${truncate(node.task.title, width - 10)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render full dependency graph
 */
export function renderFullGraph(tasks: UnifiedTask[], options: GraphOptions = {}): string {
  const { width = 80, maxDepth = 5 } = options;
  const nodes = buildTaskNodes(tasks);
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}═══ TASK DEPENDENCY GRAPH ═══${RESET}`);
  lines.push('');

  // Find root tasks (no dependencies)
  const roots = [...nodes.values()].filter(n => n.blockers.length === 0);

  // Render tree from each root
  const rendered = new Set<string>();

  for (const root of roots) {
    renderNode(root, 0, lines, rendered, width, maxDepth);
  }

  // Render orphans (if any tasks weren't reached)
  const orphans = [...nodes.values()].filter(n => !rendered.has(n.task.id));
  if (orphans.length > 0) {
    lines.push('');
    lines.push(`${DIM}── Disconnected Tasks ──${RESET}`);
    for (const node of orphans) {
      renderNode(node, 0, lines, rendered, width, maxDepth);
    }
  }

  lines.push('');
  lines.push(`${DIM}Legend: ○ Ready  ◐ In Progress  ● Blocked  ✓ Completed${RESET}`);
  lines.push(`${DIM}        │ └─ Dependencies  ★ Bottleneck${RESET}`);

  return lines.join('\n');
}

function renderNode(
  node: TaskNode,
  depth: number,
  lines: string[],
  rendered: Set<string>,
  width: number,
  maxDepth: number
): void {
  if (rendered.has(node.task.id)) return;
  if (depth > maxDepth) {
    lines.push(`${'  '.repeat(depth)}${DIM}... (max depth reached)${RESET}`);
    return;
  }

  rendered.add(node.task.id);

  const task = node.task;
  const indent = '  '.repeat(depth);
  const connector = depth > 0 ? '└─ ' : '';
  const icon = STATUS_ICONS[task.status];
  const color = PRIORITY_COLORS[task.priority];
  const bottleneck = node.isBottleneck ? ' ★' : '';

  lines.push(`${indent}${connector}${color}${icon}${RESET} ${truncate(task.title, width - indent.length - 10)}${bottleneck}`);

  // Render children (tasks blocked by this one)
  for (let i = 0; i < node.blocking.length; i++) {
    renderNode(node.blocking[i], depth + 1, lines, rendered, width, maxDepth);
  }
}

// ============================================================================
// Briefing Generator
// ============================================================================

/**
 * Generate a project briefing for quick status overview
 */
export function generateBriefing(
  tasks: UnifiedTask[],
  decisions: StrategicDecision[] = [],
  options: {
    focus?: string;
    depth?: number;
    agentId?: string;
    initiatives?: BriefingInitiative[];
    recentCompletions?: UnifiedTask[];
    taskDecisions?: Map<string, Array<{ decision: string; category?: string }>>;
    pendingThoughts?: Array<{ id: string; thought: string; taskId?: string; createdAt: Date }>;
  } = {}
): BriefingResult {
  const nodes = buildTaskNodes(tasks);

  const workableNow = [...nodes.values()]
    .filter(n => n.isWorkable && n.task.status !== 'completed')
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.task.priority] - priorityOrder[b.task.priority];
    })
    .map(n => n.task);

  const bottlenecks = [...nodes.values()]
    .filter(n => n.isBottleneck)
    .sort((a, b) => b.blocking.length - a.blocking.length)
    .map(n => n.task);

  const inProgress = tasks.filter(t => t.status === 'in-progress');

  // Find tasks assigned to specific users (waiting for human action)
  const assignedTasks = tasks
    .filter(t => t.assignedTo && t.status === 'ready')
    .map(t => ({ task: t, assignedTo: t.assignedTo! }))
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.task.priority] - priorityOrder[b.task.priority];
    });

  const recentDecisions = decisions.slice(0, 5);
  const recentCompletions = options.recentCompletions || [];

  // Build initiative-driven focus
  let currentFocus: BriefingResult['currentFocus'] | undefined;
  const activeInitiatives = options.initiatives?.filter(i => i.status === 'active') || [];
  if (activeInitiatives.length > 0) {
    // Build a set of task IDs linked to active initiatives
    const initiativeTaskIds = new Set(activeInitiatives.flatMap(i => i.linkedTaskIds));

    // Find workable tasks linked to active initiatives
    const focusTasks = workableNow.filter(t => initiativeTaskIds.has(t.id));

    const focusParts: string[] = [];
    if (activeInitiatives.length === 1) {
      focusParts.push(`Current focus: ${activeInitiatives[0].title}`);
    } else {
      focusParts.push(`${activeInitiatives.length} active initiatives`);
    }
    if (focusTasks.length > 0) {
      focusParts.push(`${focusTasks.length} ready task(s) contribute directly`);
    }

    currentFocus = {
      initiatives: activeInitiatives,
      focusSummary: focusParts.join('. ') + '.',
    };
  }

  // Generate recommendations
  // NOTE: Include task IDs for agent reliability (AX "Structure > Instruction" principle)
  const recommendations: string[] = [];

  // Initiative-aware recommendations come first
  if (currentFocus && currentFocus.initiatives.length > 0) {
    const initiativeTaskIds = new Set(currentFocus.initiatives.flatMap(i => i.linkedTaskIds));
    const focusWorkable = workableNow.filter(t => initiativeTaskIds.has(t.id));
    if (focusWorkable.length > 0) {
      const top = focusWorkable[0];
      recommendations.push(`[${top.id}] "${top.title}" advances the current initiative`);
    }
  }

  if (bottlenecks.length > 0) {
    const bn = bottlenecks[0];
    recommendations.push(`Prioritize [${bn.id}] "${bn.title}" - it's blocking ${nodes.get(bn.id)!.blocking.length} other tasks`);
  }

  const criticalReady = workableNow.filter(t => t.priority === 'critical');
  if (criticalReady.length > 0) {
    const ids = criticalReady.slice(0, 3).map(t => t.id).join(', ');
    recommendations.push(`${criticalReady.length} critical task(s) ready to start: ${ids}`);
  }

  if (inProgress.length > 3) {
    const ids = inProgress.slice(0, 3).map(t => t.id).join(', ');
    recommendations.push(`Consider completing in-progress tasks before starting new ones (${inProgress.length} active): ${ids}`);
  }

  const stats = calculateStats(nodes);
  const blockedPercent = Math.round((stats.blocked / stats.total) * 100);
  if (blockedPercent > 30) {
    recommendations.push(`${blockedPercent}% of tasks are blocked - review dependency chains`);
  }

  // Generate summary
  const summary = `${stats.total} tasks: ${stats.ready} ready, ${stats.inProgress} in progress, ${stats.blocked} blocked, ${stats.completed} done. ${workableNow.length} tasks can be started now.`;

  // Agent-specific in-progress breakdown
  let agentInProgress: UnifiedTask[] | undefined;
  let otherAgentInProgress: Array<{ task: UnifiedTask; agentId: string }> | undefined;
  if (options.agentId) {
    agentInProgress = inProgress.filter(t => t.assignedTo === options.agentId);
    const others = inProgress.filter(t => t.assignedTo && t.assignedTo !== options.agentId);
    if (others.length > 0) {
      otherAgentInProgress = others.map(t => ({ task: t, agentId: t.assignedTo! }));
    }
  }

  return {
    summary,
    currentFocus,
    recentCompletions,
    workableNow,
    bottlenecks,
    inProgress,
    recentDecisions,
    taskDecisions: options.taskDecisions,
    recommendations,
    assignedTasks,
    agentInProgress,
    otherAgentInProgress,
    pendingThoughts: options.pendingThoughts,
  };
}

/**
 * Format briefing as text
 * NOTE: Task IDs are included for agent reliability (AX "Structure > Instruction" principle)
 */
export function formatBriefing(briefing: BriefingResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`${BOLD}═══ PROJECT BRIEFING ═══${RESET}`);
  lines.push('');

  // Lead with strategic focus if initiatives exist
  if (briefing.currentFocus) {
    lines.push(`${BOLD}Current Focus:${RESET}`);
    for (const init of briefing.currentFocus.initiatives) {
      lines.push(`  → ${init.title} ${DIM}(${init.taskCount} tasks)${RESET}`);
    }
    lines.push('');
  } else if (briefing.workableNow.length >= 5) {
    // No initiatives — nudge with concrete suggestion
    const nudge = generateInitiativeNudge(briefing.workableNow);
    if (nudge) {
      lines.push(`${YELLOW}${nudge}${RESET}`);
      lines.push('');
    }
  }

  // Recent momentum — what just happened
  if (briefing.recentCompletions.length > 0) {
    lines.push(`${BOLD}Recent:${RESET}`);
    for (const task of briefing.recentCompletions.slice(0, 3)) {
      lines.push(`  ${GREEN}✓${RESET} ${task.title.slice(0, 60)}`);
    }
    if (briefing.recentCompletions.length > 3) {
      lines.push(`  ${DIM}... and ${briefing.recentCompletions.length - 3} more${RESET}`);
    }
    lines.push('');
  }

  lines.push(briefing.summary);
  lines.push('');

  if (briefing.recommendations.length > 0) {
    lines.push(`${BOLD}Recommendations:${RESET}`);
    for (const rec of briefing.recommendations) {
      lines.push(`  💡 ${rec}`);
    }
    lines.push('');
  }

  if (briefing.workableNow.length > 0) {
    // Build initiative lookup for task annotations
    const taskInitiativeMap = new Map<string, string>();
    if (briefing.currentFocus) {
      for (const init of briefing.currentFocus.initiatives) {
        for (const tid of init.linkedTaskIds) {
          taskInitiativeMap.set(tid, init.title);
        }
      }
    }

    lines.push(`${BOLD}What would you like to work on?${RESET}`);
    lines.push('');
    lines.push(`  1. ${BOLD}Auto-pick highest priority${RESET} ${DIM}(enginehaus task next)${RESET}`);

    const menuTasks = briefing.workableNow.slice(0, 5);
    for (let i = 0; i < menuTasks.length; i++) {
      const task = menuTasks[i];
      const color = PRIORITY_COLORS[task.priority];
      const initName = taskInitiativeMap.get(task.id);
      const annotation = initName ? ` ${DIM}← ${initName}${RESET}` : '';
      lines.push(`  ${i + 2}. ${color}[${task.priority}]${RESET} ${task.title.slice(0, 50)}${annotation}`);
      lines.push(`     ${DIM}enginehaus task claim ${task.id.slice(0, 8)}${RESET}`);
      // Show linked decisions for this task
      const decisions = briefing.taskDecisions?.get(task.id);
      if (decisions && decisions.length > 0) {
        for (const d of decisions.slice(0, 2)) {
          lines.push(`     ${DIM}↳ ${d.decision.slice(0, 65)}${d.decision.length > 65 ? '...' : ''}${RESET}`);
        }
      }
    }
    if (briefing.workableNow.length > menuTasks.length) {
      lines.push(`     ${DIM}... and ${briefing.workableNow.length - menuTasks.length} more (enginehaus task list -s ready)${RESET}`);
    }
    lines.push('');
    lines.push(`  0. ${BOLD}Something else${RESET} ${DIM}— describe what you'd like to do${RESET}`);
    lines.push('');
  }

  // Agent-specific in-progress breakdown
  if (briefing.agentInProgress && briefing.agentInProgress.length > 0) {
    lines.push(`${BOLD}Your In-Progress Tasks:${RESET}`);
    for (const task of briefing.agentInProgress.slice(0, 5)) {
      const color = PRIORITY_COLORS[task.priority];
      lines.push(`  ${color}●${RESET} [${task.id}] ${task.title.slice(0, 50)}`);
    }
    lines.push('');
  }
  if (briefing.otherAgentInProgress && briefing.otherAgentInProgress.length > 0) {
    lines.push(`${BOLD}Other Agents Working:${RESET}`);
    const byAgent = new Map<string, UnifiedTask[]>();
    for (const { task, agentId } of briefing.otherAgentInProgress) {
      const existing = byAgent.get(agentId) || [];
      existing.push(task);
      byAgent.set(agentId, existing);
    }
    for (const [agent, agentTasks] of byAgent) {
      lines.push(`  ${DIM}@${agent}:${RESET} ${agentTasks.length} task(s)`);
      for (const task of agentTasks.slice(0, 2)) {
        lines.push(`    ${DIM}→ ${task.title.slice(0, 45)}${RESET}`);
      }
    }
    lines.push('');
  }

  if (briefing.bottlenecks.length > 0) {
    lines.push(`${BOLD}Bottlenecks:${RESET}`);
    for (const task of briefing.bottlenecks.slice(0, 3)) {
      lines.push(`  ★ [${task.id}] ${task.title.slice(0, 50)}`);
    }
    lines.push('');
  }

  if (briefing.assignedTasks.length > 0) {
    lines.push(`${BOLD}Waiting for Human Action:${RESET}`);
    // Group by assignee
    const byAssignee = new Map<string, UnifiedTask[]>();
    for (const { task, assignedTo } of briefing.assignedTasks) {
      const existing = byAssignee.get(assignedTo) || [];
      existing.push(task);
      byAssignee.set(assignedTo, existing);
    }
    for (const [assignee, tasks] of byAssignee) {
      lines.push(`  ${YELLOW}@${assignee}:${RESET}`);
      for (const task of tasks.slice(0, 3)) {
        const color = PRIORITY_COLORS[task.priority];
        lines.push(`    ${color}●${RESET} [${task.id}] ${task.title.slice(0, 45)}`);
      }
      if (tasks.length > 3) {
        lines.push(`    ${DIM}... and ${tasks.length - 3} more${RESET}`);
      }
    }
    lines.push('');
  }

  // Pending thoughts awaiting review
  if (briefing.pendingThoughts && briefing.pendingThoughts.length > 0) {
    lines.push(`${BOLD}Pending Thoughts:${RESET} ${DIM}(${briefing.pendingThoughts.length} draft${briefing.pendingThoughts.length === 1 ? '' : 's'})${RESET}`);
    for (const t of briefing.pendingThoughts.slice(0, 3)) {
      lines.push(`  ${DIM}💭${RESET} ${t.thought.slice(0, 70)}${t.thought.length > 70 ? '...' : ''}`);
    }
    if (briefing.pendingThoughts.length > 3) {
      lines.push(`  ${DIM}... and ${briefing.pendingThoughts.length - 3} more${RESET}`);
    }
    lines.push(`  ${DIM}→ review_thoughts to promote, discard, or defer${RESET}`);
    lines.push('');
  }

  // Recent strategic decisions (unattached or recent)
  if (briefing.recentDecisions.length > 0) {
    // Show decisions not already displayed inline with tasks
    const taskDecisionIds = new Set<string>();
    if (briefing.taskDecisions) {
      // We don't have IDs in the taskDecisions map, so just show unattached ones
    }
    const unattachedDecisions = briefing.recentDecisions.filter(d => !d.taskId);
    if (unattachedDecisions.length > 0) {
      lines.push(`${BOLD}Recent Strategic Decisions:${RESET}`);
      for (const d of unattachedDecisions.slice(0, 5)) {
        lines.push(`  ${DIM}•${RESET} ${d.decision.slice(0, 70)}${d.decision.length > 70 ? '...' : ''}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Context Generation
// ============================================================================

/**
 * Generate token-efficient context prompt for a task cluster
 */
export function generateClusterContext(
  tasks: UnifiedTask[],
  focusTaskId: string,
  decisions: StrategicDecision[] = []
): string {
  const nodes = buildTaskNodes(tasks);
  const focusNode = nodes.get(focusTaskId);

  if (!focusNode) {
    return `Task ${focusTaskId} not found`;
  }

  const cluster = getTaskCluster(focusNode, nodes);
  const lines: string[] = [];

  lines.push('# Task Context');
  lines.push('');
  lines.push(`## Focus: ${focusNode.task.title}`);
  lines.push('');
  lines.push(focusNode.task.description || 'No description');
  lines.push('');

  if (focusNode.task.files && focusNode.task.files.length > 0) {
    lines.push('**Files:**');
    for (const file of focusNode.task.files) {
      lines.push(`- ${file}`);
    }
    lines.push('');
  }

  // Dependencies context
  if (cluster.criticalPath.length > 1) {
    lines.push('## Dependency Chain');
    for (let i = 0; i < cluster.criticalPath.length; i++) {
      const task = cluster.criticalPath[i];
      const status = task.status === 'completed' ? '✓' : task.status === 'in-progress' ? '>' : '○';
      lines.push(`${i + 1}. [${status}] ${task.title}`);
    }
    lines.push('');
  }

  // Relevant decisions
  const taskDecisions = decisions.filter(d => d.taskId === focusTaskId);
  if (taskDecisions.length > 0) {
    lines.push('## Prior Decisions');
    for (const decision of taskDecisions) {
      lines.push(`- **${decision.decision}**`);
      if (decision.rationale) {
        lines.push(`  - ${decision.rationale}`);
      }
    }
    lines.push('');
  }

  // What this unblocks
  if (focusNode.blocking.length > 0) {
    lines.push('## Unblocks');
    for (const blocked of focusNode.blocking) {
      lines.push(`- ${blocked.task.title}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getTaskCluster(node: TaskNode, nodes: Map<string, TaskNode>): TaskCluster {
  const cluster: TaskCluster = {
    rootTask: node.task,
    tasks: [],
    criticalPath: [],
    bottlenecks: [],
    workableTasks: [],
  };

  // Get all related tasks
  const visited = new Set<string>();
  collectCluster(node, cluster.tasks, visited, 'both');

  // Find critical path (longest dependency chain to this task)
  cluster.criticalPath = findCriticalPath(node);

  // Find bottlenecks in cluster
  cluster.bottlenecks = cluster.tasks.filter(t => {
    const n = nodes.get(t.id);
    return n && n.isBottleneck;
  });

  // Find workable tasks in cluster
  cluster.workableTasks = cluster.tasks.filter(t => {
    const n = nodes.get(t.id);
    return n && n.isWorkable && t.status !== 'completed';
  });

  return cluster;
}

function collectCluster(node: TaskNode, tasks: UnifiedTask[], visited: Set<string>, direction: 'up' | 'down' | 'both'): void {
  if (visited.has(node.task.id)) return;
  visited.add(node.task.id);
  tasks.push(node.task);

  if (direction === 'up' || direction === 'both') {
    for (const blocker of node.blockers) {
      collectCluster(blocker, tasks, visited, 'up');
    }
  }

  if (direction === 'down' || direction === 'both') {
    for (const blocking of node.blocking) {
      collectCluster(blocking, tasks, visited, 'down');
    }
  }
}

function findCriticalPath(node: TaskNode): UnifiedTask[] {
  // Find longest path from root to this node
  const path: UnifiedTask[] = [node.task];

  let current = node;
  while (current.blockers.length > 0) {
    // Pick the blocker with the longest chain
    const longestBlocker = current.blockers.reduce((a, b) =>
      countUpstream(a) > countUpstream(b) ? a : b
    );
    path.unshift(longestBlocker.task);
    current = longestBlocker;
  }

  return path;
}

function countUpstream(node: TaskNode): number {
  if (node.blockers.length === 0) return 1;
  return 1 + Math.max(...node.blockers.map(countUpstream));
}

// ============================================================================
// Utilities
// ============================================================================

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function traceDependencyChain(node: TaskNode): UnifiedTask[] {
  const chain: UnifiedTask[] = [node.task];
  let current = node;

  while (current.blockers.length > 0) {
    const blocker = current.blockers.find(b => b.task.status !== 'completed') || current.blockers[0];
    chain.unshift(blocker.task);
    current = blocker;
  }

  return chain;
}

function calculateStats(nodes: Map<string, TaskNode>): {
  total: number;
  ready: number;
  inProgress: number;
  blocked: number;
  completed: number;
} {
  let ready = 0, inProgress = 0, blocked = 0, completed = 0;

  for (const node of nodes.values()) {
    switch (node.task.status) {
      case 'ready': ready++; break;
      case 'in-progress': inProgress++; break;
      case 'blocked': blocked++; break;
      case 'completed': completed++; break;
    }
  }

  return {
    total: nodes.size,
    ready,
    inProgress,
    blocked,
    completed,
  };
}

// ============================================================================
// Main Entry Points
// ============================================================================

/**
 * Render task graph based on view type
 */
export function renderTaskGraph(
  tasks: UnifiedTask[],
  options: GraphOptions = {}
): string {
  const { view = 'developer' } = options;

  switch (view) {
    case 'developer':
      return renderDeveloperView(tasks, options);
    case 'lead':
      return renderLeadView(tasks, options);
    case 'full':
      return renderFullGraph(tasks, options);
    default:
      return renderDeveloperView(tasks, options);
  }
}

/**
 * Render task graph for session (requires session data)
 */
export function renderSessionGraph(
  tasks: UnifiedTask[],
  session: CoordinationSession | null,
  decisions: StrategicDecision[],
  options: GraphOptions = {}
): string {
  return renderSessionView(tasks, session, decisions, options);
}
