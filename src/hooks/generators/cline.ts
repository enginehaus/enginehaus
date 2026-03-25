/**
 * Cline hook config.
 * Uses TaskStart instead of SessionStart.
 * Uses different tool names: write_to_file|apply_diff and execute_command.
 * Writes to .clinerules/hooks/hooks.json
 */

import { createHookGenerator, ClientHookConfig } from './config-hook-generator.js';

export const clineConfig: ClientHookConfig = {
  configPath: '.clinerules/hooks/hooks.json',
  hooksKey: 'hooks',
  hookDefs: [
    { hookType: 'TaskStart', scriptName: 'session-start', matcher: {}, label: 'TaskStart (session-start)' },
    { hookType: 'PreToolUse', scriptName: 'enforce-workflow', matcher: 'write_to_file|apply_diff', label: 'PreToolUse (enforce-workflow)' },
    { hookType: 'PostToolUse', scriptName: 'post-commit-reminder', matcher: 'execute_command', label: 'PostToolUse (post-commit-reminder)' },
    { hookType: 'PostToolUse', scriptName: 'detect-pipe-workaround', matcher: 'execute_command', label: 'PostToolUse (detect-pipe-workaround)' },
    { hookType: 'PostToolUse', scriptName: 'detect-context-loss', matcher: 'execute_command', label: 'PostToolUse (detect-context-loss)' },
    { hookType: 'PostToolUse', scriptName: 'auto-decision-capture', matcher: 'execute_command', label: 'PostToolUse (auto-decision-capture)' },
  ],
};

export const clineGenerator = createHookGenerator(clineConfig);
