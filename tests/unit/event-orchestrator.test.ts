import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EventOrchestrator,
  TaskEventPayload,
  SessionEventPayload,
  DecisionEventPayload,
  EnginehausEventPayload,
} from '../../src/events/event-orchestrator.js';
import { UnifiedTask, CoordinationSession } from '../../src/coordination/types.js';

describe('EventOrchestrator', () => {
  let orchestrator: EventOrchestrator;

  beforeEach(() => {
    orchestrator = new EventOrchestrator();
  });

  const createMockTask = (overrides: Partial<UnifiedTask> = {}): UnifiedTask => ({
    id: 'task-1',
    projectId: 'project-1',
    title: 'Test Task',
    description: 'Test description',
    priority: 'medium',
    status: 'ready',
    files: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockSession = (overrides: Partial<CoordinationSession> = {}): CoordinationSession => ({
    id: 'session-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    projectId: 'project-1',
    status: 'active',
    startedAt: new Date(),
    lastHeartbeat: new Date(),
    ...overrides,
  });

  describe('Event Emission', () => {
    it('should emit events with generated ID and timestamp', async () => {
      const task = createMockTask();
      const eventId = await orchestrator.emitTaskCreated(task);

      expect(eventId).toBeDefined();
      expect(eventId).toMatch(/^evt_\d+_\d+$/);
    });

    it('should emit task.created event', async () => {
      const task = createMockTask();
      const events: TaskEventPayload[] = [];

      orchestrator.on('task.created', (event: TaskEventPayload) => {
        events.push(event);
      });

      await orchestrator.emitTaskCreated(task, 'mcp');

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('task.created');
      expect(events[0].task.id).toBe('task-1');
      expect(events[0].source).toBe('mcp');
    });

    it('should emit task.updated event with previous state', async () => {
      const task = createMockTask({ title: 'New Title' });
      const previousState = { title: 'Old Title' };
      const events: TaskEventPayload[] = [];

      orchestrator.on('task.updated', (event: TaskEventPayload) => {
        events.push(event);
      });

      await orchestrator.emitTaskUpdated(task, previousState, 'rest');

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('task.updated');
      expect(events[0].previousState?.title).toBe('Old Title');
    });

    it('should emit task.completed event', async () => {
      const task = createMockTask({ status: 'completed' });
      const events: TaskEventPayload[] = [];

      orchestrator.on('task.completed', (event: TaskEventPayload) => {
        events.push(event);
      });

      await orchestrator.emitTaskCompleted(task);

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('task.completed');
    });

    it('should emit task.claimed event', async () => {
      const task = createMockTask({ status: 'in_progress' });
      const events: TaskEventPayload[] = [];

      orchestrator.on('task.claimed', (event: TaskEventPayload) => {
        events.push(event);
      });

      await orchestrator.emitTaskClaimed(task, 'session-1', 'agent-1', 'cli');

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('task.claimed');
      expect(events[0].sessionId).toBe('session-1');
      expect(events[0].agentId).toBe('agent-1');
    });

    it('should emit session.started event', async () => {
      const session = createMockSession();
      const events: SessionEventPayload[] = [];

      orchestrator.on('session.started', (event: SessionEventPayload) => {
        events.push(event);
      });

      await orchestrator.emitSessionStarted(session);

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('session.started');
      expect(events[0].session.id).toBe('session-1');
      expect(events[0].agentId).toBe('agent-1');
    });

    it('should emit decision.logged event', async () => {
      const events: DecisionEventPayload[] = [];

      orchestrator.on('decision.logged', (event: DecisionEventPayload) => {
        events.push(event);
      });

      await orchestrator.emitDecisionLogged(
        'decision-1',
        'Use SQLite',
        'Simple and embedded',
        { category: 'architecture', projectId: 'project-1' }
      );

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('decision.logged');
      expect(events[0].decision).toBe('Use SQLite');
      expect(events[0].rationale).toBe('Simple and embedded');
      expect(events[0].category).toBe('architecture');
    });

    it('should emit quality gate events', async () => {
      const passedEvents: EnginehausEventPayload[] = [];
      const failedEvents: EnginehausEventPayload[] = [];

      orchestrator.on('quality.gate_passed', (event) => passedEvents.push(event));
      orchestrator.on('quality.gate_failed', (event) => failedEvents.push(event));

      await orchestrator.emitQualityGateResult(true, 'tests', { taskId: 'task-1' });
      await orchestrator.emitQualityGateResult(false, 'linting', { details: 'ESLint errors' });

      expect(passedEvents.length).toBe(1);
      expect(failedEvents.length).toBe(1);
    });

    it('should emit phase.advanced event', async () => {
      const events: EnginehausEventPayload[] = [];

      orchestrator.on('phase.advanced', (event) => events.push(event));

      await orchestrator.emitPhaseAdvanced('task-1', 'testing', 5, 'integration', 'project-1');

      expect(events.length).toBe(1);
      expect((events[0] as any).phase).toBe('testing');
      expect((events[0] as any).phaseNumber).toBe(5);
      expect((events[0] as any).previousPhase).toBe('integration');
    });

    it('should emit handoff.initiated event', async () => {
      const events: EnginehausEventPayload[] = [];

      orchestrator.on('handoff.initiated', (event) => events.push(event));

      await orchestrator.emitHandoffInitiated('task-1', 'agent-1', 'agent-2', 'project-1');

      expect(events.length).toBe(1);
      expect((events[0] as any).fromAgent).toBe('agent-1');
      expect((events[0] as any).toAgent).toBe('agent-2');
    });
  });

  describe('Wildcard Listeners', () => {
    it('should notify wildcard listeners for all events', async () => {
      const allEvents: EnginehausEventPayload[] = [];

      orchestrator.on('*', (event) => allEvents.push(event));

      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);
      await orchestrator.emitTaskCompleted(task);

      expect(allEvents.length).toBe(2);
    });

    it('should notify category listeners', async () => {
      const taskEvents: EnginehausEventPayload[] = [];

      orchestrator.on('category:task', (event) => taskEvents.push(event));

      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);
      await orchestrator.emitTaskUpdated(task, {});
      await orchestrator.emitTaskCompleted(task);

      // Also emit a non-task event
      await orchestrator.emitDecisionLogged('d-1', 'Decision', 'Rationale');

      expect(taskEvents.length).toBe(3);
    });
  });

  describe('Subscriptions', () => {
    it('should subscribe to specific event types', async () => {
      const events: EnginehausEventPayload[] = [];

      const subId = orchestrator.subscribe(
        ['task.created', 'task.completed'],
        (event) => { events.push(event); }
      );

      expect(subId).toBeDefined();
      expect(subId).toMatch(/^sub_\d+_/);

      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);
      await orchestrator.emitTaskUpdated(task, {}); // Should not match
      await orchestrator.emitTaskCompleted(task);

      expect(events.length).toBe(2);
    });

    it('should subscribe with wildcard', async () => {
      const events: EnginehausEventPayload[] = [];

      orchestrator.subscribe('*', (event) => { events.push(event); });

      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);
      await orchestrator.emitDecisionLogged('d-1', 'Decision', 'Rationale');

      expect(events.length).toBe(2);
    });

    it('should filter by projectId', async () => {
      const events: EnginehausEventPayload[] = [];

      orchestrator.subscribe(
        ['task.created'],
        (event) => { events.push(event); },
        { projectId: 'project-1' }
      );

      await orchestrator.emitTaskCreated(createMockTask({ projectId: 'project-1' }));
      await orchestrator.emitTaskCreated(createMockTask({ id: 'task-2', projectId: 'project-2' }));

      expect(events.length).toBe(1);
      expect((events[0] as TaskEventPayload).task.projectId).toBe('project-1');
    });

    it('should unsubscribe correctly', async () => {
      const events: EnginehausEventPayload[] = [];

      const subId = orchestrator.subscribe(
        ['task.created'],
        (event) => { events.push(event); }
      );

      await orchestrator.emitTaskCreated(createMockTask());
      expect(events.length).toBe(1);

      const result = orchestrator.unsubscribe(subId);
      expect(result).toBe(true);

      await orchestrator.emitTaskCreated(createMockTask({ id: 'task-2' }));
      expect(events.length).toBe(1); // Still 1, no new events
    });

    it('should return false when unsubscribing non-existent subscription', () => {
      const result = orchestrator.unsubscribe('non-existent');
      expect(result).toBe(false);
    });

    it('should filter by categories', async () => {
      const events: EnginehausEventPayload[] = [];

      orchestrator.subscribe(
        '*',
        (event) => { events.push(event); },
        { categories: ['task', 'session'] }
      );

      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);
      await orchestrator.emitSessionStarted(createMockSession());
      await orchestrator.emitDecisionLogged('d-1', 'Decision', 'Rationale'); // Should not match

      expect(events.length).toBe(2);
    });
  });

  describe('Event History', () => {
    it('should store events in history', async () => {
      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);
      await orchestrator.emitTaskCompleted(task);

      const history = orchestrator.getRecentEvents();

      expect(history.length).toBe(2);
    });

    it('should return events in reverse order (most recent first)', async () => {
      await orchestrator.emitTaskCreated(createMockTask({ id: 'task-1' }));
      await orchestrator.emitTaskCreated(createMockTask({ id: 'task-2' }));

      const history = orchestrator.getRecentEvents();

      expect((history[0] as TaskEventPayload).task.id).toBe('task-2');
      expect((history[1] as TaskEventPayload).task.id).toBe('task-1');
    });

    it('should limit history results', async () => {
      for (let i = 0; i < 10; i++) {
        await orchestrator.emitTaskCreated(createMockTask({ id: `task-${i}` }));
      }

      const history = orchestrator.getRecentEvents({ limit: 5 });

      expect(history.length).toBe(5);
    });

    it('should filter history by event types', async () => {
      await orchestrator.emitTaskCreated(createMockTask());
      await orchestrator.emitTaskCompleted(createMockTask());
      await orchestrator.emitDecisionLogged('d-1', 'Decision', 'Rationale');

      const history = orchestrator.getRecentEvents({ eventTypes: ['task.created'] });

      expect(history.length).toBe(1);
      expect(history[0].eventType).toBe('task.created');
    });

    it('should filter history by date', async () => {
      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);

      const futureDate = new Date(Date.now() + 10000);
      const history = orchestrator.getRecentEvents({ since: futureDate });

      expect(history.length).toBe(0);
    });

    it('should filter history by projectId', async () => {
      await orchestrator.emitTaskCreated(createMockTask({ projectId: 'project-1' }));
      await orchestrator.emitTaskCreated(createMockTask({ id: 'task-2', projectId: 'project-2' }));

      const history = orchestrator.getRecentEvents({ projectId: 'project-1' });

      expect(history.length).toBe(1);
    });

    it('should clear history', async () => {
      await orchestrator.emitTaskCreated(createMockTask());
      await orchestrator.emitTaskCreated(createMockTask({ id: 'task-2' }));

      orchestrator.clearHistory();

      const history = orchestrator.getRecentEvents();
      expect(history.length).toBe(0);
    });

    it('should limit history size to max', async () => {
      // Emit more than max history size (1000)
      for (let i = 0; i < 1010; i++) {
        await orchestrator.emitTaskCreated(createMockTask({ id: `task-${i}` }));
      }

      const history = orchestrator.getRecentEvents();
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Event Statistics', () => {
    it('should count events by type', async () => {
      const task = createMockTask();
      await orchestrator.emitTaskCreated(task);
      await orchestrator.emitTaskCreated(createMockTask({ id: 'task-2' }));
      await orchestrator.emitTaskCompleted(task);

      const stats = orchestrator.getEventStats();

      expect(stats['task.created']).toBe(2);
      expect(stats['task.completed']).toBe(1);
    });

    it('should filter stats by date', async () => {
      await orchestrator.emitTaskCreated(createMockTask());

      const futureDate = new Date(Date.now() + 10000);
      const stats = orchestrator.getEventStats(futureDate);

      expect(Object.keys(stats).length).toBe(0);
    });
  });

  describe('Subscription Count', () => {
    it('should track subscription count', () => {
      expect(orchestrator.getSubscriptionCount()).toBe(0);

      const sub1 = orchestrator.subscribe(['task.created'], () => {});
      const sub2 = orchestrator.subscribe(['task.completed'], () => {});

      expect(orchestrator.getSubscriptionCount()).toBe(2);

      orchestrator.unsubscribe(sub1);
      expect(orchestrator.getSubscriptionCount()).toBe(1);
    });
  });

  describe('Async Listeners', () => {
    it('should wait for async listeners', async () => {
      vi.useFakeTimers();
      let completed = false;

      orchestrator.subscribe(['task.created'], async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        completed = true;
      });

      const emitPromise = orchestrator.emitTaskCreated(createMockTask());
      // Advance fake timers to resolve the setTimeout inside the listener
      await vi.advanceTimersByTimeAsync(10);
      await emitPromise;

      expect(completed).toBe(true);
      vi.useRealTimers();
    });

    it('should handle listener errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      orchestrator.subscribe(['task.created'], () => {
        throw new Error('Listener error');
      });

      // Should not throw
      await orchestrator.emitTaskCreated(createMockTask());

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
