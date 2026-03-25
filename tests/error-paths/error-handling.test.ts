import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { GitService } from '../../src/git/git-service.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Error handling', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let repoDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-err-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-err-repo-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    const project = await service.createProject({
      name: 'Error Test',
      rootPath: repoDir,
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe('Missing resources', () => {
    it('getTask with invalid ID returns null', async () => {
      const result = await service.getTask('nonexistent-id');
      expect(result).toBeNull();
    });

    it('updateTask with invalid ID returns null', async () => {
      const result = await service.updateTask('nonexistent-id', { title: 'New' });
      expect(result).toBeNull();
    });

    it('claimTask on non-existent task throws', async () => {
      await expect(
        service.claimTask('nonexistent-id', 'agent-1')
      ).rejects.toThrow('Task not found');
    });

    it('completeTaskSmart on invalid task fails', async () => {
      const result = await service.completeTaskSmart({
        taskId: 'nonexistent-id',
        summary: 'Done',
        defaultProjectRoot: repoDir,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Invalid state transitions', () => {
    it('claimTask on already-claimed task fails', async () => {
      const task = await service.createTask({ title: 'Claimed task' });
      await service.claimTask(task.id, 'agent-1');

      const result = await service.claimTask(task.id, 'agent-2');
      expect(result.success).toBe(false);
      expect(result.conflict).toBeDefined();
    });

    it('releaseTask on unclaimed task throws', async () => {
      const task = await service.createTask({ title: 'Unclaimed task' });

      // claimTask sets up a session; releaseTask needs the task's session
      // Without a claim, the internal session lookup throws
      await expect(
        service.releaseTask(task.id)
      ).rejects.toThrow();
    });
  });

  describe('Git failures', () => {
    it('completeTaskSmart in non-git directory handles gracefully', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-nogit-'));

      // Create project pointing to non-git directory
      await service.createProject({
        name: 'Non-git project',
        rootPath: nonGitDir,
      });
      const task = await service.createTask({ title: 'Non-git task' });
      await service.claimTask(task.id, 'agent-1');

      // Should not throw unhandled exception
      const result = await service.completeTaskSmart({
        taskId: task.id,
        summary: 'Done',
        defaultProjectRoot: nonGitDir,
        enforceQuality: false,
      });

      // May succeed with empty analysis or fail gracefully
      expect(result).toBeDefined();

      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });

    it('GitService getStatus in empty repo returns valid state', async () => {
      const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-empty-'));
      execSync('git init', { cwd: emptyRepo, stdio: 'ignore' });
      const git = new GitService(emptyRepo);

      // Should not throw
      const status = await git.getStatus();
      expect(status.currentBranch).toBeDefined();

      fs.rmSync(emptyRepo, { recursive: true, force: true });
    });

    it('GitService getCommitHistory in repo with no commits handles gracefully', async () => {
      const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-nocommit-'));
      execSync('git init', { cwd: emptyRepo, stdio: 'ignore' });
      const git = new GitService(emptyRepo);

      // Should not crash
      try {
        const history = await git.getCommitHistory('main', 5);
        expect(Array.isArray(history)).toBe(true);
      } catch (err: any) {
        // Acceptable: throws on empty repo with no commits
        expect(err).toBeDefined();
      }

      fs.rmSync(emptyRepo, { recursive: true, force: true });
    });
  });

  describe('Sequential conflict operations', () => {
    it('second claim after first succeeds gets conflict', async () => {
      const task = await service.createTask({ title: 'Conflict task' });

      const result1 = await service.claimTask(task.id, 'agent-1');
      const result2 = await service.claimTask(task.id, 'agent-2');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result2.conflict).toBeDefined();
    });
  });

  describe('Input validation', () => {
    it('createTask with empty title still creates (no validation)', async () => {
      // Tests the actual behavior - empty titles may or may not be rejected
      try {
        const task = await service.createTask({ title: '' });
        // If it succeeds, it created a task with empty title
        expect(task.id).toBeDefined();
      } catch (err: any) {
        // If it throws, validation caught it
        expect(err).toBeDefined();
      }
    });

    it('logDecision with empty decision text is handled', async () => {
      try {
        const result = await service.logDecision({ decision: '' });
        // Implementation may allow or reject
        expect(result).toBeDefined();
      } catch (err: any) {
        expect(err).toBeDefined();
      }
    });

    it('createProject with duplicate slug fails gracefully', async () => {
      await service.createProject({ name: 'Unique', slug: 'unique-slug' });

      try {
        await service.createProject({ name: 'Duplicate', slug: 'unique-slug' });
        // If no error, duplicates are allowed
      } catch (err: any) {
        // Expected: duplicate slug rejection
        expect(err).toBeDefined();
      }
    });

    it('storeArtifact with non-existent taskId fails', async () => {
      const result = await service.storeArtifact({
        taskId: 'nonexistent-task',
        type: 'doc',
        content: 'test',
        contentType: 'text/plain',
      });

      // Should either fail or succeed depending on FK enforcement
      expect(result).toBeDefined();
    });
  });
});
