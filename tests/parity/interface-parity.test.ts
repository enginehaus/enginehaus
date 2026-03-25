/**
 * Interface Parity Tests
 *
 * Verify that MCP handlers produce equivalent results to direct service calls.
 * Ensures the thin-interface pattern hasn't introduced data loss or divergence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { CoordinationEngine } from '../../src/coordination/engine.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { GitService } from '../../src/git/git-service.js';
import { QualityService } from '../../src/quality/quality-service.js';
import { handleAddTask, handleListTasks, handleGetNextTask, handleCompleteTaskSmart } from '../../src/adapters/mcp/handlers/task-handlers.js';
import { handleLogDecision } from '../../src/adapters/mcp/handlers/decision-handlers.js';
import { handleQuickHandoff } from '../../src/adapters/mcp/handlers/session-handlers.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Interface Parity', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let engine: CoordinationEngine;
  let events: EventOrchestrator;
  let testDir: string;
  let testProjectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-parity-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();

    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const gitService = new GitService(testDir);
    const qualityService = new QualityService(testDir);
    engine = new CoordinationEngine(gitService, qualityService, storage);

    // Initialize git repo (required for completeTaskSmart)
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test" && git commit --allow-empty -m "init"', { cwd: testDir, stdio: 'ignore' });

    testProjectId = 'parity-test-project';
    await storage.createProject({
      id: testProjectId,
      name: 'Parity Test Project',
      slug: 'parity-test',
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

  function getTaskHandlerContext() {
    return {
      projectRoot: testDir,
      service,
      coordination: engine,
      getProjectContext: async () => ({
        projectId: testProjectId,
        projectName: 'Parity Test Project',
        projectSlug: 'parity-test',
      }),
      sessionState: { taskCount: 0 },
    };
  }

  function parseResponse(result: { content: Array<{ type: string; text: string }> }) {
    return JSON.parse(result.content[0].text);
  }

  describe('create task', () => {
    it('MCP handler produces task with same fields as engine.createUnifiedTask', async () => {
      const ctx = getTaskHandlerContext();
      const mcpResult = await handleAddTask(ctx, {
        title: 'Parity Test Task',
        priority: 'high',
        description: 'Testing interface parity',
      });
      const parsed = parseResponse(mcpResult);

      expect(parsed.success).toBe(true);
      expect(parsed.taskId).toBeDefined();
      expect(parsed.title).toBe('Parity Test Task');
      expect(parsed.priority).toBe('high');

      // Verify the task exists via direct storage query
      const storedTask = await storage.getTask(parsed.taskId);
      expect(storedTask).toBeDefined();
      expect(storedTask!.title).toBe('Parity Test Task');
      expect(storedTask!.priority).toBe('high');
      expect(storedTask!.projectId).toBe(testProjectId);
    });

    it('MCP handler task matches direct engine creation shape', async () => {
      const directTask = await engine.createUnifiedTask({
        title: 'Direct Task',
        priority: 'medium',
        description: 'Created directly',
      });

      const ctx = getTaskHandlerContext();
      const mcpResult = await handleAddTask(ctx, {
        title: 'MCP Task',
        priority: 'medium',
        description: 'Created via handler',
      });
      const parsed = parseResponse(mcpResult);

      // Both should have same field types
      expect(typeof parsed.taskId).toBe(typeof directTask.id);
      expect(typeof parsed.priority).toBe(typeof directTask.priority);
      expect(parsed.priority).toBe(directTask.priority);
    });
  });

  describe('list tasks', () => {
    it('MCP handler returns same tasks as service.listTasksWithResponse', async () => {
      // Create some tasks
      await engine.createUnifiedTask({ title: 'Task A', priority: 'high', description: 'First task' });
      await engine.createUnifiedTask({ title: 'Task B', priority: 'medium', description: 'Second task' });

      const ctx = getTaskHandlerContext();
      const mcpResult = await handleListTasks(ctx, {});
      const parsed = parseResponse(mcpResult);

      // Direct service call
      const serviceResult = await service.listTasksWithResponse({});

      expect(parsed.success).toBe(true);
      expect(parsed.tasks.length).toBe(serviceResult.tasks.length);

      // Verify task titles match
      const mcpTitles = parsed.tasks.map((t: any) => t.title).sort();
      const serviceTitles = serviceResult.tasks.map(t => t.title).sort();
      expect(mcpTitles).toEqual(serviceTitles);
    });

    it('MCP handler respects same filter as service', async () => {
      await engine.createUnifiedTask({ title: 'High Task', priority: 'high', description: 'High priority' });
      await engine.createUnifiedTask({ title: 'Low Task', priority: 'low', description: 'Low priority' });

      const ctx = getTaskHandlerContext();
      const mcpResult = await handleListTasks(ctx, { priority: 'high' });
      const parsed = parseResponse(mcpResult);

      const serviceResult = await service.listTasksWithResponse({ priority: 'high' });

      expect(parsed.tasks.length).toBe(serviceResult.tasks.length);
      parsed.tasks.forEach((t: any) => expect(t.priority).toBe('high'));
    });
  });

  describe('log decision', () => {
    it('MCP handler produces consistent decision structure', async () => {
      const mcpResult = await handleLogDecision(service, {
        decision: 'Use TypeScript over JavaScript',
        rationale: 'Better type safety',
        category: 'architecture',
      });
      const parsed = parseResponse(mcpResult);

      expect(parsed.success).toBe(true);
      expect(parsed.decisionId).toBeDefined();

      // Verify via direct service call
      const result = await service.getDecisions({});
      const found = result.decisions.find(d => d.id === parsed.decisionId);
      expect(found).toBeDefined();
      expect(found!.decision).toBe('Use TypeScript over JavaScript');
      expect(found!.rationale).toBe('Better type safety');
      expect(found!.category).toBe('architecture');
    });
  });

  describe('get next task', () => {
    it('MCP handler returns same task as service.getNextTaskWithResponse', async () => {
      await engine.createUnifiedTask({ title: 'Ready Task', priority: 'critical', description: 'Critical task' });

      const ctx = getTaskHandlerContext();
      const mcpResult = await handleGetNextTask(ctx, {});
      const parsed = parseResponse(mcpResult);

      const serviceResult = await service.getNextTaskWithResponse({});

      // Both should find the same task
      if (serviceResult.task) {
        expect(parsed.task.id).toBe(serviceResult.task.id);
        expect(parsed.task.title).toBe(serviceResult.task.title);
        expect(parsed.task.priority).toBe(serviceResult.task.priority);
      }
    });
  });

  describe('complete task', () => {
    it('MCP handler calls same service method and returns consistent result', async () => {
      const task = await engine.createUnifiedTask({
        title: 'Task to Complete',
        priority: 'medium',
        description: 'Will be completed',
      });

      // Claim it first (required for completion)
      await engine.claimTask(task.id, 'test-agent');

      // Add .gitignore for the db file so uncommitted-changes check passes
      fs.writeFileSync(path.join(testDir, '.gitignore'), '*.db\n*.db-journal\n*.db-shm\n*.db-wal\n');
      execSync('git add .gitignore && git commit -m "add gitignore"', { cwd: testDir, stdio: 'ignore' });

      const ctx = getTaskHandlerContext();
      const mcpResult = await handleCompleteTaskSmart(ctx, {
        taskId: task.id,
        summary: 'Completed via parity test',
        enforceQuality: false,
      });
      const parsed = parseResponse(mcpResult);

      expect(parsed.success).toBe(true);
      expect(parsed.taskId).toBe(task.id);

      // Verify task is completed in storage
      const storedTask = await storage.getTask(task.id);
      expect(storedTask!.status).toBe('completed');
    });
  });

  describe('quick handoff', () => {
    it('MCP handler delegates to service.generateQuickHandoff', async () => {
      const task = await engine.createUnifiedTask({
        title: 'Handoff Task',
        priority: 'high',
        description: 'Will be handed off',
      });
      await engine.claimTask(task.id, 'test-agent');

      const ctx = { service, coordination: engine };
      const mcpResult = await handleQuickHandoff(ctx, {
        taskId: task.id,
        note: 'Handing off for testing',
      });
      const parsed = parseResponse(mcpResult);

      // Should return handoff info
      expect(parsed.success).toBe(true);
      expect(parsed.taskId).toBe(task.id);
    });
  });

  describe('cross-interface consistency', () => {
    it('task created via MCP handler appears in service list', async () => {
      const ctx = getTaskHandlerContext();
      const mcpResult = await handleAddTask(ctx, {
        title: 'Cross-Interface Task',
        priority: 'high',
        description: 'Cross-interface test',
      });
      const parsed = parseResponse(mcpResult);

      // Verify via service list
      const serviceResult = await service.listTasksWithResponse({});
      const found = serviceResult.tasks.find(t => t.id === parsed.taskId);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Cross-Interface Task');
    });

    it('decision logged via MCP handler has same shape as service query', async () => {
      await handleLogDecision(service, {
        decision: 'Consistency check',
        rationale: 'Testing parity',
        category: 'pattern',
      });

      const result = await service.getDecisions({});
      expect(result.decisions.length).toBeGreaterThan(0);

      const decision = result.decisions[0];
      expect(decision.id).toBeDefined();
      expect(decision.decision).toBe('Consistency check');
      expect(decision.rationale).toBe('Testing parity');
      expect(decision.category).toBe('pattern');
      expect(decision.createdAt).toBeDefined();
    });
  });

  describe('file-relevant decisions', () => {
    it('getFileRelevantDecisions returns decisions mentioning task files', async () => {
      // Log a decision mentioning a specific file
      await service.logDecision({
        decision: 'All operations route through CoordinationService',
        rationale: 'Thin interface pattern for coordination-service.ts',
        category: 'architecture',
      });

      // Log a decision NOT mentioning the file
      await service.logDecision({
        decision: 'Use SQLite for storage',
        rationale: 'Simpler deployment',
        category: 'architecture',
      });

      const task = await engine.createUnifiedTask({
        title: 'Fix coordination service',
        priority: 'high',
        description: 'Bug fix',
        files: ['src/core/services/coordination-service.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files || []);

      // Should find the decision mentioning coordination-service.ts
      expect(result.relevantDecisions.length).toBeGreaterThan(0);
      expect(result.relevantDecisions[0].decision).toContain('CoordinationService');
    });

    it('getFileRelevantDecisions matches on basename', async () => {
      await service.logDecision({
        decision: 'server.ts should remain a thin translation layer',
        rationale: 'Architecture enforcement',
        category: 'pattern',
      });

      const task = await engine.createUnifiedTask({
        title: 'Update REST server',
        priority: 'medium',
        description: 'Add endpoint',
        files: ['src/adapters/rest/server.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files || []);

      expect(result.relevantDecisions.length).toBeGreaterThan(0);
      expect(result.relevantDecisions[0].decision).toContain('server.ts');
    });

    it('getFileRelevantDecisions returns empty when no match', async () => {
      await service.logDecision({
        decision: 'Use React for frontend',
        rationale: 'Component model',
        category: 'architecture',
      });

      const task = await engine.createUnifiedTask({
        title: 'Fix database',
        priority: 'low',
        description: 'Schema issue',
        files: ['src/storage/sqlite-storage-service.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files || []);

      // 'React for frontend' doesn't mention sqlite-storage-service
      const reactDecision = result.relevantDecisions.find(d => d.decision.includes('React'));
      expect(reactDecision).toBeUndefined();
    });
  });
});
