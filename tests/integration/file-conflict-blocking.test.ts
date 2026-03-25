import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { handleStartWork, WorkflowHandlerContext } from '../../src/adapters/mcp/handlers/workflow-handlers.js';
import { CoordinationEngine } from '../../src/coordination/engine.js';
import { GitService } from '../../src/git/git-service.js';
import { QualityService } from '../../src/quality/quality-service.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('File conflict blocking (structural)', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;
  let repoDir: string;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-fc-db-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-fc-repo-'));
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    const project = await service.createProject({
      name: 'Conflict Test',
      slug: 'conflict-test',
      rootPath: repoDir,
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('claimTask rejects when files overlap with active session', async () => {
    // Both tasks share src/auth.ts
    const task1 = await service.createTask({
      title: 'Task A',
      priority: 'high',
      files: ['src/auth.ts', 'src/login.ts'],
    });
    const task2 = await service.createTask({
      title: 'Task B',
      priority: 'medium',
      files: ['src/auth.ts', 'src/session.ts'],
    });

    // Agent 1 claims task 1
    const claim1 = await service.claimTask(task1.id, 'agent-1');
    expect(claim1.success).toBe(true);

    // Agent 2 attempts task 2 - should be blocked (shared src/auth.ts)
    const claim2 = await service.claimTask(task2.id, 'agent-2');
    expect(claim2.success).toBe(false);
    expect(claim2.fileConflicts).toBeDefined();
    expect(claim2.fileConflicts!.length).toBeGreaterThan(0);
    expect(claim2.fileConflicts![0].overlappingFiles).toContain('src/auth.ts');
  });

  it('claimTask allows claim when no file overlap', async () => {
    const task1 = await service.createTask({
      title: 'Frontend',
      priority: 'high',
      files: ['src/ui/button.tsx'],
    });
    const task2 = await service.createTask({
      title: 'Backend',
      priority: 'medium',
      files: ['src/api/handler.ts'],
    });

    const claim1 = await service.claimTask(task1.id, 'agent-1');
    const claim2 = await service.claimTask(task2.id, 'agent-2');

    expect(claim1.success).toBe(true);
    expect(claim2.success).toBe(true);
  });

  it('claimTask with force overrides file conflicts', async () => {
    const task1 = await service.createTask({
      title: 'Task A',
      priority: 'high',
      files: ['src/shared.ts'],
    });
    const task2 = await service.createTask({
      title: 'Task B',
      priority: 'medium',
      files: ['src/shared.ts'],
    });

    await service.claimTask(task1.id, 'agent-1');

    // Force claim should succeed despite file overlap
    const claim2 = await service.claimTask(task2.id, 'agent-2', { force: true });
    expect(claim2.success).toBe(true);
    expect(claim2.sessionId).toBeDefined();
  });

  it('getNextTaskWithResponse skips conflicting tasks and claims next', async () => {
    // High priority task with conflicting files
    const conflicting = await service.createTask({
      title: 'Conflicting Task',
      priority: 'high',
      files: ['src/overlap.ts'],
    });
    // Low priority task with no conflicts
    await service.createTask({
      title: 'Safe Task',
      priority: 'low',
      files: ['src/safe.ts'],
    });

    // Agent 1 claims the conflicting files
    await service.claimTask(conflicting.id, 'agent-1');

    // Agent 2 asks for next task - should skip conflicting and get safe
    const result = await service.getNextTaskWithResponse({ agentId: 'agent-2' });

    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task!.title).toBe('Safe Task');
  });

  it('getNextTaskWithResponse fails when all tasks have conflicts', async () => {
    // All tasks share the same file
    const task1 = await service.createTask({
      title: 'Task X',
      priority: 'high',
      files: ['src/core.ts'],
    });
    await service.createTask({
      title: 'Task Y',
      priority: 'low',
      files: ['src/core.ts'],
    });

    // Agent 1 locks src/core.ts
    await service.claimTask(task1.id, 'agent-1');

    // Agent 2 can't claim any task
    const result = await service.getNextTaskWithResponse({ agentId: 'agent-2' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('conflicts');
  });

  it('handleStartWork surfaces file conflict on explicit taskId', async () => {
    const task1 = await service.createTask({
      title: 'Locked Task',
      priority: 'high',
      files: ['src/locked.ts'],
    });
    const task2 = await service.createTask({
      title: 'Blocked Task',
      priority: 'medium',
      files: ['src/locked.ts'],
    });

    await service.claimTask(task1.id, 'agent-1');

    const engine = new CoordinationEngine(
      new GitService(repoDir),
      new QualityService(repoDir),
      storage,
    );
    const ctx: WorkflowHandlerContext = { projectRoot: repoDir, service, coordination: engine };

    const result = await handleStartWork(ctx, { taskId: task2.id, agentId: 'agent-2' });

    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(false);
  });
});
