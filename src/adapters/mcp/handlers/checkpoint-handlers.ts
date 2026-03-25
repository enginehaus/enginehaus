/**
 * Checkpoint Tool Handlers
 *
 * Handlers for human checkpoint MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';

export interface RequestHumanInputParams {
  taskId: string;
  type: 'phase-gate' | 'decision-required' | 'review-required' | 'approval-required';
  reason: string;
  question?: string;
  options?: Array<{ id: string; label: string; description?: string; action?: 'approve' | 'reject' | 'redirect' }>;
  context?: string;
  requestedBy?: string;
  phase?: number;
  timeoutMinutes?: number;
  escalateTo?: string;
}

export interface ProvideHumanInputParams {
  checkpointId: string;
  respondedBy: string;
  decision: 'approve' | 'reject' | 'redirect';
  response?: string;
  selectedOption?: string;
}

export interface GetPendingCheckpointsParams {
  projectId?: string;
}

export interface GetCheckpointParams {
  checkpointId: string;
}

export interface GetTasksAwaitingHumanParams {
  projectId?: string;
}

export async function handleRequestHumanInput(
  service: CoordinationService,
  args: RequestHumanInputParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.requestHumanInput({
    taskId: args.taskId,
    type: args.type,
    reason: args.reason,
    question: args.question,
    options: args.options,
    context: args.context,
    requestedBy: args.requestedBy || 'claude-code',
    phase: args.phase,
    timeoutMinutes: args.timeoutMinutes,
    escalateTo: args.escalateTo,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleProvideHumanInput(
  service: CoordinationService,
  args: ProvideHumanInputParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.provideHumanInput({
    checkpointId: args.checkpointId,
    respondedBy: args.respondedBy,
    decision: args.decision,
    response: args.response,
    selectedOption: args.selectedOption,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetPendingCheckpoints(
  service: CoordinationService,
  args: GetPendingCheckpointsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const checkpoints = await service.getPendingCheckpoints(args.projectId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        count: checkpoints.length,
        checkpoints: checkpoints.map(cp => ({
          id: cp.id,
          taskId: cp.taskId,
          type: cp.type,
          status: cp.status,
          reason: cp.reason,
          question: cp.question,
          requestedBy: cp.requestedBy,
          requestedAt: cp.requestedAt,
          timeoutMinutes: cp.timeoutMinutes,
        })),
      }, null, 2),
    }],
  };
}

export async function handleGetCheckpoint(
  service: CoordinationService,
  args: GetCheckpointParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const checkpoint = await service.getCheckpoint(args.checkpointId);

  if (!checkpoint) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: `Checkpoint not found: ${args.checkpointId}` }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(checkpoint, null, 2),
    }],
  };
}

export async function handleGetTasksAwaitingHuman(
  service: CoordinationService,
  args: GetTasksAwaitingHumanParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const tasks = await service.getTasksAwaitingHuman(args.projectId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          activeCheckpoint: t.activeCheckpoint ? {
            id: t.activeCheckpoint.id,
            type: t.activeCheckpoint.type,
            reason: t.activeCheckpoint.reason,
            question: t.activeCheckpoint.question,
          } : null,
        })),
      }, null, 2),
    }],
  };
}
