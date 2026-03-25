import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator, TaskEventPayload } from '../../src/events/event-orchestrator.js';
import { ViewMaterializer } from '../../src/views/view-materializer.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Coordination feed events', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let materializer: ViewMaterializer;
  let dbDir: string;
  let repoDir: string;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-feed-db-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-feed-repo-'));
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);
    materializer = new ViewMaterializer(events);
    await materializer.start();

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    const project = await service.createProject({
      name: 'Feed Test',
      slug: 'feed-test',
      rootPath: repoDir,
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    materializer.stop();
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('emits task.claim_rejected event on file conflict', async () => {
    const emittedEvents: TaskEventPayload[] = [];
    events.on('task.claim_rejected', (e: TaskEventPayload) => emittedEvents.push(e));

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
    await service.claimTask(task2.id, 'agent-2');

    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].eventType).toBe('task.claim_rejected');
    expect(emittedEvents[0].rejectionReason).toBe('file_conflict');
    expect(emittedEvents[0].agentId).toBe('agent-2');
    expect(emittedEvents[0].task.id).toBe(task2.id);
  });

  it('emits task.claim_rejected event on dependency block', async () => {
    const emittedEvents: TaskEventPayload[] = [];
    events.on('task.claim_rejected', (e: TaskEventPayload) => emittedEvents.push(e));

    const blocker = await service.createTask({ title: 'Blocker', priority: 'high' });
    const blocked = await service.createTask({ title: 'Blocked', priority: 'medium' });
    await service.addTaskDependency(blocker.id, blocked.id);

    await service.claimTask(blocked.id, 'agent-1');

    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].rejectionReason).toBe('dependency_block');
    expect(emittedEvents[0].rejectionDetails).toContain('Blocker');
  });

  it('emits task.claim_rejected event on session conflict', async () => {
    const emittedEvents: TaskEventPayload[] = [];
    events.on('task.claim_rejected', (e: TaskEventPayload) => emittedEvents.push(e));

    const task = await service.createTask({ title: 'Contested', priority: 'high' });
    await service.claimTask(task.id, 'agent-1');
    await service.claimTask(task.id, 'agent-2');

    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].rejectionReason).toBe('session_conflict');
    expect(emittedEvents[0].rejectionDetails).toContain('agent-1');
  });

  it('ViewMaterializer adds claim rejection to decision stream', async () => {
    const task1 = await service.createTask({
      title: 'Lock Owner',
      priority: 'high',
      files: ['src/core.ts'],
    });
    const task2 = await service.createTask({
      title: 'Blocked Agent',
      priority: 'medium',
      files: ['src/core.ts'],
    });

    await service.claimTask(task1.id, 'agent-1');
    await service.claimTask(task2.id, 'agent-2');

    const snapshot = materializer.getSnapshot();
    const coordItems = snapshot.decisions.filter(d => d.category === 'coordination');

    expect(coordItems.length).toBe(1);
    expect(coordItems[0].decision).toContain('Claim rejected');
    expect(coordItems[0].decision).toContain('Blocked Agent');
    expect(coordItems[0].rationale).toContain('src/core.ts');
    expect(coordItems[0].agentId).toBe('agent-2');
  });

  it('ViewMaterializer emits delta on claim rejection', async () => {
    const deltas: any[] = [];
    materializer.on('delta', (delta: any) => {
      if (delta.type === 'decision') deltas.push(delta);
    });

    const task1 = await service.createTask({
      title: 'Owner',
      priority: 'high',
      files: ['src/file.ts'],
    });
    const task2 = await service.createTask({
      title: 'Rejected',
      priority: 'medium',
      files: ['src/file.ts'],
    });

    await service.claimTask(task1.id, 'agent-1');
    await service.claimTask(task2.id, 'agent-2');

    expect(deltas.length).toBeGreaterThan(0);
    const rejectionDelta = deltas.find(d => d.data.category === 'coordination');
    expect(rejectionDelta).toBeDefined();
    expect(rejectionDelta.action).toBe('add');
  });

  it('no event emitted when force claim overrides blocking', async () => {
    const emittedEvents: TaskEventPayload[] = [];
    events.on('task.claim_rejected', (e: TaskEventPayload) => emittedEvents.push(e));

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
    await service.claimTask(task2.id, 'agent-2', { force: true });

    // No rejection event - force bypassed the check
    expect(emittedEvents.length).toBe(0);
  });
});
