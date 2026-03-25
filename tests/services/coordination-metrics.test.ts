import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Metrics operations', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-met-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Metrics Test' });
    await service.setActiveProject(project.id);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('logMetric records custom event', async () => {
    const result = await service.logMetric({
      eventType: 'tool_called',
      metadata: { tool: 'get_next_task', responseSize: 1200 },
    });

    expect(result.success).toBe(true);
  });

  it('logMetric records context fetch events', async () => {
    const result = await service.logMetric({
      eventType: 'context_fetch_minimal',
      taskId: 'task-123',
      metadata: { responseBytes: 500 },
    });

    expect(result.success).toBe(true);
  });

  it('getCoordinationMetrics returns aggregates', async () => {
    // Log some activity first
    await service.logMetric({ eventType: 'context_fetch_minimal' });
    await service.logMetric({ eventType: 'context_fetch_full' });

    const result = await service.getCoordinationMetrics({ period: 'day' });

    expect(result.success).toBe(true);
    expect(result.metrics).toBeDefined();
    expect(result.metrics.tokenEfficiency).toBeDefined();
    expect(typeof result.metrics.tasksCompleted).toBe('number');
  });

  it('getOutcomeMetrics returns value metrics', async () => {
    const result = await service.getOutcomeMetrics({ period: 'week' });

    expect(result.success).toBe(true);
    expect(result.metrics).toBeDefined();
    expect(result.metrics!.tokenEfficiency).toBeDefined();
    expect(result.metrics!.humanTime).toBeDefined();
    expect(result.metrics!.qualityOutcomes).toBeDefined();
    expect(result.metrics!.rawCounts).toBeDefined();
  });

  it('getValueDashboard returns insights', async () => {
    const result = await service.getValueDashboard({ period: 'week' });

    expect(result.success).toBe(true);
    expect(result.dashboard).toBeDefined();
    expect(result.dashboard!.summary).toBeDefined();
    expect(Array.isArray(result.dashboard!.insights)).toBe(true);
    expect(Array.isArray(result.dashboard!.limitations)).toBe(true);
  });

  it('getCoordinationMetrics with different periods', async () => {
    const dayResult = await service.getCoordinationMetrics({ period: 'day' });
    const weekResult = await service.getCoordinationMetrics({ period: 'week' });
    const monthResult = await service.getCoordinationMetrics({ period: 'month' });

    expect(dayResult.success).toBe(true);
    expect(weekResult.success).toBe(true);
    expect(monthResult.success).toBe(true);
    expect(dayResult.period).toBe('day');
    expect(weekResult.period).toBe('week');
    expect(monthResult.period).toBe('month');
  });

  it('metrics reflect actual task activity', async () => {
    // Create and complete a task
    const task = await service.createTask({ title: 'Metric task' });
    await service.claimTask(task.id, 'test-agent');
    await service.logDecision({
      decision: 'Test metric decision',
      category: 'architecture',
      taskId: task.id,
    });

    const result = await service.getOutcomeMetrics({ period: 'day' });

    expect(result.success).toBe(true);
    expect(result.metrics!.rawCounts.tasksClaimed).toBeGreaterThanOrEqual(1);
    expect(result.metrics!.rawCounts.decisions).toBeGreaterThanOrEqual(1);
  });
});
