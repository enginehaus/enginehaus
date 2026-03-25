/**
 * Tests for outcome-based analytics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Outcome-Based Analytics', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    // Create temp directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-analytics-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    service = new CoordinationService(storage);

    // Create test project
    projectId = 'test-analytics-project';
    const now = new Date();
    await storage.createProject({
      id: projectId,
      slug: 'analytics-test',
      name: 'Analytics Test',
      rootPath: testDir,
      status: 'active',
      domain: 'other',
      createdAt: now,
      updatedAt: now,
    });
    await storage.setActiveProjectId(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('getOutcomeMetrics', () => {
    it('should return empty metrics for new project', async () => {
      const result = await service.getOutcomeMetrics({ projectId });

      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(result.metrics!.rawCounts.tasksCompleted).toBe(0);
      expect(result.metrics!.rawCounts.sessions).toBe(0);
    });

    it('should include token efficiency metrics', async () => {
      const result = await service.getOutcomeMetrics({ projectId });

      expect(result.metrics!.tokenEfficiency).toBeDefined();
      expect(result.metrics!.tokenEfficiency.minimalContextFetches).toBeTypeOf('number');
      expect(result.metrics!.tokenEfficiency.fullContextFetches).toBeTypeOf('number');
      expect(result.metrics!.tokenEfficiency.minimalSufficiencyRate).toMatch(/^\d+%$/);
    });

    it('should include human time metrics', async () => {
      const result = await service.getOutcomeMetrics({ projectId });

      expect(result.metrics!.humanTime).toBeDefined();
      expect(result.metrics!.humanTime.avgCycleTime).toBeDefined();
      expect(result.metrics!.humanTime.taskReopeningRate).toMatch(/^\d+%$/);
      expect(result.metrics!.humanTime.topFriction).toBeInstanceOf(Array);
    });

    it('should include quality outcomes', async () => {
      const result = await service.getOutcomeMetrics({ projectId });

      expect(result.metrics!.qualityOutcomes).toBeDefined();
      expect(result.metrics!.qualityOutcomes.qualityGatePassRate).toMatch(/^\d+%$/);
      expect(result.metrics!.qualityOutcomes.firstAttemptSuccessRate).toMatch(/^\d+%$/);
      expect(result.metrics!.qualityOutcomes.reworkRate).toMatch(/^\d+%$/);
    });

    it('should respect period parameter', async () => {
      const dayResult = await service.getOutcomeMetrics({ projectId, period: 'day' });
      const weekResult = await service.getOutcomeMetrics({ projectId, period: 'week' });
      const monthResult = await service.getOutcomeMetrics({ projectId, period: 'month' });

      expect(dayResult.metrics!.period.label).toBe('Last day');
      expect(weekResult.metrics!.period.label).toBe('Last week');
      expect(monthResult.metrics!.period.label).toBe('Last month');
    });
  });

  describe('getValueDashboard', () => {
    it('should generate dashboard with insights', async () => {
      const result = await service.getValueDashboard({ projectId });

      expect(result.success).toBe(true);
      expect(result.dashboard).toBeDefined();
      expect(result.dashboard!.insights).toBeInstanceOf(Array);
      expect(result.dashboard!.summary).toBeDefined();
      expect(result.dashboard!.limitations).toBeInstanceOf(Array);
    });

    it('should include summary metrics', async () => {
      const result = await service.getValueDashboard({ projectId });

      expect(result.dashboard!.summary.tokensEstimatedSaved).toBeTypeOf('number');
      expect(result.dashboard!.summary.firstAttemptSuccessRate).toBeDefined();
      expect(result.dashboard!.summary.qualityGatePassRate).toBeDefined();
    });

    it('should include honest limitations', async () => {
      const result = await service.getValueDashboard({ projectId });

      expect(result.dashboard!.limitations.length).toBeGreaterThan(0);
      expect(result.dashboard!.limitations).toContain(
        'Token counts are estimated based on context size, not actual API usage'
      );
    });
  });

  describe('submitSessionFeedback', () => {
    it('should record session feedback', async () => {
      const result = await service.submitSessionFeedback({
        sessionId: 'test-session-123',
        productivityRating: 4,
        frictionTags: ['missing_files', 'unclear_task'],
        notes: 'Some files were not in the task list',
      });

      expect(result.success).toBe(true);
      expect(result.feedbackId).toBeDefined();
      expect(result.message).toContain('recorded');
    });

    it('should accept feedback without rating', async () => {
      const result = await service.submitSessionFeedback({
        sessionId: 'test-session-456',
        frictionTags: ['tool_confusion'],
      });

      expect(result.success).toBe(true);
    });

    it('should accept feedback with only notes', async () => {
      const result = await service.submitSessionFeedback({
        sessionId: 'test-session-789',
        frictionTags: [],
        notes: 'Great session, no issues',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('logMetric with new event types', () => {
    it('should log task_reopened events', async () => {
      const result = await service.logMetric({
        eventType: 'task_reopened',
        taskId: 'test-task-1',
        metadata: { reason: 'additional_work_needed' },
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('task_reopened');
    });

    it('should log context_repeated events', async () => {
      const result = await service.logMetric({
        eventType: 'context_repeated',
        taskId: 'test-task-2',
        metadata: { contextType: 'file_list' },
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('context_repeated');
    });
  });

  describe('Friction tracking', () => {
    it('should aggregate friction tags in metrics', async () => {
      // Submit multiple feedback entries with friction tags
      await service.submitSessionFeedback({
        sessionId: 's1',
        frictionTags: ['missing_files', 'unclear_task'],
      });
      await service.submitSessionFeedback({
        sessionId: 's2',
        frictionTags: ['missing_files'],
      });
      await service.submitSessionFeedback({
        sessionId: 's3',
        frictionTags: ['tool_confusion', 'missing_files'],
      });

      const result = await service.getOutcomeMetrics({ projectId });

      // Missing files should be most common (3 occurrences)
      expect(result.metrics!.humanTime.topFriction[0]).toContain('missing_files');
    });

    it('should show "None reported" when no friction', async () => {
      const result = await service.getOutcomeMetrics({ projectId });

      expect(result.metrics!.humanTime.topFriction).toContain('None reported');
    });
  });
});
