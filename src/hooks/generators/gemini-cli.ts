/**
 * Gemini CLI hook config.
 * Uses BeforeTool/AfterTool instead of PreToolUse/PostToolUse.
 * Writes to .gemini/settings.json
 */

import { createHookGenerator, ClientHookConfig } from './config-hook-generator.js';

export const geminiCliConfig: ClientHookConfig = {
  configPath: '.gemini/settings.json',
  hooksKey: 'hooks',
  hookDefs: [
    { hookType: 'SessionStart', scriptName: 'session-start', matcher: '', label: 'SessionStart' },
    { hookType: 'BeforeTool', scriptName: 'enforce-workflow', matcher: 'Edit|Write', label: 'BeforeTool (enforce-workflow)' },
    { hookType: 'AfterTool', scriptName: 'post-commit-reminder', matcher: 'Bash', label: 'AfterTool (post-commit-reminder)' },
    { hookType: 'AfterTool', scriptName: 'detect-pipe-workaround', matcher: 'Bash', label: 'AfterTool (detect-pipe-workaround)' },
    { hookType: 'AfterTool', scriptName: 'detect-context-loss', matcher: 'Bash', label: 'AfterTool (detect-context-loss)' },
    { hookType: 'AfterTool', scriptName: 'auto-decision-capture', matcher: 'Bash', label: 'AfterTool (auto-decision-capture)' },
  ],
};

export const geminiCliGenerator = createHookGenerator(geminiCliConfig);
