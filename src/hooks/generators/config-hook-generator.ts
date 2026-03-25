/**
 * Parameterized hook generator factory.
 *
 * All MCP clients use the same install/uninstall algorithm — they only differ in:
 *   1. Config file path (relative to project root)
 *   2. JSON key path for the hooks object
 *   3. Hook event names and tool matchers
 *
 * To add a new client, export a ClientHookConfig and register it in install.ts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import { HookGenerator, HookInstallOptions, HookInstallResult, hookCommand } from './types.js';

export interface HookDef {
  /** Event name in the client's hook system (e.g. 'PreToolUse', 'BeforeTool') */
  hookType: string;
  /** Script filename without extension (e.g. 'enforce-workflow') */
  scriptName: string;
  /** Tool matcher pattern (e.g. 'Edit|Write') or {} for no matcher */
  matcher: string | Record<string, never>;
  /** Human-readable label for install output */
  label: string;
}

export interface ClientHookConfig {
  /** Relative path from project root to config file (e.g. '.claude/settings.json') */
  configPath: string;
  /** Dot-separated key path to the hooks object (e.g. 'hooks' or 'github.copilot.chat.hooks') */
  hooksKey: string;
  /** Hook definitions for this client */
  hookDefs: HookDef[];
}

/**
 * Get or create the hooks object within a nested key path.
 * e.g. getNestedHooks(settings, 'github.copilot.chat.hooks') traverses/creates each level.
 */
function getOrCreateNestedObj(obj: any, keyPath: string): any {
  const keys = keyPath.split('.');
  let current = obj;
  for (const key of keys) {
    if (!current[key]) current[key] = {};
    current = current[key];
  }
  return current;
}

/**
 * Get a nested object by key path, returning undefined if any level is missing.
 */
function getNestedObj(obj: any, keyPath: string): any {
  const keys = keyPath.split('.');
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Delete a nested key if its value is an empty object, cleaning up parent chain.
 */
function deleteIfEmpty(obj: any, keyPath: string): void {
  const keys = keyPath.split('.');
  // Walk to the parent of the deepest key
  const parents: Array<{ obj: any; key: string }> = [];
  let current = obj;
  for (const key of keys) {
    parents.push({ obj: current, key });
    current = current?.[key];
  }
  // Clean up from deepest to shallowest
  for (let i = parents.length - 1; i >= 0; i--) {
    const { obj: parent, key } = parents[i];
    const val = parent[key];
    if (val && typeof val === 'object' && Object.keys(val).length === 0) {
      delete parent[key];
    } else {
      break; // Stop if this level isn't empty
    }
  }
}

const SCRIPT_NAMES = ['session-start', 'enforce-workflow', 'post-commit-reminder'];

/**
 * Create a HookGenerator from a client config.
 * This is the only install/uninstall logic — all clients share it.
 */
export function createHookGenerator(config: ClientHookConfig): HookGenerator {
  return {
    install(opts: HookInstallOptions): HookInstallResult {
      const result: HookInstallResult = { installed: [], skipped: [], errors: [] };
      const fullConfigPath = path.join(opts.projectRoot, config.configPath);
      const configDir = path.dirname(fullConfigPath);

      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      let settings: any = {};
      if (existsSync(fullConfigPath)) {
        try {
          settings = JSON.parse(readFileSync(fullConfigPath, 'utf-8'));
        } catch {
          settings = {};
        }
      }

      const hooks = getOrCreateNestedObj(settings, config.hooksKey);

      for (const def of config.hookDefs) {
        const scriptPath = path.join(opts.globalHooksDir, def.scriptName + opts.hookExt);
        if (!existsSync(scriptPath)) {
          result.errors.push(`${def.label}: script not found at ${scriptPath}`);
          continue;
        }

        const existing = hooks[def.hookType] || [];
        const hasEnginehaus = existing.some((h: any) =>
          h.hooks?.some((hh: any) =>
            hh.command?.includes('enginehaus') || hh.command?.includes(def.scriptName)
          )
        );

        if (hasEnginehaus) {
          result.skipped.push(def.label);
          continue;
        }

        hooks[def.hookType] = [
          ...existing,
          {
            matcher: def.matcher,
            hooks: [{ type: 'command', command: hookCommand(scriptPath, opts.isWindows) }],
          },
        ];
        result.installed.push(def.label);
      }

      writeFileSync(fullConfigPath, JSON.stringify(settings, null, 2));
      return result;
    },

    uninstall(projectRoot: string): void {
      const fullConfigPath = path.join(projectRoot, config.configPath);
      if (!existsSync(fullConfigPath)) return;

      try {
        const settings = JSON.parse(readFileSync(fullConfigPath, 'utf-8'));
        const hooks = getNestedObj(settings, config.hooksKey);
        if (!hooks) return;

        const hookTypes = config.hookDefs.map(d => d.hookType);
        for (const hookType of hookTypes) {
          const entries = hooks[hookType];
          if (!Array.isArray(entries)) continue;
          hooks[hookType] = entries.filter((h: any) =>
            !h.hooks?.some((hh: any) =>
              SCRIPT_NAMES.some(name => hh.command?.includes(name)) ||
              hh.command?.includes('enginehaus')
            )
          );
          if (hooks[hookType].length === 0) {
            delete hooks[hookType];
          }
        }

        deleteIfEmpty(settings, config.hooksKey);
        writeFileSync(fullConfigPath, JSON.stringify(settings, null, 2));
      } catch { /* ignore parse errors */ }
    },
  };
}
