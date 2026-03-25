import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorktree, removeWorktree, listWorktrees } from '../../src/git/git-analysis.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Git Worktree Management', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-worktree-test-'));
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    // Initial commit required for worktrees
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test\n');
    execSync('git add . && git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(() => {
    // Clean up worktrees before removing temp dir
    try {
      execSync('git worktree prune', { cwd: tempDir, stdio: 'ignore' });
    } catch { /* ignore */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('createWorktree creates a new worktree with a new branch', async () => {
    const worktreePath = path.join(tempDir, '..', 'worktree-test-new');
    const result = await createWorktree(tempDir, worktreePath, 'feature/task-abc12345-test');

    expect(result.success).toBe(true);
    expect(result.path).toBe(worktreePath);
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(path.join(worktreePath, 'README.md'))).toBe(true);

    // Clean up
    fs.rmSync(worktreePath, { recursive: true, force: true });
  });

  it('createWorktree attaches to existing branch', async () => {
    // Create branch first
    execSync('git branch feature/existing-branch', { cwd: tempDir, stdio: 'ignore' });

    const worktreePath = path.join(tempDir, '..', 'worktree-test-existing');
    const result = await createWorktree(tempDir, worktreePath, 'feature/existing-branch');

    expect(result.success).toBe(true);
    expect(fs.existsSync(worktreePath)).toBe(true);

    // Clean up
    fs.rmSync(worktreePath, { recursive: true, force: true });
  });

  it('createWorktree returns error for invalid path', async () => {
    // Worktree path that already exists as a file
    const worktreePath = path.join(tempDir, 'README.md');
    const result = await createWorktree(tempDir, worktreePath, 'feature/bad');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('listWorktrees returns all worktrees', async () => {
    const worktreePath = path.join(tempDir, '..', 'worktree-test-list');
    await createWorktree(tempDir, worktreePath, 'feature/list-test');

    const worktrees = await listWorktrees(tempDir);

    // Should include main worktree + the one we created
    expect(worktrees.length).toBeGreaterThanOrEqual(2);
    const branches = worktrees.map(w => w.branch);
    expect(branches).toContain('feature/list-test');

    // Clean up
    fs.rmSync(worktreePath, { recursive: true, force: true });
  });

  it('removeWorktree removes a worktree', async () => {
    const worktreePath = path.join(tempDir, '..', 'worktree-test-remove');
    await createWorktree(tempDir, worktreePath, 'feature/remove-test');
    expect(fs.existsSync(worktreePath)).toBe(true);

    const result = await removeWorktree(tempDir, worktreePath);
    expect(result.success).toBe(true);
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it('removeWorktree can also delete the branch', async () => {
    const worktreePath = path.join(tempDir, '..', 'worktree-test-branch-del');
    await createWorktree(tempDir, worktreePath, 'feature/branch-delete-test');

    const result = await removeWorktree(tempDir, worktreePath, {
      deleteBranch: true,
      branchName: 'feature/branch-delete-test',
    });
    expect(result.success).toBe(true);

    // Branch should be gone
    const branches = execSync('git branch', { cwd: tempDir, encoding: 'utf8' });
    expect(branches).not.toContain('feature/branch-delete-test');
  });

  it('removeWorktree returns error for non-existent worktree', async () => {
    const result = await removeWorktree(tempDir, '/nonexistent/path');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
