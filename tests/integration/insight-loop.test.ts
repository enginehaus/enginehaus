import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InsightLoop } from '../../src/analysis/insight-loop.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('InsightLoop', () => {
  let loop: InsightLoop;
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-insight-'));
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);
    loop = new InsightLoop(storage, { events, coordination: service });
  });

  afterEach(() => {
    loop.deactivate();
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  describe('activate/deactivate', () => {
    it('subscribes to events on activate', () => {
      expect(events.getSubscriptionCount()).toBe(0);
      loop.activate();
      expect(events.getSubscriptionCount()).toBe(4);
    });

    it('unsubscribes on deactivate', () => {
      loop.activate();
      expect(events.getSubscriptionCount()).toBe(4);
      loop.deactivate();
      expect(events.getSubscriptionCount()).toBe(0);
    });

    it('throws if activated without events', () => {
      const briefingLoop = InsightLoop.forBriefing(storage);
      expect(() => briefingLoop.activate()).toThrow('EventOrchestrator');
    });
  });

  describe('event-driven analysis', () => {
    it('logs quality metric when task completed without decisions', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'Test Project',
        slug: 'test-proj',
        rootPath: '/tmp/test',
      });
      await service.setActiveProject(project.id);

      // Create and complete a task (no decisions logged)
      const task = await service.createTask({
        title: 'Quick fix',
        projectId: project.id,
      });

      // Emit task.completed event
      await events.emitTaskCompleted(task, 'internal');

      // emitTaskCompleted awaits all subscription handlers, so no delay needed

      // Check that a quality_gate_failed metric was logged for missing decisions
      const metrics = await storage.getMetrics({
        eventTypes: ['quality_gate_failed'],
      });
      const decisionGate = metrics.events.find(
        (m: any) => m.metadata?.gate === 'decision_logging'
      );
      expect(decisionGate).toBeDefined();
    });

    it('creates insight task on repeated quality gate failures', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'Quality Project',
        slug: 'quality-proj',
        rootPath: '/tmp/quality',
      });
      await service.setActiveProject(project.id);

      // Log enough gate failures to trigger threshold
      for (let i = 0; i < 6; i++) {
        await storage.logMetric({
          eventType: i < 2 ? 'quality_gate_passed' : 'quality_gate_failed',
          projectId: project.id,
          metadata: {},
        });
      }

      // Emit quality.gate_failed to trigger analysis
      await events.emitQualityGateResult(false, 'test-gate', {
        projectId: project.id,
      });

      // emitQualityGateResult awaits all subscription handlers, so no delay needed

      // Check for auto-created insight task
      const tasks = await storage.getTasks({ projectId: project.id });
      const insightTask = tasks.find(t =>
        t.description.includes('[auto-insight]') &&
        t.description.includes('low-quality-gate-rate')
      );
      expect(insightTask).toBeDefined();
      expect(insightTask!.title).toContain('quality gate pass rate');
    });

    it('creates task on abandonment pattern', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'Abandon Project',
        slug: 'abandon-proj',
        rootPath: '/tmp/abandon',
      });
      await service.setActiveProject(project.id);

      // Create a task to release
      const task = await service.createTask({
        title: 'Will be released',
        projectId: project.id,
      });

      // Emit 3+ release events to trigger pattern
      for (let i = 0; i < 3; i++) {
        await events.emitTaskReleased(task, `session-${i}`, `agent-${i}`, 'internal');
      }

      // emitTaskReleased awaits all subscription handlers, so no delay needed

      const tasks = await storage.getTasks({ projectId: project.id });
      const insightTask = tasks.find(t =>
        t.description.includes('[auto-insight]') &&
        t.description.includes('task-abandonment-pattern')
      );
      expect(insightTask).toBeDefined();
    });

    it('deduplicates insight tasks', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'Dedup Project',
        slug: 'dedup-proj',
        rootPath: '/tmp/dedup',
      });
      await service.setActiveProject(project.id);

      // Trigger abandonment pattern twice
      const task = await service.createTask({
        title: 'Released task',
        projectId: project.id,
      });

      for (let i = 0; i < 4; i++) {
        await events.emitTaskReleased(task, `session-${i}`, `agent-${i}`, 'internal');
      }
      // emitTaskReleased awaits all subscription handlers, so no delay needed

      // Trigger again — should not create duplicate
      await events.emitTaskReleased(task, 'session-5', 'agent-5', 'internal');

      const tasks = await storage.getTasks({ projectId: project.id });
      const insightTasks = tasks.filter(t =>
        t.description.includes('[auto-insight][task-abandonment-pattern]')
      );
      expect(insightTasks.length).toBe(1);
    });
  });

  describe('generateInsights', () => {
    it('returns empty insights for clean data', async () => {
      const insights = await loop.generateInsights();
      expect(insights.recommendations).toEqual([]);
      expect(insights.frictionTrend).toBeNull();
      expect(insights.staleInitiatives).toEqual([]);
      expect(insights.generatedAt).toBeInstanceOf(Date);
    });

    it('includes recommendations when issues exist', async () => {
      const project = await service.createProject({
        name: 'Issues Project',
        slug: 'issues-proj',
        rootPath: '/tmp/issues',
      });
      await service.setActiveProject(project.id);

      // Create workaround decisions to trigger recommendations
      for (let i = 0; i < 4; i++) {
        await service.logDecision({
          decision: `Temporary hack to bypass limitation ${i}`,
          rationale: 'Had to work around the problem',
          category: 'architecture',
        });
      }

      const insights = await loop.generateInsights();
      expect(insights.recommendations.length).toBeGreaterThan(0);
      expect(insights.recommendations[0].title).toContain('Workaround');
    });
  });

  describe('formatInsights', () => {
    it('returns empty string when no insights', async () => {
      const insights = await loop.generateInsights();
      const text = loop.formatInsights(insights);
      expect(text).toBe('');
    });

    it('formats recommendations when present', async () => {
      const project = await service.createProject({
        name: 'Format Project',
        slug: 'format-proj',
        rootPath: '/tmp/format',
      });
      await service.setActiveProject(project.id);

      for (let i = 0; i < 4; i++) {
        await service.logDecision({
          decision: `Workaround for issue ${i}`,
          rationale: 'Temporary bypass',
          category: 'architecture',
        });
      }

      const insights = await loop.generateInsights();
      const text = loop.formatInsights(insights);
      expect(text).toContain('LEARNING ENGINE INSIGHTS');
      expect(text).toContain('Top Recommendations');
    });
  });

  describe('post-completion reflection', () => {
    it('logs reflection metric when task completed with decisions', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'Reflection Project',
        slug: 'reflect-proj',
        rootPath: '/tmp/reflect',
      });
      await service.setActiveProject(project.id);

      const task = await service.createTask({
        title: 'Task with decisions',
        projectId: project.id,
      });

      // Log a decision for this task
      await service.logDecision({
        decision: 'Use approach A over B',
        rationale: 'Better performance',
        category: 'architecture',
        taskId: task.id,
      });

      // Emit task.completed
      await events.emitTaskCompleted(task, 'internal');
      // emitTaskCompleted awaits all subscription handlers, so no delay needed

      // Check that a reflection metric was logged
      const metrics = await storage.getMetrics({
        eventTypes: ['task_completed'],
      });
      const reflectionMetric = metrics.events.find(
        (m: any) => m.metadata?.reflection === true
      );
      expect(reflectionMetric).toBeDefined();
      expect(reflectionMetric!.metadata.decisionsLogged).toBe(1);
      expect(reflectionMetric!.metadata.decisionCategories).toContain('architecture');
    });

    it('does not log reflection when task has no decisions', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'No Decision Project',
        slug: 'no-decision-proj',
        rootPath: '/tmp/no-decision',
      });
      await service.setActiveProject(project.id);

      const task = await service.createTask({
        title: 'Task without decisions',
        projectId: project.id,
      });

      await events.emitTaskCompleted(task, 'internal');
      // emitTaskCompleted awaits all subscription handlers, so no delay needed

      // Should have a quality_gate_failed metric but NO reflection metric
      const metrics = await storage.getMetrics({
        eventTypes: ['task_completed'],
      });
      const reflectionMetric = metrics.events.find(
        (m: any) => m.metadata?.reflection === true
      );
      expect(reflectionMetric).toBeUndefined();
    });
  });

  describe('friction threshold alerting', () => {
    it('creates task when friction tag appears 3+ times in 7 days', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'Friction Project',
        slug: 'friction-proj',
        rootPath: '/tmp/friction',
      });
      await service.setActiveProject(project.id);

      // Submit friction feedback with the same tag 3 times
      for (let i = 0; i < 3; i++) {
        await storage.saveSessionFeedback({
          sessionId: `session-${i}`,
          projectId: project.id,
          productivityRating: 2,
          frictionTags: ['slow-builds'],
          notes: `Build was slow session ${i}`,
        });
      }

      // Create and complete a task to trigger friction check
      const task = await service.createTask({
        title: 'Trigger task',
        projectId: project.id,
      });

      await events.emitTaskCompleted(task, 'internal');
      // emitTaskCompleted awaits all subscription handlers, so no delay needed

      const tasks = await storage.getTasks({ projectId: project.id });
      const frictionTask = tasks.find(t =>
        t.description.includes('[auto-insight]') &&
        t.description.includes('friction-threshold-slow-builds')
      );
      expect(frictionTask).toBeDefined();
      expect(frictionTask!.title).toContain('slow-builds');
    });

    it('does not create task when friction count below threshold', async () => {
      loop.activate();

      const project = await service.createProject({
        name: 'Low Friction Project',
        slug: 'low-friction-proj',
        rootPath: '/tmp/low-friction',
      });
      await service.setActiveProject(project.id);

      // Submit only 2 friction reports (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        await storage.saveSessionFeedback({
          sessionId: `session-${i}`,
          projectId: project.id,
          productivityRating: 3,
          frictionTags: ['unclear-docs'],
          notes: `Docs unclear session ${i}`,
        });
      }

      const task = await service.createTask({
        title: 'Trigger task',
        projectId: project.id,
      });

      await events.emitTaskCompleted(task, 'internal');
      // emitTaskCompleted awaits all subscription handlers, so no delay needed

      const tasks = await storage.getTasks({ projectId: project.id });
      const frictionTask = tasks.find(t =>
        t.description.includes('friction-threshold-unclear-docs')
      );
      expect(frictionTask).toBeUndefined();
    });
  });

  describe('forBriefing static factory', () => {
    it('creates loop without events/coordination', async () => {
      const briefingLoop = InsightLoop.forBriefing(storage);
      // Should be able to generate insights without events
      await expect(briefingLoop.generateInsights()).resolves.toBeDefined();
    });
  });
});
