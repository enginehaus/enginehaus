/**
 * Phase-Based Workflow System
 *
 * Enforces an 8-phase progression for task implementation:
 * 1. Context & Planning - Understand requirements, gather context
 * 2. Architecture - Design solution, make technical decisions
 * 3. Core Implementation - Build primary functionality
 * 4. Integration - Connect components, wire up dependencies
 * 5. Testing - Add tests, verify behavior
 * 6. Documentation - Update docs, add comments
 * 7. Review - Self-review, address issues
 * 8. Deployment - Final checks, merge preparation
 *
 * Features:
 * - Auto-commit at phase boundaries
 * - Phase cannot be skipped without explicit override
 * - Progress tracking with visual indicators
 *
 * Phase definitions are now configurable via the configuration system.
 * Use DEFAULT_PHASES from config/types.ts for default values.
 */

import { DEFAULT_PHASES, PhaseDefinition } from '../config/types.js';

// Phase type with required description for backward compatibility
// (PhaseDefinition has optional description, but Phase uses it required)
export interface Phase {
  id: number;
  name: string;
  shortName: string;
  description: string;  // Required in Phase
  commitPrefix: string;
  requiredOutputs: string[];
  canSkip: boolean;
}

export interface PhaseProgress {
  currentPhase: number;
  completedPhases: number[];
  skippedPhases: number[];
  phaseNotes: Record<number, string>;
  phaseStartTimes: Record<number, Date>;
  phaseEndTimes: Record<number, Date>;
  /** Commit SHA recorded at each phase completion - links phases to specific commits */
  phaseCommits: Record<number, string>;
}

/**
 * Default phases from configuration.
 * Use getConfigurablePhases() with a ConfigurationManager for project-specific phases.
 */
export const PHASES: Phase[] = DEFAULT_PHASES.map(p => ({
  ...p,
  description: p.description || '',
  requiredOutputs: p.requiredOutputs || [],
}));

/**
 * Get phase by ID
 */
export function getPhase(id: number): Phase | undefined {
  return PHASES.find(p => p.id === id);
}

/**
 * Get next phase after current
 */
export function getNextPhase(currentPhaseId: number): Phase | undefined {
  const currentIndex = PHASES.findIndex(p => p.id === currentPhaseId);
  if (currentIndex === -1 || currentIndex >= PHASES.length - 1) {
    return undefined;
  }
  return PHASES[currentIndex + 1];
}

/**
 * Check if phase can be skipped
 */
export function canSkipPhase(phaseId: number): boolean {
  const phase = getPhase(phaseId);
  return phase?.canSkip ?? false;
}

/**
 * Create initial phase progress
 */
export function createPhaseProgress(): PhaseProgress {
  return {
    currentPhase: 1,
    completedPhases: [],
    skippedPhases: [],
    phaseNotes: {},
    phaseStartTimes: { 1: new Date() },
    phaseEndTimes: {},
    phaseCommits: {},
  };
}

/**
 * Advance to next phase
 * @param progress Current phase progress
 * @param commitSha Git commit SHA for this phase completion (required for git protocol)
 * @param note Optional note about the phase completion
 * @param protocol Checkpoint protocol: 'git' (default) requires commit SHA, 'manual' uses timestamp
 */
