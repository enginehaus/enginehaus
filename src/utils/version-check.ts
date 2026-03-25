/**
 * Version Check Utility
 *
 * Checks for updates from npm registry with daily caching.
 * Non-blocking - failures silently return null.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  isMajorUpdate: boolean;
  isMinorUpdate: boolean;
  isPatchUpdate: boolean;
}

interface CachedCheck {
  timestamp: number;
  latestVersion: string;
}

const PACKAGE_NAME = 'enginehaus';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILE = path.join(os.homedir(), '.enginehaus', 'last-version-check.json');

/**
 * Get current installed version from package.json
 */
export function getCurrentVersion(): string {
  try {
    // In ES modules, use import.meta.url to find package.json
    const currentFileUrl = import.meta.url;
    const currentFilePath = new URL(currentFileUrl).pathname;
    // Go up from build/utils/ to project root
    const packageJsonPath = path.resolve(path.dirname(currentFilePath), '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Parse semver string into components
 */
function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two semver strings
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  if (!parsedA || !parsedB) return 0;

  if (parsedA.major !== parsedB.major) return parsedA.major > parsedB.major ? 1 : -1;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor > parsedB.minor ? 1 : -1;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch > parsedB.patch ? 1 : -1;

  return 0;
}

/**
 * Read cached version check result
 */
function readCache(): CachedCheck | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const content = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(content) as CachedCheck;
  } catch {
    return null;
  }
}

/**
 * Write cached version check result
 */
function writeCache(latestVersion: string): void {
  try {
    const cacheDir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const cache: CachedCheck = {
      timestamp: Date.now(),
      latestVersion,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Silently ignore cache write failures
  }
}

/**
 * Fetch latest version from npm registry
 * Returns null on failure (non-blocking)
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json() as { version?: string };
    return data.version || null;
  } catch {
    return null;
  }
}

/**
 * Check for updates (with caching)
 *
 * - Returns cached result if checked within last 24 hours
 * - Fetches from npm registry otherwise
 * - Non-blocking: returns null on any failure
 */
export async function checkForUpdates(): Promise<VersionCheckResult | null> {
  try {
    const currentVersion = getCurrentVersion();

    // Check cache first
    const cached = readCache();
    const now = Date.now();

    let latestVersion: string | null = null;

    if (cached && (now - cached.timestamp) < CHECK_INTERVAL_MS) {
      // Use cached version
      latestVersion = cached.latestVersion;
    } else {
      // Fetch from npm
      latestVersion = await fetchLatestVersion();

      if (latestVersion) {
        writeCache(latestVersion);
      } else if (cached) {
        // Fetch failed, fall back to stale cache
        latestVersion = cached.latestVersion;
      }
    }

    if (!latestVersion) return null;

    const comparison = compareSemver(latestVersion, currentVersion);
    const updateAvailable = comparison > 0;

    // Determine update type
    const current = parseSemver(currentVersion);
    const latest = parseSemver(latestVersion);

    let isMajorUpdate = false;
    let isMinorUpdate = false;
    let isPatchUpdate = false;

    if (current && latest && updateAvailable) {
      if (latest.major > current.major) {
        isMajorUpdate = true;
      } else if (latest.minor > current.minor) {
        isMinorUpdate = true;
      } else if (latest.patch > current.patch) {
        isPatchUpdate = true;
      }
    }

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      isMajorUpdate,
      isMinorUpdate,
      isPatchUpdate,
    };
  } catch {
    return null;
  }
}

/**
 * Format update notification message (one-liner)
 */
export function formatUpdateMessage(result: VersionCheckResult): string {
  if (!result.updateAvailable) return '';

  const urgency = result.isMajorUpdate ? '⚠️ ' : '';
  return `${urgency}Enginehaus v${result.latestVersion} available (you have v${result.currentVersion}). Run \`eh update\``;
}

/**
 * Check if we should show update notification
 * Only show if update is available and it's been a while
 */
export async function shouldShowUpdateNotification(): Promise<{ show: boolean; message: string }> {
  const result = await checkForUpdates();

  if (!result || !result.updateAvailable) {
    return { show: false, message: '' };
  }

  // Show notification for any update
  return {
    show: true,
    message: formatUpdateMessage(result),
  };
}
