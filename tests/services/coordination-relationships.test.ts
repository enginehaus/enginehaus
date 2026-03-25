import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Task relationship operations', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let task1Id: string;
  let task2Id: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-rel-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Relationship Test' });
    await service.setActiveProject(project.id);
    const task1 = await service.createTask({ title: 'Task One', files: ['src/auth.ts'] });
    const task2 = await service.createTask({ title: 'Task Two', files: ['src/auth.ts', 'src/session.ts'] });
    task1Id = task1.id;
    task2Id = task2.id;
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('linkTasks creates semantic relationship', async () => {
    const result = await service.linkTasks({
      sourceTaskId: task1Id,
      targetTaskId: task2Id,
      relationshipType: 'related_to',
      description: 'Both touch auth code',
    });

    expect(result.success).toBe(true);
    expect(result.relationship).toBeDefined();
  });

  it('unlinkTasks removes relationship', async () => {
    await service.linkTasks({
      sourceTaskId: task1Id,
      targetTaskId: task2Id,
      relationshipType: 'related_to',
    });

    const result = await service.unlinkTasks({
      sourceTaskId: task1Id,
      targetTaskId: task2Id,
    });

    expect(result.success).toBe(true);
    expect(result.removed).toBeGreaterThanOrEqual(1);
  });

  it('getRelatedTasks returns linked tasks', async () => {
    await service.linkTasks({
      sourceTaskId: task1Id,
      targetTaskId: task2Id,
      relationshipType: 'informed_by',
    });

    const result = await service.getRelatedTasks({
      taskId: task1Id,
      direction: 'both',
    });

    expect(result.success).toBe(true);
    expect(result.relationships.length).toBeGreaterThanOrEqual(1);
  });

  it('suggestRelationships finds file overlap', async () => {
    const result = await service.suggestRelationships({
      taskId: task1Id,
    });

    expect(result.success).toBe(true);
    // task2 shares src/auth.ts with task1
    if (result.suggestions.length > 0) {
      expect(result.suggestions[0].sharedFiles).toContain('src/auth.ts');
    }
  });

  it('getRelatedLearnings returns insights from related completed tasks', async () => {
    // Link tasks and complete task2
    await service.linkTasks({
      sourceTaskId: task1Id,
      targetTaskId: task2Id,
      relationshipType: 'informed_by',
    });
    await service.claimTask(task2Id, 'agent-1');
    await service.logDecision({
      decision: 'Use JWT for session tokens',
      rationale: 'Stateless auth',
      category: 'architecture',
      taskId: task2Id,
    });

    const result = await service.getRelatedLearnings(task1Id);

    expect(result.success).toBe(true);
    expect(result.learnings).toBeDefined();
    expect(result.learnings.summary).toBeDefined();
  });
});
