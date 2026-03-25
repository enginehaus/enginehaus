import { describe, it, expect } from 'vitest';
import {
  AuditHelpers,
  formatAuditEvent,
  eventsToCSV,
  type AuditEvent,
  type AuditEventType,
} from '../../src/audit/audit-service.js';

describe('AuditHelpers', () => {
  describe('taskEvent', () => {
    it('should create a task.created event', () => {
      const event = AuditHelpers.taskEvent(
        'task.created',
        'user-123',
        'user',
        'project-456',
        'task-789',
        'Created task: Implement feature X'
      );

      expect(event.eventType).toBe('task.created');
      expect(event.actorId).toBe('user-123');
      expect(event.actorType).toBe('user');
      expect(event.projectId).toBe('project-456');
      expect(event.resourceType).toBe('task');
      expect(event.resourceId).toBe('task-789');
      expect(event.action).toBe('Created task: Implement feature X');
    });

    it('should create a task.updated event with before/after state', () => {
      const beforeState = { title: 'Old Title', priority: 'low' };
      const afterState = { title: 'New Title', priority: 'high' };

      const event = AuditHelpers.taskEvent(
        'task.updated',
        'agent-1',
        'agent',
        'project-1',
        'task-1',
        'Updated task priority',
        beforeState,
        afterState
      );

      expect(event.eventType).toBe('task.updated');
      expect(event.beforeState).toEqual(beforeState);
      expect(event.afterState).toEqual(afterState);
    });

    it('should create a task.status_changed event', () => {
      const event = AuditHelpers.taskEvent(
        'task.status_changed',
        'agent-2',
        'agent',
        'proj-1',
        'task-2',
        'Status changed from ready to in_progress',
        { status: 'ready' },
        { status: 'in_progress' }
      );

      expect(event.eventType).toBe('task.status_changed');
      expect(event.actorType).toBe('agent');
    });

    it('should create a task.assigned event with metadata', () => {
      const event = AuditHelpers.taskEvent(
        'task.assigned',
        'system',
        'system',
        'proj-1',
        'task-3',
        'Task assigned to agent-1',
        undefined,
        undefined,
        { assignedTo: 'agent-1', previousAssignee: null }
      );

      expect(event.eventType).toBe('task.assigned');
      expect(event.metadata).toEqual({ assignedTo: 'agent-1', previousAssignee: null });
    });

    it('should create a task.completed event', () => {
      const event = AuditHelpers.taskEvent(
        'task.completed',
        'agent-3',
        'agent',
        'proj-2',
        'task-4',
        'Task completed successfully'
      );

      expect(event.eventType).toBe('task.completed');
      expect(event.resourceType).toBe('task');
    });

    it('should create a task.deleted event', () => {
      const event = AuditHelpers.taskEvent(
        'task.deleted',
        'user-admin',
        'user',
        'proj-3',
        'task-5',
        'Task deleted by admin',
        { title: 'Deleted task', status: 'ready' }
      );

      expect(event.eventType).toBe('task.deleted');
      expect(event.beforeState).toBeDefined();
    });
  });

  describe('sessionEvent', () => {
    it('should create a session.started event', () => {
      const event = AuditHelpers.sessionEvent(
        'session.started',
        'agent-1',
        'project-1',
        'session-abc',
        'Session started for task implementation'
      );

      expect(event.eventType).toBe('session.started');
      expect(event.actorId).toBe('agent-1');
      expect(event.actorType).toBe('agent'); // Always 'agent' for sessions
      expect(event.projectId).toBe('project-1');
      expect(event.resourceType).toBe('session');
      expect(event.resourceId).toBe('session-abc');
    });

    it('should create a session.heartbeat event with metadata', () => {
      const event = AuditHelpers.sessionEvent(
        'session.heartbeat',
        'agent-2',
        'project-2',
        'session-def',
        'Heartbeat received',
        { lastActivity: 'editing file', filesModified: 3 }
      );

      expect(event.eventType).toBe('session.heartbeat');
      expect(event.metadata).toEqual({ lastActivity: 'editing file', filesModified: 3 });
    });

    it('should create a session.expired event', () => {
      const event = AuditHelpers.sessionEvent(
        'session.expired',
        'agent-3',
        'project-3',
        'session-ghi',
        'Session expired after 30 minutes of inactivity'
      );

      expect(event.eventType).toBe('session.expired');
    });

    it('should create a session.completed event', () => {
      const event = AuditHelpers.sessionEvent(
        'session.completed',
        'agent-4',
        'project-4',
        'session-jkl',
        'Session completed with task finish',
        { duration: 3600, filesChanged: ['src/main.ts', 'src/utils.ts'] }
      );

      expect(event.eventType).toBe('session.completed');
      expect(event.metadata?.duration).toBe(3600);
    });

    it('should create a session.force_claimed event', () => {
      const event = AuditHelpers.sessionEvent(
        'session.force_claimed',
        'agent-5',
        'project-5',
        'session-mno',
        'Session force claimed from agent-4',
        { previousAgent: 'agent-4', reason: 'stale session' }
      );

      expect(event.eventType).toBe('session.force_claimed');
      expect(event.metadata?.previousAgent).toBe('agent-4');
    });
  });

  describe('projectEvent', () => {
    it('should create a project.created event', () => {
      const event = AuditHelpers.projectEvent(
        'project.created',
        'user-admin',
        'user',
        'project-new',
        'Project created: My New Project',
        undefined,
        { name: 'My New Project', slug: 'my-new-project' }
      );

      expect(event.eventType).toBe('project.created');
      expect(event.actorId).toBe('user-admin');
      expect(event.actorType).toBe('user');
      expect(event.resourceType).toBe('project');
      expect(event.resourceId).toBe('project-new');
      expect(event.afterState).toEqual({ name: 'My New Project', slug: 'my-new-project' });
    });

    it('should create a project.updated event with before/after state', () => {
      const before = { name: 'Old Name', domain: 'api' };
      const after = { name: 'New Name', domain: 'fullstack' };

      const event = AuditHelpers.projectEvent(
        'project.updated',
        'user-123',
        'user',
        'project-1',
        'Project updated',
        before,
        after
      );

      expect(event.eventType).toBe('project.updated');
      expect(event.beforeState).toEqual(before);
      expect(event.afterState).toEqual(after);
    });

    it('should create a project.deleted event', () => {
      const event = AuditHelpers.projectEvent(
        'project.deleted',
        'user-admin',
        'user',
        'project-old',
        'Project deleted',
        { name: 'Old Project', taskCount: 5 }
      );

      expect(event.eventType).toBe('project.deleted');
      expect(event.beforeState).toBeDefined();
    });

    it('should create a project.activated event', () => {
      const event = AuditHelpers.projectEvent(
        'project.activated',
        'agent-1',
        'agent',
        'project-active',
        'Project set as active',
        undefined,
        undefined,
        { previousActive: 'project-old' }
      );

      expect(event.eventType).toBe('project.activated');
      expect(event.metadata?.previousActive).toBe('project-old');
    });
  });

  describe('qualityEvent', () => {
    it('should create a quality.gate_passed event', () => {
      const event = AuditHelpers.qualityEvent(
        'quality.gate_passed',
        'ci-system',
        'project-1',
        'task-1',
        'All quality gates passed',
        { testsRun: 150, coveragePercent: 85 }
      );

      expect(event.eventType).toBe('quality.gate_passed');
      expect(event.actorId).toBe('ci-system');
      expect(event.actorType).toBe('system'); // Always 'system' for quality
      expect(event.resourceType).toBe('quality');
      expect(event.resourceId).toBe('task-1');
      expect(event.metadata?.testsRun).toBe(150);
    });

    it('should create a quality.gate_failed event', () => {
      const event = AuditHelpers.qualityEvent(
        'quality.gate_failed',
        'ci-system',
        'project-2',
        'task-2',
        'Quality gate failed: coverage below threshold',
        { actualCoverage: 45, requiredCoverage: 80, failedTests: 3 }
      );

      expect(event.eventType).toBe('quality.gate_failed');
      expect(event.metadata?.failedTests).toBe(3);
    });

    it('should create a quality.check_run event', () => {
      const event = AuditHelpers.qualityEvent(
        'quality.check_run',
        'linter',
        'project-3',
        'task-3',
        'ESLint check completed'
      );

      expect(event.eventType).toBe('quality.check_run');
    });
  });

  describe('systemEvent', () => {
    it('should create a system.health_check event', () => {
      const event = AuditHelpers.systemEvent(
        'system.health_check',
        'Health check completed',
        { dbConnected: true, activeSessions: 5, memoryUsageMB: 256 }
      );

      expect(event.eventType).toBe('system.health_check');
      expect(event.actorId).toBe('system');
      expect(event.actorType).toBe('system');
      expect(event.projectId).toBe('system');
      expect(event.resourceType).toBe('system');
      expect(event.resourceId).toBe('system');
      expect(event.metadata?.activeSessions).toBe(5);
    });

    it('should create a system.migration event', () => {
      const event = AuditHelpers.systemEvent(
        'system.migration',
        'Database migration completed: v1 to v2',
        { fromVersion: 1, toVersion: 2, tablesAffected: ['tasks', 'sessions'] }
      );

      expect(event.eventType).toBe('system.migration');
      expect(event.action).toContain('v1 to v2');
    });

    it('should create a system.backup event', () => {
      const event = AuditHelpers.systemEvent(
        'system.backup',
        'Database backup completed',
        { backupPath: '/backups/db-2024-01-15.db', sizeMB: 50 }
      );

      expect(event.eventType).toBe('system.backup');
    });
  });

  describe('errorEvent', () => {
    it('should create an error.tool_failed event', () => {
      const event = AuditHelpers.errorEvent(
        'error.tool_failed',
        'create_task',
        'Failed to create task: validation error',
        'project-1',
        { args: { title: 'Test' }, sessionId: 'session-1' }
      );

      expect(event.eventType).toBe('error.tool_failed');
      expect(event.actorId).toBe('mcp-server');
      expect(event.actorType).toBe('system');
      expect(event.resourceType).toBe('error');
      expect(event.resourceId).toBe('create_task');
      expect(event.action).toBe('Failed to create task: validation error');
    });

    it('should create an error.validation_failed event', () => {
      const event = AuditHelpers.errorEvent(
        'error.validation_failed',
        'update_task',
        'Invalid priority value: extreme',
        'project-2'
      );

      expect(event.eventType).toBe('error.validation_failed');
      expect(event.metadata).toBeUndefined();
    });

    it('should create an error.internal event with stack trace', () => {
      const event = AuditHelpers.errorEvent(
        'error.internal',
        'sync_sessions',
        'Database connection lost',
        'project-3',
        { stackTrace: 'Error: SQLITE_BUSY...' }
      );

      expect(event.eventType).toBe('error.internal');
      expect(event.metadata?.stackTrace).toBeDefined();
    });

    it('should sanitize sensitive data in error metadata', () => {
      const event = AuditHelpers.errorEvent(
        'error.tool_failed',
        'auth_check',
        'Authentication failed',
        'project-1',
        {
          args: { apiKey: 'secret-key-123', user: 'test-user' },
          password: 'hunter2'
        }
      );

      // Check that sensitive fields are redacted
      expect((event.metadata as any).password).toBe('[REDACTED]');
      expect((event.metadata as any).args.apiKey).toBe('[REDACTED]');
      expect((event.metadata as any).args.user).toBe('test-user');
    });
  });

  describe('sanitize', () => {
    it('should return primitive values unchanged', () => {
      expect(AuditHelpers.sanitize('hello')).toBe('hello');
      expect(AuditHelpers.sanitize(123)).toBe(123);
      expect(AuditHelpers.sanitize(true)).toBe(true);
      expect(AuditHelpers.sanitize(null)).toBe(null);
      expect(AuditHelpers.sanitize(undefined)).toBe(undefined);
    });

    it('should redact password fields', () => {
      const data = { username: 'john', password: 'secret123' };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.username).toBe('john');
      expect(sanitized.password).toBe('[REDACTED]');
    });

    it('should redact token fields', () => {
      const data = { userId: 1, accessToken: 'xyz', refreshToken: 'abc' };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.userId).toBe(1);
      expect(sanitized.accessToken).toBe('[REDACTED]');
      expect(sanitized.refreshToken).toBe('[REDACTED]');
    });

    it('should redact secret fields', () => {
      const data = { name: 'app', clientSecret: 'shh' };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.name).toBe('app');
      expect(sanitized.clientSecret).toBe('[REDACTED]');
    });

    it('should redact API key fields (various formats)', () => {
      const data = {
        apiKey: 'key1',
        api_key: 'key2',
        APIKEY: 'key3'
      };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.apiKey).toBe('[REDACTED]');
      expect(sanitized.api_key).toBe('[REDACTED]');
      expect(sanitized.APIKEY).toBe('[REDACTED]');
    });

    it('should redact auth fields', () => {
      const data = { authToken: 'bearer xyz', authorization: 'Basic abc' };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.authToken).toBe('[REDACTED]');
      expect(sanitized.authorization).toBe('[REDACTED]');
    });

    it('should redact credential fields', () => {
      const data = { dbCredential: 'user:pass', credentials: { u: 1, p: 2 } };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.dbCredential).toBe('[REDACTED]');
      expect(sanitized.credentials).toBe('[REDACTED]');
    });

    it('should recursively sanitize nested objects', () => {
      const data = {
        user: {
          name: 'John',
          settings: {
            theme: 'dark',
            lastLogin: '2024-01-01',
          },
        },
      };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.user.name).toBe('John');
      expect(sanitized.user.settings.theme).toBe('dark');
      expect(sanitized.user.settings.lastLogin).toBe('2024-01-01');
    });

    it('should redact entire auth objects when key contains sensitive word', () => {
      const data = {
        user: {
          name: 'John',
          auth: {
            password: 'secret',
            lastLogin: '2024-01-01',
          },
        },
      };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.user.name).toBe('John');
      // The 'auth' key contains 'auth' which is sensitive, so the whole object is redacted
      expect(sanitized.user.auth).toBe('[REDACTED]');
    });

    it('should handle deeply nested sensitive data', () => {
      const data = {
        level1: {
          level2: {
            level3: {
              apiKey: 'deep-secret',
              regularField: 'visible',
            },
          },
        },
      };
      const sanitized = AuditHelpers.sanitize(data) as typeof data;

      expect(sanitized.level1.level2.level3.apiKey).toBe('[REDACTED]');
      expect(sanitized.level1.level2.level3.regularField).toBe('visible');
    });

    it('should handle case-insensitive matching', () => {
      const data = {
        PASSWORD: 'upper',
        Password: 'mixed',
        password: 'lower',
      };
      const sanitized = AuditHelpers.sanitize(data) as Record<string, string>;

      expect(sanitized.PASSWORD).toBe('[REDACTED]');
      expect(sanitized.Password).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
    });
  });

  describe('createDiff', () => {
    it('should detect changes in values', () => {
      const before = { name: 'Old', priority: 'low' };
      const after = { name: 'New', priority: 'high' };

      const diff = AuditHelpers.createDiff(before, after);

      expect(diff.name).toEqual({ before: 'Old', after: 'New' });
      expect(diff.priority).toEqual({ before: 'low', after: 'high' });
    });

    it('should not include unchanged fields', () => {
      const before = { name: 'Same', priority: 'low' };
      const after = { name: 'Same', priority: 'high' };

      const diff = AuditHelpers.createDiff(before, after);

      expect(diff.name).toBeUndefined();
      expect(diff.priority).toEqual({ before: 'low', after: 'high' });
    });

    it('should detect added fields', () => {
      const before = { name: 'Task' };
      const after = { name: 'Task', description: 'New description' };

      const diff = AuditHelpers.createDiff(before, after);

      expect(diff.description).toEqual({ before: undefined, after: 'New description' });
    });

    it('should detect removed fields', () => {
      const before = { name: 'Task', description: 'Old desc' };
      const after = { name: 'Task' };

      const diff = AuditHelpers.createDiff(before, after);

      expect(diff.description).toEqual({ before: 'Old desc', after: undefined });
    });

    it('should handle empty objects', () => {
      expect(AuditHelpers.createDiff({}, {})).toEqual({});
    });

    it('should detect changes in nested objects via JSON comparison', () => {
      const before = { config: { enabled: true } };
      const after = { config: { enabled: false } };

      const diff = AuditHelpers.createDiff(before, after);

      expect(diff.config).toEqual({
        before: { enabled: true },
        after: { enabled: false },
      });
    });

    it('should detect changes in arrays', () => {
      const before = { files: ['a.ts', 'b.ts'] };
      const after = { files: ['a.ts', 'b.ts', 'c.ts'] };

      const diff = AuditHelpers.createDiff(before, after);

      expect(diff.files).toEqual({
        before: ['a.ts', 'b.ts'],
        after: ['a.ts', 'b.ts', 'c.ts'],
      });
    });

    it('should not include unchanged arrays', () => {
      const before = { files: ['a.ts', 'b.ts'] };
      const after = { files: ['a.ts', 'b.ts'] };

      const diff = AuditHelpers.createDiff(before, after);

      expect(diff.files).toBeUndefined();
    });
  });
});

