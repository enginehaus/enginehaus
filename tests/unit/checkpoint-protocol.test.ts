import { describe, it, expect } from 'vitest';
import { advancePhase, createPhaseProgress } from '../../src/coordination/phases.js';

describe('Checkpoint Protocol', () => {
  it('advances phase with commitSha when protocol is git', () => {
    const progress = createPhaseProgress();
    const result = advancePhase(progress, 'abc1234', undefined, 'git');
    expect(result.error).toBeUndefined();
    expect(result.progress.currentPhase).toBe(2);
    expect(result.progress.phaseCommits[1]).toBe('abc1234');
  });

  it('rejects missing commitSha when protocol is git', () => {
    const progress = createPhaseProgress();
    const result = advancePhase(progress, '', undefined, 'git');
    expect(result.error).toContain('Commit SHA is required');
  });

  it('advances phase without commitSha when protocol is manual', () => {
    const progress = createPhaseProgress();
    const result = advancePhase(progress, undefined, 'Completed research phase', 'manual');
    expect(result.error).toBeUndefined();
    expect(result.progress.currentPhase).toBe(2);
    // Manual protocol stores ISO timestamp instead of commit SHA
    expect(result.progress.phaseCommits[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults to git protocol when not specified', () => {
    const progress = createPhaseProgress();
    const result = advancePhase(progress, '', undefined, undefined);
    expect(result.error).toContain('Commit SHA is required');
  });

  it('stores note when advancing with manual protocol', () => {
    const progress = createPhaseProgress();
    const result = advancePhase(progress, undefined, 'Research complete', 'manual');
    expect(result.progress.phaseNotes[1]).toBe('Research complete');
  });
});
