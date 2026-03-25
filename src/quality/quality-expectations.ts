/**
 * Quality Expectations Service
 *
 * Generates structured quality expectations for tasks based on:
 * - Task priority
 * - Task type (feature, bug fix, refactor, etc.)
 * - Files being modified
 * - Project tech stack
 * - Strategic/UX/Technical context
 *
 * Thresholds and requirements are now configurable via the configuration system.
 * Use DEFAULT_CONFIG from config/types.ts for default values.
 */

import { UnifiedTask, TaskPriority } from '../coordination/types.js';
import { DEFAULT_CONFIG, QualityConfig, TestRequirementsConfig, CoverageConfig } from '../config/types.js';

export interface QualityExpectation {
  category: 'testing' | 'documentation' | 'security' | 'performance' | 'accessibility' | 'code-quality' | 'review';
  requirement: string;
  priority: 'required' | 'recommended' | 'optional';
  rationale?: string;
}

/**
 * Coverage thresholds from configuration defaults.
 * Use getCoverageThresholdsFromConfig() for project-specific values.
 */
export const COVERAGE_THRESHOLDS = {
  minimum: DEFAULT_CONFIG.quality.coverage.minimum,
  recommended: DEFAULT_CONFIG.quality.coverage.recommended,
  excellent: DEFAULT_CONFIG.quality.coverage.excellent,
} as const;

/**
 * Test requirements by priority from configuration defaults.
 * Use getTestRequirementsFromConfig() for project-specific values.
 */
export const TEST_REQUIREMENTS: Record<string, { unit: boolean; integration: boolean; e2e: boolean }> = {
  critical: DEFAULT_CONFIG.quality.testRequirements.critical,
  high: DEFAULT_CONFIG.quality.testRequirements.high,
  medium: DEFAULT_CONFIG.quality.testRequirements.medium,
  low: DEFAULT_CONFIG.quality.testRequirements.low,
};

/**
 * Get coverage thresholds from a configuration.
 */
export function getCoverageThresholdsFromConfig(config: { quality: QualityConfig }): CoverageConfig {
  return config.quality.coverage;
}

/**
 * Get test requirements from a configuration.
 */
export function getTestRequirementsFromConfig(config: { quality: QualityConfig }): TestRequirementsConfig {
  return config.quality.testRequirements;
}

export interface QualityChecklist {
  taskId: string;
  expectations: QualityExpectation[];
  summary: string;
  criticalItems: string[];
  estimatedEffort?: string;
  testingRequirements: {
    unitTestsRequired: boolean;
    integrationTestsRequired: boolean;
    e2eTestsRequired: boolean;
    minimumCoverage: number;
  };
}

/**
 * Coverage compliance check result
 */
export interface CoverageComplianceResult {
  compliant: boolean;
  currentCoverage: number;
  minimumRequired: number;
  gap: number;
  status: 'excellent' | 'recommended' | 'passing' | 'failing';
  message: string;
}

/**
 * Check if coverage meets thresholds.
 * Delegates to checkCoverageComplianceWithConfig using DEFAULT_CONFIG.
 */
export function checkCoverageCompliance(currentCoverage: number): CoverageComplianceResult {
  return checkCoverageComplianceWithConfig(currentCoverage, { quality: DEFAULT_CONFIG.quality });
}

/**
 * Infer task type from title and description
 */
function inferTaskType(task: UnifiedTask): 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'infra' | 'security' {
  const text = `${task.title} ${task.description}`.toLowerCase();

  if (text.includes('security') || text.includes('vulnerability') || text.includes('auth')) {
    return 'security';
  }
  if (text.includes('bug') || text.includes('fix') || text.includes('error') || text.includes('issue')) {
    return 'bugfix';
  }
  if (text.includes('refactor') || text.includes('cleanup') || text.includes('optimize')) {
    return 'refactor';
  }
  if (text.includes('test') || text.includes('coverage')) {
    return 'test';
  }
  if (text.includes('doc') || text.includes('readme') || text.includes('comment')) {
    return 'docs';
  }
  if (text.includes('deploy') || text.includes('ci') || text.includes('infrastructure') || text.includes('config')) {
    return 'infra';
  }

  return 'feature';
}

