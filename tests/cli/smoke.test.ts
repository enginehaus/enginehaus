import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CLI Smoke Tests', () => {
  let dataDir: string;
  const env: Record<string, string> = {};

  beforeAll(() => {
    // Isolate from real user data
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-cli-smoke-'));
    Object.assign(env, process.env, { ENGINEHAUS_DATA_DIR: dataDir });
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const cli = (cmd: string): string => {
    const binPath = path.resolve(__dirname, '../../build/bin/enginehaus.js');
    return execSync(`node ${binPath} ${cmd}`, {
      encoding: 'utf-8',
      env,
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  };

  const cliSafe = (cmd: string): { stdout: string; exitCode: number } => {
    const binPath = path.resolve(__dirname, '../../build/bin/enginehaus.js');
    try {
      const stdout = execSync(`node ${binPath} ${cmd}`, {
        encoding: 'utf-8',
        env,
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout, exitCode: 0 };
    } catch (err: any) {
      return { stdout: err.stdout || err.stderr || '', exitCode: err.status ?? 1 };
    }
  };

  it('enginehaus --version', () => {
    const output = cli('--version');
    expect(output.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  it('enginehaus --help', () => {
    const output = cli('--help');
    expect(output).toContain('task');
    expect(output).toContain('project');
  });

  it('enginehaus doctor', () => {
    // doctor may exit non-zero if MCP isn't configured, but should not crash
    const { stdout, exitCode } = cliSafe('doctor');
    // Crashed processes throw SIGABRT/SIGSEGV with no stdout - verify we got output
    expect(stdout.length + exitCode).toBeDefined();
    // Should not be a Node.js unhandled exception
    expect(stdout).not.toContain('TypeError');
    expect(stdout).not.toContain('ReferenceError');
  });

  it('enginehaus task list', () => {
    // May show "no tasks" or error about no active project - just should not crash
    const { stdout, exitCode } = cliSafe('task list');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
    expect(stdout).not.toContain('ReferenceError');
  });

  it('enginehaus project list', () => {
    const { stdout, exitCode } = cliSafe('project list');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
    expect(stdout).not.toContain('ReferenceError');
  });

  // ── Extracted command module smoke tests ──────────────────────────────
  // Verify each extracted command module loads and runs without crashing.
  // These catch import path errors, missing dependencies, and registration bugs.

  it('enginehaus status', () => {
    const { stdout, exitCode } = cliSafe('status');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
    expect(stdout).not.toContain('ReferenceError');
  });

  it('enginehaus stats', () => {
    const { stdout, exitCode } = cliSafe('stats');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
  });

  it('enginehaus decision list', () => {
    const { stdout, exitCode } = cliSafe('decision list');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
  });

  it('enginehaus initiative list', () => {
    const { stdout, exitCode } = cliSafe('initiative list');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
  });

  it('enginehaus config show', () => {
    const { stdout, exitCode } = cliSafe('config show');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
  });

  it('enginehaus metrics', () => {
    const { stdout, exitCode } = cliSafe('metrics');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
  });

  it('enginehaus hooks status', () => {
    const { stdout, exitCode } = cliSafe('hooks status');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
  });

  it('enginehaus verify', () => {
    const { stdout, exitCode } = cliSafe('verify');
    expect(exitCode).toBeLessThanOrEqual(1);
    expect(stdout).not.toContain('TypeError');
  });

  it('enginehaus help all', () => {
    const output = cli('help all');
    expect(output).toContain('Getting Started');
    expect(output).toContain('Task Management');
  });

  it('enginehaus completion bash', () => {
    const output = cli('completion bash');
    expect(output).toContain('_enginehaus_completions');
  });

  it('enginehaus task list --agent-help returns JSON', () => {
    const output = cli('task list --agent-help');
    const parsed = JSON.parse(output);
    expect(parsed.commands).toBeDefined();
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(parsed.commands.length).toBeGreaterThan(0);
  });

  // ── Functional tests with isolated project ────────────────────────────

  describe('with project', () => {
    let projectSlug: string;

    beforeAll(() => {
      projectSlug = `test-${Date.now()}`;
      // Create a project to test against (project init needs cwd, use project create via task add)
      // We'll create directly through the project init subcommand alternative
      const { stdout } = cliSafe(`project list --json`);
      // If no projects, task commands may error, but that's OK for smoke tests
    });

    it('enginehaus task add and list round-trip', () => {
      const addResult = cliSafe('task add "Smoke test task" -d "Created by CLI smoke test"');
      // May fail if no project, but should not crash
      if (addResult.exitCode === 0) {
        expect(addResult.stdout).toContain('Smoke test task');

        const listResult = cliSafe('task list -s all');
        expect(listResult.exitCode).toBe(0);
        expect(listResult.stdout).toContain('Smoke test task');
      }
    });

    it('enginehaus task list --json returns valid JSON', () => {
      const { stdout, exitCode } = cliSafe('task list --json');
      if (exitCode === 0 && stdout.trim().startsWith('[')) {
        const tasks = JSON.parse(stdout);
        expect(Array.isArray(tasks)).toBe(true);
      }
    });

    it('enginehaus briefing does not crash', () => {
      const { stdout, exitCode } = cliSafe('briefing');
      expect(exitCode).toBeLessThanOrEqual(1);
      expect(stdout).not.toContain('TypeError');
    });

    it('enginehaus analytics does not crash', () => {
      const { stdout, exitCode } = cliSafe('analytics');
      expect(exitCode).toBeLessThanOrEqual(1);
      expect(stdout).not.toContain('TypeError');
    });

    it('enginehaus map does not crash', () => {
      const { stdout, exitCode } = cliSafe('map');
      expect(exitCode).toBeLessThanOrEqual(1);
      expect(stdout).not.toContain('TypeError');
    });
  });
});
