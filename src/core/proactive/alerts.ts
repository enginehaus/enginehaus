/**
 * Proactive Intelligence — Tier 1 Heuristic Alerts
 *
 * Event-driven checks that surface genuinely relevant information.
 * Principle: if the agent says "so what?" it's noise. If they say
 * "oh shit, good catch" it's relevant.
 *
 * These are heuristic-only (no LLM required).
 */

import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { UnifiedTask } from '../../coordination/types.js';

export interface ProactiveAlert {
  type: 'stall' | 'decision-debt' | 'stale-question' | 'heavy-session';
  severity: 'blocking' | 'warning' | 'info';
  title: string;
  action: string;
  context?: Record<string, unknown>;
}

/**
 * Check for stall: task has been claimed across multiple sessions
 * without progress. Compares to median session count for completed
 * tasks in the same project.
 */
export async function checkStall(
  storage: StorageAdapter,
  task: UnifiedTask
): Promise<ProactiveAlert | null> {
  const sessions = await storage.getSessionsForTask(task.id);
  const sessionCount = sessions.length;

  // Need at least 3 sessions before flagging
  if (sessionCount < 3) return null;

  // Get median session count for completed tasks in same project
  const completedTasks = await storage.getTasks({ projectId: task.projectId, status: 'completed' });
  if (completedTasks.length < 5) return null; // Not enough data

  const sessionCounts: number[] = [];
  // Sample up to 20 recent completed tasks for performance
  const sample = completedTasks.slice(0, 20);
  for (const ct of sample) {
    const ctSessions = await storage.getSessionsForTask(ct.id);
    if (ctSessions.length > 0) sessionCounts.push(ctSessions.length);
  }

  if (sessionCounts.length < 3) return null;

  sessionCounts.sort((a, b) => a - b);
  const median = sessionCounts[Math.floor(sessionCounts.length / 2)];

  // Flag if 2x the median
  if (sessionCount >= median * 2 && sessionCount > 3) {
    return {
      type: 'stall',
      severity: 'warning',
      title: `Task at ${sessionCount} sessions (typical: ${median})`,
      action: 'Consider breaking into subtasks, or flag_for_human if blocked.',
      context: { sessionCount, medianForProject: median },
    };
  }

  return null;
}

/**
 * Check for decision debt: task has been in-progress for multiple
 * sessions but no decisions logged. Decisions capture the "why"
 * that makes work reproducible.
 */
export async function checkDecisionDebt(
  storage: StorageAdapter,
  task: UnifiedTask
): Promise<ProactiveAlert | null> {
  const sessions = await storage.getSessionsForTask(task.id);
  if (sessions.length < 2) return null;

  const decisions = await storage.getDecisions({ taskId: task.id, limit: 1 });
  if (decisions.length > 0) return null;

  return {
    type: 'decision-debt',
    severity: 'info',
    title: `${sessions.length} sessions, no decisions logged`,
    action: 'Log architectural choices with log_decision to capture "why".',
  };
}

/**
 * Run all proactive checks for a task being claimed/started.
 * Returns only genuinely relevant alerts.
 */
export async function getProactiveAlerts(
  storage: StorageAdapter,
  task: UnifiedTask
): Promise<ProactiveAlert[]> {
  const checks = await Promise.all([
    checkStall(storage, task),
    checkDecisionDebt(storage, task),
  ]);

  return checks.filter((a): a is ProactiveAlert => a !== null);
}
