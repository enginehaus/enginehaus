/**
 * Canonical path resolution for Enginehaus data directory.
 *
 * ALL entry points (MCP, CLI, REST) MUST use this function.
 * This is the single source of truth for where the database lives.
 *
 * Resolution order:
 * 1. ENGINEHAUS_DATA_DIR environment variable (explicit override)
 * 2. ~/.enginehaus/data/ (canonical default)
 */

import * as path from 'path';
import * as os from 'os';

let resolved: string | null = null;

export function getDataDir(): string {
  if (!resolved) {
    resolved = process.env.ENGINEHAUS_DATA_DIR || path.join(os.homedir(), '.enginehaus', 'data');
    // Log on first resolution so path issues are visible — but only to TTY
    // to avoid polluting piped/scripted output (e.g. --json | jq)
    if (process.stderr.isTTY) {
      console.error(`[enginehaus] Database: ${resolved}/enginehaus.db`);
    }
  }
  return resolved;
}
