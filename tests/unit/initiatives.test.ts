/**
 * Tests for initiative tracking system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Initiative Tracking', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-initiative-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    service = new CoordinationService(storage);

    // Create test project
    projectId = 'test-initiative-project';
    const now = new Date();
    await storage.createProject({
      id: projectId,
      slug: 'initiative-test',
      name: 'Initiative Test',
      rootPath: testDir,
      status: 'active',
      domain: 'other',
      createdAt: now,
      updatedAt: now,
    });
    await storage.setActiveProjectId(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('createInitiative', () => {
    it('should create an initiative with required fields', async () => {
      const result = await service.createInitiative({
        title: 'Improve API Performance',
      });

      expect(result.success).toBe(true);
      expect(result.initiativeId).toBeDefined();
      expect(result.message).toContain('created');
    });

    it('should create an initiative with all fields', async () => {
      const result = await service.createInitiative({
        title: 'User Authentication Overhaul',
        description: 'Replace legacy auth with OAuth2',
        successCriteria: 'All users can log in via OAuth2, legacy auth removed',
      });

      expect(result.success).toBe(true);
      expect(result.initiativeId).toBeDefined();
    });

    it('should create initiative with explicit projectId', async () => {
      const result = await service.createInitiative({
        title: 'Test Initiative',
        projectId: projectId,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getInitiative', () => {
    it('should retrieve an initiative by id', async () => {
      const createResult = await service.createInitiative({
        title: 'Performance Initiative',
        description: 'Make everything faster',
        successCriteria: 'P95 latency under 100ms',
      });

      const result = await service.getInitiative(createResult.initiativeId!);

      expect(result.success).toBe(true);
      expect(result.initiative).toBeDefined();
      expect(result.initiative!.title).toBe('Performance Initiative');
      expect(result.initiative!.description).toBe('Make everything faster');
      expect(result.initiative!.successCriteria).toBe('P95 latency under 100ms');
      expect(result.initiative!.status).toBe('active');
    });

    it('should include linked tasks', async () => {
      // Create initiative
      const initResult = await service.createInitiative({
        title: 'Test Initiative',
      });

      // Create task
      const task = await service.createTask({
        title: 'Related Task',
        priority: 'high',
      });

      // Link task to initiative
      await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: initResult.initiativeId!,
      });

      // Retrieve initiative with tasks
      const result = await service.getInitiative(initResult.initiativeId!);

      expect(result.success).toBe(true);
      expect(result.initiative!.tasks).toHaveLength(1);
      expect(result.initiative!.tasks[0].taskId).toBe(task.id);
    });

    it('should return error for non-existent initiative', async () => {
      const result = await service.getInitiative('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('listInitiatives', () => {
    it('should list all initiatives for project', async () => {
      await service.createInitiative({ title: 'Initiative 1' });
      await service.createInitiative({ title: 'Initiative 2' });
      await service.createInitiative({ title: 'Initiative 3' });

      const result = await service.listInitiatives({});

      expect(result.success).toBe(true);
      expect(result.initiatives).toHaveLength(3);
    });

    it('should filter by status', async () => {
      await service.createInitiative({ title: 'Active Initiative' });
      const init2 = await service.createInitiative({ title: 'Succeeded Initiative' });

      // Record outcome for one
      await service.recordInitiativeOutcome({
        initiativeId: init2.initiativeId!,
        status: 'succeeded',
        notes: 'Completed successfully',
      });

      const activeResult = await service.listInitiatives({ status: 'active' });
      const succeededResult = await service.listInitiatives({ status: 'succeeded' });

      expect(activeResult.initiatives).toHaveLength(1);
      expect(activeResult.initiatives[0].title).toBe('Active Initiative');
      expect(succeededResult.initiatives).toHaveLength(1);
      expect(succeededResult.initiatives[0].title).toBe('Succeeded Initiative');
    });

    it('should return empty array for project with no initiatives', async () => {
      const result = await service.listInitiatives({});

      expect(result.success).toBe(true);
      expect(result.initiatives).toEqual([]);
    });
  });

  describe('linkTaskToInitiative', () => {
    it('should link a task to an initiative', async () => {
      const initResult = await service.createInitiative({ title: 'Test Initiative' });
      const task = await service.createTask({ title: 'Test Task', priority: 'medium' });

      const result = await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: initResult.initiativeId!,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('linked');
    });

    it('should link with contribution notes', async () => {
      const initResult = await service.createInitiative({ title: 'Test Initiative' });
      const task = await service.createTask({ title: 'Test Task', priority: 'medium' });

      const result = await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: initResult.initiativeId!,
        contributionNotes: 'This task implements the core logic',
      });

      expect(result.success).toBe(true);
    });

    it('should allow linking one task to multiple initiatives', async () => {
      const init1 = await service.createInitiative({ title: 'Initiative 1' });
      const init2 = await service.createInitiative({ title: 'Initiative 2' });
      const task = await service.createTask({ title: 'Shared Task', priority: 'high' });

      const result1 = await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: init1.initiativeId!,
      });
      const result2 = await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: init2.initiativeId!,
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Verify task is linked to both
      const taskInits = await service.getTaskInitiatives(task.id);
      expect(taskInits.initiatives).toHaveLength(2);
    });

    it('should fail for non-existent task', async () => {
      const initResult = await service.createInitiative({ title: 'Test Initiative' });

      const result = await service.linkTaskToInitiative({
        taskId: 'non-existent-task',
        initiativeId: initResult.initiativeId!,
      });

      expect(result.success).toBe(false);
    });

    it('should fail for non-existent initiative', async () => {
      const task = await service.createTask({ title: 'Test Task', priority: 'medium' });

      const result = await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: 'non-existent-init',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('recordInitiativeOutcome', () => {
    it('should record a successful outcome', async () => {
      const initResult = await service.createInitiative({
        title: 'Test Initiative',
        successCriteria: 'Meet all goals',
      });

      const result = await service.recordInitiativeOutcome({
        initiativeId: initResult.initiativeId!,
        status: 'succeeded',
        outcomeNotes: 'All goals met ahead of schedule',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Outcome recorded');

      // Verify status updated
      const getResult = await service.getInitiative(initResult.initiativeId!);
      expect(getResult.initiative!.status).toBe('succeeded');
      expect(getResult.initiative!.outcomeNotes).toBe('All goals met ahead of schedule');
    });

    it('should record a failed outcome', async () => {
      const initResult = await service.createInitiative({ title: 'Failed Initiative' });

      const result = await service.recordInitiativeOutcome({
        initiativeId: initResult.initiativeId!,
        status: 'failed',
        outcomeNotes: 'Technical constraints made this impossible',
      });

      expect(result.success).toBe(true);

      const getResult = await service.getInitiative(initResult.initiativeId!);
      expect(getResult.initiative!.status).toBe('failed');
    });

    it('should record a pivoted outcome', async () => {
      const initResult = await service.createInitiative({ title: 'Pivoted Initiative' });

      const result = await service.recordInitiativeOutcome({
        initiativeId: initResult.initiativeId!,
        status: 'pivoted',
        outcomeNotes: 'Requirements changed, took different approach',
      });

      expect(result.success).toBe(true);

      const getResult = await service.getInitiative(initResult.initiativeId!);
      expect(getResult.initiative!.status).toBe('pivoted');
    });

    it('should record an abandoned outcome', async () => {
      const initResult = await service.createInitiative({ title: 'Abandoned Initiative' });

      const result = await service.recordInitiativeOutcome({
        initiativeId: initResult.initiativeId!,
        status: 'abandoned',
        outcomeNotes: 'No longer relevant',
      });

      expect(result.success).toBe(true);

      const getResult = await service.getInitiative(initResult.initiativeId!);
      expect(getResult.initiative!.status).toBe('abandoned');
    });

    it('should fail for non-existent initiative', async () => {
      const result = await service.recordInitiativeOutcome({
        initiativeId: 'non-existent',
        status: 'succeeded',
        outcomeNotes: 'Test',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('getInitiativeLearnings', () => {
    it('should return learnings from completed initiatives', async () => {
      // Create and complete a few initiatives
      const init1 = await service.createInitiative({
        title: 'Successful Project',
        successCriteria: 'Deploy to production',
      });
      await service.recordInitiativeOutcome({
        initiativeId: init1.initiativeId!,
        status: 'succeeded',
        outcomeNotes: 'Deployed smoothly with no issues',
      });

      const init2 = await service.createInitiative({
        title: 'Failed Experiment',
        successCriteria: 'Prove hypothesis',
      });
      await service.recordInitiativeOutcome({
        initiativeId: init2.initiativeId!,
        status: 'failed',
        outcomeNotes: 'Hypothesis was incorrect, but learned about user behavior',
      });

      const result = await service.getInitiativeLearnings({});

      expect(result.success).toBe(true);
      expect(result.learnings).toBeDefined();
      expect(result.learnings.summary.succeeded).toBe(1);
      expect(result.learnings.summary.failed).toBe(1);
      expect(result.learnings.summary.total).toBe(2);
    });

    it('should include succeeded initiatives with notes', async () => {
      const init1 = await service.createInitiative({ title: 'Success 1' });
      await service.recordInitiativeOutcome({
        initiativeId: init1.initiativeId!,
        status: 'succeeded',
        outcomeNotes: 'Done',
      });

      const result = await service.getInitiativeLearnings({});

      expect(result.learnings.succeededInitiatives).toHaveLength(1);
      expect(result.learnings.succeededInitiatives[0].title).toBe('Success 1');
    });

    it('should include failed initiatives with notes', async () => {
      const init1 = await service.createInitiative({ title: 'Failed 1' });
      await service.recordInitiativeOutcome({
        initiativeId: init1.initiativeId!,
        status: 'failed',
        outcomeNotes: 'Did not work',
      });

      const result = await service.getInitiativeLearnings({});

      expect(result.learnings.failedInitiatives).toHaveLength(1);
      expect(result.learnings.failedInitiatives[0].title).toBe('Failed 1');
      expect(result.learnings.failedInitiatives[0].outcomeNotes).toBe('Did not work');
    });

    it('should return empty learnings for new project', async () => {
      const result = await service.getInitiativeLearnings({});

      expect(result.success).toBe(true);
      expect(result.learnings.summary.total).toBe(0);
      expect(result.learnings.succeededInitiatives).toHaveLength(0);
      expect(result.learnings.failedInitiatives).toHaveLength(0);
    });
  });

  describe('getTaskInitiatives', () => {
    it('should return initiatives linked to a task', async () => {
      const init1 = await service.createInitiative({ title: 'Initiative A' });
      const init2 = await service.createInitiative({ title: 'Initiative B' });
      const task = await service.createTask({ title: 'Multi-Initiative Task', priority: 'high' });

      await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: init1.initiativeId!,
        contributionNotes: 'Core implementation',
      });
      await service.linkTaskToInitiative({
        taskId: task.id,
        initiativeId: init2.initiativeId!,
        contributionNotes: 'Secondary benefit',
      });

      const result = await service.getTaskInitiatives(task.id);

      expect(result.success).toBe(true);
      expect(result.initiatives).toHaveLength(2);
    });

    it('should return empty array for task with no initiatives', async () => {
      const task = await service.createTask({ title: 'Standalone Task', priority: 'low' });

      const result = await service.getTaskInitiatives(task.id);

      expect(result.success).toBe(true);
      expect(result.initiatives).toEqual([]);
    });
  });

  describe('Integration scenarios', () => {
    it('should track a complete initiative lifecycle', async () => {
      // 1. Create initiative
      const initResult = await service.createInitiative({
        title: 'Complete User Auth System',
        description: 'Implement full authentication flow',
        successCriteria: 'Users can register, login, and reset password',
      });
      expect(initResult.success).toBe(true);

      // 2. Create and link tasks
      const task1 = await service.createTask({ title: 'User registration', priority: 'high' });
      const task2 = await service.createTask({ title: 'Login flow', priority: 'high' });
      const task3 = await service.createTask({ title: 'Password reset', priority: 'medium' });

      await service.linkTaskToInitiative({
        taskId: task1.id,
        initiativeId: initResult.initiativeId!,
        contributionNotes: 'Core registration API',
      });
      await service.linkTaskToInitiative({
        taskId: task2.id,
        initiativeId: initResult.initiativeId!,
        contributionNotes: 'Session management',
      });
      await service.linkTaskToInitiative({
        taskId: task3.id,
        initiativeId: initResult.initiativeId!,
        contributionNotes: 'Email-based reset',
      });

      // 3. Verify initiative has all tasks
      const midCheck = await service.getInitiative(initResult.initiativeId!);
      expect(midCheck.initiative!.tasks).toHaveLength(3);

      // 4. Record successful outcome
      await service.recordInitiativeOutcome({
        initiativeId: initResult.initiativeId!,
        status: 'succeeded',
        outcomeNotes: 'All auth features deployed and working',
      });

      // 5. Verify final state
      const finalCheck = await service.getInitiative(initResult.initiativeId!);
      expect(finalCheck.initiative!.status).toBe('succeeded');
      expect(finalCheck.initiative!.outcomeNotes).toBe('All auth features deployed and working');

      // 6. Check learnings
      const learnings = await service.getInitiativeLearnings({});
      expect(learnings.learnings.summary.succeeded).toBe(1);
      expect(learnings.learnings.summary.successRate).toBe(1); // 1.0 = 100% (decimal format)
    });
  });
});
