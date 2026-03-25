import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { AuditHelpers } from '../../src/audit/audit-service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Error Logging', () => {
  let storage: SQLiteStorageService;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-error-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('AuditHelpers.errorEvent', () => {
    it('should create an error event with tool name and message', () => {
      const event = AuditHelpers.errorEvent(
        'error.tool_failed',
        'add_task',
        'Task not found: abc123',
        'project-1'
      );

      expect(event.eventType).toBe('error.tool_failed');
      expect(event.resourceType).toBe('error');
      expect(event.resourceId).toBe('add_task');
      expect(event.action).toBe('Task not found: abc123');
      expect(event.projectId).toBe('project-1');
      expect(event.actorId).toBe('mcp-server');
      expect(event.actorType).toBe('system');
    });

    it('should include metadata with args and stack trace', () => {
      const event = AuditHelpers.errorEvent(
        'error.tool_failed',
        'get_task',
        'Database error',
        'project-1',
        {
          args: { taskId: 'task-123' },
          stackTrace: 'Error: Database error\n    at getTask (/path/to/file.ts:10:5)',
        }
      );

      expect(event.metadata).toBeDefined();
      expect((event.metadata as any).args).toEqual({ taskId: 'task-123' });
      expect((event.metadata as any).stackTrace).toContain('Database error');
    });

    it('should sanitize sensitive data in args', () => {
      const event = AuditHelpers.errorEvent(
        'error.tool_failed',
        'auth_tool',
        'Auth failed',
        'project-1',
        {
          args: {
            username: 'user@example.com',
            password: 'secret123',
            apiKey: 'sk-abc123',
          },
        }
      );

      const args = (event.metadata as any).args;
      expect(args.username).toBe('user@example.com');
      expect(args.password).toBe('[REDACTED]');
      expect(args.apiKey).toBe('[REDACTED]');
    });
  });

  describe('AuditHelpers.sanitize', () => {
    it('should redact password fields', () => {
      const result = AuditHelpers.sanitize({
        user: 'test',
        password: 'secret',
      });

      expect((result as any).user).toBe('test');
      expect((result as any).password).toBe('[REDACTED]');
    });

    it('should redact token fields', () => {
      const result = AuditHelpers.sanitize({
        accessToken: 'abc123',
        refreshToken: 'def456',
      });

      expect((result as any).accessToken).toBe('[REDACTED]');
      expect((result as any).refreshToken).toBe('[REDACTED]');
    });

    it('should redact apiKey fields', () => {
      const result = AuditHelpers.sanitize({
        apiKey: 'sk-test-123',
        api_key: 'sk-test-456',
      });

      expect((result as any).apiKey).toBe('[REDACTED]');
      expect((result as any).api_key).toBe('[REDACTED]');
    });

    it('should redact secret fields', () => {
      const result = AuditHelpers.sanitize({
        clientSecret: 'secret123',
        secretKey: 'key456',
      });

      expect((result as any).clientSecret).toBe('[REDACTED]');
      expect((result as any).secretKey).toBe('[REDACTED]');
    });

    it('should recursively sanitize nested objects', () => {
      const result = AuditHelpers.sanitize({
        config: {
          database: {
            password: 'dbpass',
            host: 'localhost',
          },
        },
      });

      expect((result as any).config.database.password).toBe('[REDACTED]');
      expect((result as any).config.database.host).toBe('localhost');
    });

    it('should handle null and undefined', () => {
      expect(AuditHelpers.sanitize(null)).toBeNull();
      expect(AuditHelpers.sanitize(undefined)).toBeUndefined();
    });

    it('should pass through non-objects', () => {
      expect(AuditHelpers.sanitize('string')).toBe('string');
      expect(AuditHelpers.sanitize(123)).toBe(123);
      expect(AuditHelpers.sanitize(true)).toBe(true);
    });
  });

  describe('Error event logging to storage', () => {
    it('should log error events to audit log', async () => {
      const errorEvent = AuditHelpers.errorEvent(
        'error.tool_failed',
        'test_tool',
        'Test error message',
        'test-project',
        { args: { foo: 'bar' } }
      );

      await storage.logAuditEvent(errorEvent);

      const events = await storage.queryAuditLog({
        eventTypes: ['error.tool_failed'],
      });

      expect(events.length).toBe(1);
      expect(events[0].resourceId).toBe('test_tool');
      expect(events[0].action).toBe('Test error message');
    });

    it('should query error events by time range', async () => {
      // Log an error event
      const errorEvent = AuditHelpers.errorEvent(
        'error.tool_failed',
        'test_tool',
        'Recent error',
        'test-project'
      );

      await storage.logAuditEvent(errorEvent);

      // Query with recent time range
      const recentEvents = await storage.queryAuditLog({
        eventTypes: ['error.tool_failed'],
        startTime: new Date(Date.now() - 60000), // Last minute
      });

      expect(recentEvents.length).toBe(1);

      // Query with old time range
      const oldEvents = await storage.queryAuditLog({
        eventTypes: ['error.tool_failed'],
        startTime: new Date(Date.now() - 120000), // 2 minutes ago
        endTime: new Date(Date.now() - 60000), // 1 minute ago
      });

      expect(oldEvents.length).toBe(0);
    });

    it('should query multiple error types', async () => {
      await storage.logAuditEvent(
        AuditHelpers.errorEvent('error.tool_failed', 'tool1', 'Error 1', 'proj')
      );
      await storage.logAuditEvent(
        AuditHelpers.errorEvent('error.validation_failed', 'tool2', 'Error 2', 'proj')
      );
      await storage.logAuditEvent(
        AuditHelpers.errorEvent('error.internal', 'tool3', 'Error 3', 'proj')
      );

      const allErrors = await storage.queryAuditLog({
        eventTypes: ['error.tool_failed', 'error.validation_failed', 'error.internal'],
      });

      expect(allErrors.length).toBe(3);
    });

    it('should filter errors by project', async () => {
      await storage.logAuditEvent(
        AuditHelpers.errorEvent('error.tool_failed', 'tool1', 'Error 1', 'project-a')
      );
      await storage.logAuditEvent(
        AuditHelpers.errorEvent('error.tool_failed', 'tool2', 'Error 2', 'project-b')
      );

      const projectAErrors = await storage.queryAuditLog({
        eventTypes: ['error.tool_failed'],
        projectId: 'project-a',
      });

      expect(projectAErrors.length).toBe(1);
      expect(projectAErrors[0].resourceId).toBe('tool1');
    });
  });
});
