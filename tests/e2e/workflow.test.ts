import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationEngine } from '../../src/coordination/engine.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { GitService } from '../../src/git/git-service.js';
import { QualityService } from '../../src/quality/quality-service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * End-to-end workflow tests
 */
describe('E2E Workflows', () => {
  let engine: CoordinationEngine;
  let storage: SQLiteStorageService;
  let testDir: string;
  let testProjectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-e2e-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();

    const gitService = new GitService(testDir);
    const qualityService = new QualityService(testDir);
    engine = new CoordinationEngine(gitService, qualityService, storage);

    testProjectId = 'e2e-test-project';
    await storage.createProject({
      id: testProjectId,
      name: 'E2E Test Project',
      slug: 'e2e-test',
      rootPath: testDir,
      domain: 'api',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await storage.setActiveProjectId(testProjectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Complete Task Workflow', () => {
    it('should handle full task lifecycle: create -> claim -> work -> release', async () => {
      // 1. Create a task
      const task = await engine.createUnifiedTask({
        title: 'Implement user dashboard',
        description: 'Build a dashboard showing user metrics',
        priority: 'high',
        files: ['src/dashboard/Dashboard.tsx'],
      });

      expect(task.status).toBe('ready');

      // 2. Agent claims the task
      const claim = await engine.claimTask(task.id, 'dashboard-agent');
      expect(claim.success).toBe(true);

      // 3. Verify claim
      const status = await engine.getTaskSessionStatus(task.id);
      expect(status.hasActiveSession).toBe(true);

      // 4. Send heartbeat
      await engine.sessionHeartbeat(claim.sessionId!);

      // 5. Release the task
      await engine.releaseTask(claim.sessionId!, true);

      // 6. Verify released
      const finalStatus = await engine.getTaskSessionStatus(task.id);
      expect(finalStatus.hasActiveSession).toBe(false);
    });
  });

  describe('Multi-Agent Collaboration', () => {
    it('should handle multiple agents on different tasks', async () => {
      const frontendTask = await engine.createUnifiedTask({
        title: 'Build UI components',
        description: 'Build UI components',
        priority: 'high',
      });
      const backendTask = await engine.createUnifiedTask({
        title: 'Build API endpoints',
        description: 'Build API endpoints',
        priority: 'high',
      });

      const frontendClaim = await engine.claimTask(frontendTask.id, 'frontend-agent');
      const backendClaim = await engine.claimTask(backendTask.id, 'backend-agent');

      expect(frontendClaim.success).toBe(true);
      expect(backendClaim.success).toBe(true);

      await engine.releaseTask(frontendClaim.sessionId!, true);
      await engine.releaseTask(backendClaim.sessionId!, true);
    });
  });

  describe('Conflict Resolution', () => {
    it('should prevent two agents from claiming the same task', async () => {
      const task = await engine.createUnifiedTask({ title: 'Contested Task', description: 'A contested task', priority: 'medium' });

      const claim1 = await engine.claimTask(task.id, 'agent-1');
      expect(claim1.success).toBe(true);

      const claim2 = await engine.claimTask(task.id, 'agent-2');
      expect(claim2.success).toBe(false);
      expect(claim2.conflict?.existingAgentId).toBe('agent-1');

      // Force claim should work
      const forceClaim = await engine.claimTask(task.id, 'agent-2', true);
      expect(forceClaim.success).toBe(true);
    });
  });

  describe('Project Isolation', () => {
    it('should maintain task isolation between projects', async () => {
      // Create second project
      await storage.createProject({
        id: 'second-project',
        name: 'Second Project',
        slug: 'second',
        rootPath: '/second/path',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create task in first project
      await engine.createUnifiedTask({ title: 'Project 1 Task', description: 'Project 1 task', priority: 'medium' });

      // Switch to second project and create task
      await storage.setActiveProjectId('second-project');
      await engine.createUnifiedTask({ title: 'Project 2 Task', description: 'Project 2 task', priority: 'medium' });

      // Next task should be from second project
      const nextTask = await engine.getNextTask();
      expect(nextTask?.title).toBe('Project 2 Task');

      // Switch back to first project
      await storage.setActiveProjectId(testProjectId);
      const project1Task = await engine.getNextTask();
      expect(project1Task?.title).toBe('Project 1 Task');
    });
  });
});
