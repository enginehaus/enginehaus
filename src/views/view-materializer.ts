/**
 * ViewMaterializer
 *
 * Transforms raw coordination events into derived views for the Wheelhaus control room.
 * Maintains efficient incremental updates - views are updated on each event rather than
 * re-fetching entire datasets.
 *
 * This is the core innovation for real-time AI team observability:
 * - Events flow in from EventOrchestrator
 * - ViewMaterializer maintains derived state
 * - React components subscribe to specific views
 * - WebSocket broadcasts view deltas to connected clients
 */

import { EventEmitter } from 'events';
import {
  EventOrchestrator,
  EnginehausEventPayload,
  TaskEventPayload,
  SessionEventPayload,
  DecisionEventPayload,
  PhaseEventPayload,
  QualityEventPayload,
} from '../events/event-orchestrator.js';
import { UnifiedTask, CoordinationSession } from '../coordination/types.js';

// ============================================================================
// View Types - What Wheelhaus displays
// ============================================================================

export interface ActiveSessionView {
  sessionId: string;
  agentId: string;
  taskId: string;
  taskTitle: string;
  startedAt: Date;
  lastHeartbeat: Date;
  durationSeconds: number;
  currentPhase?: string;
  phaseNumber?: number;
}

export interface DecisionStreamItem {
  id: string;
  decision: string;
  rationale: string;
  category?: string;
  taskId?: string;
  timestamp: Date;
  agentId?: string;
}

export interface TaskGraphNode {
  id: string;
  title: string;
  status: UnifiedTask['status'];
  priority: UnifiedTask['priority'];
  assignedTo?: string;
  blockedBy: string[];
  blocks: string[];
  currentPhase?: string;
  phaseNumber?: number;
  lastUpdated: Date;
}

export interface ContextHealthMetrics {
  activeSessions: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksReady: number;
  decisionsLast24h: number;
  qualityGatesPassed: number;
  qualityGatesFailed: number;
  avgSessionDurationMinutes: number;
  lastEventAt: Date | null;
  eventRate: number; // events per minute
}

// ============================================================================
// View Delta Types - What gets broadcast
// ============================================================================

export type ViewDelta =
  | { type: 'session'; action: 'add' | 'update' | 'remove'; data: ActiveSessionView }
  | { type: 'decision'; action: 'add'; data: DecisionStreamItem }
  | { type: 'task'; action: 'add' | 'update' | 'remove'; data: TaskGraphNode }
  | { type: 'health'; data: ContextHealthMetrics }
  | { type: 'snapshot'; data: MaterializedViews };

export interface MaterializedViews {
  sessions: Map<string, ActiveSessionView>;
  decisions: DecisionStreamItem[];
  tasks: Map<string, TaskGraphNode>;
  health: ContextHealthMetrics;
  lastMaterializedAt: Date;
}

// ============================================================================
// Initial Data Loader Interface
// ============================================================================

export interface InitialDataLoader {
  getTasks(): Promise<UnifiedTask[]>;
  getActiveSessions(): Promise<CoordinationSession[]>;
  getDecisions(limit: number): Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    category?: string;
    taskId?: string;
    createdAt: Date;
  }>>;
}

// ============================================================================
// ViewMaterializer Class
// ============================================================================

export class ViewMaterializer extends EventEmitter {
  private views: MaterializedViews;
  private subscriptionId: string | null = null;
  private eventWindow: Date[] = []; // For calculating event rate
  private readonly eventWindowSize = 60; // 60 seconds
  private dataLoader: InitialDataLoader | null = null;

  constructor(private orchestrator: EventOrchestrator) {
    super();
    this.views = this.createEmptyViews();
  }

  /**
   * Set data loader for initial state population
   */
  setDataLoader(loader: InitialDataLoader): void {
    this.dataLoader = loader;
  }

  /**
   * Create empty views structure
   */
  private createEmptyViews(): MaterializedViews {
    return {
      sessions: new Map(),
      decisions: [],
      tasks: new Map(),
      health: {
        activeSessions: 0,
        tasksInProgress: 0,
        tasksBlocked: 0,
        tasksReady: 0,
        decisionsLast24h: 0,
        qualityGatesPassed: 0,
        qualityGatesFailed: 0,
        avgSessionDurationMinutes: 0,
        lastEventAt: null,
        eventRate: 0,
      },
      lastMaterializedAt: new Date(),
    };
  }

