/**
 * Event Orchestrator
 *
 * Transforms Enginehaus from passive storage to active event orchestration.
 * Emits events on task changes, session updates, quality gates, etc.
 * Supports local listeners and webhook delivery.
 */

import { EventEmitter } from 'events';
import { UnifiedTask, CoordinationSession, Project } from '../coordination/types.js';

// ============================================================================
// Event Types
// ============================================================================

export type EventCategory =
  | 'task'
  | 'session'
  | 'project'
  | 'decision'
  | 'quality'
  | 'phase'
  | 'handoff';

export type TaskEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'task.blocked'
  | 'task.unblocked'
  | 'task.deleted'
  | 'task.claimed'
  | 'task.released'
  | 'task.claim_rejected';

export type SessionEventType =
  | 'session.started'
  | 'session.heartbeat'
  | 'session.expired'
  | 'session.completed';

export type ProjectEventType =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'project.activated';

export type DecisionEventType =
  | 'decision.logged'
  | 'decision.strategic'
  | 'decision.technical';

export type QualityEventType =
  | 'quality.gate_passed'
  | 'quality.gate_failed'
  | 'quality.metrics_updated';

export type PhaseEventType =
  | 'phase.started'
  | 'phase.advanced'
  | 'phase.skipped'
  | 'phase.completed';

export type HandoffEventType =
  | 'handoff.initiated'
  | 'handoff.context_generated'
  | 'handoff.completed';

export type EnginehausEventType =
  | TaskEventType
  | SessionEventType
  | ProjectEventType
  | DecisionEventType
  | QualityEventType
  | PhaseEventType
  | HandoffEventType;

// ============================================================================
// Event Payloads
// ============================================================================

export interface BaseEventPayload {
  eventId: string;
  eventType: EnginehausEventType;
  timestamp: Date;
  projectId?: string;
  source: 'mcp' | 'rest' | 'cli' | 'internal';
}

export interface TaskEventPayload extends BaseEventPayload {
  eventType: TaskEventType;
  task: UnifiedTask;
  previousState?: Partial<UnifiedTask>;
  agentId?: string;
  sessionId?: string;
  rejectionReason?: string;
  rejectionDetails?: string;
}

export interface SessionEventPayload extends BaseEventPayload {
  eventType: SessionEventType;
  session: CoordinationSession;
  taskId: string;
  agentId: string;
}

export interface ProjectEventPayload extends BaseEventPayload {
  eventType: ProjectEventType;
  project: Project;
  previousState?: Partial<Project>;
}

export interface DecisionEventPayload extends BaseEventPayload {
  eventType: DecisionEventType;
  decisionId: string;
  decision: string;
  rationale: string;
  taskId?: string;
  category?: string;
}

export interface QualityEventPayload extends BaseEventPayload {
  eventType: QualityEventType;
  taskId?: string;
  gate?: string;
  passed?: boolean;
  metrics?: Record<string, number>;
  details?: string;
}

export interface PhaseEventPayload extends BaseEventPayload {
  eventType: PhaseEventType;
  taskId: string;
  phase: string;
  phaseNumber: number;
  previousPhase?: string;
  skipped?: boolean;
}

export interface HandoffEventPayload extends BaseEventPayload {
  eventType: HandoffEventType;
  taskId: string;
  fromAgent?: string;
  toAgent?: string;
  contextSize?: number;
}

export type EnginehausEventPayload =
  | TaskEventPayload
  | SessionEventPayload
  | ProjectEventPayload
  | DecisionEventPayload
  | QualityEventPayload
  | PhaseEventPayload
  | HandoffEventPayload;

// ============================================================================
// Event Listener Types
// ============================================================================

export type EventListener<T extends EnginehausEventPayload = EnginehausEventPayload> = (
  event: T
) => void | Promise<void>;

export interface EventSubscription {
  id: string;
  eventTypes: EnginehausEventType[];
  listener: EventListener;
  filter?: EventFilter;
}

export interface EventFilter {
  projectId?: string;
  taskId?: string;
  agentId?: string;
  categories?: EventCategory[];
}

// ============================================================================
// Event Orchestrator
// ============================================================================

