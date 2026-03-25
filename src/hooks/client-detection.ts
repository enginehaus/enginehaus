/**
 * Detect which MCP clients are installed on this machine.
 *
 * Uses filesystem checks (config directories, settings files) rather
 * than process detection — we care about what's installed, not running.
 */

import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

export type ClientId =
  | 'claude-code'
  | 'vscode-copilot'
  | 'cursor'
  | 'cline'
  | 'gemini-cli'
  | 'opencode'
  | 'windsurf'
  | 'claude-desktop'
  | 'roo-code'
  | 'lm-studio'
  | 'kiro-cli';

export interface DetectedClient {
  id: ClientId;
  name: string;
  tier: 1 | 2;
  configPath: string;
  hooksSupported: {
    preToolUse: boolean;
    postToolUse: boolean;
    sessionStart: boolean;
  };
}

/**
 * Detect which MCP clients are installed/configured.
 */
export function detectClients(projectRoot: string): DetectedClient[] {
  const clients: DetectedClient[] = [];
  const home = os.homedir();

  // Claude Code: .claude/ directory in project
  if (existsSync(path.join(projectRoot, '.claude')) || commandExists('claude')) {
    clients.push({
      id: 'claude-code',
      name: 'Claude Code',
      tier: 1,
      configPath: path.join(projectRoot, '.claude', 'settings.json'),
      hooksSupported: { preToolUse: true, postToolUse: true, sessionStart: true },
    });
  }

  // VS Code + Copilot: .vscode/ directory or `code` on PATH
  if (existsSync(path.join(projectRoot, '.vscode')) || commandExists('code')) {
    clients.push({
      id: 'vscode-copilot',
      name: 'VS Code + Copilot',
      tier: 1,
      configPath: path.join(projectRoot, '.vscode', 'settings.json'),
      hooksSupported: { preToolUse: true, postToolUse: true, sessionStart: true },
    });
  }

  // Cursor: .cursor/ directory
  if (existsSync(path.join(projectRoot, '.cursor')) || existsSync(path.join(home, '.cursor'))) {
    clients.push({
      id: 'cursor',
      name: 'Cursor',
      tier: 1,
      configPath: path.join(projectRoot, '.cursor', 'hooks.json'),
      hooksSupported: { preToolUse: true, postToolUse: true, sessionStart: true },
    });
  }

  // Cline: .clinerules/ in project or ~/Documents/Cline/
  if (existsSync(path.join(projectRoot, '.clinerules')) ||
      existsSync(path.join(home, 'Documents', 'Cline'))) {
    clients.push({
      id: 'cline',
      name: 'Cline',
      tier: 1,
      configPath: path.join(projectRoot, '.clinerules', 'hooks', 'hooks.json'),
      hooksSupported: { preToolUse: true, postToolUse: true, sessionStart: true },
    });
  }

  // Gemini CLI: .gemini/ directory or `gemini` on PATH
  if (existsSync(path.join(projectRoot, '.gemini')) ||
      existsSync(path.join(home, '.gemini')) ||
      commandExists('gemini')) {
    clients.push({
      id: 'gemini-cli',
      name: 'Gemini CLI',
      tier: 1,
      configPath: path.join(projectRoot, '.gemini', 'settings.json'),
      hooksSupported: { preToolUse: true, postToolUse: true, sessionStart: true },
    });
  }

  // OpenCode: opencode.json or .opencode/ directory
  if (existsSync(path.join(projectRoot, 'opencode.json')) ||
      existsSync(path.join(projectRoot, '.opencode'))) {
    clients.push({
      id: 'opencode',
      name: 'OpenCode',
      tier: 1,
      configPath: path.join(projectRoot, '.opencode', 'plugins'),
      hooksSupported: { preToolUse: true, postToolUse: true, sessionStart: false },
    });
  }

  // Windsurf: ~/.codeium/windsurf/ exists
  if (existsSync(path.join(home, '.codeium', 'windsurf'))) {
    clients.push({
      id: 'windsurf',
      name: 'Windsurf',
      tier: 2, // Partial hooks only — scoped to built-in actions
      configPath: path.join(home, '.codeium', 'windsurf', 'settings.json'),
      hooksSupported: { preToolUse: false, postToolUse: false, sessionStart: false },
    });
  }

  // Kiro CLI: .kiro/ directory in project or ~/.kiro/
  if (existsSync(path.join(projectRoot, '.kiro')) ||
      existsSync(path.join(home, '.kiro')) ||
      commandExists('kiro')) {
    clients.push({
      id: 'kiro-cli',
      name: 'Kiro CLI',
      tier: 2, // No hooks support yet — MCP config only
      configPath: path.join(projectRoot, '.kiro', 'settings', 'mcp.json'),
      hooksSupported: { preToolUse: false, postToolUse: false, sessionStart: false },
    });
  }

  // Roo Code: .roo/ directory in project
  if (existsSync(path.join(projectRoot, '.roo'))) {
    clients.push({
      id: 'roo-code',
      name: 'Roo Code',
      tier: 2,
      configPath: path.join(projectRoot, '.roo', 'mcp.json'),
      hooksSupported: { preToolUse: false, postToolUse: false, sessionStart: false },
    });
  }

  // Claude Desktop: ~/Library/Application Support/Claude/ (macOS) or equivalent
  const claudeDesktopPath = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Claude')
    : process.platform === 'win32'
      ? path.join(home, 'AppData', 'Roaming', 'Claude')
      : path.join(home, '.config', 'Claude');
  if (existsSync(path.join(claudeDesktopPath, 'claude_desktop_config.json'))) {
    clients.push({
      id: 'claude-desktop',
      name: 'Claude Desktop',
      tier: 2, // MCP config only — no hooks in desktop app
      configPath: path.join(claudeDesktopPath, 'claude_desktop_config.json'),
      hooksSupported: { preToolUse: false, postToolUse: false, sessionStart: false },
    });
  }

  // LM Studio: ~/.lmstudio/ directory with mcp.json
  if (existsSync(path.join(home, '.lmstudio')) ||
      existsSync(path.join(home, 'Library', 'Application Support', 'LM Studio'))) {
    clients.push({
      id: 'lm-studio',
      name: 'LM Studio',
      tier: 2, // MCP config only — no hooks support
      configPath: path.join(home, '.lmstudio', 'mcp.json'),
      hooksSupported: { preToolUse: false, postToolUse: false, sessionStart: false },
    });
  }

  return clients;
}

function commandExists(cmd: string): boolean {
  try {
    const { execFileSync } = require('child_process');
    if (process.platform === 'win32') {
      execFileSync('where', [cmd], { stdio: 'pipe' });
    } else {
      execFileSync('which', [cmd], { stdio: 'pipe' });
    }
    return true;
  } catch {
    return false;
  }
}