describe('formatAuditEvent', () => {
  it('should format event with user actor', () => {
    const event: AuditEvent = {
      id: 'evt-123',
      timestamp: new Date('2024-01-15T10:30:00Z'),
      eventType: 'task.created',
      actorId: 'user-john',
      actorType: 'user',
      projectId: 'proj-1',
      resourceType: 'task',
      resourceId: 'task-456',
      action: 'Created task: Implement feature',
    };

    const formatted = formatAuditEvent(event);

    expect(formatted).toBe(
      '[2024-01-15T10:30:00.000Z] task.created by user-john: Created task: Implement feature (task:task-456)'
    );
  });

  it('should format event with agent actor', () => {
    const event: AuditEvent = {
      id: 'evt-124',
      timestamp: new Date('2024-01-15T11:00:00Z'),
      eventType: 'session.started',
      actorId: 'claude-agent-1',
      actorType: 'agent',
      projectId: 'proj-1',
      resourceType: 'session',
      resourceId: 'session-789',
      action: 'Session started',
    };

    const formatted = formatAuditEvent(event);

    expect(formatted).toContain('by claude-agent-1:');
  });

  it('should format event with system actor as SYSTEM', () => {
    const event: AuditEvent = {
      id: 'evt-125',
      timestamp: new Date('2024-01-15T12:00:00Z'),
      eventType: 'system.health_check',
      actorId: 'system',
      actorType: 'system',
      projectId: 'system',
      resourceType: 'system',
      resourceId: 'system',
      action: 'Health check passed',
    };

    const formatted = formatAuditEvent(event);

    expect(formatted).toContain('by SYSTEM:');
    expect(formatted).toContain('system.health_check');
  });

  it('should include resource type and ID', () => {
    const event: AuditEvent = {
      id: 'evt-126',
      timestamp: new Date('2024-01-15T13:00:00Z'),
      eventType: 'project.created',
      actorId: 'admin',
      actorType: 'user',
      projectId: 'proj-new',
      resourceType: 'project',
      resourceId: 'proj-new',
      action: 'Project created',
    };

    const formatted = formatAuditEvent(event);

    expect(formatted).toContain('(project:proj-new)');
  });
});

