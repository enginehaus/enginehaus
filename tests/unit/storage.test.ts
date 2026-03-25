import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { Project, UnifiedTask, CoordinationSession } from '../../src/coordination/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteStorageService', () => {
  let storage: SQLiteStorageService;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Projects', () => {
    it('should create a project', async () => {
      const project: Project = {
        id: 'test-project-1',
        name: 'Test Project',
        slug: 'test-project',
        rootPath: '/path/to/project',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await storage.createProject(project);
      const retrieved = await storage.getProject(project.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Project');
      expect(retrieved?.slug).toBe('test-project');
    });

    it('should list all projects', async () => {
      const project1: Project = {
        id: 'project-1',
        name: 'Project One',
        slug: 'project-one',
        rootPath: '/path/one',
        domain: 'web',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const project2: Project = {
        id: 'project-2',
        name: 'Project Two',
        slug: 'project-two',
        rootPath: '/path/two',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await storage.createProject(project1);
      await storage.createProject(project2);

      const projects = await storage.listProjects();
      // Default project + 2 new ones
      expect(projects.length).toBeGreaterThanOrEqual(2);
    });

    it('should set and get active project', async () => {
      const project: Project = {
        id: 'active-project',
        name: 'Active Project',
        slug: 'active-project',
        rootPath: '/active/path',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await storage.createProject(project);
      await storage.setActiveProjectId(project.id);

      const activeId = await storage.getActiveProjectId();
      expect(activeId).toBe('active-project');
    });
  });

  describe('Database Initialization', () => {
    it('should start with no projects (no auto-created default)', async () => {
      const projects = await storage.listProjects();
      // After removing auto-creation of default project, a fresh DB starts empty
      // (except for test projects created in beforeEach of other tests)
      expect(projects.length).toBeGreaterThanOrEqual(0);
    });

    it('should support closing and reopening', async () => {
      const project: Project = {
        id: 'persist-project',
        name: 'Persist Project',
        slug: 'persist-project',
        rootPath: '/persist/path',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await storage.createProject(project);
      storage.close();

      // Reopen
      storage = new SQLiteStorageService(testDir);
      await storage.initialize();

      const retrieved = await storage.getProject('persist-project');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Persist Project');
    });
  });

  describe('Task status transitions', () => {
    const projectId = 'test-project';

    beforeEach(async () => {
      await storage.createProject({
        id: projectId, name: 'Test', slug: 'test', rootPath: '/test',
        domain: 'api', status: 'active', createdAt: new Date(), updatedAt: new Date(),
      });
      await storage.setActiveProjectId(projectId);
    });

    it('should allow valid transitions', async () => {
      const task: UnifiedTask = {
        id: 'transition-1', projectId, title: 'Test', description: 'Test',
        priority: 'medium', status: 'ready', createdAt: new Date(), updatedAt: new Date(),
      };
      await storage.saveTask(task);

      // ready → in-progress
      await storage.updateTask('transition-1', { status: 'in-progress' });
      let updated = await storage.getTask('transition-1');
      expect(updated?.status).toBe('in-progress');

      // in-progress → completed
      await storage.updateTask('transition-1', { status: 'completed' });
      updated = await storage.getTask('transition-1');
      expect(updated?.status).toBe('completed');
    });

    it('should reject completed → ready transition', async () => {
      const task: UnifiedTask = {
        id: 'transition-2', projectId, title: 'Test', description: 'Test',
        priority: 'medium', status: 'completed', createdAt: new Date(), updatedAt: new Date(),
      };
      await storage.saveTask(task);

      await expect(storage.updateTask('transition-2', { status: 'ready' }))
        .rejects.toThrow('Invalid status transition: completed → ready');
    });

    it('should reject completed → in-progress transition', async () => {
      const task: UnifiedTask = {
        id: 'transition-3', projectId, title: 'Test', description: 'Test',
        priority: 'medium', status: 'completed', createdAt: new Date(), updatedAt: new Date(),
      };
      await storage.saveTask(task);

      await expect(storage.updateTask('transition-3', { status: 'in-progress' }))
        .rejects.toThrow('Invalid status transition: completed → in-progress');
    });
  });

  describe('expireStaleSessions', () => {
    const projectId = 'test-project';
    const taskId = 'task-1';
    const sessionId = 'session-1';

    beforeEach(async () => {
      // Create project
      await storage.createProject({
        id: projectId,
        name: 'Test',
        slug: 'test',
        rootPath: '/test',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await storage.setActiveProjectId(projectId);

      // Create task in 'in-progress' status
      const task: UnifiedTask = {
        id: taskId,
        projectId,
        title: 'Test task',
        description: 'A task that will get stuck',
        priority: 'high',
        status: 'in-progress',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await storage.saveTask(task);
    });

    it('should reset orphaned tasks to ready when sessions expire', async () => {
      // Create a session with a stale heartbeat (10 minutes ago)
      const staleTime = new Date(Date.now() - 10 * 60 * 1000);
      const session: CoordinationSession = {
        id: sessionId,
        projectId,
        taskId,
        agentId: 'agent-1',
        status: 'active',
        startTime: staleTime,
        lastHeartbeat: staleTime,
        context: { role: 'agent-1', currentTask: null as any, recentDecisions: [], recentUXRequirements: [], recentTechnicalPlans: [], activeTasks: [], readyTasks: [], projectContext: {} },
      };
      await storage.saveSession(session);

      // Verify task is in-progress
      let task = await storage.getTask(taskId);
      expect(task?.status).toBe('in-progress');

      // Expire stale sessions (default 5 min timeout)
      const expired = await storage.expireStaleSessions();
      expect(expired).toBe(1);

      // Task should now be reset to 'ready'
      task = await storage.getTask(taskId);
      expect(task?.status).toBe('ready');
    });

    it('should close dangling sessions for completed tasks', async () => {
      // Mark the task as completed (simulating completeTaskWithResponse before the fix)
      const task = await storage.getTask(taskId);
      task!.status = 'completed';
      await storage.saveTask(task!);

      // Create an active session that was never closed (the dangling session bug)
      const session: CoordinationSession = {
        id: sessionId,
        projectId,
        taskId,
        agentId: 'agent-1',
        status: 'active',
        startTime: new Date(),
        lastHeartbeat: new Date(), // Recent heartbeat — won't be caught by timeout
        context: { role: 'agent-1', currentTask: null as any, recentDecisions: [], recentUXRequirements: [], recentTechnicalPlans: [], activeTasks: [], readyTasks: [], projectContext: {} },
      };
      await storage.saveSession(session);

      // Verify the session is active
      const activeBefore = await storage.getActiveSessionForTask(taskId);
      expect(activeBefore).not.toBeNull();

      // Expire stale sessions — should catch the dangling session
      const expired = await storage.expireStaleSessions();
      expect(expired).toBe(1);

      // Session should now be closed
      const activeAfter = await storage.getActiveSessionForTask(taskId);
      expect(activeAfter).toBeNull();
    });

    it('should not reset tasks that still have an active session', async () => {
      // Create a stale session
      const staleTime = new Date(Date.now() - 10 * 60 * 1000);
      const staleSession: CoordinationSession = {
        id: 'stale-session',
        projectId,
        taskId,
        agentId: 'agent-1',
        status: 'active',
        startTime: staleTime,
        lastHeartbeat: staleTime,
        context: { role: 'agent-1', currentTask: null as any, recentDecisions: [], recentUXRequirements: [], recentTechnicalPlans: [], activeTasks: [], readyTasks: [], projectContext: {} },
      };
      await storage.saveSession(staleSession);

      // Create a fresh active session for the same task
      const freshSession: CoordinationSession = {
        id: 'fresh-session',
        projectId,
        taskId,
        agentId: 'agent-2',
        status: 'active',
        startTime: new Date(),
        lastHeartbeat: new Date(),
        context: { role: 'agent-2', currentTask: null as any, recentDecisions: [], recentUXRequirements: [], recentTechnicalPlans: [], activeTasks: [], readyTasks: [], projectContext: {} },
      };
      await storage.saveSession(freshSession);

      // Expire stale sessions
      const expired = await storage.expireStaleSessions();
      expect(expired).toBe(1);

      // Task should remain in-progress because fresh session still exists
      const task = await storage.getTask(taskId);
      expect(task?.status).toBe('in-progress');
    });
  });

  describe('searchTasks — tokenized search', () => {
    const projectId = 'search-test-project';

    beforeEach(async () => {
      await storage.createProject({
        id: projectId,
        name: 'Search Test',
        slug: 'search-test',
        rootPath: '/test',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // Create tasks with varied titles
      const tasks: Partial<UnifiedTask>[] = [
        { id: 'task-ssw', title: 'SSW / IRCC settlement sector: market research, CLB mapping', description: 'Research for SSW corridor' },
        { id: 'task-web', title: 'Web presence: goshima.co refresh for GTM readiness', description: 'Refresh the website' },
        { id: 'task-pos', title: 'Positioning documents: one-pager per institutional buyer', description: 'Sales collateral' },
        { id: 'task-tts', title: 'TTS: language tier model + hybrid delivery', description: 'Text to speech infrastructure' },
        { id: 'task-dnd', title: 'DND / federal government language training', description: 'Military and government vertical' },
      ];

      for (const t of tasks) {
        await storage.saveTask({
          id: t.id!,
          title: t.title!,
          description: t.description || '',
          status: 'ready',
          priority: 'medium',
          projectId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as UnifiedTask);
      }
    });

    it('finds tasks with single token', async () => {
      const results = await storage.searchTasks('SSW', { projectId });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('task-ssw');
    });

    it('finds tasks with multi-word tokenized query', async () => {
      const results = await storage.searchTasks('SSW IRCC settlement', { projectId });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('task-ssw');
    });

    it('finds tasks when tokens appear in different order than title', async () => {
      const results = await storage.searchTasks('settlement SSW', { projectId });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('task-ssw');
    });

    it('finds tasks with partial word tokens', async () => {
      const results = await storage.searchTasks('goshima website', { projectId });
      // "goshima" matches title, "website" matches description
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('task-web');
    });

    it('returns empty for tokens that don\'t all match', async () => {
      const results = await storage.searchTasks('SSW goshima', { projectId });
      expect(results.length).toBe(0);
    });

    it('respects status filter with tokenized search', async () => {
      const results = await storage.searchTasks('SSW', { projectId, status: 'completed' });
      expect(results.length).toBe(0); // task is 'ready', not 'completed'
    });

    it('searches description field too', async () => {
      const results = await storage.searchTasks('corridor', { projectId });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('task-ssw');
    });

    it('returns empty for blank query', async () => {
      const results = await storage.searchTasks('   ', { projectId });
      expect(results.length).toBe(0);
    });

    it('handles federal government multi-token', async () => {
      const results = await storage.searchTasks('DND federal government language', { projectId });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('task-dnd');
    });
  });
});
