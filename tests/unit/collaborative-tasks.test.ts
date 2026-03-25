import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Collaborative Tasks', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let tmpDir: string;
  let projectId: string;
  let taskId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-collab-test-'));
    storage = new SQLiteStorageService(tmpDir);
    await storage.initialize();
    const events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    // Create a project
    const project = await service.createProject({ name: 'Collab Test', rootPath: tmpDir });
    projectId = project.id;
    await storage.setActiveProjectId(projectId);

    // Create a collaborative task
    taskId = uuidv4();
    await storage.saveTask({
      id: taskId,
      projectId,
      title: 'Council review: Architecture decision',
      description: 'Multiple agents provide input',
      priority: 'high',
      status: 'ready',
      mode: 'collaborative',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and retrieves contributions', async () => {
    const contribution = {
      id: uuidv4(),
      taskId,
      projectId,
      agentId: 'claude-code',
      role: 'developer' as const,
      type: 'analysis' as const,
      content: 'The architecture should use event sourcing for auditability.',
      createdAt: new Date(),
    };

    await service.contributeToTask(contribution);
    const contributions = await service.getContributions(taskId);

    expect(contributions).toHaveLength(1);
    expect(contributions[0].agentId).toBe('claude-code');
    expect(contributions[0].type).toBe('analysis');
    expect(contributions[0].content).toContain('event sourcing');
  });

  it('rejects contributions to non-collaborative tasks', async () => {
    // Create an exclusive task
    const exclusiveTaskId = uuidv4();
    await storage.saveTask({
      id: exclusiveTaskId,
      projectId,
      title: 'Exclusive task',
      description: 'Single agent only',
      priority: 'medium',
      status: 'ready',
      mode: 'exclusive',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.contributeToTask({
        id: uuidv4(),
        taskId: exclusiveTaskId,
        projectId,
        agentId: 'claude-code',
        role: 'developer',
        type: 'opinion',
        content: 'test',
        createdAt: new Date(),
      })
    ).rejects.toThrow('not in collaborative mode');
  });

  it('filters contributions by agent and type', async () => {
    // Add contributions from different agents
    for (const [agentId, type] of [
      ['claude-code', 'analysis'],
      ['cursor', 'suggestion'],
      ['claude-code', 'opinion'],
    ] as const) {
      await service.contributeToTask({
        id: uuidv4(),
        taskId,
        projectId,
        agentId,
        role: 'developer',
        type,
        content: `${type} from ${agentId}`,
        createdAt: new Date(),
      });
    }

    const claudeOnly = await service.getContributions(taskId, { agentId: 'claude-code' });
    expect(claudeOnly).toHaveLength(2);

    const analysisOnly = await service.getContributions(taskId, { type: 'analysis' });
    expect(analysisOnly).toHaveLength(1);
  });

  it('aggregates contributors correctly', async () => {
    await service.contributeToTask({
      id: uuidv4(), taskId, projectId, agentId: 'claude-code',
      role: 'developer', type: 'analysis', content: 'First', createdAt: new Date(),
    });
    await service.contributeToTask({
      id: uuidv4(), taskId, projectId, agentId: 'cursor',
      role: 'developer', type: 'suggestion', content: 'Second', createdAt: new Date(),
    });
    await service.contributeToTask({
      id: uuidv4(), taskId, projectId, agentId: 'claude-code',
      role: 'tech-lead', type: 'decision', content: 'Third', createdAt: new Date(),
    });

    const contributors = await service.getTaskContributors(taskId);
    expect(contributors).toHaveLength(2);

    const claude = contributors.find(c => c.agentId === 'claude-code');
    expect(claude?.contributionCount).toBe(2);
    expect(claude?.types).toContain('analysis');
    expect(claude?.types).toContain('decision');
  });

  it('allows multiple agents to claim collaborative tasks', async () => {
    // First agent claims
    const result1 = await service.claimTaskWithResponse(taskId, 'claude-code', { capacity: 0 });
    expect(result1.success).toBe(true);

    // Second agent claims — should succeed in collaborative mode
    const result2 = await service.claimTaskWithResponse(taskId, 'cursor', { capacity: 0 });
    expect(result2.success).toBe(true);
  });

  it('rejects second claim on exclusive tasks', async () => {
    const exclusiveTaskId = uuidv4();
    await storage.saveTask({
      id: exclusiveTaskId,
      projectId,
      title: 'Exclusive task',
      description: 'Single agent only',
      priority: 'medium',
      status: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result1 = await service.claimTaskWithResponse(exclusiveTaskId, 'claude-code', { capacity: 0 });
    expect(result1.success).toBe(true);

    const result2 = await service.claimTaskWithResponse(exclusiveTaskId, 'cursor', { capacity: 0 });
    expect(result2.success).toBe(false);
  });

  it('persists mode through save and retrieve', async () => {
    const task = await storage.getTask(taskId);
    expect(task?.mode).toBe('collaborative');
  });

  it('defaults to exclusive mode for tasks without mode', async () => {
    const noModeTaskId = uuidv4();
    await storage.saveTask({
      id: noModeTaskId,
      projectId,
      title: 'Legacy task',
      description: 'No mode set',
      priority: 'medium',
      status: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const task = await storage.getTask(noModeTaskId);
    expect(task?.mode).toBe('exclusive');
  });
});
