import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { getDecisionPrompt } from '../../src/utils/decision-prompting.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Decision Prompting', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let tmpDir: string;
  let projectId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-decision-prompt-'));
    storage = new SQLiteStorageService(tmpDir);
    await storage.initialize();
    const events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Decision Test', rootPath: tmpDir });
    projectId = project.id;
    await storage.setActiveProjectId(projectId);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prompts when task has decision keywords and no decisions logged', async () => {
    const task = await service.createTask({
      title: 'Refactor the architecture',
      description: 'Design new approach for data layer',
      priority: 'high',
      projectId,
    });

    const prompt = await getDecisionPrompt(service, {
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
    });

    expect(prompt).toBeDefined();
    expect(prompt).toContain('Decision moment');
  });

  it('does not prompt when recent decision exists', async () => {
    const task = await service.createTask({
      title: 'Architecture redesign',
      description: 'Major tradeoff decisions needed',
      priority: 'high',
      projectId,
    });

    // Log a decision
    await service.logDecision({
      decision: 'Use event sourcing',
      rationale: 'Better auditability',
      category: 'architecture',
      taskId: task.id,
      projectId,
    });

    const prompt = await getDecisionPrompt(service, {
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
    });

    // Should NOT prompt — recent decision exists and keywords are satisfied
    expect(prompt).toBeUndefined();
  });

  it('prompts when in implementation phase with no decisions', async () => {
    const task = await service.createTask({
      title: 'Build feature',
      description: 'Simple feature',
      priority: 'medium',
      projectId,
    });

    const prompt = await getDecisionPrompt(service, {
      taskId: task.id,
      taskTitle: task.title,
      currentPhase: 3, // Core Implementation phase
    });

    expect(prompt).toBeDefined();
    expect(prompt).toContain('Decision moment');
  });

  it('does not prompt for non-decision tasks early in session', async () => {
    const task = await service.createTask({
      title: 'Fix typo in readme',
      description: 'Simple text change',
      priority: 'low',
      projectId,
    });

    const prompt = await getDecisionPrompt(service, {
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      sessionStartTime: new Date(), // Just started
    });

    expect(prompt).toBeUndefined();
  });

  it('prompts after 15 minutes with no decisions', async () => {
    const task = await service.createTask({
      title: 'Fix typo',
      description: 'Simple change',
      priority: 'low',
      projectId,
    });

    const prompt = await getDecisionPrompt(service, {
      taskId: task.id,
      taskTitle: task.title,
      sessionStartTime: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
    });

    expect(prompt).toBeDefined();
  });
});
