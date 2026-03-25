import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Dispatch Queue', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let tmpDir: string;
  let projectId: string;
  let taskId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-dispatch-test-'));
    storage = new SQLiteStorageService(tmpDir);
    await storage.initialize();
    const events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Dispatch Test', rootPath: tmpDir });
    projectId = project.id;
    await storage.setActiveProjectId(projectId);

    // Create a task to dispatch
    taskId = uuidv4();
    await storage.saveTask({
      id: taskId,
      projectId,
      title: 'Implement feature X',
      description: 'Build the thing',
      priority: 'medium',
      status: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and retrieves dispatches', async () => {
    const dispatch = {
      id: uuidv4(),
      projectId,
      taskId,
      targetAgent: 'claude-code',
      dispatchedBy: 'trevor',
      status: 'pending' as const,
      createdAt: new Date(),
    };

    await service.dispatchTask(dispatch);
    const pending = await service.getPendingDispatches('claude-code');

    expect(pending).toHaveLength(1);
    expect(pending[0].taskId).toBe(taskId);
    expect(pending[0].targetAgent).toBe('claude-code');
    expect(pending[0].dispatchedBy).toBe('trevor');
  });

  it('rejects dispatch for non-existent task', async () => {
    await expect(
      service.dispatchTask({
        id: uuidv4(),
        projectId,
        taskId: 'non-existent-id',
        targetAgent: 'claude-code',
        dispatchedBy: 'trevor',
        status: 'pending',
        createdAt: new Date(),
      })
    ).rejects.toThrow('not found');
  });

  it('claims a dispatch', async () => {
    const dispatchId = uuidv4();
    await service.dispatchTask({
      id: dispatchId,
      projectId,
      taskId,
      targetAgent: 'claude-code',
      dispatchedBy: 'trevor',
      status: 'pending',
      createdAt: new Date(),
    });

    const claimed = await service.claimDispatch(dispatchId);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('claimed');

    // Should no longer appear in pending
    const pending = await service.getPendingDispatches('claude-code');
    expect(pending).toHaveLength(0);
  });

  it('recalls a pending dispatch', async () => {
    const dispatchId = uuidv4();
    await service.dispatchTask({
      id: dispatchId,
      projectId,
      taskId,
      targetAgent: 'claude-code',
      dispatchedBy: 'trevor',
      status: 'pending',
      createdAt: new Date(),
    });

    const recalled = await service.recallDispatch(dispatchId);
    expect(recalled).toBe(true);

    // Should no longer appear in pending
    const pending = await service.getPendingDispatches('claude-code');
    expect(pending).toHaveLength(0);
  });

  it('cannot recall an already-claimed dispatch', async () => {
    const dispatchId = uuidv4();
    await service.dispatchTask({
      id: dispatchId,
      projectId,
      taskId,
      targetAgent: 'claude-code',
      dispatchedBy: 'trevor',
      status: 'pending',
      createdAt: new Date(),
    });

    await service.claimDispatch(dispatchId);
    const recalled = await service.recallDispatch(dispatchId);
    expect(recalled).toBe(false);
  });

  it('filters pending dispatches by target agent', async () => {
    await service.dispatchTask({
      id: uuidv4(), projectId, taskId, targetAgent: 'claude-code',
      dispatchedBy: 'trevor', status: 'pending', createdAt: new Date(),
    });
    await service.dispatchTask({
      id: uuidv4(), projectId, taskId, targetAgent: 'cursor',
      dispatchedBy: 'trevor', status: 'pending', createdAt: new Date(),
    });

    const claudeDispatches = await service.getPendingDispatches('claude-code');
    expect(claudeDispatches).toHaveLength(1);
    expect(claudeDispatches[0].targetAgent).toBe('claude-code');
  });

  it('excludes expired dispatches', async () => {
    await service.dispatchTask({
      id: uuidv4(), projectId, taskId, targetAgent: 'claude-code',
      dispatchedBy: 'trevor', status: 'pending', createdAt: new Date(),
      expiresAt: new Date(Date.now() - 60000), // Expired 1 minute ago
    });

    const pending = await service.getPendingDispatches('claude-code');
    expect(pending).toHaveLength(0);
  });

  it('lists dispatches with status filter', async () => {
    const d1 = uuidv4();
    const d2 = uuidv4();
    await service.dispatchTask({
      id: d1, projectId, taskId, targetAgent: 'claude-code',
      dispatchedBy: 'trevor', status: 'pending', createdAt: new Date(),
    });
    await service.dispatchTask({
      id: d2, projectId, taskId, targetAgent: 'cursor',
      dispatchedBy: 'trevor', status: 'pending', createdAt: new Date(),
    });

    await service.claimDispatch(d1);

    const pendingOnly = await service.listDispatches({ status: 'pending' });
    expect(pendingOnly).toHaveLength(1);
    expect(pendingOnly[0].targetAgent).toBe('cursor');

    const claimedOnly = await service.listDispatches({ status: 'claimed' });
    expect(claimedOnly).toHaveLength(1);
    expect(claimedOnly[0].targetAgent).toBe('claude-code');
  });

  it('includes priority override and context', async () => {
    await service.dispatchTask({
      id: uuidv4(), projectId, taskId, targetAgent: 'claude-code',
      dispatchedBy: 'trevor', status: 'pending', createdAt: new Date(),
      priorityOverride: 'critical',
      context: 'This is urgent — customer demo tomorrow',
    });

    const pending = await service.getPendingDispatches('claude-code');
    expect(pending[0].priorityOverride).toBe('critical');
    expect(pending[0].context).toBe('This is urgent — customer demo tomorrow');
  });
});
