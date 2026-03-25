import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CoordinationService', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-coord-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Project Management', () => {
    it('should create a project', async () => {
      const project = await service.createProject({
        name: 'Test Project',
        slug: 'test-project',
        rootPath: '/test/path',
        domain: 'api',
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.slug).toBe('test-project');
      expect(project.domain).toBe('api');
      expect(project.status).toBe('active');
    });

    it('should generate slug from name if not provided', async () => {
      const project = await service.createProject({
        name: 'My Cool Project',
      });

      expect(project.slug).toBe('my-cool-project');
    });

    it('should list projects', async () => {
      await service.createProject({ name: 'Project 1' });
      await service.createProject({ name: 'Project 2' });

      const projects = await service.listProjects();
      // At least 2 (plus default project)
      expect(projects.length).toBeGreaterThanOrEqual(2);
    });

    it('should set and get active project', async () => {
      const project = await service.createProject({ name: 'Active Project' });
      await service.setActiveProject(project.id);

      const active = await service.getActiveProject();
      expect(active?.id).toBe(project.id);
    });

    it('should update project', async () => {
      const project = await service.createProject({ name: 'Original Name' });

      const updated = await service.updateProject(project.id, { name: 'New Name' });

      expect(updated?.name).toBe('New Name');
    });

    it('should delete project', async () => {
      const project = await service.createProject({ name: 'To Delete' });

      await service.deleteProject(project.id);

      const retrieved = await service.getProject(project.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Task Management', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await service.createProject({ name: 'Task Test Project' });
      projectId = project.id;
      await service.setActiveProject(projectId);
    });

    it('should create a task', async () => {
      const task = await service.createTask({
        title: 'Test Task',
        description: 'Test description',
        priority: 'high',
        files: ['src/test.ts'],
      });

      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.priority).toBe('high');
      expect(task.status).toBe('ready');
      expect(task.projectId).toBe(projectId);
    });

    it('should use default priority if not specified', async () => {
      const task = await service.createTask({
        title: 'Default Priority Task',
      });

      expect(task.priority).toBe('medium');
    });

    it('should get task by ID', async () => {
      const created = await service.createTask({ title: 'Get Me' });

      const retrieved = await service.getTask(created.id);

      expect(retrieved?.title).toBe('Get Me');
    });

    it('should get tasks with filter', async () => {
      await service.createTask({ title: 'High', priority: 'high' });
      await service.createTask({ title: 'Low', priority: 'low' });

      const highTasks = await service.getTasks({ priority: 'high' });

      expect(highTasks.every(t => t.priority === 'high')).toBe(true);
    });

    it('should update task', async () => {
      const task = await service.createTask({ title: 'Original' });

      const updated = await service.updateTask(task.id, {
        title: 'Updated',
        priority: 'critical',
      });

      expect(updated?.title).toBe('Updated');
      expect(updated?.priority).toBe('critical');
    });

    it('should delete task', async () => {
      const task = await service.createTask({ title: 'To Delete' });

      await service.deleteTask(task.id);

      const retrieved = await service.getTask(task.id);
      expect(retrieved).toBeNull();
    });

    it('should get next task by priority', async () => {
      await service.createTask({ title: 'Low', priority: 'low' });
      await service.createTask({ title: 'High', priority: 'high' });
      await service.createTask({ title: 'Critical', priority: 'critical' });

      const next = await service.getNextTask();

      expect(next?.priority).toBe('critical');
    });
  });

  describe('Session Management', () => {
    let taskId: string;

    beforeEach(async () => {
      const project = await service.createProject({ name: 'Session Test' });
      await service.setActiveProject(project.id);
      const task = await service.createTask({ title: 'Session Task' });
      taskId = task.id;
    });

    it('should claim a task', async () => {
      const result = await service.claimTask(taskId, 'agent-1');

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    it('should detect conflict when task already claimed', async () => {
      await service.claimTask(taskId, 'agent-1');

      const result = await service.claimTask(taskId, 'agent-2');

      expect(result.success).toBe(false);
      expect(result.conflict).toBeDefined();
      expect(result.conflict?.agentId).toBe('agent-1');
    });

    it('should allow force claim', async () => {
      await service.claimTask(taskId, 'agent-1');

      const result = await service.claimTask(taskId, 'agent-2', { force: true });

      expect(result.success).toBe(true);
    });

    it('should refresh session for same agent', async () => {
      const first = await service.claimTask(taskId, 'agent-1');
      const second = await service.claimTask(taskId, 'agent-1');

      expect(second.success).toBe(true);
      expect(second.sessionId).toBe(first.sessionId);
    });

    it('should release task', async () => {
      const claim = await service.claimTask(taskId, 'agent-1');

      await service.releaseTask(claim.sessionId!);

      const sessions = await service.getActiveSessions();
      expect(sessions.find(s => s.id === claim.sessionId)).toBeUndefined();
    });

    it('should reset task status on release without completion', async () => {
      const claim = await service.claimTask(taskId, 'agent-1');

      await service.releaseTask(claim.sessionId!, false);

      const task = await service.getTask(taskId);
      expect(task?.status).toBe('ready');
    });

    it('should handle session heartbeat', async () => {
      const claim = await service.claimTask(taskId, 'agent-1');

      const result = await service.sessionHeartbeat(claim.sessionId!);

      expect(result.success).toBe(true);
      expect(result.expired).toBe(false);
    });

    it('should report expired for invalid session', async () => {
      const result = await service.sessionHeartbeat('invalid-session-id');

      expect(result.success).toBe(false);
      expect(result.expired).toBe(true);
    });
  });

  describe('Decision Logging', () => {
    beforeEach(async () => {
      const project = await service.createProject({ name: 'Decision Test' });
      await service.setActiveProject(project.id);
    });

    it('should log a decision', async () => {
      const decisionId = await service.logDecision({
        decision: 'Use SQLite',
        rationale: 'Simpler for local development',
        category: 'architecture',
      });

      expect(decisionId).toBeDefined();
    });

    it('should retrieve logged decisions', async () => {
      await service.logDecision({
        decision: 'Decision 1',
        rationale: 'Reason 1',
      });
      await service.logDecision({
        decision: 'Decision 2',
        rationale: 'Reason 2',
      });

      const result = await service.getDecisions({});

      expect(result.decisions.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter decisions by category', async () => {
      await service.logDecision({
        decision: 'Architecture Decision',
        rationale: 'For architecture',
        category: 'architecture',
      });
      await service.logDecision({
        decision: 'Tradeoff Decision',
        rationale: 'For tradeoff',
        category: 'tradeoff',
      });

      const result = await service.getDecisions({ category: 'architecture' });

      expect(result.decisions.every(d => d.category === 'architecture')).toBe(true);
    });
  });

  describe('Stats', () => {
    beforeEach(async () => {
      const project = await service.createProject({ name: 'Stats Test' });
      await service.setActiveProject(project.id);
    });

    it('should return task statistics', async () => {
      await service.createTask({ title: 'Ready Task', priority: 'high' });
      await service.createTask({ title: 'Another Task', priority: 'low' });

      const stats = await service.getStats();

      expect(stats.tasks.total).toBeGreaterThanOrEqual(2);
      expect(stats.tasks.byStatus).toBeDefined();
      expect(stats.tasks.byPriority).toBeDefined();
    });
  });

  describe('Event Emission', () => {
    beforeEach(async () => {
      const project = await service.createProject({ name: 'Event Test' });
      await service.setActiveProject(project.id);
    });

    it('should emit event on task creation', async () => {
      const emittedEvents: string[] = [];
      events.on('task.created', () => emittedEvents.push('task.created'));

      await service.createTask({ title: 'Event Task' });

      expect(emittedEvents).toContain('task.created');
    });

    it('should emit event on task completion', async () => {
      const emittedEvents: string[] = [];
      events.on('task.completed', () => emittedEvents.push('task.completed'));

      const task = await service.createTask({ title: 'Complete Me' });
      await service.updateTask(task.id, { status: 'completed' });

      expect(emittedEvents).toContain('task.completed');
    });

    it('should emit event on session start', async () => {
      const emittedEvents: string[] = [];
      events.on('session.started', () => emittedEvents.push('session.started'));

      const task = await service.createTask({ title: 'Session Task' });
      await service.claimTask(task.id, 'agent-1');

      expect(emittedEvents).toContain('session.started');
    });
  });

  describe('Quality Enforcement (completeTaskSmart)', () => {
    let projectId: string;

    beforeEach(async () => {
      // Initialize a git repo in the test directory
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: testDir, stdio: 'ignore' });
      // Ignore SQLite database files
      fs.writeFileSync(path.join(testDir, '.gitignore'), '*.db\n*.db-shm\n*.db-wal\n');
      fs.writeFileSync(path.join(testDir, 'test.txt'), 'test');
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "initial"', { cwd: testDir, stdio: 'ignore' });

      const project = await service.createProject({
        name: 'Quality Test Project',
        rootPath: testDir,
      });
      projectId = project.id;
      await service.setActiveProject(projectId);
    });

    it('should block substantial changes by default when no decisions logged', async () => {
      const task = await service.createTask({
        title: 'Task without decisions',
        priority: 'medium',
      });
      await service.updateTask(task.id, { status: 'in-progress' });

      // Create substantial change (>=4 code files)
      const { execSync } = await import('child_process');
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(testDir, `mod${i}.ts`), `export const v${i} = ${i};\n`);
      }
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "feat: add modules"', { cwd: testDir, stdio: 'ignore' });

      const result = await service.completeTaskSmart({
        taskId: task.id,
        summary: 'Test summary',
        defaultProjectRoot: testDir,
        // enforceQuality defaults to true
      });

      // Should fail due to quality gaps (decisions or tests)
      if (result.qualityEnforced !== undefined) {
        expect(result.success).toBe(false);
        expect(result.qualityEnforced).toBe(true);
        expect(result.qualityGaps).toBeDefined();
        expect(result.qualityGaps?.some(g => g.includes('decisions'))).toBe(true);
      } else {
        expect(result.success).toBe(false);
      }
    });

    it('should allow small changes even with enforceQuality when no decisions logged', async () => {
      const task = await service.createTask({
        title: 'Small task without decisions',
        priority: 'medium',
      });
      await service.updateTask(task.id, { status: 'in-progress' });

      // Single file change — below substantial threshold
      const { execSync } = await import('child_process');
      fs.writeFileSync(path.join(testDir, 'small.ts'), 'export const x = 1;\n');
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "feat: small change"', { cwd: testDir, stdio: 'ignore' });

      const result = await service.completeTaskSmart({
        taskId: task.id,
        summary: 'Small change',
        defaultProjectRoot: testDir,
      });

      // Small changes should pass — decisions/tests are advisory
      expect(result.success).toBe(true);
    });

    it('should allow completion when enforceQuality is false', async () => {
      const task = await service.createTask({
        title: 'Task with bypass',
        priority: 'medium',
      });
      await service.updateTask(task.id, { status: 'in-progress' });

      // Make a commit so requireCommitOnCompletion doesn't block us
      const { execSync } = await import('child_process');
      fs.writeFileSync(path.join(testDir, 'change.txt'), 'change');
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "test change"', { cwd: testDir, stdio: 'ignore' });

      const result = await service.completeTaskSmart({
        taskId: task.id,
        summary: 'Bypassing quality checks',
        defaultProjectRoot: testDir,
        enforceQuality: false,
      });

      // Should succeed — quality bypass allowed
      expect(result.success).toBe(true);
    });

    it('should allow completion when decisions are logged', async () => {
      const task = await service.createTask({
        title: 'Task with decisions',
        priority: 'medium',
      });
      await service.updateTask(task.id, { status: 'in-progress' });

      // Log a decision for the task
      await service.logDecision({
        decision: 'Use approach A over B',
        rationale: 'Better performance',
        category: 'architecture',
        taskId: task.id,
      });

      // Make a test commit so no test gap
      const { execSync } = await import('child_process');
      fs.writeFileSync(path.join(testDir, 'test.spec.ts'), 'test');
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "test: add tests"', { cwd: testDir, stdio: 'ignore' });

      const result = await service.completeTaskSmart({
        taskId: task.id,
        summary: 'Completed with decisions',
        defaultProjectRoot: testDir,
      });

      // Should succeed (no decision gap, no test gap since we committed test file)
      expect(result.qualityGaps?.some(g => g.includes('decisions'))).toBeFalsy();
      expect(result.success).toBe(true);
    });
  });
});
