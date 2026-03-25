/**
 * PhaseService — extracted from CoordinationService
 *
 * Phase workflow management: start, advance, skip, and query phase progress.
 */

import type { ServiceContext } from './service-context.js';
import { audit } from './service-context.js';
import {
  createPhaseProgress,
  advancePhase,
  skipPhase,
  getPhase,
  getProgressSummary,
  generatePhaseCommitMessage,
  PHASES,
} from '../../coordination/phases.js';
import type { CheckpointType, CheckpointOption } from '../../coordination/types.js';

/**
 * Callback for cross-service calls from PhaseService to CheckpointService.
 * This avoids circular dependencies between services.
 */
export interface PhaseCheckpointCallback {
  requestHumanInput(params: {
    taskId: string;
    type: CheckpointType;
    reason: string;
    question?: string;
    options?: CheckpointOption[];
    context?: string;
    requestedBy: string;
    phase?: number;
  }): Promise<{ success: boolean; checkpointId?: string }>;
}

export class PhaseService {
  private checkpointCallback?: PhaseCheckpointCallback;

  constructor(private ctx: ServiceContext) {}

  /** Set the checkpoint callback for cross-service calls */
  setCheckpointCallback(callback: PhaseCheckpointCallback): void {
    this.checkpointCallback = callback;
  }

  async getTaskPhase(taskId: string): Promise<{
    success: boolean;
    task?: { id: string; title: string };
    hasPhaseProgress: boolean;
    progress?: {
      indicator: string;
      currentPhase: { id: number; name: string; description: string } | null;
      completedCount: number;
      totalCount: number;
      percentComplete: number;
      nextPhase: { id: number; name: string } | null;
    };
    completedPhases?: number[];
    skippedPhases?: number[];
    phaseNotes?: Record<number, string>;
    phaseCommits?: Record<number, string>;
    message?: string;
  }> {
    const task = await this.ctx.storage.getTask(taskId);
    if (!task) {
      return { success: false, hasPhaseProgress: false, message: `Task not found: ${taskId}` };
    }

    const phaseProgress = task.implementation?.phaseProgress;
    if (!phaseProgress) {
      return {
        success: true,
        task: { id: task.id, title: task.title },
        hasPhaseProgress: false,
        message: 'Phase workflow not started for this task. Use startTaskPhases to begin.',
      };
    }

    const summary = getProgressSummary(phaseProgress);

    return {
      success: true,
      task: { id: task.id, title: task.title },
      hasPhaseProgress: true,
      progress: {
        indicator: summary.indicator,
        currentPhase: summary.currentPhase ? {
          id: summary.currentPhase.id,
          name: summary.currentPhase.name,
          description: summary.currentPhase.description,
        } : null,
        completedCount: summary.completedCount,
        totalCount: summary.totalCount,
        percentComplete: summary.percentComplete,
        nextPhase: summary.nextPhase ? {
          id: summary.nextPhase.id,
          name: summary.nextPhase.name,
        } : null,
      },
      completedPhases: phaseProgress.completedPhases,
      skippedPhases: phaseProgress.skippedPhases,
      phaseNotes: phaseProgress.phaseNotes,
      phaseCommits: phaseProgress.phaseCommits,
    };
  }

  async startTaskPhases(taskId: string): Promise<{
    success: boolean;
    task?: { id: string; title: string };
    currentPhase?: { id: number; name: string; description: string };
    indicator?: string;
    message?: string;
  }> {
    const task = await this.ctx.storage.getTask(taskId);
    if (!task) {
      return { success: false, message: `Task not found: ${taskId}` };
    }

    if (task.implementation?.phaseProgress) {
      return {
        success: false,
        message: 'Phase workflow already started for this task. Use getTaskPhase to check progress.',
      };
    }

    const phaseProgress = createPhaseProgress();
    const implementation = {
      ...task.implementation,
      phaseProgress,
      startedAt: task.implementation?.startedAt || new Date(),
    };

    await this.ctx.storage.updateTask(task.id, { implementation });

    const firstPhase = getPhase(1);

    await audit(this.ctx.storage, 'task.phases_started', task.projectId, 'task', taskId, `Phase workflow started for: ${task.title}`, { metadata: { firstPhase: firstPhase?.name } });

    if (this.ctx.events) {
      await this.ctx.events.emitPhaseAdvanced(taskId, firstPhase?.name || 'Context & Planning', 1, 'none', task.projectId);
    }

    return {
      success: true,
      task: { id: task.id, title: task.title },
      currentPhase: firstPhase ? {
        id: firstPhase.id,
        name: firstPhase.name,
        description: firstPhase.description,
      } : undefined,
      indicator: getProgressSummary(phaseProgress).indicator,
      message: 'Phase workflow started',
    };
  }