describe('eventsToCSV', () => {
  it('should create CSV with headers', () => {
    const csv = eventsToCSV([]);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('id,timestamp,eventType,actorId,actorType,projectId,resourceType,resourceId,action,metadata');
  });

  it('should format a single event correctly', () => {
    const events: AuditEvent[] = [
      {
        id: 'evt-1',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        eventType: 'task.created',
        actorId: 'user-1',
        actorType: 'user',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Created task',
      },
    ];

    const csv = eventsToCSV(events);
    const lines = csv.split('\n');

    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('evt-1');
    expect(lines[1]).toContain('task.created');
    expect(lines[1]).toContain('"Created task"');
  });

  it('should escape quotes in action field', () => {
    const events: AuditEvent[] = [
      {
        id: 'evt-2',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        eventType: 'task.updated',
        actorId: 'user-1',
        actorType: 'user',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Updated title to "New Title"',
      },
    ];

    const csv = eventsToCSV(events);

    // Quotes should be doubled for CSV escaping
    expect(csv).toContain('""New Title""');
  });

  it('should include metadata as escaped JSON', () => {
    const events: AuditEvent[] = [
      {
        id: 'evt-3',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        eventType: 'task.completed',
        actorId: 'agent-1',
        actorType: 'agent',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Task completed',
        metadata: { duration: 3600, filesChanged: 5 },
      },
    ];

    const csv = eventsToCSV(events);

    // Metadata should be JSON with escaped quotes
    expect(csv).toContain('duration');
    expect(csv).toContain('filesChanged');
  });

  it('should handle events without metadata', () => {
    const events: AuditEvent[] = [
      {
        id: 'evt-4',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        eventType: 'task.created',
        actorId: 'user-1',
        actorType: 'user',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Created',
      },
    ];

    const csv = eventsToCSV(events);
    const lines = csv.split('\n');

    // Last field should be empty
    expect(lines[1]).toMatch(/,$/);
  });

  it('should format multiple events', () => {
    const events: AuditEvent[] = [
      {
        id: 'evt-1',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        eventType: 'task.created',
        actorId: 'user-1',
        actorType: 'user',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Created',
      },
      {
        id: 'evt-2',
        timestamp: new Date('2024-01-15T11:00:00Z'),
        eventType: 'task.updated',
        actorId: 'user-1',
        actorType: 'user',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Updated',
      },
      {
        id: 'evt-3',
        timestamp: new Date('2024-01-15T12:00:00Z'),
        eventType: 'task.completed',
        actorId: 'agent-1',
        actorType: 'agent',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Completed',
      },
    ];

    const csv = eventsToCSV(events);
    const lines = csv.split('\n');

    expect(lines.length).toBe(4); // 1 header + 3 events
    expect(lines[1]).toContain('evt-1');
    expect(lines[2]).toContain('evt-2');
    expect(lines[3]).toContain('evt-3');
  });

  it('should handle special characters in action', () => {
    const events: AuditEvent[] = [
      {
        id: 'evt-5',
        timestamp: new Date('2024-01-15T10:00:00Z'),
        eventType: 'task.created',
        actorId: 'user-1',
        actorType: 'user',
        projectId: 'proj-1',
        resourceType: 'task',
        resourceId: 'task-1',
        action: 'Created task with comma, newline\nand "quotes"',
      },
    ];

    const csv = eventsToCSV(events);

    // Should handle the special characters
    expect(csv).toContain('""quotes""');
  });
});

