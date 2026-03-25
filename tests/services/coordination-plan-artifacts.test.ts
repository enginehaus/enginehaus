import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Plan artifact surfacing', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-plan-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Plan Test', rootPath: testDir });
    await service.setActiveProject(project.id);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('storeArtifact with type design stores plan content', async () => {
    const task = await service.createTask({ title: 'Feature task' });

    const result = await service.storeArtifact({
      taskId: task.id,
      type: 'design',
      content: '# Plan: Implement feature X\n\n## Approach\nUse pattern Y.',
      contentType: 'text/markdown',
      title: 'Plan: Implement feature X',
    });

    expect(result.success).toBe(true);
    expect(result.artifactId).toBeDefined();
    expect(result.type).toBe('design');
    expect(result.contentSize).toBeGreaterThan(0);
  });

  it('getNextTaskWithResponse surfaces plan artifacts from claimed task', async () => {
    const task = await service.createTask({ title: 'Task with plan' });
    await service.storeArtifact({
      taskId: task.id,
      type: 'design',
      content: '# Plan: Build auth system\n\n## Steps\n1. Add JWT\n2. Add middleware',
      contentType: 'text/markdown',
      title: 'Plan: Build auth system',
    });

    const result = await service.getNextTaskWithResponse({
      agentId: 'test-agent',
      withContext: false,
    });

    expect(result.success).toBe(true);
    expect(result.task?.id).toBe(task.id);
    expect(result.planArtifacts).toBeDefined();
    expect(result.planArtifacts!.length).toBe(1);
    expect(result.planArtifacts![0].title).toBe('Plan: Build auth system');
    expect(result.planArtifacts![0].content).toContain('Add JWT');
    expect(result.planArtifacts![0].fromTaskId).toBe(task.id);
    expect(result.planArtifacts![0].fromTaskTitle).toBe('Task with plan');
  });

  it('getNextTaskWithResponse surfaces plan artifacts from related tasks', async () => {
    // Note: updateTask uses INSERT OR REPLACE which CASCADE-deletes related rows.
    // So we complete the parent first, THEN create the relationship and artifact.
    const parentTask = await service.createTask({ title: 'Parent epic' });
    const childTask = await service.createTask({ title: 'Child feature' });

    // Complete parent first (CASCADE clears everything on parent)
    await service.updateTask(parentTask.id, { status: 'completed' });

    // Now create relationship and artifact AFTER the parent was last updated
    await service.linkTasks({
      sourceTaskId: childTask.id,
      targetTaskId: parentTask.id,
      relationshipType: 'part_of',
    });
    await service.storeArtifact({
      taskId: parentTask.id,
      type: 'design',
      content: '# Plan: Epic architecture\n\nOverall design for the epic.',
      contentType: 'text/markdown',
      title: 'Plan: Epic architecture',
    });

    const result = await service.getNextTaskWithResponse({
      agentId: 'test-agent',
      withContext: false,
    });

    expect(result.success).toBe(true);
    expect(result.task?.id).toBe(childTask.id);
    expect(result.planArtifacts).toBeDefined();
    expect(result.planArtifacts!.length).toBe(1);
    expect(result.planArtifacts![0].title).toBe('Plan: Epic architecture');
    expect(result.planArtifacts![0].fromTaskId).toBe(parentTask.id);
    expect(result.planArtifacts![0].fromTaskTitle).toBe('Parent epic');
  });

  it('getNextTaskWithResponse caps plans at 3 most recent', async () => {
    const task = await service.createTask({ title: 'Task with many plans' });

    // Create 5 plan artifacts
    for (let i = 1; i <= 5; i++) {
      await service.storeArtifact({
        taskId: task.id,
        type: 'design',
        content: `# Plan v${i}\nIteration ${i} of the plan.`,
        contentType: 'text/markdown',
        title: `Plan v${i}`,
      });
    }

    const result = await service.getNextTaskWithResponse({
      agentId: 'test-agent',
      withContext: false,
    });

    expect(result.success).toBe(true);
    expect(result.planArtifacts).toBeDefined();
    expect(result.planArtifacts!.length).toBe(3);
  });

  it('getNextTaskWithResponse omits planArtifacts when none exist', async () => {
    await service.createTask({ title: 'Task without plans' });

    const result = await service.getNextTaskWithResponse({
      agentId: 'test-agent',
      withContext: false,
    });

    expect(result.success).toBe(true);
    expect(result.planArtifacts).toBeUndefined();
  });

  it('message includes plan count when plans exist', async () => {
    const task = await service.createTask({ title: 'Task with plan msg' });
    await service.storeArtifact({
      taskId: task.id,
      type: 'design',
      content: '# Plan\nSome plan.',
      contentType: 'text/markdown',
      title: 'Plan: test',
    });

    const result = await service.getNextTaskWithResponse({
      agentId: 'test-agent',
      withContext: false,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('1 implementation plan(s) available');
  });
});