/**
 * Infer file types from file paths
 */
function inferFileTypes(files: string[]): Set<string> {
  const types = new Set<string>();

  for (const file of files) {
    if (file.includes('test') || file.includes('spec')) {
      types.add('test');
    }
    if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      types.add('code');
    }
    if (file.endsWith('.css') || file.endsWith('.scss') || file.endsWith('.less')) {
      types.add('style');
    }
    if (file.includes('api') || file.includes('route') || file.includes('handler')) {
      types.add('api');
    }
    if (file.includes('component') || file.endsWith('.tsx') || file.endsWith('.jsx')) {
      types.add('ui');
    }
    if (file.includes('storage') || file.includes('database') || file.includes('model')) {
      types.add('data');
    }
    if (file.endsWith('.md') || file.endsWith('.mdx')) {
      types.add('docs');
    }
  }

  return types;
}

/**
 * Generate expectations based on file types being modified
 */
function getFileTypeExpectations(fileTypes: Set<string>): QualityExpectation[] {
  const expectations: QualityExpectation[] = [];

  if (fileTypes.has('api')) {
    expectations.push({
      category: 'security',
      requirement: 'Validate API inputs and sanitize outputs',
      priority: 'required',
    });
    expectations.push({
      category: 'documentation',
      requirement: 'Update API documentation if endpoints changed',
      priority: 'recommended',
    });
  }

  if (fileTypes.has('ui')) {
    expectations.push({
      category: 'accessibility',
      requirement: 'Ensure UI components are keyboard accessible',
      priority: 'recommended',
    });
    expectations.push({
      category: 'accessibility',
      requirement: 'Add appropriate ARIA labels',
      priority: 'recommended',
    });
  }

  if (fileTypes.has('data')) {
    expectations.push({
      category: 'security',
      requirement: 'Sanitize data before storage',
      priority: 'required',
    });
    expectations.push({
      category: 'testing',
      requirement: 'Test edge cases for data operations',
      priority: 'required',
    });
  }

  return expectations;
}

/**
 * Generate expectations from task context
 */
function getContextExpectations(task: UnifiedTask): QualityExpectation[] {
  const expectations: QualityExpectation[] = [];

  // From technical context
  if (task.technicalContext?.qualityGates) {
    for (const gate of task.technicalContext.qualityGates) {
      expectations.push({
        category: 'code-quality',
        requirement: gate,
        priority: 'required',
        rationale: 'Defined in technical plan',
      });
    }
  }

  // From quality requirements
  if (task.qualityRequirements) {
    for (const req of task.qualityRequirements) {
      expectations.push({
        category: 'code-quality',
        requirement: req,
        priority: 'required',
        rationale: 'Explicit task requirement',
      });
    }
  }

  // From strategic context
  if (task.strategicContext?.revenueImpact) {
    expectations.push({
      category: 'testing',
      requirement: 'Add comprehensive tests for revenue-critical functionality',
      priority: 'required',
      rationale: 'High business impact requires extra testing rigor',
    });
  }

  // From UX context
  if (task.uxContext?.progressiveDisclosure) {
    expectations.push({
      category: 'accessibility',
      requirement: 'Implement progressive disclosure as specified',
      priority: 'required',
    });
  }

  return expectations;
}

/**
 * Generate complete quality checklist for a task.
 * Delegates to generateQualityChecklistWithConfig using DEFAULT_CONFIG.
 */
export function generateQualityChecklist(task: UnifiedTask): QualityChecklist {
  return generateQualityChecklistWithConfig(task, { quality: DEFAULT_CONFIG.quality });
}

/**
 * Format quality checklist for display
 */
