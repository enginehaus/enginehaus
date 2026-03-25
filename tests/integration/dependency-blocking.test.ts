import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Dependency blocking (structural)', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-dep-'));
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({
      name: 'Dependency Test',
      slug: 'dep-test',
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  it('claimTask rejects when task has unmet dependencies', async () => {
    const blocker = await service.createTask({ title: 'Blocker Task', priority: 'high' });
    const blocked = await service.createTask({ title: 'Blocked Task', priority: 'high' });

    await service.addTaskDependency(blocker.id, blocked.id);

    // Verify task is now in blocked status
    const task = await service.getTask(blocked.id);
    expect(task!.status).toBe('blocked');

    // Attempt to claim blocked task - should be rejected
    const result = await service.claimTask(blocked.id, 'agent-1');
    expect(result.success).toBe(false);
    expect(result.dependencyBlock).toBeDefined();
    expect(result.dependencyBlock!.blockedBy.length).toBeGreaterThan(0);
    expect(result.dependencyBlock!.blockedBy[0].taskId).toBe(blocker.id);
  });

  it('claimTask allows after dependency is completed', async () => {
    const blocker = await service.createTask({ title: 'Blocker', priority: 'high' });
    const blocked = await service.createTask({ title: 'Dependent', priority: 'high' });

    await service.addTaskDependency(blocker.id, blocked.id);

    // Complete the blocker (simulating task completion)
    await storage.updateTask(blocker.id, { status: 'completed' });
    await storage.onTaskCompleted(blocker.id);

    // Dependent should now be unblocked
    const task = await service.getTask(blocked.id);
    expect(task!.status).toBe('ready');

    // Claim should now succeed
    const result = await service.claimTask(blocked.id, 'agent-2');
    expect(result.success).toBe(true);
    expect(result.sessionId).toBeDefined();
  });

  it('claimTask with force overrides dependency block', async () => {
    const blocker = await service.createTask({ title: 'Blocker', priority: 'high' });
    const blocked = await service.createTask({ title: 'Forced', priority: 'high' });

    await service.addTaskDependency(blocker.id, blocked.id);

    // Force claim should succeed despite dependency
    const result = await service.claimTask(blocked.id, 'agent-1', { force: true });
    expect(result.success).toBe(true);
    expect(result.sessionId).toBeDefined();
  });

  it('getNextTaskWithResponse skips blocked tasks', async () => {
    const blocker = await service.createTask({ title: 'Blocker', priority: 'high' });
    const blocked = await service.createTask({ title: 'Blocked High', priority: 'high' });
    await service.createTask({ title: 'Free Task', priority: 'low' });

    await service.addTaskDependency(blocker.id, blocked.id);

    // Agent claims blocker (highest priority ready task)
    await service.claimTask(blocker.id, 'agent-1');

    // Agent-2 asks for next task - blocked task should be skipped
    const result = await service.getNextTaskWithResponse({ agentId: 'agent-2' });

    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task!.title).toBe('Free Task');
  });

  it('completing blocker cascades unblock to dependent', async () => {
    const blocker = await service.createTask({ title: 'Cascade Blocker', priority: 'high' });
    const dependent = await service.createTask({ title: 'Cascade Dependent', priority: 'medium' });

    await service.addTaskDependency(blocker.id, dependent.id);

    // Verify blocked
    let task = await service.getTask(dependent.id);
    expect(task!.status).toBe('blocked');

    // Complete blocker via storage.onTaskCompleted (simulating completion trigger)
    await service.claimTask(blocker.id, 'agent-1');
    await storage.updateTask(blocker.id, { status: 'completed' });
    const unblocked = await storage.onTaskCompleted(blocker.id);

    expect(unblocked).toContain(dependent.id);

    // Verify dependent is now ready
    task = await service.getTask(dependent.id);
    expect(task!.status).toBe('ready');
  });

  it('multiple dependencies - task stays blocked until ALL are complete', async () => {
    const blocker1 = await service.createTask({ title: 'Dep A', priority: 'high' });
    const blocker2 = await service.createTask({ title: 'Dep B', priority: 'high' });
    const dependent = await service.createTask({ title: 'Needs Both', priority: 'medium' });

    await service.addTaskDependency(blocker1.id, dependent.id);
    await service.addTaskDependency(blocker2.id, dependent.id);

    // Complete only first blocker
    await storage.updateTask(blocker1.id, { status: 'completed' });
    await storage.onTaskCompleted(blocker1.id);

    // Still blocked (blocker2 not done)
    let task = await service.getTask(dependent.id);
    expect(task!.status).toBe('blocked');

    // Claim should still fail
    const result = await service.claimTask(dependent.id, 'agent-1');
    expect(result.success).toBe(false);
    expect(result.dependencyBlock).toBeDefined();

    // Complete second blocker
    await storage.updateTask(blocker2.id, { status: 'completed' });
    await storage.onTaskCompleted(blocker2.id);

    // Now unblocked
    task = await service.getTask(dependent.id);
    expect(task!.status).toBe('ready');

    // Claim now succeeds
    const finalClaim = await service.claimTask(dependent.id, 'agent-1');
    expect(finalClaim.success).toBe(true);
  });

  it('dependencyBlock result includes incomplete blocker details', async () => {
    const blocker = await service.createTask({ title: 'Detail Blocker', priority: 'high' });
    const blocked = await service.createTask({ title: 'Detail Blocked', priority: 'medium' });

    await service.addTaskDependency(blocker.id, blocked.id);

    const result = await service.claimTask(blocked.id, 'agent-1');
    expect(result.success).toBe(false);
    expect(result.dependencyBlock).toBeDefined();
    expect(result.dependencyBlock!.blockedBy[0].taskTitle).toBe('Detail Blocker');
    expect(result.dependencyBlock!.blockedBy[0].status).not.toBe('completed');
  });
});