  /**
   * Start materializing views from events
   */
  async start(): Promise<void> {
    if (this.subscriptionId) return;

    // Load initial data from database if loader is available
    if (this.dataLoader) {
      await this.loadInitialData();
    }

    // Subscribe to all events for live updates
    this.subscriptionId = this.orchestrator.subscribe(
      '*',
      (event) => this.handleEvent(event)
    );

    // Replay recent events to catch any we missed during initial load
    const recentEvents = this.orchestrator.getRecentEvents({ limit: 100 });
    for (const event of recentEvents.reverse()) {
      this.handleEvent(event, false);
    }

    this.emit('started');
  }

  /**
   * Load initial data from database
   */
  private async loadInitialData(): Promise<void> {
    if (!this.dataLoader) return;

    try {
      // Load tasks
      const tasks = await this.dataLoader.getTasks();
      for (const task of tasks) {
        // Only include non-completed tasks in the graph
        if (task.status !== 'completed') {
          const phaseProgress = task.implementation?.phaseProgress;
          const node: TaskGraphNode = {
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            assignedTo: task.implementation?.sessionId,
            blockedBy: task.blockedBy || [],
            blocks: task.blocks || [],
            currentPhase: phaseProgress?.currentPhase?.toString(),
            phaseNumber: phaseProgress?.currentPhase,
            lastUpdated: task.updatedAt,
          };
          this.views.tasks.set(task.id, node);
        }
      }

      // Load active sessions
      const sessions = await this.dataLoader.getActiveSessions();
      for (const session of sessions) {
        const taskNode = this.views.tasks.get(session.taskId);
        const view: ActiveSessionView = {
          sessionId: session.id,
          agentId: session.agentId,
          taskId: session.taskId,
          taskTitle: taskNode?.title || 'Unknown Task',
          startedAt: new Date(session.startTime),
          lastHeartbeat: new Date(session.lastHeartbeat),
          durationSeconds: Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000),
          currentPhase: taskNode?.currentPhase,
          phaseNumber: taskNode?.phaseNumber,
        };
        this.views.sessions.set(session.id, view);
      }

      // Load recent decisions
      const decisions = await this.dataLoader.getDecisions(50);
      for (const decision of decisions) {
        this.views.decisions.push({
          id: decision.id,
          decision: decision.decision,
          rationale: decision.rationale || '',
          category: decision.category,
          taskId: decision.taskId,
          timestamp: new Date(decision.createdAt),
        });
      }

      // Recalculate health metrics
      this.recalculateTaskHealth();
      this.views.health.activeSessions = this.views.sessions.size;

      // Count decisions in last 24h
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      this.views.health.decisionsLast24h = this.views.decisions.filter(
        d => d.timestamp >= oneDayAgo
      ).length;

      this.views.lastMaterializedAt = new Date();
      console.log(`ViewMaterializer loaded: ${this.views.tasks.size} tasks, ${this.views.sessions.size} sessions, ${this.views.decisions.length} decisions`);
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  }

  /**
   * Stop materializing views
   */
  stop(): void {
    if (this.subscriptionId) {
      this.orchestrator.unsubscribe(this.subscriptionId);
      this.subscriptionId = null;
    }
    this.emit('stopped');
  }

  /**
   * Handle incoming event and update views
   */
  private handleEvent(event: EnginehausEventPayload, emitDelta = true): void {
    // Update event rate tracking
    this.eventWindow.push(event.timestamp);
    const cutoff = new Date(Date.now() - this.eventWindowSize * 1000);
    this.eventWindow = this.eventWindow.filter(t => t >= cutoff);

    // Update last event time
    this.views.health.lastEventAt = event.timestamp;
    this.views.health.eventRate = (this.eventWindow.length / this.eventWindowSize) * 60;

    // Route to appropriate handler
    if (event.eventType.startsWith('task.')) {
      this.handleTaskEvent(event as TaskEventPayload, emitDelta);
    } else if (event.eventType.startsWith('session.')) {
      this.handleSessionEvent(event as SessionEventPayload, emitDelta);
    } else if (event.eventType.startsWith('decision.')) {
      this.handleDecisionEvent(event as DecisionEventPayload, emitDelta);
    } else if (event.eventType.startsWith('phase.')) {
      this.handlePhaseEvent(event as PhaseEventPayload, emitDelta);
    } else if (event.eventType.startsWith('quality.')) {
      this.handleQualityEvent(event as QualityEventPayload, emitDelta);
    }

    this.views.lastMaterializedAt = new Date();

    // Emit health update (aggregated)
    if (emitDelta) {
      this.emitDelta({ type: 'health', data: this.views.health });
    }
  }

