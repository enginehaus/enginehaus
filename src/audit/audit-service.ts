/**
 * Enterprise Audit Logging Service
 *
 * Provides comprehensive audit logging for enterprise governance and compliance:
 * - SOC2/ISO27001 compliance-ready event tracking
 * - All task state changes with before/after snapshots
 * - Session events (start, heartbeat, expire, complete)
 * - Quality gate results
 * - User/actor identification
 * - Timestamps with timezone support
 *
 * Audit events are immutable once created.
 */

export type AuditEventType =
  // Task Events
  | 'task.created'
  | 'task.updated'
  | 'task.status_changed'
  | 'task.assigned'
  | 'task.completed'
  | 'task.deleted'
  // Session Events
  | 'session.started'
  | 'session.heartbeat'
  | 'session.expired'
  | 'session.completed'
  | 'session.force_claimed'
  // Project Events
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'project.activated'
  // Config Events
  | 'config.created'
  | 'config.updated'
  | 'config.synced'
  | 'config.reset'
  | 'config.session_override'
  // Dependency Events
  | 'dependency.added'
  | 'dependency.removed'
  | 'task.blocked'
  | 'task.unblocked'
  // Phase Events
  | 'phase.started'
  | 'phase.completed'
  | 'phase.skipped'
  // Checkpoint Events
  | 'checkpoint-requested'
  | 'checkpoint-approved'
  | 'checkpoint-rejected'
  | 'checkpoint-timed-out'
  | 'checkpoint-escalated'
  // Quality Events
  | 'quality.gate_passed'
  | 'quality.gate_failed'
  | 'quality.check_run'
  // System Events
  | 'system.health_check'
  | 'system.migration'
  | 'system.backup'
  // Error Events
  | 'error.tool_failed'
  | 'error.validation_failed'
  | 'error.internal';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  actorId: string;         // User or agent ID that triggered the event
  actorType: 'user' | 'agent' | 'system';
  projectId: string;
  resourceType: 'task' | 'session' | 'project' | 'config' | 'dependency' | 'phase' | 'quality' | 'system' | 'error';
  resourceId: string;
  action: string;          // Human-readable action description
  beforeState?: unknown;   // State before the change (for updates)
  afterState?: unknown;    // State after the change
  metadata?: Record<string, unknown>;  // Additional context
  ipAddress?: string;      // For network audit trails
  userAgent?: string;      // Client information
  correlationId?: string;  // For tracing related events
}

export interface AuditQueryOptions {
  eventTypes?: AuditEventType[];
  actorId?: string;
  projectId?: string;
  resourceType?: AuditEvent['resourceType'];
  resourceId?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogSummary {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByActor: Record<string, number>;
  eventsByResource: Record<string, number>;
  timeRange: {
    earliest: Date;
    latest: Date;
  };
}

/**
 * Audit logging service interface
 */
export interface AuditService {
  /**
   * Log an audit event
   */
  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<AuditEvent>;

  /**
   * Query audit events with filters
   */
  query(options: AuditQueryOptions): Promise<AuditEvent[]>;

  /**
   * Get a single audit event by ID
   */
  getEvent(id: string): Promise<AuditEvent | null>;

  /**
   * Get audit summary for a time period
   */
  getSummary(projectId?: string, startTime?: Date, endTime?: Date): Promise<AuditLogSummary>;

  /**
   * Get all events for a specific resource
   */
  getResourceHistory(resourceType: AuditEvent['resourceType'], resourceId: string): Promise<AuditEvent[]>;