  async advanceTaskPhase(
    taskId: string,
    commitSha: string,
    note?: string,
    role?: string
  ): Promise<{
    success: boolean;
    task?: { id: string; title: string };
    completedPhase?: { id: number; name: string };
    commitSha?: string;
    nextPhase?: { id: number; name: string; description: string } | null;
    isComplete?: boolean;
    suggestedCommitMessage?: string | null;
    progress?: { indicator: string; percentComplete: number };
    phaseHistory?: Record<number, string>;
    message?: string;
    hint?: string;
    role?: string;
  }> {
    const task = await this.ctx.storage.getTask(taskId);
    if (!task) {
      return { success: false, message: `Task not found: ${taskId}` };
    }

    if (!task.implementation?.phaseProgress) {
      return {
        success: false,
        message: 'Phase workflow not started. Use startTaskPhases first.',
      };
    }

    const currentPhase = getPhase(task.implementation.phaseProgress.currentPhase);
    const result = advancePhase(task.implementation.phaseProgress, commitSha, note);

    if (result.error) {
      return {
        success: false,
        message: result.error,
        hint: 'Commit your work first: git add . && git commit -m "your message"',
      };
    }

    // Check if next phase requires human approval (checkpoint)
    const nextPhaseId = result.phase?.id;
    if (nextPhaseId && task.checkpointPhases?.includes(nextPhaseId) && this.checkpointCallback) {
      const checkpointResult = await this.checkpointCallback.requestHumanInput({
        taskId: task.id,
        type: 'phase-gate',
        reason: `Phase ${nextPhaseId} (${result.phase?.name}) requires human approval before proceeding`,
        question: `Approve advancing to Phase ${nextPhaseId}: ${result.phase?.name}?`,
        context: `Completed Phase ${currentPhase?.id}: ${currentPhase?.name}. Commit: ${commitSha}`,
        requestedBy: 'system',
        phase: nextPhaseId,
        options: [
          { id: 'approve', label: 'Approve', description: 'Proceed to next phase', action: 'approve' },
          { id: 'reject', label: 'Reject', description: 'Review needed before proceeding', action: 'reject' },
        ],
      });

      if (checkpointResult.success) {
        return {
          success: true,
          task: { id: task.id, title: task.title },
          completedPhase: currentPhase ? { id: currentPhase.id, name: currentPhase.name } : undefined,
          commitSha,
          nextPhase: result.phase ? {
            id: result.phase.id,
            name: result.phase.name,
            description: result.phase.description,
          } : null,
          message: `Phase ${currentPhase?.id} completed. Awaiting human approval for Phase ${nextPhaseId}.`,
          hint: `Use provide_human_input with checkpoint ID: ${checkpointResult.checkpointId}`,
          role: role || 'developer',
        };
      }
    }

    const commitMessage = currentPhase
      ? generatePhaseCommitMessage(task.title, currentPhase, note)
      : null;

    const implementation = {
      ...task.implementation,
      phaseProgress: result.progress,
      completedAt: result.isComplete ? new Date() : undefined,
    };

    await this.ctx.storage.updateTask(task.id, { implementation });

    await audit(this.ctx.storage, 'task.phase_advanced', task.projectId, 'task', taskId, `Phase advanced: ${currentPhase?.name} → ${result.phase?.name || 'complete'}`, { metadata: { commitSha, note, completedPhaseId: currentPhase?.id, nextPhaseId: result.phase?.id, isComplete: result.isComplete } });

    if (this.ctx.events) {
      await this.ctx.events.emitPhaseAdvanced(
        taskId,
        result.phase?.name || 'complete',
        result.phase?.id || currentPhase?.id || 0,
        currentPhase?.name || 'unknown',
        task.projectId,
      );
    }

    const summary = getProgressSummary(result.progress);

    return {
      success: true,
      task: { id: task.id, title: task.title },
      completedPhase: currentPhase ? { id: currentPhase.id, name: currentPhase.name } : undefined,
      commitSha,
      nextPhase: result.phase ? {
        id: result.phase.id,
        name: result.phase.name,
        description: result.phase.description,
      } : null,
      isComplete: result.isComplete,
      suggestedCommitMessage: commitMessage,
      progress: {
        indicator: summary.indicator,
        percentComplete: summary.percentComplete,
      },
      phaseHistory: result.progress.phaseCommits,
      message: result.isComplete ? 'All phases complete!' : `Advanced to Phase ${result.phase?.id}: ${result.phase?.name}`,
      role: role || 'developer',
    };
  }

  async skipTaskPhase(taskId: string, force?: boolean): Promise<{
    success: boolean;
    task?: { id: string; title: string };
    skippedPhase?: { id: number; name: string };
    nextPhase?: { id: number; name: string; description: string } | null;
    isComplete?: boolean;
    progress?: { indicator: string; percentComplete: number };
    message?: string;
  }> {
    const task = await this.ctx.storage.getTask(taskId);
    if (!task) {
      return { success: false, message: `Task not found: ${taskId}` };
    }

    if (!task.implementation?.phaseProgress) {
      return {
        success: false,
        message: 'Phase workflow not started. Use startTaskPhases first.',
      };
    }

    const result = skipPhase(task.implementation.phaseProgress, force);

    if (!result.skipped) {
      return {
        success: false,
        message: result.error,
      };
    }

    const implementation = {
      ...task.implementation,
      phaseProgress: result.progress,
    };

    await this.ctx.storage.updateTask(task.id, { implementation });

    await audit(this.ctx.storage, 'task.phase_skipped', task.projectId, 'task', taskId, `Phase skipped: ${result.phase?.name}`, { metadata: { skippedPhaseId: result.phase?.id, force, nextPhase: result.progress.currentPhase } });

    const summary = getProgressSummary(result.progress);

    return {
      success: true,
      task: { id: task.id, title: task.title },
      skippedPhase: result.phase ? { id: result.phase.id, name: result.phase.name } : undefined,
      nextPhase: result.progress.currentPhase <= 8 ? (() => {
        const next = getPhase(result.progress.currentPhase);
        return next ? { id: next.id, name: next.name, description: next.description } : null;
      })() : null,
      isComplete: result.progress.currentPhase > 8,
      progress: {
        indicator: summary.indicator,
        percentComplete: summary.percentComplete,
      },
      message: `Skipped Phase ${result.phase?.id}: ${result.phase?.name}`,
    };
  }
}