  /**
   * Handle task events
   */
  private handleTaskEvent(event: TaskEventPayload, emitDelta: boolean): void {
    const task = event.task;
    const phaseProgress = task.implementation?.phaseProgress;
    const node: TaskGraphNode = {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignedTo: task.implementation?.sessionId,
      blockedBy: task.blockedBy || [],
      blocks: task.blocks || [],
      currentPhase: phaseProgress?.currentPhase?.toString(),
      phaseNumber: phaseProgress?.currentPhase,
      lastUpdated: event.timestamp,
    };

    switch (event.eventType) {
      case 'task.created':
      case 'task.claimed':
      case 'task.updated':
        this.views.tasks.set(task.id, node);
        if (emitDelta) {
          this.emitDelta({
            type: 'task',
            action: event.eventType === 'task.created' ? 'add' : 'update',
            data: node
          });
        }
        break;
      case 'task.completed':
      case 'task.deleted':
        this.views.tasks.delete(task.id);
        if (emitDelta) {
          this.emitDelta({ type: 'task', action: 'remove', data: node });
        }
        break;
      case 'task.claim_rejected': {
        const feedItem: DecisionStreamItem = {
          id: event.eventId,
          decision: `Claim rejected: ${task.title}`,
          rationale: event.rejectionDetails || event.rejectionReason || 'Unknown reason',
          category: 'coordination',
          taskId: task.id,
          timestamp: event.timestamp,
          agentId: event.agentId,
        };
        this.views.decisions.unshift(feedItem);
        if (this.views.decisions.length > 100) {
          this.views.decisions.pop();
        }
        if (emitDelta) {
          this.emitDelta({ type: 'decision', action: 'add', data: feedItem });
        }
        break;
      }
    }

    // Update health metrics
    this.recalculateTaskHealth();
  }

  /**
   * Handle session events
   */
  private handleSessionEvent(event: SessionEventPayload, emitDelta: boolean): void {
    const session = event.session;

    switch (event.eventType) {
      case 'session.started': {
        const taskNode = this.views.tasks.get(session.taskId);
        const view: ActiveSessionView = {
          sessionId: session.id,
          agentId: session.agentId,
          taskId: session.taskId,
          taskTitle: taskNode?.title || 'Unknown Task',
          startedAt: new Date(session.startTime),
          lastHeartbeat: new Date(session.lastHeartbeat),
          durationSeconds: 0,
          currentPhase: taskNode?.currentPhase,
          phaseNumber: taskNode?.phaseNumber,
        };
        this.views.sessions.set(session.id, view);
        if (emitDelta) {
          this.emitDelta({ type: 'session', action: 'add', data: view });
        }
        break;
      }
      case 'session.heartbeat': {
        const existing = this.views.sessions.get(session.id);
        if (existing) {
          existing.lastHeartbeat = new Date(session.lastHeartbeat);
          existing.durationSeconds = Math.floor(
            (Date.now() - existing.startedAt.getTime()) / 1000
          );
          if (emitDelta) {
            this.emitDelta({ type: 'session', action: 'update', data: existing });
          }
        }
        break;
      }
      case 'session.completed':
      case 'session.expired': {
        const removed = this.views.sessions.get(session.id);
        this.views.sessions.delete(session.id);
        if (removed && emitDelta) {
          this.emitDelta({ type: 'session', action: 'remove', data: removed });
        }
        break;
      }
    }

    // Update health metrics
    this.views.health.activeSessions = this.views.sessions.size;
    this.recalculateAvgSessionDuration();
  }

