import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Checkpoint operations', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let taskId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-cp-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Checkpoint Test' });
    await service.setActiveProject(project.id);
    const task = await service.createTask({ title: 'Checkpoint task', priority: 'high' });
    taskId = task.id;
    await service.claimTask(taskId, 'test-agent');
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('requestHumanInput creates checkpoint', async () => {
    const result = await service.requestHumanInput({
      taskId,
      type: 'decision-required',
      reason: 'Need approval on API design',
      question: 'Should we use REST or GraphQL?',
      options: [
        { id: 'rest', label: 'REST', description: 'Traditional approach' },
        { id: 'graphql', label: 'GraphQL', description: 'Flexible queries' },
      ],
      requestedBy: 'test-agent',
    });

    expect(result.success).toBe(true);
    expect(result.checkpointId).toBeDefined();
  });

  it('getPendingCheckpoints returns awaiting items', async () => {
    await service.requestHumanInput({
      taskId,
      type: 'approval-required',
      reason: 'Deployment approval needed',
      requestedBy: 'test-agent',
    });

    const pending = await service.getPendingCheckpoints();

    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].taskId).toBe(taskId);
  });

  it('getCheckpoint returns checkpoint details', async () => {
    const created = await service.requestHumanInput({
      taskId,
      type: 'review-required',
      reason: 'Code review needed',
      requestedBy: 'test-agent',
    });

    const checkpoint = await service.getCheckpoint(created.checkpointId!);

    expect(checkpoint).toBeDefined();
    expect(checkpoint!.type).toBe('review-required');
    expect(checkpoint!.reason).toBe('Code review needed');
  });

  it('provideHumanInput resolves checkpoint', async () => {
    const created = await service.requestHumanInput({
      taskId,
      type: 'decision-required',
      reason: 'Pick a framework',
      requestedBy: 'test-agent',
    });

    const result = await service.provideHumanInput({
      checkpointId: created.checkpointId!,
      respondedBy: 'human-reviewer',
      decision: 'approve',
      response: 'Use Express',
    });

    expect(result.success).toBe(true);

    // Checkpoint should no longer be pending
    const pending = await service.getPendingCheckpoints();
    const stillPending = pending.find(cp => cp.id === created.checkpointId);
    expect(stillPending).toBeUndefined();
  });

  it('getTasksAwaitingHuman lists blocked tasks', async () => {
    await service.requestHumanInput({
      taskId,
      type: 'phase-gate',
      reason: 'Phase gate approval',
      requestedBy: 'test-agent',
    });

    const tasks = await service.getTasksAwaitingHuman();

    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some(t => t.id === taskId)).toBe(true);
  });
});