export function formatQualityChecklist(checklist: QualityChecklist): string {
  const lines: string[] = [
    'Quality Expectations',
    '====================',
    '',
  ];

  // Testing requirements summary
  const testReqs = checklist.testingRequirements;
  if (testReqs.minimumCoverage > 0) {
    lines.push('TEST COVERAGE REQUIREMENTS:');
    lines.push(`  Minimum coverage: ${testReqs.minimumCoverage}%`);
    const testTypes: string[] = [];
    if (testReqs.unitTestsRequired) testTypes.push('unit');
    if (testReqs.integrationTestsRequired) testTypes.push('integration');
    if (testReqs.e2eTestsRequired) testTypes.push('e2e');
    lines.push(`  Required tests: ${testTypes.join(', ')}`);
    lines.push('');
  }

  if (checklist.criticalItems.length > 0) {
    lines.push('REQUIRED:');
    for (const item of checklist.criticalItems) {
      lines.push(`  [ ] ${item}`);
    }
    lines.push('');
  }

  const recommended = checklist.expectations.filter(e => e.priority === 'recommended');
  if (recommended.length > 0) {
    lines.push('RECOMMENDED:');
    for (const e of recommended) {
      lines.push(`  [ ] ${e.requirement}`);
    }
    lines.push('');
  }

  lines.push(checklist.summary);

  return lines.join('\n');
}

/**
 * Check if task meets quality expectations
 */
export function checkQualityCompliance(
  task: UnifiedTask,
  completedItems: string[]
): {
  compliant: boolean;
  missingRequired: string[];
  completedCount: number;
  totalRequired: number;
} {
  const checklist = generateQualityChecklist(task);
  const completedSet = new Set(completedItems.map(s => s.toLowerCase()));

  const missingRequired = checklist.criticalItems.filter(
    item => !completedSet.has(item.toLowerCase())
  );

  return {
    compliant: missingRequired.length === 0,
    missingRequired,
    completedCount: completedItems.length,
    totalRequired: checklist.criticalItems.length,
  };
}

/**
 * Check coverage compliance with project-specific thresholds.
 */
export function checkCoverageComplianceWithConfig(
  currentCoverage: number,
  config: { quality: QualityConfig }
): CoverageComplianceResult {
  const thresholds = getCoverageThresholdsFromConfig(config);
  const minimumRequired = thresholds.minimum;
  const gap = minimumRequired - currentCoverage;

  let status: CoverageComplianceResult['status'];
  let message: string;

  if (currentCoverage >= thresholds.excellent) {
    status = 'excellent';
    message = `Excellent! Coverage at ${currentCoverage}% exceeds all thresholds`;
  } else if (currentCoverage >= thresholds.recommended) {
    status = 'recommended';
    message = `Good coverage at ${currentCoverage}%. Consider adding tests to reach ${thresholds.excellent}%`;
  } else if (currentCoverage >= thresholds.minimum) {
    status = 'passing';
    message = `Coverage at ${currentCoverage}% meets minimum. Recommend increasing to ${thresholds.recommended}%`;
  } else {
    status = 'failing';
    message = `Coverage at ${currentCoverage}% is below minimum ${minimumRequired}%. Add ${gap.toFixed(1)}% more coverage to proceed`;
  }

  return {
    compliant: currentCoverage >= minimumRequired,
    currentCoverage,
    minimumRequired,
    gap: Math.max(0, gap),
    status,
    message,
  };
}

/**
 * Generate quality checklist with project-specific configuration.
 */
export function generateQualityChecklistWithConfig(
  task: UnifiedTask,
  config: { quality: QualityConfig }
): QualityChecklist {
  const taskType = inferTaskType(task);
  const fileTypes = task.files ? inferFileTypes(task.files) : new Set<string>();
  const testReqs = getTestRequirementsFromConfig(config)[task.priority] || config.quality.testRequirements.medium;
  const coverageThresholds = getCoverageThresholdsFromConfig(config);

  // Collect all expectations (using config thresholds)
  const allExpectations: QualityExpectation[] = [
    ...getBaseExpectationsWithConfig(taskType, task.priority, config),
    ...getFileTypeExpectations(fileTypes),
    ...getContextExpectations(task),
  ];

  // Deduplicate by requirement text
  const seen = new Set<string>();
  const expectations = allExpectations.filter(e => {
    if (seen.has(e.requirement)) return false;
    seen.add(e.requirement);
    return true;
  });

  // Sort by priority
  expectations.sort((a, b) => {
    const order = { required: 0, recommended: 1, optional: 2 };
    return order[a.priority] - order[b.priority];
  });

  // Extract critical items (required)
  const criticalItems = expectations
    .filter(e => e.priority === 'required')
    .map(e => e.requirement);

  // Generate summary
  const requiredCount = expectations.filter(e => e.priority === 'required').length;
  const recommendedCount = expectations.filter(e => e.priority === 'recommended').length;

  const summary = `${requiredCount} required, ${recommendedCount} recommended quality expectations`;

  // Determine testing requirements based on task type and priority
  const isCodeChange = taskType !== 'docs' && taskType !== 'infra';

  return {
    taskId: task.id,
    expectations,
    summary,
    criticalItems,
    estimatedEffort: task.technicalContext?.estimatedEffort,
    testingRequirements: {
      unitTestsRequired: isCodeChange && testReqs.unit,
      integrationTestsRequired: testReqs.integration,
      e2eTestsRequired: testReqs.e2e,
      minimumCoverage: isCodeChange ? coverageThresholds.minimum : 0,
    },
  };
}

