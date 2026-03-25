import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HandoffService } from '../../src/coordination/handoff-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('HandoffService', () => {
  let service: HandoffService;
  let storage: SQLiteStorageService;
  let testDir: string;
  let testProjectId: string;
  let testTaskId: string;
  let testSessionId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-handoff-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    service = new HandoffService(storage);

    // Create test project
    testProjectId = 'handoff-test-project';
    await storage.createProject({
      id: testProjectId,
      name: 'Handoff Test Project',
      slug: 'handoff-test',
      rootPath: testDir,
      domain: 'api',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await storage.setActiveProjectId(testProjectId);

    // Create test task
    testTaskId = 'handoff-test-task';
    await storage.saveTask({
      id: testTaskId,
      projectId: testProjectId,
      title: 'Handoff Test Task',
      description: 'Test task for handoff service',
      priority: 'high',
      status: 'in-progress',
      files: ['src/main.ts', 'src/utils.ts'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create test session
    testSessionId = 'handoff-test-session';
    await storage.saveSession({
      id: testSessionId,
      taskId: testTaskId,
      agentId: 'agent-1',
      projectId: testProjectId,
      status: 'active',
      startTime: new Date(Date.now() - 3600000), // 1 hour ago
      lastHeartbeat: new Date(),
      context: {
        role: 'test-agent',
        recentDecisions: [],
        recentUXRequirements: [],
        recentTechnicalPlans: [],
        activeTasks: [],
        readyTasks: [],
      },
    });

    // Add some decisions
    await storage.logDecision({
      decision: 'Use TypeScript for type safety',
      rationale: 'Better tooling and error detection',
      impact: 'High - affects codebase quality',
      category: 'architecture',
      taskId: testTaskId,
      projectId: testProjectId,
    });
    await storage.logDecision({
      decision: 'Implement caching layer',
      rationale: 'Improve performance',
      impact: 'Medium - affects response times',
      category: 'tradeoff',
      taskId: testTaskId,
      projectId: testProjectId,
    });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('getHandoffContext', () => {
    it('should generate handoff context for a task', async () => {
      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: testTaskId,
      });

      expect(context.fromAgent).toBe('agent-1');
      expect(context.toAgent).toBe('agent-2');
      expect(context.task.id).toBe(testTaskId);
      expect(context.task.title).toBe('Handoff Test Task');
      expect(context.task.priority).toBe('high');
    });

    it('should include task files in context', async () => {
      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: testTaskId,
      });

      expect(context.task.files).toContain('src/main.ts');
      expect(context.task.files).toContain('src/utils.ts');
    });

    it('should include decisions in context', async () => {
      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: testTaskId,
      });

      expect(context.decisions.length).toBe(2);
      expect(context.decisions.some(d => d.decision.includes('TypeScript'))).toBe(true);
    });

    it('should include accomplishments', async () => {
      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: testTaskId,
      });

      expect(context.accomplishments.length).toBeGreaterThan(0);
      expect(context.accomplishments[0]).toContain('file');
    });

    it('should include current state with summary', async () => {
      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: testTaskId,
      });

      expect(context.currentState.summary).toBeDefined();
      expect(context.currentState.summary).toContain('in progress');
    });

    it('should include next steps', async () => {
      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: testTaskId,
      });

      expect(context.nextSteps.length).toBeGreaterThan(0);
    });

    it('should include session metrics when session exists', async () => {
      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: testTaskId,
        sessionId: testSessionId,
      });

      expect(context.sessionMetrics).toBeDefined();
      expect(context.sessionMetrics?.duration).toBeDefined();
    });

    it('should throw error for non-existent task', async () => {
      await expect(service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: 'non-existent',
      })).rejects.toThrow('Task not found');
    });

    it('should handle task with blocked status', async () => {
      // Create blocker task first
      await storage.saveTask({
        id: 'blocker-task',
        projectId: testProjectId,
        title: 'Blocker Task',
        description: 'This task blocks the other',
        priority: 'high',
        status: 'ready',
        files: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create the blocked task
      await storage.saveTask({
        id: 'blocked-task',
        projectId: testProjectId,
        title: 'Blocked Task',
        description: 'A blocked task',
        priority: 'medium',
        status: 'blocked',
        files: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create the dependency relationship
      await storage.addTaskDependency('blocker-task', 'blocked-task');

      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: 'blocked-task',
      });

      expect(context.currentState.blockers.length).toBeGreaterThan(0);
      expect(context.currentState.summary).toContain('blocked');
    });
  });

  describe('generateContinuationPrompt', () => {
    it('should generate a formatted continuation prompt', async () => {
      const result = await service.generateContinuationPrompt({
        taskId: testTaskId,
        targetAgent: 'agent-2',
        fromAgent: 'agent-1',
      });

      expect(result.prompt).toContain('# Session Handoff');
      expect(result.prompt).toContain('Handoff Test Task');
    });

    it('should include metadata in result', async () => {
      const result = await service.generateContinuationPrompt({
        taskId: testTaskId,
        targetAgent: 'agent-2',
        fromAgent: 'agent-1',
      });

      expect(result.metadata.taskId).toBe(testTaskId);
      expect(result.metadata.fromAgent).toBe('agent-1');
      expect(result.metadata.toAgent).toBe('agent-2');
      expect(result.metadata.generatedAt).toBeDefined();
    });

    it('should include files when requested', async () => {
      const result = await service.generateContinuationPrompt({
        taskId: testTaskId,
        targetAgent: 'agent-2',
        includeFiles: true,
      });

      expect(result.prompt).toContain('## Relevant Files');
      expect(result.prompt).toContain('src/main.ts');
    });

    it('should exclude files when not requested', async () => {
      const result = await service.generateContinuationPrompt({
        taskId: testTaskId,
        targetAgent: 'agent-2',
        includeFiles: false,
      });

      expect(result.prompt).not.toContain('## Relevant Files');
    });

    it('should include decisions in prompt', async () => {
      const result = await service.generateContinuationPrompt({
        taskId: testTaskId,
        targetAgent: 'agent-2',
      });

      expect(result.prompt).toContain('## Decisions Made');
      expect(result.prompt).toContain('TypeScript');
    });

    it('should include next steps in prompt', async () => {
      const result = await service.generateContinuationPrompt({
        taskId: testTaskId,
        targetAgent: 'agent-2',
      });

      expect(result.prompt).toContain('## Next Steps');
    });
  });

  describe('compressSessionState', () => {
    it('should compress session state', async () => {
      const compressed = await service.compressSessionState(testSessionId);

      expect(compressed.sessionId).toBe(testSessionId);
      expect(compressed.taskId).toBe(testTaskId);
      expect(compressed.agentId).toBe('agent-1');
    });

    it('should include session summary', async () => {
      const compressed = await service.compressSessionState(testSessionId);

      expect(compressed.summary).toBeDefined();
      expect(compressed.summary).toContain('Handoff Test Task');
    });

    it('should include key decisions', async () => {
      const compressed = await service.compressSessionState(testSessionId);

      expect(compressed.keyDecisions.length).toBeGreaterThan(0);
    });

    it('should include files worked on', async () => {
      const compressed = await service.compressSessionState(testSessionId);

      expect(compressed.filesWorkedOn).toContain('src/main.ts');
    });

    it('should include session status', async () => {
      const compressed = await service.compressSessionState(testSessionId);

      expect(compressed.status).toBe('active');
    });

    it('should throw error for non-existent session', async () => {
      await expect(service.compressSessionState('non-existent'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('getHandoffStatus', () => {
    it('should return active sessions', async () => {
      const status = await service.getHandoffStatus({ projectId: testProjectId });

      expect(status.activeSessions.length).toBeGreaterThan(0);
      expect(status.activeSessions[0].sessionId).toBe(testSessionId);
    });

    it('should include session details', async () => {
      const status = await service.getHandoffStatus({ projectId: testProjectId });

      const session = status.activeSessions[0];
      expect(session.taskId).toBe(testTaskId);
      expect(session.taskTitle).toBe('Handoff Test Task');
      expect(session.agentId).toBe('agent-1');
      expect(session.durationMinutes).toBeGreaterThanOrEqual(0);
    });

    it('should include recent decisions', async () => {
      const status = await service.getHandoffStatus({ projectId: testProjectId });

      expect(status.recentDecisions.length).toBeGreaterThan(0);
    });

    it('should return pendingHandoffs count', async () => {
      const status = await service.getHandoffStatus({ projectId: testProjectId });

      expect(status.pendingHandoffs).toBeDefined();
      expect(typeof status.pendingHandoffs).toBe('number');
    });

    it('should use active project when no projectId provided', async () => {
      const status = await service.getHandoffStatus({});

      // Should still find sessions since we set active project
      expect(status.activeSessions.length).toBeGreaterThan(0);
    });
  });

  describe('Task Status Handling', () => {
    it('should handle ready status', async () => {
      await storage.saveTask({
        id: 'ready-task',
        projectId: testProjectId,
        title: 'Ready Task',
        description: 'A ready task',
        priority: 'medium',
        status: 'ready',
        files: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: 'ready-task',
      });

      expect(context.currentState.summary).toContain('ready');
      expect(context.nextSteps.some(s => s.toLowerCase().includes('begin'))).toBe(true);
    });

    it('should handle completed status', async () => {
      await storage.saveTask({
        id: 'completed-task',
        projectId: testProjectId,
        title: 'Completed Task',
        description: 'A completed task',
        priority: 'medium',
        status: 'completed',
        files: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const context = await service.getHandoffContext({
        fromAgent: 'agent-1',
        toAgent: 'agent-2',
        taskId: 'completed-task',
      });

      expect(context.currentState.summary).toContain('completed');
      expect(context.accomplishments.some(a => a.toLowerCase().includes('completed'))).toBe(true);
    });
  });
});