export class EventOrchestrator extends EventEmitter {
  private subscriptions: Map<string, EventSubscription> = new Map();
  private eventHistory: EnginehausEventPayload[] = [];
  private maxHistorySize = 1000;
  private eventCounter = 0;

  constructor() {
    super();
    // Increase default max listeners for high-volume scenarios
    this.setMaxListeners(100);
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    this.eventCounter++;
    return `evt_${Date.now()}_${this.eventCounter}`;
  }

  /**
   * Emit an event to all subscribers
   */
  async emitEvent<T extends EnginehausEventPayload>(
    payload: Omit<T, 'eventId' | 'timestamp'>
  ): Promise<string> {
    const eventId = this.generateEventId();
    const fullPayload: EnginehausEventPayload = {
      ...payload,
      eventId,
      timestamp: new Date(),
    } as EnginehausEventPayload;

    // Store in history
    this.eventHistory.push(fullPayload);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Emit to Node.js EventEmitter listeners
    this.emit(fullPayload.eventType, fullPayload);
    this.emit('*', fullPayload); // Wildcard for all events

    // Emit to category
    const category = this.getEventCategory(fullPayload.eventType);
    this.emit(`category:${category}`, fullPayload);

    // Notify subscription-based listeners
    await this.notifySubscribers(fullPayload);

    return eventId;
  }

  /**
   * Get the category of an event type
   */
  private getEventCategory(eventType: EnginehausEventType): EventCategory {
    const prefix = eventType.split('.')[0];
    return prefix as EventCategory;
  }

