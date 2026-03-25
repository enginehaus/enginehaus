/**
 * Cursor hook config.
 * Same JSON format as Claude Code, stored in .cursor/hooks.json
 */

import { createHookGenerator, ClientHookConfig } from './config-hook-generator.js';

export const cursorConfig: ClientHookConfig = {
  configPath: '.cursor/hooks.json',
  hooksKey: 'hooks',
  hookDefs: [
    { hookType: 'SessionStart', scriptName: 'session-start', matcher: {}, label: 'SessionStart' },
    { hookType: 'PreToolUse', scriptName: 'enforce-workflow', matcher: 'Edit|Write', label: 'PreToolUse' },
    { hookType: 'PostToolUse', scriptName: 'post-commit-reminder', matcher: 'Bash', label: 'PostToolUse (post-commit-reminder)' },
    { hookType: 'PostToolUse', scriptName: 'detect-pipe-workaround', matcher: 'Bash', label: 'PostToolUse (detect-pipe-workaround)' },
    { hookType: 'PostToolUse', scriptName: 'detect-context-loss', matcher: 'Bash', label: 'PostToolUse (detect-context-loss)' },
    { hookType: 'PostToolUse', scriptName: 'auto-decision-capture', matcher: 'Bash', label: 'PostToolUse (auto-decision-capture)' },
  ],
};

export const cursorGenerator = createHookGenerator(cursorConfig);
