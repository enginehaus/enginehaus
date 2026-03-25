import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Multi-project isolation', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let project1Id: string;
  let project2Id: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-multi-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const p1 = await service.createProject({ name: 'Project Alpha', slug: 'alpha' });
    const p2 = await service.createProject({ name: 'Project Beta', slug: 'beta' });
    project1Id = p1.id;
    project2Id = p2.id;
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('tasks in project1 not visible in project2 queries', async () => {
    await service.setActiveProject(project1Id);
    await service.createTask({ title: 'Alpha task' });

    await service.setActiveProject(project2Id);
    await service.createTask({ title: 'Beta task' });

    // Query tasks for project2
    const betaTasks = await service.getTasks({ projectId: project2Id });
    expect(betaTasks.every(t => t.projectId === project2Id)).toBe(true);
    expect(betaTasks.some(t => t.title === 'Alpha task')).toBe(false);
  });

  it('decisions in project1 not surfaced for project2', async () => {
    await service.setActiveProject(project1Id);
    await service.logDecision({
      decision: 'Alpha architecture choice',
      category: 'architecture',
      projectId: project1Id,
    });

    await service.setActiveProject(project2Id);
    await service.logDecision({
      decision: 'Beta architecture choice',
      category: 'architecture',
      projectId: project2Id,
    });

    const betaDecisions = await service.getDecisions({ projectId: project2Id });
    expect(betaDecisions.decisions.every(d =>
      d.decision !== 'Alpha architecture choice'
    )).toBe(true);
  });

  it('setActiveProject changes query scope', async () => {
    await service.setActiveProject(project1Id);
    await service.createTask({ title: 'P1 Task' });

    await service.setActiveProject(project2Id);
    await service.createTask({ title: 'P2 Task' });

    // Switch back to project1 and verify scope
    await service.setActiveProject(project1Id);
    const active = await service.getActiveProject();
    expect(active?.id).toBe(project1Id);
  });

  it('initiatives are project-scoped', async () => {
    await service.setActiveProject(project1Id);
    await service.createInitiative({ title: 'Alpha initiative' });

    await service.setActiveProject(project2Id);
    await service.createInitiative({ title: 'Beta initiative' });

    const betaInitiatives = await service.listInitiatives({ projectId: project2Id });
    expect(betaInitiatives.initiatives.every(i => i.title !== 'Alpha initiative')).toBe(true);
  });

  it('artifacts are project-scoped via tasks', async () => {
    await service.setActiveProject(project1Id);
    const alphaTask = await service.createTask({ title: 'Alpha art task' });
    await service.storeArtifact({
      taskId: alphaTask.id,
      type: 'doc',
      content: 'Alpha content',
      contentType: 'text/plain',
    });

    await service.setActiveProject(project2Id);
    const betaTask = await service.createTask({ title: 'Beta art task' });

    // Beta task should have no artifacts
    const betaArtifacts = await service.listArtifacts({ taskId: betaTask.id });
    expect(betaArtifacts.count).toBe(0);

    // Alpha task's artifacts still accessible
    const alphaArtifacts = await service.listArtifacts({ taskId: alphaTask.id });
    expect(alphaArtifacts.count).toBe(1);
  });
});
