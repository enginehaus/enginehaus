/**
 * Hook installation orchestrator.
 * Detects clients and installs hooks using the appropriate generator.
 */

import { existsSync, copyFileSync, chmodSync, mkdirSync, readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DetectedClient } from './client-detection.js';
import { HookInstallOptions, HookInstallResult, HookGenerator } from './generators/types.js';
import { claudeCodeGenerator } from './generators/claude-code.js';
import { vscodeCopilotGenerator } from './generators/vscode-copilot.js';
import { cursorGenerator } from './generators/cursor.js';
import { clineGenerator } from './generators/cline.js';
import { geminiCliGenerator } from './generators/gemini-cli.js';

const generators: Record<string, HookGenerator> = {
  'claude-code': claudeCodeGenerator,
  'vscode-copilot': vscodeCopilotGenerator,
  'cursor': cursorGenerator,
  'cline': clineGenerator,
  'gemini-cli': geminiCliGenerator,
};

/**
 * Deploy hook scripts from the package to ~/.enginehaus/hooks/
 */
export function deployHookScripts(packageHooksDir: string): string {
  const globalHooksDir = path.join(os.homedir(), '.enginehaus', 'hooks');
  if (!existsSync(globalHooksDir)) {
    mkdirSync(globalHooksDir, { recursive: true });
  }

  const isWindows = process.platform === 'win32';
  const hookExt = isWindows ? '.ps1' : '.sh';
  const hookNames = ['session-start', 'enforce-workflow', 'post-commit-reminder', 'detect-pipe-workaround', 'detect-context-loss', 'auto-decision-capture'];

  for (const hookName of hookNames) {
    const src = path.join(packageHooksDir, hookName + hookExt);
    const dest = path.join(globalHooksDir, hookName + hookExt);
    if (existsSync(src)) {
      // Deploy if missing, or update if source has changed (e.g., after upgrade)
      const needsCopy = !existsSync(dest) ||
        readFileSync(src, 'utf-8') !== readFileSync(dest, 'utf-8');
      if (needsCopy) {
        copyFileSync(src, dest);
        if (!isWindows) chmodSync(dest, 0o755);
      }
    }
  }

  return globalHooksDir;
}

/**
 * Install hooks for a specific detected client.
 */
export function installHooksForClient(
  client: DetectedClient,
  opts: HookInstallOptions,
): HookInstallResult {
  const generator = generators[client.id];
  if (!generator) {
    return {
      installed: [],
      skipped: [],
      errors: [`No generator for client: ${client.id}`],
    };
  }
  return generator.install(opts);
}

/**
 * Uninstall hooks for a specific client.
 */
export function uninstallHooksForClient(clientId: string, projectRoot: string): void {
  const generator = generators[clientId];
  if (generator) {
    generator.uninstall(projectRoot);
  }
}

/**
 * Install hooks for all detected Tier 1 clients.
 * Returns results keyed by client ID.
 */
export function installAllHooks(
  clients: DetectedClient[],
  projectRoot: string,
  globalHooksDir: string,
): Record<string, HookInstallResult> {
  const isWindows = process.platform === 'win32';
  const hookExt = isWindows ? '.ps1' : '.sh';
  const results: Record<string, HookInstallResult> = {};

  for (const client of clients) {
    if (client.tier !== 1) continue;
    if (!generators[client.id]) continue;

    results[client.id] = installHooksForClient(client, {
      projectRoot,
      globalHooksDir,
      hookExt,
      isWindows,
    });
  }

  return results;
}
