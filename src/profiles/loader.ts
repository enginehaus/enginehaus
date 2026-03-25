/**
 * Profile Loader
 *
 * Discovers and loads domain profiles from built-in and user directories.
 * User profiles (~/.enginehaus/profiles/) take precedence over built-in profiles.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { DomainProfile } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load a profile by name. Checks user profiles first (~/.enginehaus/profiles/),
 * then built-in profiles (src/profiles/).
 */
export async function loadProfile(name: string): Promise<DomainProfile | null> {
  // Check user profiles first
  const userDir = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.enginehaus', 'profiles'
  );
  const userPath = path.join(userDir, `${name}.json`);
  if (existsSync(userPath)) {
    return JSON.parse(readFileSync(userPath, 'utf-8')) as DomainProfile;
  }

  // Check built-in profiles
  const builtinPath = path.join(__dirname, `${name}.json`);
  if (existsSync(builtinPath)) {
    return JSON.parse(readFileSync(builtinPath, 'utf-8')) as DomainProfile;
  }

  return null;
}

/**
 * List all available profiles (built-in + user).
 */
export async function listProfiles(): Promise<Array<{ name: string; label: string; experimental?: boolean }>> {
  const profiles: Map<string, { name: string; label: string; experimental?: boolean }> = new Map();

  // Load built-in profiles
  if (existsSync(__dirname)) {
    for (const file of readdirSync(__dirname)) {
      if (file.endsWith('.json')) {
        try {
          const profile = JSON.parse(readFileSync(path.join(__dirname, file), 'utf-8')) as DomainProfile;
          profiles.set(profile.name, { name: profile.name, label: profile.label, experimental: profile.experimental });
        } catch { /* skip malformed */ }
      }
    }
  }

  // Load user profiles (override built-in if same name)
  const userDir = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.enginehaus', 'profiles'
  );
  if (existsSync(userDir)) {
    for (const file of readdirSync(userDir)) {
      if (file.endsWith('.json')) {
        try {
          const profile = JSON.parse(readFileSync(path.join(userDir, file), 'utf-8')) as DomainProfile;
          profiles.set(profile.name, { name: profile.name, label: profile.label, experimental: profile.experimental });
        } catch { /* skip malformed */ }
      }
    }
  }

  return Array.from(profiles.values());
}
