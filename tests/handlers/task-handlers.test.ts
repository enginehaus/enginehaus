import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleAddTask,
  handleListTasks,
  handleUpdateTask,
  handleCompleteTaskSmart,
  TaskHandlerContext,
} from '../../src/adapters/mcp/handlers/task-handlers.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { CoordinationEngine } from '../../src/coordination/engine.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { GitService } from '../../src/git/git-service.js';
import { QualityService } from '../../src/quality/quality-service.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('task handlers', () => {
  let service: CoordinationService;
  let engine: CoordinationEngine;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;
  let repoDir: string;
  let ctx: TaskHandlerContext;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-th-db-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-th-repo-'));

    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const gitService = new GitService(repoDir);
    const qualityService = new QualityService(repoDir);
    engine = new CoordinationEngine(gitService, qualityService, storage);

    // Init git repo
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    const project = await service.createProject({
      name: 'Task Handler Test',
      slug: 'task-handler-test',
      rootPath: repoDir,
    });
    projectId = project.id;
    await service.setActiveProject(projectId);

    ctx = {
      projectRoot: repoDir,
      service,
      coordination: engine,
      getProjectContext: async () => ({
        projectId,
        projectName: 'Task Handler Test',
        projectSlug: 'task-handler-test',
      }),
      sessionState: { taskCount: 0 },
    };
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('handleAddTask creates task with all fields', async () => {
    const result = await handleAddTask(ctx, {
      title: 'New Feature',
      description: 'Implement the new feature',
      priority: 'high',
      files: ['src/feature.ts'],
    });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
    expect(body.taskId).toBeDefined();
    expect(body.title).toBe('New Feature');
    expect(body.priority).toBe('high');
  });

  it('handleAddTask increments session task count', async () => {
    expect(ctx.sessionState.taskCount).toBe(0);

    await handleAddTask(ctx, {
      title: 'Task 1',
      description: 'First task',
      priority: 'medium',
    });

    expect(ctx.sessionState.taskCount).toBe(1);

    await handleAddTask(ctx, {
      title: 'Task 2',
      description: 'Second task',
      priority: 'low',
    });

    expect(ctx.sessionState.taskCount).toBe(2);
  });

  it('handleListTasks returns tasks', async () => {
    await service.createTask({ title: 'Task A', priority: 'high' });
    await service.createTask({ title: 'Task B', priority: 'low' });

    const result = await handleListTasks(ctx, {});

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.tasks.length).toBeGreaterThanOrEqual(2);
  });

  it('handleListTasks filters by priority', async () => {
    await service.createTask({ title: 'High Task', priority: 'high' });
    await service.createTask({ title: 'Low Task', priority: 'low' });

    const result = await handleListTasks(ctx, { priority: 'high' });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    const tasks = body.tasks || [];
    expect(tasks.every((t: any) => t.priority === 'high')).toBe(true);
  });

  it('handleUpdateTask changes task fields', async () => {
    const task = await service.createTask({ title: 'Original', priority: 'low' });

    const result = await handleUpdateTask(ctx, {
      taskId: task.id,
      title: 'Updated Title',
      priority: 'critical',
    });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
  });

  it('handleCompleteTaskSmart enforces quality for substantial changes', async () => {
    const task = await service.createTask({ title: 'Complete me', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Commit multiple code files without tests (substantial change: >=4 code files)
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(repoDir, `module${i}.ts`), `export const val${i} = ${i};\n`);
    }
    execSync('git add . && git commit -m "feat: add modules"', { cwd: repoDir, stdio: 'ignore' });

    const result = await handleCompleteTaskSmart(ctx, {
      taskId: task.id,
      summary: 'Added code',
      enforceQuality: true,
    });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(false);
    expect(body.qualityGaps).toBeDefined();
  });
});