export function advancePhase(
  progress: PhaseProgress,
  commitSha?: string,
  note?: string,
  protocol?: 'git' | 'manual',
): { progress: PhaseProgress; phase: Phase | undefined; isComplete: boolean; error?: string } {
  const effectiveProtocol = protocol || 'git';

  if (effectiveProtocol === 'git') {
    // Validate commitSha is provided and looks like a SHA
    if (!commitSha || commitSha.trim().length === 0) {
      return {
        progress,
        phase: getPhase(progress.currentPhase),
        isComplete: false,
        error: 'Commit SHA is required to advance phase. Commit your work before proceeding.',
      };
    }

    // Basic SHA validation (at least 7 chars, hex only)
    const trimmedSha = commitSha.trim();
    if (!/^[a-f0-9]{7,40}$/i.test(trimmedSha)) {
      return {
        progress,
        phase: getPhase(progress.currentPhase),
        isComplete: false,
        error: `Invalid commit SHA format: "${trimmedSha}". Expected 7-40 hex characters.`,
      };
    }
  }

  const checkpoint = effectiveProtocol === 'manual'
    ? new Date().toISOString()
    : commitSha!.trim();

  const currentPhase = getPhase(progress.currentPhase);
  if (!currentPhase) {
    return { progress, phase: undefined, isComplete: true };
  }

  // Mark current phase as completed with checkpoint (commit SHA or timestamp)
  const updatedProgress: PhaseProgress = {
    ...progress,
    completedPhases: [...progress.completedPhases, progress.currentPhase],
    phaseEndTimes: {
      ...progress.phaseEndTimes,
      [progress.currentPhase]: new Date(),
    },
    phaseCommits: {
      ...progress.phaseCommits,
      [progress.currentPhase]: checkpoint,
    },
  };

  if (note) {
    updatedProgress.phaseNotes = {
      ...updatedProgress.phaseNotes,
      [progress.currentPhase]: note,
    };
  }

  // Get next phase
  const nextPhase = getNextPhase(progress.currentPhase);
  if (!nextPhase) {
    // All phases complete
    return { progress: updatedProgress, phase: undefined, isComplete: true };
  }

  // Move to next phase
  updatedProgress.currentPhase = nextPhase.id;
  updatedProgress.phaseStartTimes = {
    ...updatedProgress.phaseStartTimes,
    [nextPhase.id]: new Date(),
  };

  return { progress: updatedProgress, phase: nextPhase, isComplete: false };
}

/**
 * Skip current phase (if allowed)
 */
export function skipPhase(
  progress: PhaseProgress,
  force: boolean = false
): { progress: PhaseProgress; phase: Phase | undefined; skipped: boolean; error?: string } {
  const currentPhase = getPhase(progress.currentPhase);
  if (!currentPhase) {
    return { progress, phase: undefined, skipped: false, error: 'Invalid phase' };
  }

  if (!currentPhase.canSkip && !force) {
    return {
      progress,
      phase: currentPhase,
      skipped: false,
      error: `Phase "${currentPhase.name}" cannot be skipped. Use force=true to override.`,
    };
  }

  // Mark as skipped
  const updatedProgress: PhaseProgress = {
    ...progress,
    skippedPhases: [...progress.skippedPhases, progress.currentPhase],
    phaseEndTimes: {
      ...progress.phaseEndTimes,
      [progress.currentPhase]: new Date(),
    },
  };

  // Get next phase
  const nextPhase = getNextPhase(progress.currentPhase);
  if (!nextPhase) {
    return { progress: updatedProgress, phase: undefined, skipped: true };
  }

  updatedProgress.currentPhase = nextPhase.id;
  updatedProgress.phaseStartTimes = {
    ...updatedProgress.phaseStartTimes,
    [nextPhase.id]: new Date(),
  };

  return { progress: updatedProgress, phase: nextPhase, skipped: true };
}

/**
 * Generate commit message for phase completion
 */
export function generatePhaseCommitMessage(
  taskTitle: string,
  phase: Phase,
  note?: string
): string {
  const sanitizedTitle = taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const noteText = note ? `: ${note}` : '';
  return `${phase.commitPrefix}(${sanitizedTitle}): Phase ${phase.id} - ${phase.name}${noteText}`;
}

/**
 * Get visual progress indicator
 */
export function getProgressIndicator(progress: PhaseProgress): string {
  const indicators = PHASES.map(phase => {
    if (progress.completedPhases.includes(phase.id)) {
      return `[${phase.shortName}]`; // Completed
    } else if (progress.skippedPhases.includes(phase.id)) {
      return `(${phase.shortName})`; // Skipped
    } else if (phase.id === progress.currentPhase) {
      return `>${phase.shortName}<`; // Current
    } else {
      return ` ${phase.shortName} `; // Pending
    }
  });

  return indicators.join(' ');
}

/**
 * Get detailed progress summary
 */
