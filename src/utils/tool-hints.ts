/**
 * HATEOAS-style Workflow Hints
 *
 * Like REST HATEOAS, responses include the available next actions
 * based on current state. Agents discover tools at the moment
 * they're relevant — not from a static list of 80+ tools.
 *
 * State-aware: hints change based on what the agent has/hasn't done,
 * what the task looks like, and what the project needs.
 */

export interface ToolHint {
  tool: string;
  reason: string;
}

/**
 * Generate next-action hints for a task claim (get_next_task / start_work).
 * Based on: what does this task need? what hasn't been done yet?
 */
export function getClaimHints(context: {
  hasBlockedBy?: boolean;
  hasInitiative?: boolean;
  hasRelatedTasks?: boolean;
  hasFiles?: boolean;
  hasQualityGates?: boolean;
  hasProjectInitiatives?: boolean;
  taskTitle?: string;
  taskDescription?: string;
}): ToolHint[] {
  const hints: ToolHint[] = [];

  // State: task is linked to initiative → agent should review learnings
  if (context.hasInitiative) {
    hints.push({
      tool: 'get_initiative_learnings',
      reason: 'This task is linked to an initiative — review past patterns before starting',
    });
  }

  // State: project has no initiatives → nudge toward creating one
  if (!context.hasInitiative && !context.hasProjectInitiatives) {
    hints.push({
      tool: 'suggest_initiatives',
      reason: 'No initiatives set for this project — run this to discover natural task groupings and set strategic focus',
    });
  }

  // State: task has dependencies → check them
  if (context.hasBlockedBy) {
    hints.push({
      tool: 'get_dependencies',
      reason: 'This task has dependencies — check their status before diving in',
    });
  }

  // Always: log_decision is the #1 underused high-value tool
  hints.push({
    tool: 'log_decision',
    reason: 'Log choices as you work — they satisfy quality gates and help future agents',
  });

  // State: complex-looking task → suggest capture_insight
  const desc = (context.taskDescription || '').toLowerCase();
  const title = (context.taskTitle || '').toLowerCase();
  if (desc.includes('refactor') || desc.includes('design') || desc.includes('architect') ||
      title.includes('refactor') || title.includes('design') || title.includes('architect')) {
    hints.push({
      tool: 'capture_insight',
      reason: 'Capture design insights — useful for architectural work',
    });
  }

  return hints.slice(0, 3);
}

/**
 * Generate next-action hints for task completion (complete_task_smart).
 * Based on: what was done? what follow-up is available?
 */
export function getCompletionHints(context: {
  hasInitiative?: boolean;
  hasRelatedTasks?: boolean;
  filesChangedCount?: number;
  decisionsLogged?: number;
  inlineDecisionsLogged?: number;
}): ToolHint[] {
  const hints: ToolHint[] = [];

  if (context.hasInitiative) {
    hints.push({
      tool: 'record_initiative_outcome',
      reason: 'Update the initiative with this task\'s contribution',
    });
  }

  if ((context.filesChangedCount || 0) > 5) {
    hints.push({
      tool: 'link_artifact',
      reason: 'Link key artifacts to the task for future reference',
    });
  }

  if (context.hasRelatedTasks) {
    hints.push({
      tool: 'suggest_relationships',
      reason: 'Discover tasks that might benefit from what you just built',
    });
  }

  return hints.slice(0, 2);
}
