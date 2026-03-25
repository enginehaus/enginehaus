/**
 * Decision Prompting
 *
 * Structural prompting for decision logging based on session patterns.
 * Injects "decision moment?" hints into tool responses when conditions
 * suggest the agent should log an architectural choice.
 */

import type { CoordinationService } from '../core/services/coordination-service.js';

/** Keywords in task descriptions that suggest decision-heavy work */
const DECISION_KEYWORDS = [
  'architecture', 'tradeoff', 'trade-off', 'approach', 'decision',
  'design', 'pattern', 'strategy', 'migration', 'refactor',
  'dependency', 'schema', 'protocol', 'interface',
];

/** Minutes since last decision before prompting */
const DECISION_STALENESS_MINUTES = 15;

export interface DecisionPromptContext {
  taskId: string;
  taskDescription?: string;
  taskTitle?: string;
  currentPhase?: number;
  sessionStartTime?: Date;
}

/**
 * Check if we should prompt the agent to log a decision.
 * Returns a prompt string if yes, undefined if no.
 */
export async function getDecisionPrompt(
  service: CoordinationService,
  ctx: DecisionPromptContext
): Promise<string | undefined> {
  // Get recent decisions for this task
  const recentDecisions = await service.getDecisions({
    taskId: ctx.taskId,
    limit: 1,
  });

  const lastDecisionTime = recentDecisions.decisions.length > 0
    ? new Date(recentDecisions.decisions[0].createdAt)
    : null;

  const now = new Date();
  const reasons: string[] = [];

  // 1. Time-based: stale decision log
  if (lastDecisionTime) {
    const minutesSince = (now.getTime() - lastDecisionTime.getTime()) / (1000 * 60);
    if (minutesSince > DECISION_STALENESS_MINUTES) {
      reasons.push('time');
    }
  } else if (ctx.sessionStartTime) {
    // No decisions at all — check if session has been active long enough
    const sessionMinutes = (now.getTime() - ctx.sessionStartTime.getTime()) / (1000 * 60);
    if (sessionMinutes > DECISION_STALENESS_MINUTES) {
      reasons.push('no-decisions');
    }
  }

  // 2. Keyword-based: task description suggests decision-heavy work
  const searchText = `${ctx.taskTitle || ''} ${ctx.taskDescription || ''}`.toLowerCase();
  const matchedKeywords = DECISION_KEYWORDS.filter(kw => searchText.includes(kw));
  if (matchedKeywords.length > 0 && !lastDecisionTime) {
    reasons.push('keywords');
  }

  // 3. Phase-based: entering implementation (phase 3+) without decisions
  if (ctx.currentPhase && ctx.currentPhase >= 3 && !lastDecisionTime) {
    reasons.push('phase');
  }

  if (reasons.length === 0) return undefined;

  return '\n\n💡 **Decision moment?** If you\'ve made an architectural choice or tradeoff, log it: `log_decision({ decision: "...", rationale: "..." })`';
}
