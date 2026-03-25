/**
 * Phase Tool Handlers
 *
 * Handlers for phase-based workflow MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import { PHASES } from '../../../coordination/phases.js';
import { getDecisionPrompt } from '../../../utils/decision-prompting.js';

export interface GetTaskPhaseParams {
  taskId: string;
}

export interface StartTaskPhasesParams {
  taskId: string;
}

export interface AdvancePhaseParams {
  taskId: string;
  commitSha: string;
  note?: string;
  role?: string;
}

export interface SkipPhaseParams {
  taskId: string;
  force?: boolean;
}

export async function handleListPhases(): Promise<{ content: Array<{ type: string; text: string }> }> {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        phases: PHASES.map(p => ({
          id: p.id,
          name: p.name,
          shortName: p.shortName,
          description: p.description,
          canSkip: p.canSkip,
          commitPrefix: p.commitPrefix,
        })),
        workflow: 'Context & Planning → Architecture → Core Implementation → Integration → Testing → Documentation → Review → Deployment',
      }, null, 2),
    }],
  };
}

export async function handleGetTaskPhase(
  service: CoordinationService,
  args: GetTaskPhaseParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.getTaskPhase(args.taskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleStartTaskPhases(
  service: CoordinationService,
  args: StartTaskPhasesParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.startTaskPhases(args.taskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleAdvancePhase(
  service: CoordinationService,
  args: AdvancePhaseParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.advanceTaskPhase(args.taskId, args.commitSha, args.note, args.role);

  // Check if we should prompt for decision logging at phase transition
  const decisionPrompt = await getDecisionPrompt(service, {
    taskId: args.taskId,
    currentPhase: result.nextPhase?.id,
  }).catch(() => undefined);

  if (decisionPrompt && result.message) {
    result.message += decisionPrompt;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleSkipPhase(
  service: CoordinationService,
  args: SkipPhaseParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.skipTaskPhase(args.taskId, args.force);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
