import { describe, it, expect } from 'vitest';
import {
  generateQualityChecklist,
  formatQualityChecklist,
  checkQualityCompliance,
  checkCoverageCompliance,
  COVERAGE_THRESHOLDS,
  TEST_REQUIREMENTS,
} from '../../src/quality/quality-expectations.js';
import { UnifiedTask } from '../../src/coordination/types.js';

describe('Quality Expectations', () => {
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

  describe('COVERAGE_THRESHOLDS', () => {
    it('should define minimum threshold at 70%', () => {
      expect(COVERAGE_THRESHOLDS.minimum).toBe(70);
    });

    it('should define recommended threshold at 80%', () => {
      expect(COVERAGE_THRESHOLDS.recommended).toBe(80);
    });

    it('should define excellent threshold at 90%', () => {
      expect(COVERAGE_THRESHOLDS.excellent).toBe(90);
    });
  });

  describe('TEST_REQUIREMENTS', () => {
    it('should require all test types for critical priority', () => {
      expect(TEST_REQUIREMENTS.critical.unit).toBe(true);
      expect(TEST_REQUIREMENTS.critical.integration).toBe(true);
      expect(TEST_REQUIREMENTS.critical.e2e).toBe(true);
    });

    it('should require unit and integration for high priority', () => {
      expect(TEST_REQUIREMENTS.high.unit).toBe(true);
      expect(TEST_REQUIREMENTS.high.integration).toBe(true);
      expect(TEST_REQUIREMENTS.high.e2e).toBe(false);
    });

    it('should require only unit for medium priority', () => {
      expect(TEST_REQUIREMENTS.medium.unit).toBe(true);
      expect(TEST_REQUIREMENTS.medium.integration).toBe(false);
      expect(TEST_REQUIREMENTS.medium.e2e).toBe(false);
    });

    it('should require only unit for low priority', () => {
      expect(TEST_REQUIREMENTS.low.unit).toBe(true);
      expect(TEST_REQUIREMENTS.low.integration).toBe(false);
      expect(TEST_REQUIREMENTS.low.e2e).toBe(false);
    });
  });

  describe('checkCoverageCompliance', () => {
    it('should return failing status below minimum', () => {
      const result = checkCoverageCompliance(50);

      expect(result.compliant).toBe(false);
      expect(result.status).toBe('failing');
      expect(result.gap).toBe(20);
      expect(result.message).toContain('below minimum');
    });

    it('should return passing status at minimum', () => {
      const result = checkCoverageCompliance(70);

      expect(result.compliant).toBe(true);
      expect(result.status).toBe('passing');
      expect(result.gap).toBe(0);
    });

    it('should return recommended status at 80%', () => {
      const result = checkCoverageCompliance(80);

      expect(result.compliant).toBe(true);
      expect(result.status).toBe('recommended');
    });

    it('should return excellent status at 90%', () => {
      const result = checkCoverageCompliance(95);

      expect(result.compliant).toBe(true);
      expect(result.status).toBe('excellent');
      expect(result.message).toContain('Excellent');
    });
  });

  describe('generateQualityChecklist', () => {
    it('should generate checklist for feature task', () => {
      const task = createMockTask({ title: 'Add new feature' });
      const checklist = generateQualityChecklist(task);

      expect(checklist.taskId).toBe('task-1');
      expect(checklist.expectations.length).toBeGreaterThan(0);
      expect(checklist.criticalItems.length).toBeGreaterThan(0);
    });

    it('should require unit tests for code changes', () => {
      const task = createMockTask({ title: 'Add new feature' });
      const checklist = generateQualityChecklist(task);

      expect(checklist.testingRequirements.unitTestsRequired).toBe(true);
      expect(checklist.testingRequirements.minimumCoverage).toBe(70);
    });

    it('should require integration tests for high priority', () => {
      const task = createMockTask({ title: 'Add feature', priority: 'high' });
      const checklist = generateQualityChecklist(task);

      expect(checklist.testingRequirements.integrationTestsRequired).toBe(true);
    });

    it('should require e2e tests for critical priority', () => {
      const task = createMockTask({ title: 'Add feature', priority: 'critical' });
      const checklist = generateQualityChecklist(task);

      expect(checklist.testingRequirements.e2eTestsRequired).toBe(true);
    });

    it('should not require tests for docs tasks', () => {
      // Use 'Write README' with empty description to avoid triggering 'test' pattern
      const task = createMockTask({
        title: 'Write README for project',
        description: 'Add documentation for users',
      });
      const checklist = generateQualityChecklist(task);

      expect(checklist.testingRequirements.unitTestsRequired).toBe(false);
      expect(checklist.testingRequirements.minimumCoverage).toBe(0);
    });

    it('should generate expectations for bugfix task', () => {
      const task = createMockTask({ title: 'Fix bug in login' });
      const checklist = generateQualityChecklist(task);

      const hasRegressionTest = checklist.criticalItems.some(
        item => item.toLowerCase().includes('regression')
      );
      expect(hasRegressionTest).toBe(true);
    });

    it('should include coverage verification in required items', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);

      const hasCoverageCheck = checklist.criticalItems.some(
        item => item.toLowerCase().includes('coverage')
      );
      expect(hasCoverageCheck).toBe(true);
    });

    it('should add security expectations for security tasks', () => {
      const task = createMockTask({ title: 'Fix security vulnerability' });
      const checklist = generateQualityChecklist(task);

      const hasSecurityReq = checklist.expectations.some(
        e => e.category === 'security'
      );
      expect(hasSecurityReq).toBe(true);
    });

    it('should add API expectations when files include api paths', () => {
      const task = createMockTask({
        title: 'Update API',
        files: ['src/api/routes.ts'],
      });
      const checklist = generateQualityChecklist(task);

      const hasApiSecurity = checklist.expectations.some(
        e => e.requirement.toLowerCase().includes('api')
      );
      expect(hasApiSecurity).toBe(true);
    });

    it('should add accessibility expectations for UI files', () => {
      const task = createMockTask({
        title: 'Add component',
        files: ['src/components/Button.tsx'],
      });
      const checklist = generateQualityChecklist(task);

      const hasA11y = checklist.expectations.some(
        e => e.category === 'accessibility'
      );
      expect(hasA11y).toBe(true);
    });

    it('should add data expectations for storage files', () => {
      const task = createMockTask({
        title: 'Update storage',
        files: ['src/storage/database.ts'],
      });
      const checklist = generateQualityChecklist(task);

      const hasDataReq = checklist.expectations.some(
        e => e.requirement.toLowerCase().includes('data')
      );
      expect(hasDataReq).toBe(true);
    });

    it('should include quality requirements from task', () => {
      const task = createMockTask({
        title: 'Add feature',
        qualityRequirements: ['Must handle 1000 concurrent users'],
      });
      const checklist = generateQualityChecklist(task);

      const hasCustomReq = checklist.criticalItems.some(
        item => item.includes('1000 concurrent users')
      );
      expect(hasCustomReq).toBe(true);
    });

    it('should deduplicate expectations', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);

      const requirements = checklist.expectations.map(e => e.requirement);
      const uniqueRequirements = new Set(requirements);
      expect(requirements.length).toBe(uniqueRequirements.size);
    });

    it('should sort expectations by priority', () => {
      const task = createMockTask({ title: 'Add feature', priority: 'high' });
      const checklist = generateQualityChecklist(task);

      const priorities = checklist.expectations.map(e => e.priority);
      const order = { required: 0, recommended: 1, optional: 2 };

      for (let i = 1; i < priorities.length; i++) {
        expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]]);
      }
    });
  });

  describe('formatQualityChecklist', () => {
    it('should format checklist with test coverage requirements', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);
      const formatted = formatQualityChecklist(checklist);

      expect(formatted).toContain('TEST COVERAGE REQUIREMENTS');
      expect(formatted).toContain('Minimum coverage: 70%');
    });

    it('should include required items as checkboxes', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);
      const formatted = formatQualityChecklist(checklist);

      expect(formatted).toContain('REQUIRED:');
      expect(formatted).toContain('[ ]');
    });

    it('should include summary', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);
      const formatted = formatQualityChecklist(checklist);

      expect(formatted).toContain('required');
      expect(formatted).toContain('recommended');
    });

    it('should list required test types', () => {
      const task = createMockTask({ title: 'Add feature', priority: 'critical' });
      const checklist = generateQualityChecklist(task);
      const formatted = formatQualityChecklist(checklist);

      expect(formatted).toContain('unit');
      expect(formatted).toContain('integration');
      expect(formatted).toContain('e2e');
    });
  });

  describe('checkQualityCompliance', () => {
    it('should return compliant when all required items are completed', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);

      // Complete all critical items
      const result = checkQualityCompliance(task, checklist.criticalItems);

      expect(result.compliant).toBe(true);
      expect(result.missingRequired.length).toBe(0);
    });

    it('should return non-compliant when items are missing', () => {
      const task = createMockTask({ title: 'Add feature' });

      const result = checkQualityCompliance(task, []);

      expect(result.compliant).toBe(false);
      expect(result.missingRequired.length).toBeGreaterThan(0);
    });

    it('should match completed items case-insensitively', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);

      // Complete items with different casing
      const lowerCased = checklist.criticalItems.map(item => item.toLowerCase());
      const result = checkQualityCompliance(task, lowerCased);

      expect(result.compliant).toBe(true);
    });

    it('should report correct counts', () => {
      const task = createMockTask({ title: 'Add feature' });
      const checklist = generateQualityChecklist(task);

      const result = checkQualityCompliance(task, ['item 1', 'item 2']);

      expect(result.completedCount).toBe(2);
      expect(result.totalRequired).toBe(checklist.criticalItems.length);
    });
  });
});