describe('AuditEventType coverage', () => {
  it('should support all task event types', () => {
    const taskTypes: AuditEventType[] = [
      'task.created',
      'task.updated',
      'task.status_changed',
      'task.assigned',
      'task.completed',
      'task.deleted',
    ];

    taskTypes.forEach(type => {
      expect(type).toMatch(/^task\./);
    });
  });

  it('should support all session event types', () => {
    const sessionTypes: AuditEventType[] = [
      'session.started',
      'session.heartbeat',
      'session.expired',
      'session.completed',
      'session.force_claimed',
    ];

    sessionTypes.forEach(type => {
      expect(type).toMatch(/^session\./);
    });
  });

  it('should support all project event types', () => {
    const projectTypes: AuditEventType[] = [
      'project.created',
      'project.updated',
      'project.deleted',
      'project.activated',
    ];

    projectTypes.forEach(type => {
      expect(type).toMatch(/^project\./);
    });
  });

  it('should support all dependency event types', () => {
    const depTypes: AuditEventType[] = [
      'dependency.added',
      'dependency.removed',
      'task.blocked',
      'task.unblocked',
    ];

    expect(depTypes).toHaveLength(4);
  });

  it('should support all phase event types', () => {
    const phaseTypes: AuditEventType[] = [
      'phase.started',
      'phase.completed',
      'phase.skipped',
    ];

    phaseTypes.forEach(type => {
      expect(type).toMatch(/^phase\./);
    });
  });

  it('should support all quality event types', () => {
    const qualityTypes: AuditEventType[] = [
      'quality.gate_passed',
      'quality.gate_failed',
      'quality.check_run',
    ];

    qualityTypes.forEach(type => {
      expect(type).toMatch(/^quality\./);
    });
  });

  it('should support all system event types', () => {
    const systemTypes: AuditEventType[] = [
      'system.health_check',
      'system.migration',
      'system.backup',
    ];

    systemTypes.forEach(type => {
      expect(type).toMatch(/^system\./);
    });
  });

  it('should support all error event types', () => {
    const errorTypes: AuditEventType[] = [
      'error.tool_failed',
      'error.validation_failed',
      'error.internal',
    ];

    errorTypes.forEach(type => {
      expect(type).toMatch(/^error\./);
    });
  });
});