/**
 * Generate base expectations for a task type with project-specific configuration.
 */
function getBaseExpectationsWithConfig(
  taskType: string,
  priority: TaskPriority,
  config: { quality: QualityConfig }
): QualityExpectation[] {
  const expectations: QualityExpectation[] = [];
  const testReqs = getTestRequirementsFromConfig(config)[priority] || config.quality.testRequirements.medium;
  const coverageThresholds = getCoverageThresholdsFromConfig(config);

  // Universal testing expectations - tests are now REQUIRED for all code changes
  if (taskType !== 'docs' && taskType !== 'infra') {
    expectations.push({
      category: 'testing',
      requirement: 'Add unit tests for new/modified functionality',
      priority: 'required',
      rationale: `Unit tests are required for all code changes to maintain coverage above ${coverageThresholds.minimum}%`,
    });

    expectations.push({
      category: 'testing',
      requirement: `Verify test coverage meets minimum threshold (${coverageThresholds.minimum}%)`,
      priority: 'required',
      rationale: 'Coverage below minimum blocks merges',
    });
  }

  // Additional testing by priority
  if (testReqs.integration) {
    expectations.push({
      category: 'testing',
      requirement: 'Add integration tests for cross-component interactions',
      priority: priority === 'critical' ? 'required' : 'recommended',
      rationale: 'High priority tasks need integration test coverage',
    });
  }

  if (testReqs.e2e) {
    expectations.push({
      category: 'testing',
      requirement: 'Add end-to-end tests for critical user flows',
      priority: 'required',
      rationale: 'Critical tasks must have E2E test coverage',
    });
  }

  // Feature-specific testing
  if (taskType === 'feature') {
    expectations.push({
      category: 'testing',
      requirement: 'Ensure all new exports have corresponding test coverage',
      priority: 'required',
      rationale: 'New APIs must be tested before shipping',
    });
  }

  // Bugfix-specific testing
  if (taskType === 'bugfix') {
    expectations.push({
      category: 'testing',
      requirement: 'Add regression test that would have caught this bug',
      priority: 'required',
      rationale: 'Prevents the same bug from recurring',
    });
  }

  // Refactor testing
  if (taskType === 'refactor') {
    expectations.push({
      category: 'testing',
      requirement: 'Ensure all existing tests still pass after refactor',
      priority: 'required',
    });
    expectations.push({
      category: 'testing',
      requirement: 'Add tests for any exposed edge cases',
      priority: 'recommended',
    });
  }

  // Documentation expectations
  if (taskType === 'feature') {
    expectations.push({
      category: 'documentation',
      requirement: 'Add JSDoc/TSDoc comments for new public APIs',
      priority: priority === 'critical' ? 'required' : 'recommended',
    });
  }

  // Security expectations
  if (taskType === 'security') {
    expectations.push({
      category: 'security',
      requirement: 'Validate all user inputs',
      priority: 'required',
    });
    expectations.push({
      category: 'security',
      requirement: 'Ensure no sensitive data is logged',
      priority: 'required',
    });
    expectations.push({
      category: 'review',
      requirement: 'Request security review before merging',
      priority: 'required',
    });
  }

  // Code quality expectations
  expectations.push({
    category: 'code-quality',
    requirement: 'Ensure TypeScript compilation passes without errors',
    priority: 'required',
  });
  expectations.push({
    category: 'code-quality',
    requirement: 'Run linter and fix any issues',
    priority: 'required',
  });

  return expectations;
}