export function getProgressSummary(progress: PhaseProgress): {
  indicator: string;
  currentPhase: Phase | undefined;
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  nextPhase: Phase | undefined;
} {
  const currentPhase = getPhase(progress.currentPhase);
  const nextPhase = currentPhase ? getNextPhase(progress.currentPhase) : undefined;
  const completedCount = progress.completedPhases.length + progress.skippedPhases.length;

  return {
    indicator: getProgressIndicator(progress),
    currentPhase,
    completedCount,
    totalCount: PHASES.length,
    percentComplete: Math.round((completedCount / PHASES.length) * 100),
    nextPhase,
  };
}

/**
 * Serialize phase progress for storage
 */
export function serializePhaseProgress(progress: PhaseProgress): string {
  return JSON.stringify({
    ...progress,
    phaseStartTimes: Object.fromEntries(
      Object.entries(progress.phaseStartTimes).map(([k, v]) => [k, v.toISOString()])
    ),
    phaseEndTimes: Object.fromEntries(
      Object.entries(progress.phaseEndTimes).map(([k, v]) => [k, v.toISOString()])
    ),
  });
}

/**
 * Deserialize phase progress from storage
 */
export function deserializePhaseProgress(json: string): PhaseProgress {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return createPhaseProgress();
  }
  return {
    ...parsed,
    phaseStartTimes: Object.fromEntries(
      Object.entries(parsed.phaseStartTimes || {}).map(([k, v]) => [k, new Date(v as string)])
    ),
    phaseEndTimes: Object.fromEntries(
      Object.entries(parsed.phaseEndTimes || {}).map(([k, v]) => [k, new Date(v as string)])
    ),
  };
}

// ============================================================================
// Configurable Phase Functions
// ============================================================================

/**
 * Get phases from a configuration.
 * Use this when you have access to a resolved config for project-specific phases.
 */
export function getPhasesFromConfig(config: { workflow: { phases: { enabled: boolean; definition: string; custom?: { phases: PhaseDefinition[] } } } }): Phase[] {
  if (!config.workflow.phases.enabled) {
    return [];
  }

  if (config.workflow.phases.definition === 'custom' && config.workflow.phases.custom) {
    return config.workflow.phases.custom.phases.map(p => ({
      ...p,
      description: p.description || '',
      requiredOutputs: p.requiredOutputs || [],
    }));
  }

  return PHASES;
}

/**
 * Get phase by ID from a custom phase array
 */
export function getPhaseFromArray(phases: Phase[], id: number): Phase | undefined {
  return phases.find(p => p.id === id);
}

/**
 * Get next phase from a custom phase array
 */
export function getNextPhaseFromArray(phases: Phase[], currentPhaseId: number): Phase | undefined {
  const currentIndex = phases.findIndex(p => p.id === currentPhaseId);
  if (currentIndex === -1 || currentIndex >= phases.length - 1) {
    return undefined;
  }
  return phases[currentIndex + 1];
}

/**
 * Get progress summary with custom phases
 */
export function getProgressSummaryWithPhases(progress: PhaseProgress, phases: Phase[]): {
  indicator: string;
  currentPhase: Phase | undefined;
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  nextPhase: Phase | undefined;
} {
  const currentPhase = getPhaseFromArray(phases, progress.currentPhase);
  const nextPhase = currentPhase ? getNextPhaseFromArray(phases, progress.currentPhase) : undefined;
  const completedCount = progress.completedPhases.length + progress.skippedPhases.length;

  // Generate indicator with provided phases
  const indicators = phases.map(phase => {
    if (progress.completedPhases.includes(phase.id)) {
      return `[${phase.shortName}]`;
    } else if (progress.skippedPhases.includes(phase.id)) {
      return `(${phase.shortName})`;
    } else if (phase.id === progress.currentPhase) {
      return `>${phase.shortName}<`;
    } else {
      return ` ${phase.shortName} `;
    }
  });

  return {
    indicator: indicators.join(' '),
    currentPhase,
    completedCount,
    totalCount: phases.length,
    percentComplete: Math.round((completedCount / phases.length) * 100),
    nextPhase,
  };
}
