/**
 * Shared hook enforcement logic.
 *
 * Used by:
 * - Server-side enforcement (Tier 2) in src/index.ts
 * - Could be called from shell scripts via `node -e` in the future
 *
 * Shell scripts (Tier 1) remain self-contained for now — they don't
 * depend on this module. This keeps them zero-dependency and portable.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

export interface HookResult {
  action: 'allow' | 'block' | 'notify';
  reason?: string;
  notification?: string;
}

/**
 * PreToolUse enforcement: is there a claimed in-progress task?
 * Shells out to the CLI to avoid importing the full coordination stack.
 */
export async function enforceTaskClaimed(projectRoot: string): Promise<HookResult> {
  // Only enforce in Enginehaus-linked projects
  const configPath = path.join(projectRoot, '.enginehaus', 'config.json');
  if (!existsSync(configPath)) {
    return { action: 'allow' };
  }

  try {
    const output = execFileSync('enginehaus', ['task', 'list', '-s', 'in-progress', '--json'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).toString();

    // JSON output is clean when piped (no [enginehaus] prefix since TTY gating)
    const jsonStr = output.trim();
    if (!jsonStr) {
      return {
        action: 'block',
        reason: 'No task claimed. Run `get_next_task` or `claim_task` before making changes.',
      };
    }

    const tasks = JSON.parse(jsonStr);
    if (Array.isArray(tasks) && tasks.length > 0) {
      return { action: 'allow' };
    }

    return {
      action: 'block',
      reason: 'No task claimed. Run `get_next_task` or `claim_task` before making changes.',
    };
  } catch {
    // If CLI is unavailable or fails, allow (don't block work due to tooling issues)
    return { action: 'allow' };
  }
}

/**
 * PostToolUse notification: was this a git commit?
 */
export function postCommitReminder(toolInput: { command?: string }): HookResult {
  if (toolInput.command && /git\s+commit/.test(toolInput.command)) {
    return {
      action: 'notify',
      notification: [
        '[enginehaus] Commit detected. Before completing this task:',
        '  1. Run tests: npm test',
        '  2. Push: git push',
        '  3. Complete: enginehaus task complete <id> -s "summary"',
      ].join('\n'),
    };
  }
  return { action: 'allow' };
}

/**
 * SessionStart: generate project briefing text.
 */
export async function generateSessionBriefing(projectRoot: string): Promise<string | null> {
  const configPath = path.join(projectRoot, '.enginehaus', 'config.json');
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const output = execFileSync('enginehaus', ['briefing'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).toString();

    if (!output.trim()) return null;

    return [
      '=== ENGINEHAUS CONTEXT (auto-loaded) ===',
      '',
      output.trim(),
      '',
      '=== END ENGINEHAUS CONTEXT ===',
      '',
      'You now have full project context. Work on the highest priority task.',
      "Use 'enginehaus task next' to claim it, or check 'enginehaus task list' for options.",
    ].join('\n');
  } catch {
    return null;
  }
}