  /**
   * Export audit log for compliance reporting
   */
  export(options: AuditQueryOptions, format: 'json' | 'csv'): Promise<string>;
}

/**
 * Create audit event helpers
 */
export const AuditHelpers = {
  /**
   * Create a task event
   */
  taskEvent(
    eventType: Extract<AuditEventType, `task.${string}`>,
    actorId: string,
    actorType: AuditEvent['actorType'],
    projectId: string,
    taskId: string,
    action: string,
    beforeState?: unknown,
    afterState?: unknown,
    metadata?: Record<string, unknown>
  ): Omit<AuditEvent, 'id' | 'timestamp'> {
    return {
      eventType,
      actorId,
      actorType,
      projectId,
      resourceType: 'task',
      resourceId: taskId,
      action,
      beforeState,
      afterState,
      metadata,
    };
  },

  /**
   * Create a session event
   */
  sessionEvent(
    eventType: Extract<AuditEventType, `session.${string}`>,
    actorId: string,
    projectId: string,
    sessionId: string,
    action: string,
    metadata?: Record<string, unknown>
  ): Omit<AuditEvent, 'id' | 'timestamp'> {
    return {
      eventType,
      actorId,
      actorType: 'agent',
      projectId,
      resourceType: 'session',
      resourceId: sessionId,
      action,
      metadata,
    };
  },

  /**
   * Create a project event
   */
  projectEvent(
    eventType: Extract<AuditEventType, `project.${string}`>,
    actorId: string,
    actorType: AuditEvent['actorType'],
    projectId: string,
    action: string,
    beforeState?: unknown,
    afterState?: unknown,
    metadata?: Record<string, unknown>
  ): Omit<AuditEvent, 'id' | 'timestamp'> {
    return {
      eventType,
      actorId,
      actorType,
      projectId,
      resourceType: 'project',
      resourceId: projectId,
      action,
      beforeState,
      afterState,
      metadata,
    };
  },

  /**
   * Create a config event for configuration changes
   */
  configEvent(
    eventType: Extract<AuditEventType, `config.${string}`>,
    actorId: string,
    actorType: AuditEvent['actorType'],
    projectId: string,
    action: string,
    beforeState?: unknown,
    afterState?: unknown,
    metadata?: Record<string, unknown>
  ): Omit<AuditEvent, 'id' | 'timestamp'> {
    return {
      eventType,
      actorId,
      actorType,
      projectId,
      resourceType: 'config',
      resourceId: projectId,
      action,
      beforeState: beforeState ? AuditHelpers.sanitize(beforeState) : undefined,
      afterState: afterState ? AuditHelpers.sanitize(afterState) : undefined,
      metadata,
    };
  },

  /**
   * Create a quality event
   */
  qualityEvent(
    eventType: Extract<AuditEventType, `quality.${string}`>,
    actorId: string,
    projectId: string,
    taskId: string,
    action: string,
    metadata?: Record<string, unknown>
  ): Omit<AuditEvent, 'id' | 'timestamp'> {
    return {
      eventType,
      actorId,
      actorType: 'system',
      projectId,
      resourceType: 'quality',
      resourceId: taskId,
      action,
      metadata,
    };
  },

  /**
   * Create a system event
   */
  systemEvent(
    eventType: Extract<AuditEventType, `system.${string}`>,
    action: string,
    metadata?: Record<string, unknown>
  ): Omit<AuditEvent, 'id' | 'timestamp'> {
    return {
      eventType,
      actorId: 'system',
      actorType: 'system',
      projectId: 'system',
      resourceType: 'system',
      resourceId: 'system',
      action,
      metadata,
    };
  },

  /**
   * Create an error event for tool failures
   */
  errorEvent(
    eventType: Extract<AuditEventType, `error.${string}`>,
    toolName: string,
    errorMessage: string,
    projectId: string,
    metadata?: {
      args?: unknown;
      stackTrace?: string;
      sessionId?: string;
      taskId?: string;
      errorType?: string;
    }
  ): Omit<AuditEvent, 'id' | 'timestamp'> {
    return {
      eventType,
      actorId: 'mcp-server',
      actorType: 'system',
      projectId,
      resourceType: 'error',
      resourceId: toolName,
      action: errorMessage,
      metadata: metadata ? AuditHelpers.sanitize(metadata) as Record<string, unknown> : undefined,
    };
  },

  /**
   * Sanitize sensitive data for audit logging
   */
  sanitize(data: unknown): unknown {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sensitiveKeys = ['password', 'token', 'secret', 'apikey', 'api_key', 'auth', 'credential'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        sanitized[key] = AuditHelpers.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  },

  /**
   * Create a diff between before and after states
   */
  createDiff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { before: unknown; after: unknown }> {
    const diff: Record<string, { before: unknown; after: unknown }> = {};

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      const beforeVal = before[key];
      const afterVal = after[key];

      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        diff[key] = { before: beforeVal, after: afterVal };
      }
    }

    return diff;
  },
};

/**
 * Format audit event for display
 */
export function formatAuditEvent(event: AuditEvent): string {
  const timestamp = event.timestamp.toISOString();
  const actor = event.actorType === 'system' ? 'SYSTEM' : event.actorId;
  return `[${timestamp}] ${event.eventType} by ${actor}: ${event.action} (${event.resourceType}:${event.resourceId})`;
}

/**
 * Export audit events to CSV format
 */
export function eventsToCSV(events: AuditEvent[]): string {
  const headers = [
    'id',
    'timestamp',
    'eventType',
    'actorId',
    'actorType',
    'projectId',
    'resourceType',
    'resourceId',
    'action',
    'metadata',
  ];

  const rows = events.map(e => [
    e.id,
    e.timestamp.toISOString(),
    e.eventType,
    e.actorId,
    e.actorType,
    e.projectId,
    e.resourceType,
    e.resourceId,
    `"${e.action.replace(/"/g, '""')}"`,
    e.metadata ? `"${JSON.stringify(e.metadata).replace(/"/g, '""')}"` : '',
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
