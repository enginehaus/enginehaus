import { describe, it, expect } from 'vitest';
import {
  PHASES,
  getPhase,
  getNextPhase,
  canSkipPhase,
  createPhaseProgress,
  advancePhase,
  skipPhase,
  generatePhaseCommitMessage,
  getProgressIndicator,
  getProgressSummary,
  serializePhaseProgress,
  deserializePhaseProgress,
  Phase,
  PhaseProgress,
} from '../../src/coordination/phases.js';

describe('Phase System', () => {
  describe('PHASES constant', () => {
    it('should have 8 phases', () => {
      expect(PHASES.length).toBe(8);
    });

    it('should have phases with sequential IDs from 1-8', () => {
      const ids = PHASES.map(p => p.id);
      expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('should have required phases that cannot be skipped', () => {
      const requiredPhases = PHASES.filter(p => !p.canSkip);
      expect(requiredPhases.length).toBe(4);
      expect(requiredPhases.map(p => p.id)).toEqual([1, 3, 5, 8]); // Planning, Implementation, Testing, Deployment
    });

    it('should have optional phases that can be skipped', () => {
      const optionalPhases = PHASES.filter(p => p.canSkip);
      expect(optionalPhases.length).toBe(4);
      expect(optionalPhases.map(p => p.id)).toEqual([2, 4, 6, 7]); // Architecture, Integration, Docs, Review
    });
  });

  describe('getPhase', () => {
    it('should return phase by ID', () => {
      const phase = getPhase(1);
      expect(phase?.name).toBe('Context & Planning');
    });

    it('should return undefined for invalid ID', () => {
      expect(getPhase(0)).toBeUndefined();
      expect(getPhase(9)).toBeUndefined();
      expect(getPhase(-1)).toBeUndefined();
    });

    it('should return all phases correctly', () => {
      for (const expectedPhase of PHASES) {
        const phase = getPhase(expectedPhase.id);
        expect(phase).toEqual(expectedPhase);
      }
    });
  });

  describe('getNextPhase', () => {
    it('should return next phase', () => {
      expect(getNextPhase(1)?.id).toBe(2);
      expect(getNextPhase(4)?.id).toBe(5);
      expect(getNextPhase(7)?.id).toBe(8);
    });

    it('should return undefined for last phase', () => {
      expect(getNextPhase(8)).toBeUndefined();
    });

    it('should return undefined for invalid phase', () => {
      expect(getNextPhase(0)).toBeUndefined();
      expect(getNextPhase(9)).toBeUndefined();
    });
  });

  describe('canSkipPhase', () => {
    it('should return true for skippable phases', () => {
      expect(canSkipPhase(2)).toBe(true); // Architecture
      expect(canSkipPhase(4)).toBe(true); // Integration
      expect(canSkipPhase(6)).toBe(true); // Documentation
      expect(canSkipPhase(7)).toBe(true); // Review
    });

    it('should return false for required phases', () => {
      expect(canSkipPhase(1)).toBe(false); // Planning
      expect(canSkipPhase(3)).toBe(false); // Implementation
      expect(canSkipPhase(5)).toBe(false); // Testing
      expect(canSkipPhase(8)).toBe(false); // Deployment
    });

    it('should return false for invalid phase', () => {
      expect(canSkipPhase(0)).toBe(false);
      expect(canSkipPhase(9)).toBe(false);
    });
  });

  describe('createPhaseProgress', () => {
    it('should create initial progress at phase 1', () => {
      const progress = createPhaseProgress();
      expect(progress.currentPhase).toBe(1);
    });

    it('should have empty completed and skipped arrays', () => {
      const progress = createPhaseProgress();
      expect(progress.completedPhases).toEqual([]);
      expect(progress.skippedPhases).toEqual([]);
    });

    it('should have phase 1 start time', () => {
      const before = new Date();
      const progress = createPhaseProgress();
      const after = new Date();

      expect(progress.phaseStartTimes[1]).toBeDefined();
      expect(progress.phaseStartTimes[1].getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(progress.phaseStartTimes[1].getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should have empty phase notes, end times, and commits', () => {
      const progress = createPhaseProgress();
      expect(progress.phaseNotes).toEqual({});
      expect(progress.phaseEndTimes).toEqual({});
      expect(progress.phaseCommits).toEqual({});
    });
  });

  describe('advancePhase', () => {
    it('should advance from phase 1 to phase 2', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, 'abc1234');

      expect(result.progress.currentPhase).toBe(2);
      expect(result.progress.completedPhases).toContain(1);
      expect(result.phase?.id).toBe(2);
      expect(result.isComplete).toBe(false);
    });

    it('should record commit SHA', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, 'def5678');

      expect(result.progress.phaseCommits[1]).toBe('def5678');
    });

    it('should record optional note', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, 'abc1234', 'Initial planning complete');

      expect(result.progress.phaseNotes[1]).toBe('Initial planning complete');
    });

    it('should mark phase as complete with end time', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, 'abc1234');

      expect(result.progress.phaseEndTimes[1]).toBeDefined();
    });

    it('should start next phase with start time', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, 'abc1234');

      expect(result.progress.phaseStartTimes[2]).toBeDefined();
    });

    it('should error on empty commit SHA', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, '');

      expect(result.error).toContain('Commit SHA is required');
      expect(result.progress.currentPhase).toBe(1);
    });

    it('should error on invalid commit SHA format', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, 'not-a-sha!');

      expect(result.error).toContain('Invalid commit SHA format');
    });

    it('should accept 7-character short SHA', () => {
      const progress = createPhaseProgress();
      const result = advancePhase(progress, 'abc1234');

      expect(result.error).toBeUndefined();
      expect(result.progress.phaseCommits[1]).toBe('abc1234');
    });

    it('should accept 40-character full SHA', () => {
      const progress = createPhaseProgress();
      const fullSha = 'a'.repeat(40);
      const result = advancePhase(progress, fullSha);

      expect(result.error).toBeUndefined();
      expect(result.progress.phaseCommits[1]).toBe(fullSha);
    });

    it('should return isComplete true after phase 8', () => {
      let progress = createPhaseProgress();

      // Advance through all 8 phases (use valid hex SHAs)
      for (let i = 1; i <= 8; i++) {
        expect(progress.currentPhase).toBe(i);
        const result = advancePhase(progress, `abcdef${i}`);
        progress = result.progress;

        if (i === 8) {
          expect(result.isComplete).toBe(true);
          expect(result.phase).toBeUndefined();
        } else {
          expect(result.isComplete).toBe(false);
          expect(result.phase?.id).toBe(i + 1);
        }
      }
    });
  });

  describe('skipPhase', () => {
    it('should skip skippable phase', () => {
      let progress = createPhaseProgress();
      // Advance to phase 2 (Architecture - skippable)
      progress = advancePhase(progress, 'abc1234').progress;

      const result = skipPhase(progress);

      expect(result.skipped).toBe(true);
      expect(result.progress.currentPhase).toBe(3);
      expect(result.progress.skippedPhases).toContain(2);
    });

    it('should not skip required phase without force', () => {
      const progress = createPhaseProgress();
      const result = skipPhase(progress);

      expect(result.skipped).toBe(false);
      expect(result.error).toContain('cannot be skipped');
      expect(result.progress.currentPhase).toBe(1);
    });

    it('should skip required phase with force', () => {
      const progress = createPhaseProgress();
      const result = skipPhase(progress, true);

      expect(result.skipped).toBe(true);
      expect(result.progress.currentPhase).toBe(2);
      expect(result.progress.skippedPhases).toContain(1);
    });

    it('should record skip end time', () => {
      let progress = createPhaseProgress();
      progress = advancePhase(progress, 'abc1234').progress;

      const result = skipPhase(progress);

      expect(result.progress.phaseEndTimes[2]).toBeDefined();
    });

    it('should set next phase start time', () => {
      let progress = createPhaseProgress();
      progress = advancePhase(progress, 'abc1234').progress;

      const result = skipPhase(progress);

      expect(result.progress.phaseStartTimes[3]).toBeDefined();
    });

    it('should handle skipping last phase', () => {
      // Start at phase 8
      let progress: PhaseProgress = {
        ...createPhaseProgress(),
        currentPhase: 8,
        completedPhases: [1, 2, 3, 4, 5, 6, 7],
        skippedPhases: [],
        phaseNotes: {},
        phaseStartTimes: { 8: new Date() },
        phaseEndTimes: {},
        phaseCommits: {},
      };

      const result = skipPhase(progress, true);

      expect(result.skipped).toBe(true);
      expect(result.phase).toBeUndefined();
    });
  });

  describe('generatePhaseCommitMessage', () => {
    it('should generate commit message with phase prefix', () => {
      const phase = PHASES[0]; // Planning
      const message = generatePhaseCommitMessage('Add User Auth', phase);

      expect(message).toContain('plan(');
      expect(message).toContain('Phase 1');
      expect(message).toContain('Context & Planning');
    });

    it('should sanitize task title', () => {
      const phase = PHASES[2]; // Implementation
      const message = generatePhaseCommitMessage('Add User@Auth!System', phase);

      expect(message).toContain('feat(add-user-auth-system)');
    });

    it('should truncate long task titles', () => {
      const phase = PHASES[0];
      const longTitle = 'A'.repeat(100);
      const message = generatePhaseCommitMessage(longTitle, phase);

      expect(message.length).toBeLessThan(150);
    });

    it('should include note when provided', () => {
      const phase = PHASES[0];
      const message = generatePhaseCommitMessage('Task', phase, 'Custom note here');

      expect(message).toContain(': Custom note here');
    });

    it('should not include colon when no note', () => {
      const phase = PHASES[0];
      const message = generatePhaseCommitMessage('Task', phase);

      expect(message.endsWith('Planning')).toBe(true);
    });
  });

  describe('getProgressIndicator', () => {
    it('should show current phase with angle brackets', () => {
      const progress = createPhaseProgress();
      const indicator = getProgressIndicator(progress);

      expect(indicator).toContain('>PLAN<');
    });

    it('should show completed phases in brackets', () => {
      let progress = createPhaseProgress();
      progress = advancePhase(progress, 'abc1234').progress;

      const indicator = getProgressIndicator(progress);

      expect(indicator).toContain('[PLAN]');
      expect(indicator).toContain('>ARCH<');
    });

    it('should show skipped phases in parentheses', () => {
      let progress = createPhaseProgress();
      progress = advancePhase(progress, 'abc1234').progress;
      progress = skipPhase(progress).progress;

      const indicator = getProgressIndicator(progress);

      expect(indicator).toContain('(ARCH)');
    });

    it('should show pending phases with spaces', () => {
      const progress = createPhaseProgress();
      const indicator = getProgressIndicator(progress);

      expect(indicator).toContain(' ARCH ');
      expect(indicator).toContain(' IMPL ');
    });
  });

  describe('getProgressSummary', () => {
    it('should return correct initial summary', () => {
      const progress = createPhaseProgress();
      const summary = getProgressSummary(progress);

      expect(summary.currentPhase?.id).toBe(1);
      expect(summary.completedCount).toBe(0);
      expect(summary.totalCount).toBe(8);
      expect(summary.percentComplete).toBe(0);
      expect(summary.nextPhase?.id).toBe(2);
    });

    it('should calculate percent complete correctly', () => {
      let progress = createPhaseProgress();
      // Advance phase 1 -> now at phase 2 (use valid hex SHA)
      progress = advancePhase(progress, 'abc1234').progress;
      // Advance phase 2 -> now at phase 3
      progress = advancePhase(progress, 'def5678').progress;

      const summary = getProgressSummary(progress);

      expect(summary.completedCount).toBe(2);
      expect(summary.currentPhase?.id).toBe(3);
      expect(summary.percentComplete).toBe(25); // 2/8 = 25%
    });

    it('should include skipped phases in completed count', () => {
      let progress = createPhaseProgress();
      // Advance from phase 1 to 2 (use valid hex SHA)
      progress = advancePhase(progress, 'abc1234').progress;
      expect(progress.currentPhase).toBe(2);

      // Skip phase 2 (Architecture is skippable)
      progress = skipPhase(progress).progress;
      expect(progress.currentPhase).toBe(3);

      const summary = getProgressSummary(progress);

      expect(summary.completedCount).toBe(2); // 1 completed + 1 skipped
      expect(progress.completedPhases).toEqual([1]);
      expect(progress.skippedPhases).toEqual([2]);
    });

    it('should include progress indicator', () => {
      const progress = createPhaseProgress();
      const summary = getProgressSummary(progress);

      expect(summary.indicator).toContain('>PLAN<');
    });
  });

  describe('serializePhaseProgress', () => {
    it('should serialize to valid JSON', () => {
      const progress = createPhaseProgress();
      const json = serializePhaseProgress(progress);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should convert dates to ISO strings', () => {
      const progress = createPhaseProgress();
      const json = serializePhaseProgress(progress);
      const parsed = JSON.parse(json);

      expect(typeof parsed.phaseStartTimes['1']).toBe('string');
      expect(parsed.phaseStartTimes['1']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('deserializePhaseProgress', () => {
    it('should deserialize back to PhaseProgress', () => {
      const original = createPhaseProgress();
      const json = serializePhaseProgress(original);
      const restored = deserializePhaseProgress(json);

      expect(restored.currentPhase).toBe(original.currentPhase);
      expect(restored.completedPhases).toEqual(original.completedPhases);
    });

    it('should restore dates as Date objects', () => {
      const original = createPhaseProgress();
      const json = serializePhaseProgress(original);
      const restored = deserializePhaseProgress(json);

      expect(restored.phaseStartTimes[1]).toBeInstanceOf(Date);
    });

    it('should handle complex progress state', () => {
      let progress = createPhaseProgress();
      // Phase 1 -> 2 (use valid hex SHA)
      progress = advancePhase(progress, 'abc1234', 'Planning done').progress;
      expect(progress.currentPhase).toBe(2);

      // Skip phase 2 -> 3
      progress = skipPhase(progress).progress;
      expect(progress.currentPhase).toBe(3);

      // Phase 3 -> 4
      progress = advancePhase(progress, 'def5678').progress;
      expect(progress.currentPhase).toBe(4);

      const json = serializePhaseProgress(progress);
      const restored = deserializePhaseProgress(json);

      expect(restored.currentPhase).toBe(4);
      expect(restored.completedPhases).toEqual([1, 3]);
      expect(restored.skippedPhases).toEqual([2]);
      expect(restored.phaseNotes[1]).toBe('Planning done');
      expect(restored.phaseCommits[1]).toBe('abc1234');
    });
  });

  describe('Full workflow integration', () => {
    it('should complete all 8 phases', () => {
      let progress = createPhaseProgress();
      const commitShas: string[] = [];

      for (let i = 1; i <= 8; i++) {
        const sha = `abc${i.toString().padStart(4, '0')}`;
        commitShas.push(sha);
        const result = advancePhase(progress, sha, `Phase ${i} complete`);
        progress = result.progress;

        if (i < 8) {
          expect(result.isComplete).toBe(false);
          expect(result.phase?.id).toBe(i + 1);
        } else {
          expect(result.isComplete).toBe(true);
          expect(result.phase).toBeUndefined();
        }
      }

      expect(progress.completedPhases).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(progress.skippedPhases).toEqual([]);
      expect(Object.keys(progress.phaseCommits).length).toBe(8);
    });

    it('should complete workflow with skipped optional phases', () => {
      let progress = createPhaseProgress();
      expect(progress.currentPhase).toBe(1);

      // Phase 1: Complete (required) -> now at 2 (use valid hex SHAs)
      progress = advancePhase(progress, 'aaa1111').progress;
      expect(progress.currentPhase).toBe(2);

      // Phase 2: Skip (optional) -> now at 3
      progress = skipPhase(progress).progress;
      expect(progress.currentPhase).toBe(3);

      // Phase 3: Complete (required) -> now at 4
      progress = advancePhase(progress, 'bbb3333').progress;
      expect(progress.currentPhase).toBe(4);

      // Phase 4: Skip (optional) -> now at 5
      progress = skipPhase(progress).progress;
      expect(progress.currentPhase).toBe(5);

      // Phase 5: Complete (required) -> now at 6
      progress = advancePhase(progress, 'ccc5555').progress;
      expect(progress.currentPhase).toBe(6);

      // Phase 6: Skip (optional) -> now at 7
      progress = skipPhase(progress).progress;
      expect(progress.currentPhase).toBe(7);

      // Phase 7: Skip (optional) -> now at 8
      progress = skipPhase(progress).progress;
      expect(progress.currentPhase).toBe(8);

      // Phase 8: Complete (required) -> workflow complete
      const result = advancePhase(progress, 'ddd8888');

      expect(result.isComplete).toBe(true);
      expect(result.progress.completedPhases).toEqual([1, 3, 5, 8]);
      expect(result.progress.skippedPhases).toEqual([2, 4, 6, 7]);
    });
  });
});
