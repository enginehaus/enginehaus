import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Initiative operations', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-init-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Initiative Test' });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('createInitiative stores initiative with success criteria', async () => {
    const result = await service.createInitiative({
      title: 'Reduce API latency by 50%',
      description: 'Optimize all critical paths',
      successCriteria: 'P95 latency under 100ms',
    });

    expect(result.success).toBe(true);
    expect(result.initiativeId).toBeDefined();
  });

  it('getInitiative returns initiative with linked tasks', async () => {
    const created = await service.createInitiative({
      title: 'Test Initiative',
      successCriteria: 'All tests pass',
    });

    const task = await service.createTask({ title: 'Related task' });
    await service.linkTaskToInitiative({
      taskId: task.id,
      initiativeId: created.initiativeId!,
      contributionNotes: 'Helps achieve the goal',
    });

    const result = await service.getInitiative(created.initiativeId!);

    expect(result.success).toBe(true);
    expect(result.initiative).toBeDefined();
    expect(result.initiative!.title).toBe('Test Initiative');
    expect(result.initiative!.tasks.length).toBe(1);
    expect(result.initiative!.tasks[0].taskId).toBe(task.id);
  });

  it('listInitiatives filters by status', async () => {
    await service.createInitiative({ title: 'Active one' });
    const init2 = await service.createInitiative({ title: 'Will succeed' });

    await service.recordInitiativeOutcome({
      initiativeId: init2.initiativeId!,
      status: 'succeeded',
      outcomeNotes: 'Achieved the goal',
    });

    const activeList = await service.listInitiatives({ status: 'active' });
    expect(activeList.initiatives.every(i => i.status === 'active')).toBe(true);

    const succeededList = await service.listInitiatives({ status: 'succeeded' });
    expect(succeededList.initiatives.every(i => i.status === 'succeeded')).toBe(true);
  });

  it('linkTaskToInitiative creates relationship', async () => {
    const init = await service.createInitiative({ title: 'Link test' });
    const task = await service.createTask({ title: 'Linked task' });

    const result = await service.linkTaskToInitiative({
      taskId: task.id,
      initiativeId: init.initiativeId!,
      contributionNotes: 'Optimized queries',
    });

    expect(result.success).toBe(true);
  });

  it('recordInitiativeOutcome updates status and notes', async () => {
    const init = await service.createInitiative({
      title: 'Outcome test',
      successCriteria: 'P95 under 100ms',
    });

    const result = await service.recordInitiativeOutcome({
      initiativeId: init.initiativeId!,
      status: 'succeeded',
      outcomeNotes: 'P95 now at 85ms, 57% improvement',
    });

    expect(result.success).toBe(true);

    const retrieved = await service.getInitiative(init.initiativeId!);
    expect(retrieved.initiative!.status).toBe('succeeded');
    expect(retrieved.initiative!.outcomeNotes).toContain('85ms');
  });

  it('getInitiativeLearnings returns patterns from completed', async () => {
    const init = await service.createInitiative({ title: 'Learning test' });
    await service.recordInitiativeOutcome({
      initiativeId: init.initiativeId!,
      status: 'failed',
      outcomeNotes: 'Scope was too large',
    });

    const learnings = await service.getInitiativeLearnings();

    expect(learnings.success).toBe(true);
    expect(learnings.learnings.summary.total).toBeGreaterThanOrEqual(1);
    expect(learnings.learnings.summary.failed).toBeGreaterThanOrEqual(1);
    expect(learnings.learnings.failedInitiatives.length).toBeGreaterThanOrEqual(1);
  });
});
