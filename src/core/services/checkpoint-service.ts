/**
 * CheckpointService — extracted from CoordinationService
 *
 * Human checkpoint management: create, respond, timeout, escalate.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  UnifiedTask,
  TaskStatus,
  HumanCheckpoint,
  CheckpointType,
  CheckpointStatus,
  CheckpointOption,
} from '../../coordination/types.js';
import type { ServiceContext } from './service-context.js';
import { audit, resolveProjectId } from './service-context.js';

export class CheckpointService {
  constructor(private ctx: ServiceContext) {}

  async requestHumanInput(params: {
    taskId: string;
    type: CheckpointType;
    reason: string;
    question?: string;
    options?: CheckpointOption[];
    context?: string;
    requestedBy: string;
    phase?: number;
    timeoutMinutes?: number;
    escalateTo?: string;
  }): Promise<{ success: boolean; checkpointId?: string; error?: string }> {
    const { taskId, type, reason, question, options, context, requestedBy, phase, timeoutMinutes, escalateTo } = params;

    const task = await this.ctx.storage.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };

    const existingCheckpoint = await this.ctx.storage.getActiveCheckpointForTask(taskId);
    if (existingCheckpoint) return { success: false, error: `Task already has an active checkpoint: ${existingCheckpoint.id}` };

    const checkpointId = uuidv4();
    const checkpoint = {
      id: checkpointId, taskId, projectId: task.projectId, type,
      status: 'pending' as CheckpointStatus, reason, question, options, context,
      requestedBy, requestedAt: new Date(), phase, timeoutMinutes, escalateTo,
    };

    await this.ctx.storage.createCheckpoint(checkpoint);

    await this.ctx.storage.updateTask(taskId, {
      status: 'awaiting-human',
      activeCheckpoint: checkpoint,
    });

    await audit(this.ctx.storage, 'checkpoint-requested', task.projectId, 'task', taskId,
      `Human input requested: ${reason}`,
      { actorId: requestedBy, metadata: { checkpointId, checkpointType: type, phase } });

    return { success: true, checkpointId };
  }

  async provideHumanInput(params: {
    checkpointId: string;
    respondedBy: string;
    decision: 'approve' | 'reject' | 'redirect';
    response?: string;
    selectedOption?: string;
  }): Promise<{ success: boolean; taskId?: string; newStatus?: TaskStatus; error?: string }> {
    const { checkpointId, respondedBy, decision, response, selectedOption } = params;

    const checkpoint = await this.ctx.storage.getCheckpoint(checkpointId);
    if (!checkpoint) return { success: false, error: `Checkpoint not found: ${checkpointId}` };
    if (checkpoint.status !== 'pending') return { success: false, error: `Checkpoint is not pending: status=${checkpoint.status}` };

    const updated = await this.ctx.storage.respondToCheckpoint(checkpointId, {
      respondedBy, decision, response, selectedOption,
    });
    if (!updated) return { success: false, error: 'Failed to update checkpoint' };

    let newTaskStatus: TaskStatus;
    if (decision === 'approve') {
      const task = await this.ctx.storage.getTask(checkpoint.taskId);
      if (task?.blockedBy && task.blockedBy.length > 0) newTaskStatus = 'blocked';
      else newTaskStatus = 'ready';
    } else {
      newTaskStatus = 'ready';
    }

    await this.ctx.storage.updateTask(checkpoint.taskId, { status: newTaskStatus, activeCheckpoint: undefined });

    const auditEventType = decision === 'approve' ? 'checkpoint-approved'
      : decision === 'reject' ? 'checkpoint-rejected' : 'checkpoint-approved';

    await audit(this.ctx.storage, auditEventType, checkpoint.projectId, 'task', checkpoint.taskId,
      `Checkpoint ${decision}: ${checkpoint.reason}`,
      { actorId: respondedBy, actorType: 'user', metadata: { checkpointId, checkpointType: checkpoint.type, decision, response, selectedOption } });

    return { success: true, taskId: checkpoint.taskId, newStatus: newTaskStatus };
  }

  async getPendingCheckpoints(projectId?: string): Promise<HumanCheckpoint[]> {
    const resolvedProjectId = await resolveProjectId(this.ctx.storage, projectId);
    const checkpoints = await this.ctx.storage.getPendingCheckpoints(resolvedProjectId || undefined);
    return checkpoints as HumanCheckpoint[];
  }

  async getCheckpoint(checkpointId: string): Promise<HumanCheckpoint | null> {
    const checkpoint = await this.ctx.storage.getCheckpoint(checkpointId);
    return checkpoint as HumanCheckpoint | null;
  }

  async getActiveCheckpointForTask(taskId: string): Promise<HumanCheckpoint | null> {
    const checkpoint = await this.ctx.storage.getActiveCheckpointForTask(taskId);
    return checkpoint as HumanCheckpoint | null;
  }

  async getCheckpointHistory(taskId: string): Promise<HumanCheckpoint[]> {
    const checkpoints = await this.ctx.storage.getCheckpointHistory(taskId);
    return checkpoints as HumanCheckpoint[];
  }

  async timeoutCheckpoint(checkpointId: string): Promise<{ success: boolean; escalated: boolean; error?: string }> {
    const checkpoint = await this.ctx.storage.getCheckpoint(checkpointId);
    if (!checkpoint) return { success: false, escalated: false, error: `Checkpoint not found: ${checkpointId}` };
    if (checkpoint.status !== 'pending') return { success: false, escalated: false, error: `Checkpoint is not pending: status=${checkpoint.status}` };

    let escalated = false;
    if (checkpoint.escalateTo) {
      await this.ctx.storage.escalateCheckpoint(checkpointId);
      escalated = true;
      await audit(this.ctx.storage, 'checkpoint-escalated', checkpoint.projectId, 'task', checkpoint.taskId,
        `Checkpoint escalated to ${checkpoint.escalateTo}`,
        { actorId: 'system', actorType: 'system', metadata: { checkpointId, escalateTo: checkpoint.escalateTo } });
    } else {
      await this.ctx.storage.timeoutCheckpoint(checkpointId);
      await this.ctx.storage.updateTask(checkpoint.taskId, { status: 'ready', activeCheckpoint: undefined });
      await audit(this.ctx.storage, 'checkpoint-timed-out', checkpoint.projectId, 'task', checkpoint.taskId,
        `Checkpoint timed out after ${checkpoint.timeoutMinutes} minutes`,
        { actorId: 'system', actorType: 'system', metadata: { checkpointId, timeoutMinutes: checkpoint.timeoutMinutes } });
    }

    return { success: true, escalated };
  }

  async getTasksAwaitingHuman(projectId?: string, getTasks?: (filter: any) => Promise<UnifiedTask[]>): Promise<UnifiedTask[]> {
    const tasks = getTasks
      ? await getTasks({ projectId: projectId || undefined })
      : await this.ctx.storage.getTasks({ projectId: projectId || undefined });
    return tasks.filter((t: UnifiedTask) => t.status === 'awaiting-human');
  }
}
