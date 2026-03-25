import * as os from 'os';
import * as path from 'path';

/**
 * Expand ~ to home directory in paths.
 * Only expands ~/... (not ~user/...).
 */
export function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === '~') {
    return os.homedir();
  }
  return p;
}
