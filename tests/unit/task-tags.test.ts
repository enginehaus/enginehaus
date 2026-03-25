import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Task Tags', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let tmpDir: string;
  let projectId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-tags-'));
    storage = new SQLiteStorageService(tmpDir);
    await storage.initialize();
    const events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Tags Test', rootPath: tmpDir });
    projectId = project.id;
    await storage.setActiveProjectId(projectId);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a task with tags', async () => {
    const task = await service.createTask({
      title: 'Tagged task',
      description: 'Has tags',
      priority: 'high',
      projectId,
      tags: ['oss-launch', 'ax'],
    });

    expect(task.tags).toEqual(['oss-launch', 'ax']);

    // Verify persistence
    const retrieved = await service.getTask(task.id);
    expect(retrieved?.tags).toEqual(['oss-launch', 'ax']);
  });

  it('creates a task without tags (undefined)', async () => {
    const task = await service.createTask({
      title: 'No tags',
      description: 'Plain task',
      priority: 'medium',
      projectId,
    });

    expect(task.tags).toBeUndefined();
  });

  it('updates task tags', async () => {
    const task = await service.createTask({
      title: 'Will get tags',
      description: 'No tags initially',
      priority: 'medium',
      projectId,
    });

    await storage.updateTask(task.id, { tags: ['messaging', 'gtm'] });

    const updated = await service.getTask(task.id);
    expect(updated?.tags).toEqual(['messaging', 'gtm']);
  });

  it('filters tasks by tag', async () => {
    await service.createTask({ title: 'Launch task 1', priority: 'high', projectId, tags: ['launch'] });
    await service.createTask({ title: 'Launch task 2', priority: 'high', projectId, tags: ['launch', 'ax'] });
    await service.createTask({ title: 'Other task', priority: 'medium', projectId, tags: ['infra'] });
    await service.createTask({ title: 'No tags', priority: 'low', projectId });

    const launchTasks = await storage.getTasks({ projectId, tags: ['launch'] });
    expect(launchTasks).toHaveLength(2);
    expect(launchTasks.map(t => t.title)).toContain('Launch task 1');
    expect(launchTasks.map(t => t.title)).toContain('Launch task 2');
  });

  it('filters by multiple tags (OR semantics)', async () => {
    await service.createTask({ title: 'AX task', priority: 'high', projectId, tags: ['ax'] });
    await service.createTask({ title: 'Infra task', priority: 'high', projectId, tags: ['infra'] });
    await service.createTask({ title: 'Other', priority: 'low', projectId, tags: ['messaging'] });

    const results = await storage.getTasks({ projectId, tags: ['ax', 'infra'] });
    expect(results).toHaveLength(2);
  });

  it('tag filter returns empty when no matches', async () => {
    await service.createTask({ title: 'Some task', priority: 'medium', projectId, tags: ['existing'] });

    const results = await storage.getTasks({ projectId, tags: ['nonexistent'] });
    expect(results).toHaveLength(0);
  });

  it('listTasksWithResponse includes tags', async () => {
    await service.createTask({ title: 'Tagged', priority: 'high', projectId, tags: ['v1'] });

    const result = await service.listTasksWithResponse({ tags: ['v1'] });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].tags).toEqual(['v1']);
  });
});
