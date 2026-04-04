import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../src/git/git-service.js';
import { isBranchMergedToMain } from '../../src/git/git-analysis.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GitService', () => {
  let tempDir: string;
  let git: GitService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-git-test-'));
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    // Initial commit
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test\n');
    execSync('git add . && git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });

    git = new GitService(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('getCurrentBranch returns branch name', async () => {
    const branch = await git.getCurrentBranch();
    // Default branch is usually 'main' or 'master'
    expect(['main', 'master']).toContain(branch);
  });

  it('getMainBranch returns main or master', async () => {
    const main = await git.getMainBranch();
    expect(['main', 'master']).toContain(main);
  });

  it('createTaskBranch creates and switches to feature branch', async () => {
    const task = {
      id: 'test-123',
      title: 'Add feature',
      projectId: 'proj-1',
      description: '',
      priority: 'medium' as const,
      status: 'ready' as const,
      files: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const branchName = await git.createTaskBranch(task);

    expect(branchName).toContain('test-123');
    expect(branchName).toContain('add-feature');

    const currentBranch = await git.getCurrentBranch();
    expect(currentBranch).toBe(branchName);
  });

  it('getStatus reports current state', async () => {
    const status = await git.getStatus();

    expect(status.currentBranch).toBeDefined();
    expect(status.hasUncommittedChanges).toBe(false);
    expect(Array.isArray(status.activeBranches)).toBe(true);
  });

  it('getStatus detects uncommitted changes', async () => {
    fs.writeFileSync(path.join(tempDir, 'dirty.ts'), 'const x = 1;\n');

    const status = await git.getStatus();

    expect(status.hasUncommittedChanges).toBe(true);
  });

  it('getCommitHistory returns commits', async () => {
    const mainBranch = await git.getMainBranch();
    const history = await git.getCommitHistory(mainBranch, 5);

    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].hash).toBeDefined();
    expect(history[0].message).toContain('Initial commit');
  });

  it('commitPhase stages files and creates commit', async () => {
    const mainBranch = await git.getMainBranch();

    // Create a file to commit
    fs.writeFileSync(path.join(tempDir, 'feature.ts'), 'export const y = 2;\n');

    const commit = await git.commitPhase(mainBranch, 1, 'Context & Planning', ['feature.ts']);

    expect(commit.hash).toBeDefined();
    expect(commit.message).toContain('Phase 1');

    // Verify working tree is clean after commit
    const status = await git.getStatus();
    expect(status.hasUncommittedChanges).toBe(false);
  });
});

describe('isBranchMergedToMain', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-merge-test-'));
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test\n');
    execSync('git add . && git commit -m "Initial commit"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns isMainBranch:true when on main', async () => {
    const result = await isBranchMergedToMain(tempDir);
    expect(result.isMainBranch).toBe(true);
    expect(result.isMerged).toBe(true);
  });

  it('returns isMerged:false for unmerged feature branch', async () => {
    execSync('git checkout -b feature/test', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'new.ts'), 'export const x = 1;\n');
    execSync('git add new.ts && git commit -m "feat: new"', { cwd: tempDir, stdio: 'ignore' });

    const result = await isBranchMergedToMain(tempDir);
    expect(result.isMainBranch).toBe(false);
    expect(result.isMerged).toBe(false);
    expect(result.currentBranch).toBe('feature/test');
  });

  it('returns isMerged:true for merged feature branch', async () => {
    execSync('git checkout -b feature/merged', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'merged.ts'), 'export const m = 1;\n');
    execSync('git add merged.ts && git commit -m "feat: merged"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git checkout main && git merge feature/merged', { cwd: tempDir, stdio: 'ignore' });
    execSync('git checkout feature/merged', { cwd: tempDir, stdio: 'ignore' });

    const result = await isBranchMergedToMain(tempDir);
    expect(result.isMainBranch).toBe(false);
    expect(result.isMerged).toBe(true);
  });
});
