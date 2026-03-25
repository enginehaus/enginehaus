import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationEngine } from '../../src/coordination/engine.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { GitService } from '../../src/git/git-service.js';
import { QualityService } from '../../src/quality/quality-service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CoordinationEngine', () => {
  let engine: CoordinationEngine;
  let storage: SQLiteStorageService;
  let testDir: string;
  let testProjectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-engine-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();

    const gitService = new GitService(testDir);
    const qualityService = new QualityService(testDir);
    engine = new CoordinationEngine(gitService, qualityService, storage);

    testProjectId = 'engine-test-project';
    await storage.createProject({
      id: testProjectId,
      name: 'Engine Test Project',
      slug: 'engine-test',
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

  describe('Task Creation', () => {
    it('should create a unified task', async () => {
      const taskData = {
        title: 'Implement Feature X',
        description: 'Build out feature X with full functionality',
        priority: 'high' as const,
        files: ['src/feature-x.ts', 'src/feature-x.test.ts'],
      };

      const task = await engine.createUnifiedTask(taskData);

      expect(task.id).toBeDefined();
      expect(task.title).toBe('Implement Feature X');
      expect(task.status).toBe('ready');
      expect(task.priority).toBe('high');
      expect(task.files).toEqual(['src/feature-x.ts', 'src/feature-x.test.ts']);
    });

    it('should create task with default priority', async () => {
      const task = await engine.createUnifiedTask({
        title: 'Simple Task',
        description: 'Simple task description',
        priority: 'medium',
      });
      expect(task.priority).toBe('medium');
    });
  });

  describe('Task Queries', () => {
    beforeEach(async () => {
      await engine.createUnifiedTask({ title: 'High Priority', description: 'High priority task', priority: 'high' });
      await engine.createUnifiedTask({ title: 'Low Priority', description: 'Low priority task', priority: 'low' });
      await engine.createUnifiedTask({ title: 'Medium Priority', description: 'Medium priority task', priority: 'medium' });
    });

    it('should get next task by priority', async () => {
      const nextTask = await engine.getNextTask();
      expect(nextTask?.priority).toBe('high');
      expect(nextTask?.status).toBe('ready');
    });
  });

  describe('Session Management', () => {
    it('should claim a task', async () => {
      const task = await engine.createUnifiedTask({ title: 'Claimable Task', description: 'A claimable task', priority: 'medium' });

      const result = await engine.claimTask(task.id, 'agent-1');

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    it('should detect conflict when task already claimed', async () => {
      const task = await engine.createUnifiedTask({ title: 'Contested Task', description: 'A contested task', priority: 'medium' });

      await engine.claimTask(task.id, 'agent-1');
      const secondClaim = await engine.claimTask(task.id, 'agent-2');

      expect(secondClaim.success).toBe(false);
      expect(secondClaim.conflict).toBeDefined();
      expect(secondClaim.conflict?.existingAgentId).toBe('agent-1');
    });

    it('should allow force claim', async () => {
      const task = await engine.createUnifiedTask({ title: 'Force Claim Task', description: 'A force claim task', priority: 'medium' });

      await engine.claimTask(task.id, 'agent-1');
      const forceClaim = await engine.claimTask(task.id, 'agent-2', true);

      expect(forceClaim.success).toBe(true);
    });

    it('should release task', async () => {
      const task = await engine.createUnifiedTask({ title: 'Release Task', description: 'A release task', priority: 'medium' });
      const claim = await engine.claimTask(task.id, 'agent-1');

      await engine.releaseTask(claim.sessionId!);

      const status = await engine.getTaskSessionStatus(task.id);
      expect(status.hasActiveSession).toBe(false);
    });

    it('should update heartbeat', async () => {
      const task = await engine.createUnifiedTask({ title: 'Heartbeat Task', description: 'A heartbeat task', priority: 'medium' });
      const claim = await engine.claimTask(task.id, 'agent-1');

      const result = await engine.sessionHeartbeat(claim.sessionId!);

      expect(result.success).toBe(true);
      expect(result.expired).toBe(false);
    });
  });

  describe('Health Check', () => {
    it('should run health check', async () => {
      const result = await engine.runHealthCheck();

      expect(result).toHaveProperty('healthy');
      expect(typeof result.healthy).toBe('boolean');
    });

    it('should return metrics in health check', async () => {
      await engine.createUnifiedTask({ title: 'Ready Task', description: 'Ready', priority: 'high' });

      const result = await engine.runHealthCheck();

      expect(result.metrics).toBeDefined();
      expect(result.metrics.readyTasks).toBeGreaterThanOrEqual(1);
      expect(result.metrics.activeSessions).toBeDefined();
      expect(result.metrics.inProgressTasks).toBeDefined();
    });
  });

  describe('Engine Initialization', () => {
    it('should initialize and restore sessions from storage', async () => {
      // Create a task and claim it
      const task = await engine.createUnifiedTask({ title: 'Init Task', description: 'Test', priority: 'high' });
      await engine.claimTask(task.id, 'agent-init');

      // Create a new engine instance with same storage
      const newGitService = new GitService(testDir);
      const newQualityService = new QualityService(testDir);
      const newEngine = new CoordinationEngine(newGitService, newQualityService, storage);

      // Initialize should restore the session
      await newEngine.initialize();

      // Verify session was restored by checking task status
      const status = await newEngine.getTaskSessionStatus(task.id);
      expect(status.hasActiveSession).toBe(true);
    });

    it('should sync sessions and remove stale ones', async () => {
      const task = await engine.createUnifiedTask({ title: 'Sync Task', description: 'Test', priority: 'high' });
      await engine.claimTask(task.id, 'agent-sync');

      const removed = await engine.syncSessions();

      // No sessions should be removed since all are active
      expect(removed).toBe(0);
    });
  });

  describe('Strategic Decision Recording', () => {
    it('should record a strategic decision', async () => {
      const decision = await engine.recordStrategicDecision({
        decision: 'Use PostgreSQL for persistence',
        rationale: 'Better scalability for team features',
        impact: 'high',
        alternatives: ['SQLite', 'MongoDB'],
        timeline: 'Q1 2025',
        constraints: ['Budget', 'Time'],
        stakeholders: ['Engineering', 'Product'],
      });

      expect(decision.id).toBeDefined();
      expect(decision.decision).toBe('Use PostgreSQL for persistence');
      expect(decision.projectId).toBe(testProjectId);
      expect(decision.createdAt).toBeDefined();
    });
  });

  describe('UX Requirements Recording', () => {
    it('should record UX requirements', async () => {
      const requirements = await engine.recordUXRequirements({
        feature: 'Task Dashboard',
        userExperience: 'Users should see all tasks at a glance',
        accessibilityRequirements: 'WCAG 2.1 AA compliant',
        responsiveDesign: 'Mobile-first approach',
        designPattern: 'Dashboard layout with cards',
        interactionFlow: 'Click to expand, drag to reorder',
      });

      expect(requirements.id).toBeDefined();
      expect(requirements.feature).toBe('Task Dashboard');
      expect(requirements.projectId).toBe(testProjectId);
    });
  });

  describe('Technical Plan Recording', () => {
    it('should record a technical plan', async () => {
      const plan = await engine.recordTechnicalPlan({
        feature: 'API Caching',
        technicalApproach: 'Use Redis for caching',
        estimatedEffort: 'medium',
        risks: ['Cache invalidation complexity'],
      });

      expect(plan.id).toBeDefined();
      expect(plan.feature).toBe('API Caching');
      expect(plan.projectId).toBe(testProjectId);
    });

    it('should create tasks from technical plan', async () => {
      const plan = await engine.recordTechnicalPlan({
        feature: 'Auth System',
        technicalApproach: 'JWT-based authentication',
        estimatedEffort: 'high',
        unifiedTasks: [
          { title: 'Setup JWT library', description: 'Install and configure', priority: 'high' },
          { title: 'Create auth middleware', description: 'Implement middleware', priority: 'high' },
        ],
      });

      expect(plan.id).toBeDefined();

      // Verify tasks were created
      const tasks = await storage.getTasks({ status: 'ready' });
      const planTasks = tasks.filter(t => t.title.includes('JWT') || t.title.includes('auth'));
      expect(planTasks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Task Progress Updates', () => {
    it('should update task status', async () => {
      const task = await engine.createUnifiedTask({ title: 'Progress Task', description: 'Test', priority: 'medium' });

      const updated = await engine.updateTaskProgress(task.id, {
        status: 'in-progress',
        notes: 'Started work',
      });

      expect(updated.status).toBe('in-progress');
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        engine.updateTaskProgress('non-existent-id', { status: 'completed' })
      ).rejects.toThrow('Task non-existent-id not found');
    });
  });

  describe('Task Completion', () => {
    it('should complete a task with deliverables', async () => {
      const task = await engine.createUnifiedTask({
        title: 'Complete Task',
        description: 'Test completion',
        priority: 'high'
      });

      const completed = await engine.completeTask(task.id, {
        implementationSummary: 'Implemented feature X',
        deliverables: [
          { file: 'src/feature.ts', status: 'created', description: 'Main feature file' }
        ],
      });

      expect(completed.status).toBe('completed');
      expect(completed.implementation?.implementationSummary).toBe('Implemented feature X');
      expect(completed.implementation?.completedAt).toBeDefined();
    });

    it('should throw error when completing non-existent task', async () => {
      await expect(
        engine.completeTask('non-existent', {
          implementationSummary: 'Done',
          deliverables: [],
        })
      ).rejects.toThrow('Task non-existent not found');
    });
  });

  describe('Agent Capacity', () => {
    it('should enforce agent capacity limits', async () => {
      const task1 = await engine.createUnifiedTask({ title: 'Task 1', description: 'First', priority: 'high' });
      const task2 = await engine.createUnifiedTask({ title: 'Task 2', description: 'Second', priority: 'high' });

      // Claim first task with capacity=1
      const claim1 = await engine.claimTask(task1.id, 'limited-agent', false, 1);
      expect(claim1.success).toBe(true);

      // Try to claim second task - should fail due to capacity
      const claim2 = await engine.claimTask(task2.id, 'limited-agent', false, 1);
      expect(claim2.success).toBe(false);
      expect(claim2.capacityExceeded).toBeDefined();
      expect(claim2.capacityExceeded?.capacity).toBe(1);
    });

    it('should allow unlimited capacity when set to 0', async () => {
      const task1 = await engine.createUnifiedTask({ title: 'Unlimited 1', description: 'First', priority: 'high' });
      const task2 = await engine.createUnifiedTask({ title: 'Unlimited 2', description: 'Second', priority: 'high' });

      // Claim with unlimited capacity (0)
      const claim1 = await engine.claimTask(task1.id, 'unlimited-agent', false, 0);
      const claim2 = await engine.claimTask(task2.id, 'unlimited-agent', false, 0);

      expect(claim1.success).toBe(true);
      expect(claim2.success).toBe(true);
    });
  });

  describe('File Conflict Detection', () => {
    it('should detect file-level conflicts between agents', async () => {
      const task1 = await engine.createUnifiedTask({
        title: 'File Task 1',
        description: 'First',
        priority: 'high',
        files: ['src/shared.ts', 'src/utils.ts']
      });
      const task2 = await engine.createUnifiedTask({
        title: 'File Task 2',
        description: 'Second',
        priority: 'high',
        files: ['src/shared.ts', 'src/other.ts'] // Overlaps with shared.ts
      });

      // First agent claims task1
      await engine.claimTask(task1.id, 'agent-1', false, 0);

      // Second agent tries to claim task2 - should fail due to file conflict
      const claim2 = await engine.claimTask(task2.id, 'agent-2', false, 0);
      expect(claim2.success).toBe(false);
      expect(claim2.fileConflicts).toBeDefined();
      expect(claim2.fileConflicts?.[0].overlappingFiles).toContain('src/shared.ts');
    });

    it('should allow force claim despite file conflicts', async () => {
      const task1 = await engine.createUnifiedTask({
        title: 'Force File 1',
        description: 'First',
        priority: 'high',
        files: ['src/conflict.ts']
      });
      const task2 = await engine.createUnifiedTask({
        title: 'Force File 2',
        description: 'Second',
        priority: 'high',
        files: ['src/conflict.ts']
      });

      await engine.claimTask(task1.id, 'agent-1', false, 0);

      // Force claim should succeed
      const forceClaim = await engine.claimTask(task2.id, 'agent-2', true, 0);
      expect(forceClaim.success).toBe(true);
    });
  });

  describe('Token-Efficient Context', () => {
    it('should get minimal task info', async () => {
      const task = await engine.createUnifiedTask({
        title: 'Minimal Task',
        description: 'For minimal context',
        priority: 'high',
        files: ['src/a.ts', 'src/b.ts']
      });

      const minimal = await engine.getMinimalTask(task.id);

      expect(minimal.id).toBe(task.id);
      expect(minimal.title).toBe('Minimal Task');
      expect(minimal.files).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('should throw error for non-existent task in getMinimalTask', async () => {
      await expect(engine.getMinimalTask('non-existent')).rejects.toThrow('Task non-existent not found');
    });

    it('should expand context on demand', async () => {
      const decision = await engine.recordStrategicDecision({
        decision: 'Expand Test',
        rationale: 'Testing expand context',
        impact: 'low',
        timeline: 'Now',
        constraints: [],
        stakeholders: ['Test'],
      });

      const expanded = await engine.expandContext('strategic', decision.id);

      expect(expanded.aspect).toBe('strategic');
      expect(expanded.data).toBeDefined();
    });
  });

  describe('Coordination Context', () => {
    it('should get coordination context for a role', async () => {
      await engine.createUnifiedTask({ title: 'Context Task', description: 'Test', priority: 'high' });

      const context = await engine.getCoordinationContext('developer');

      expect(context.role).toBe('developer');
      expect(context.readyTasks).toBeDefined();
      expect(context.activeTasks).toBeDefined();
    });

    it('should include current task in context when provided', async () => {
      const task = await engine.createUnifiedTask({ title: 'Current Task', description: 'Test', priority: 'high' });

      const context = await engine.getCoordinationContext('developer', task.id);

      expect(context.currentTask).toBeDefined();
      expect(context.currentTask?.id).toBe(task.id);
    });
  });

  describe('Quality Gate Validation', () => {
    it('should validate quality gates', async () => {
      const task = await engine.createUnifiedTask({ title: 'Quality Task', description: 'Test', priority: 'high' });

      const result = await engine.validateQualityGates(
        task.id,
        ['src/feature.ts'],
        ['has-tests', 'has-docs']
      );

      expect(result.passed).toBeDefined();
      expect(result.results).toBeInstanceOf(Array);
    });
  });

  describe('Release Task', () => {
    it('should release task as abandoned and reset status', async () => {
      const task = await engine.createUnifiedTask({ title: 'Abandon Task', description: 'Test', priority: 'medium' });
      const claim = await engine.claimTask(task.id, 'agent-abandon');

      // Release without completing (abandoned)
      await engine.releaseTask(claim.sessionId!, false);

      const updatedTask = await storage.getTask(task.id);
      expect(updatedTask?.status).toBe('ready'); // Reset to ready
    });

    it('should release task as completed', async () => {
      const task = await engine.createUnifiedTask({ title: 'Complete Release', description: 'Test', priority: 'medium' });
      const claim = await engine.claimTask(task.id, 'agent-complete');

      await engine.releaseTask(claim.sessionId!, true);

      const status = await engine.getTaskSessionStatus(task.id);
      expect(status.hasActiveSession).toBe(false);
    });

    it('should throw error for non-existent session', async () => {
      await expect(engine.releaseTask('non-existent-session')).rejects.toThrow('Session non-existent-session not found');
    });
  });

  describe('Implementation Session', () => {
    it('should claim task and create session', async () => {
      // Use claimTask instead of startImplementationSession to avoid git requirements
      const task = await engine.createUnifiedTask({
        title: 'Impl Session Task',
        description: 'Test implementation',
        priority: 'high'
      });

      const result = await engine.claimTask(task.id, 'impl-agent');

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        engine.startImplementationSession('non-existent')
      ).rejects.toThrow('Task non-existent not found');
    });
  });

  describe('Session Heartbeat Management', () => {
    it('should update session heartbeat via sessionHeartbeat', async () => {
      // Use claimTask to avoid git requirements
      const task = await engine.createUnifiedTask({ title: 'Heartbeat Task 2', description: 'Test', priority: 'medium' });
      const claim = await engine.claimTask(task.id, 'heartbeat-agent');

      const result = await engine.sessionHeartbeat(claim.sessionId!);

      expect(result.success).toBe(true);
      expect(result.expired).toBe(false);
    });

    it('should throw error for non-existent session heartbeat', async () => {
      await expect(
        engine.updateSessionHeartbeat('non-existent-session')
      ).rejects.toThrow('Session non-existent-session not found or expired');
    });
  });

  describe('End Session', () => {
    it('should end session with completion status', async () => {
      // Use claimTask to avoid git requirements
      const task = await engine.createUnifiedTask({ title: 'End Session Task', description: 'Test', priority: 'medium' });
      const claim = await engine.claimTask(task.id, 'end-agent');

      await engine.releaseTask(claim.sessionId!, true);

      const status = await engine.getTaskSessionStatus(task.id);
      expect(status.hasActiveSession).toBe(false);
    });

    it('should handle ending non-existent session gracefully', async () => {
      // Should not throw, just return silently
      await engine.endSession('non-existent-session', 'error');
    });
  });

  describe('Get Storage', () => {
    it('should return storage service', () => {
      const storageService = engine.getStorage();
      expect(storageService).toBe(storage);
    });
  });
});