  /**
   * Handle decision events
   */
  private handleDecisionEvent(event: DecisionEventPayload, emitDelta: boolean): void {
    const item: DecisionStreamItem = {
      id: event.decisionId,
      decision: event.decision,
      rationale: event.rationale,
      category: event.category,
      taskId: event.taskId,
      timestamp: event.timestamp,
    };

    // Add to front of stream
    this.views.decisions.unshift(item);

    // Keep last 100 decisions
    if (this.views.decisions.length > 100) {
      this.views.decisions.pop();
    }

    if (emitDelta) {
      this.emitDelta({ type: 'decision', action: 'add', data: item });
    }

    // Update 24h decision count
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.views.health.decisionsLast24h = this.views.decisions.filter(
      d => d.timestamp >= oneDayAgo
    ).length;
  }

  /**
   * Handle phase events
   */
  private handlePhaseEvent(event: PhaseEventPayload, emitDelta: boolean): void {
    const taskNode = this.views.tasks.get(event.taskId);
    if (taskNode) {
      taskNode.currentPhase = event.phase;
      taskNode.phaseNumber = event.phaseNumber;
      taskNode.lastUpdated = event.timestamp;

      if (emitDelta) {
        this.emitDelta({ type: 'task', action: 'update', data: taskNode });
      }
    }

    // Also update corresponding session
    for (const session of this.views.sessions.values()) {
      if (session.taskId === event.taskId) {
        session.currentPhase = event.phase;
        session.phaseNumber = event.phaseNumber;
        if (emitDelta) {
          this.emitDelta({ type: 'session', action: 'update', data: session });
        }
      }
    }
  }

  /**
   * Handle quality events
   */
  private handleQualityEvent(event: QualityEventPayload, _emitDelta: boolean): void {
    if (event.eventType === 'quality.gate_passed') {
      this.views.health.qualityGatesPassed++;
    } else if (event.eventType === 'quality.gate_failed') {
      this.views.health.qualityGatesFailed++;
    }
  }

  /**
   * Recalculate task health metrics
   */
  private recalculateTaskHealth(): void {
    let inProgress = 0;
    let blocked = 0;
    let ready = 0;

    for (const task of this.views.tasks.values()) {
      switch (task.status) {
        case 'in-progress':
          inProgress++;
          break;
        case 'blocked':
          blocked++;
          break;
        case 'ready':
          ready++;
          break;
      }
    }

    this.views.health.tasksInProgress = inProgress;
    this.views.health.tasksBlocked = blocked;
    this.views.health.tasksReady = ready;
  }

  /**
   * Recalculate average session duration
   */
  private recalculateAvgSessionDuration(): void {
    const sessions = Array.from(this.views.sessions.values());
    if (sessions.length === 0) {
      this.views.health.avgSessionDurationMinutes = 0;
      return;
    }

    const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
    this.views.health.avgSessionDurationMinutes = Math.round(totalSeconds / sessions.length / 60);
  }

  /**
   * Emit a view delta to subscribers
   */
  private emitDelta(delta: ViewDelta): void {
    this.emit('delta', delta);
  }

  // ============================================================================
  // Public Accessors
  // ============================================================================

  /**
   * Get current snapshot of all views
   */
  getSnapshot(): MaterializedViews {
    return this.views;
  }

  /**
   * Get active sessions view
   */
  getActiveSessions(): ActiveSessionView[] {
    return Array.from(this.views.sessions.values());
  }

  /**
   * Get decision stream
   */
  getDecisionStream(limit = 50): DecisionStreamItem[] {
    return this.views.decisions.slice(0, limit);
  }

  /**
   * Get task graph nodes
   */
  getTaskGraph(): TaskGraphNode[] {
    return Array.from(this.views.tasks.values());
  }

  /**
   * Get context health metrics
   */
  getHealth(): ContextHealthMetrics {
    return { ...this.views.health };
  }

  /**
   * Get serializable snapshot for WebSocket transmission
   */
  getSerializableSnapshot(): object {
    return {
      sessions: Array.from(this.views.sessions.entries()),
      decisions: this.views.decisions,
      tasks: Array.from(this.views.tasks.entries()),
      health: this.views.health,
      lastMaterializedAt: this.views.lastMaterializedAt.toISOString(),
    };
  }
}

// Export singleton factory
let instance: ViewMaterializer | null = null;

export function getViewMaterializer(orchestrator: EventOrchestrator): ViewMaterializer {
  if (!instance) {
    instance = new ViewMaterializer(orchestrator);
  }
  return instance;
}

export function resetViewMaterializer(): void {
  if (instance) {
    instance.stop();
    instance = null;
  }
}