  /**
   * Notify all matching subscribers
   */
  private async notifySubscribers(event: EnginehausEventPayload): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (this.matchesSubscription(event, subscription)) {
        try {
          const result = subscription.listener(event);
          if (result instanceof Promise) {
            promises.push(result);
          }
        } catch (error) {
          console.error(`Error in event listener ${subscription.id}:`, error);
        }
      }
    }

    // Wait for all async listeners
    await Promise.allSettled(promises);
  }

  /**
   * Check if an event matches a subscription's filters
   */
  private matchesSubscription(
    event: EnginehausEventPayload,
    subscription: EventSubscription
  ): boolean {
    // Check event type
    if (!subscription.eventTypes.includes(event.eventType) &&
        !subscription.eventTypes.includes('*' as any)) {
      return false;
    }

    // Check filters
    if (subscription.filter) {
      const filter = subscription.filter;

      if (filter.projectId && event.projectId !== filter.projectId) {
        return false;
      }

      if (filter.taskId && 'taskId' in event && event.taskId !== filter.taskId) {
        return false;
      }

      if (filter.agentId && 'agentId' in event && event.agentId !== filter.agentId) {
        return false;
      }

      if (filter.categories) {
        const category = this.getEventCategory(event.eventType);
        if (!filter.categories.includes(category)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Subscribe to events with optional filtering
   */
  subscribe(
    eventTypes: EnginehausEventType[] | '*',
    listener: EventListener,
    filter?: EventFilter
  ): string {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.subscriptions.set(id, {
      id,
      eventTypes: eventTypes === '*' ? ['*' as any] : eventTypes,
      listener,
      filter,
    });

    return id;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Get recent events from history
   */
  getRecentEvents(options: {
    limit?: number;
    eventTypes?: EnginehausEventType[];
    since?: Date;
    projectId?: string;
  } = {}): EnginehausEventPayload[] {
    let events = [...this.eventHistory];

    if (options.eventTypes && options.eventTypes.length > 0) {
      events = events.filter(e => options.eventTypes!.includes(e.eventType));
    }

    if (options.since) {
      events = events.filter(e => e.timestamp >= options.since!);
    }

    if (options.projectId) {
      events = events.filter(e => e.projectId === options.projectId);
    }

    // Return most recent first
    events.reverse();

    if (options.limit) {
      events = events.slice(0, options.limit);
    }

    return events;
  }

  /**
   * Get event statistics
   */
  getEventStats(since?: Date): Record<string, number> {
    let events = this.eventHistory;

    if (since) {
      events = events.filter(e => e.timestamp >= since);
    }

    const stats: Record<string, number> = {};
    for (const event of events) {
      stats[event.eventType] = (stats[event.eventType] || 0) + 1;
    }

    return stats;
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  // ============================================================================
  // Convenience Methods for Common Events
  // ============================================================================

  async emitTaskCreated(task: UnifiedTask, source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'): Promise<string> {
    return this.emitEvent<TaskEventPayload>({
      eventType: 'task.created',
      task,
      projectId: task.projectId,
      source,
    });
  }

  async emitTaskUpdated(
    task: UnifiedTask,
    previousState: Partial<UnifiedTask>,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<TaskEventPayload>({
      eventType: 'task.updated',
      task,
      previousState,
      projectId: task.projectId,
      source,
    });
  }

  async emitTaskCompleted(
    task: UnifiedTask,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<TaskEventPayload>({
      eventType: 'task.completed',
      task,
      projectId: task.projectId,
      source,
    });
  }

  async emitTaskClaimed(
    task: UnifiedTask,
    sessionId: string,
    agentId: string,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<TaskEventPayload>({
      eventType: 'task.claimed',
      task,
      sessionId,
      agentId,
      projectId: task.projectId,
      source,
    });
  }

  async emitTaskReleased(
    task: UnifiedTask,
    sessionId: string,
    agentId: string,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<TaskEventPayload>({
      eventType: 'task.released',
      task,
      sessionId,
      agentId,
      projectId: task.projectId,
      source,
    });
  }

  async emitTaskClaimRejected(
    task: UnifiedTask,
    agentId: string,
    reason: string,
    details: string,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<TaskEventPayload>({
      eventType: 'task.claim_rejected',
      task,
      agentId,
      rejectionReason: reason,
      rejectionDetails: details,
      projectId: task.projectId,
      source,
    });
  }

  async emitSessionStarted(
    session: CoordinationSession,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<SessionEventPayload>({
      eventType: 'session.started',
      session,
      taskId: session.taskId,
      agentId: session.agentId,
      projectId: session.projectId,
      source,
    });
  }

  async emitSessionCompleted(
    session: CoordinationSession,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<SessionEventPayload>({
      eventType: 'session.completed',
      session,
      taskId: session.taskId,
      agentId: session.agentId,
      projectId: session.projectId,
      source,
    });
  }

  async emitProjectCreated(
    project: Project,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<ProjectEventPayload>({
      eventType: 'project.created',
      project,
      projectId: project.id,
      source,
    });
  }

  async emitDecisionLogged(
    decisionId: string,
    decision: string,
    rationale: string,
    options: { taskId?: string; category?: string; projectId?: string } = {},
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<DecisionEventPayload>({
      eventType: 'decision.logged',
      decisionId,
      decision,
      rationale,
      taskId: options.taskId,
      category: options.category,
      projectId: options.projectId,
      source,
    });
  }

  async emitQualityGateResult(
    passed: boolean,
    gate: string,
    options: { taskId?: string; details?: string; projectId?: string } = {},
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<QualityEventPayload>({
      eventType: passed ? 'quality.gate_passed' : 'quality.gate_failed',
      passed,
      gate,
      taskId: options.taskId,
      details: options.details,
      projectId: options.projectId,
      source,
    });
  }

  async emitPhaseAdvanced(
    taskId: string,
    phase: string,
    phaseNumber: number,
    previousPhase: string,
    projectId?: string,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<PhaseEventPayload>({
      eventType: 'phase.advanced',
      taskId,
      phase,
      phaseNumber,
      previousPhase,
      projectId,
      source,
    });
  }

  async emitHandoffInitiated(
    taskId: string,
    fromAgent: string,
    toAgent: string,
    projectId?: string,
    source: 'mcp' | 'rest' | 'cli' | 'internal' = 'internal'
  ): Promise<string> {
    return this.emitEvent<HandoffEventPayload>({
      eventType: 'handoff.initiated',
      taskId,
      fromAgent,
      toAgent,
      projectId,
      source,
    });
  }
}

// Singleton instance for shared use across the application
export const eventOrchestrator = new EventOrchestrator();
