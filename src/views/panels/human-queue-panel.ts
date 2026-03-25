/**
 * Human Queue Panel — "what's waiting on me"
 *
 * Shows tasks awaiting human action and pending checkpoints,
 * grouped by assignee with checkpoint details.
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { WheelhausPanel } from './types.js';

export interface HumanQueueEntry {
  taskId: string;
  taskTitle: string;
  assignedTo: string;
  priority: string;
  reason?: string;
  question?: string;
  requestedBy?: string;
  requestedAt?: string;
  checkpointType?: string;
}

export interface HumanQueueData {
  entries: HumanQueueEntry[];
}

async function query(service: CoordinationService): Promise<HumanQueueData> {
  const projectCtx = await service.getActiveProjectContext();
  const projectId = projectCtx?.projectId;

  const [awaitingTasks, checkpoints] = await Promise.all([
    service.getTasksAwaitingHuman(projectId),
    service.getPendingCheckpoints(projectId),
  ]);

  // Index checkpoints by taskId for merging
  const checkpointByTask = new Map(
    checkpoints.map(cp => [cp.taskId, cp])
  );

  const entries: HumanQueueEntry[] = awaitingTasks.map(task => {
    const cp = checkpointByTask.get(task.id);
    return {
      taskId: task.id,
      taskTitle: task.title,
      assignedTo: task.assignedTo || 'unassigned',
      priority: task.priority,
      reason: cp?.reason,
      question: cp?.question,
      requestedBy: cp?.requestedBy,
      requestedAt: cp?.requestedAt instanceof Date
        ? cp.requestedAt.toISOString()
        : cp?.requestedAt ? String(cp.requestedAt) : undefined,
      checkpointType: cp?.type,
    };
  });

  // Also include checkpoints whose tasks aren't in the awaiting list
  // (edge case: checkpoint exists but task status wasn't updated)
  const seenTaskIds = new Set(awaitingTasks.map(t => t.id));
  for (const cp of checkpoints) {
    if (!seenTaskIds.has(cp.taskId)) {
      entries.push({
        taskId: cp.taskId,
        taskTitle: `(checkpoint: ${cp.taskId.slice(0, 8)})`,
        assignedTo: 'unassigned',
        priority: 'medium',
        reason: cp.reason,
        question: cp.question,
        requestedBy: cp.requestedBy,
        requestedAt: cp.requestedAt instanceof Date
          ? cp.requestedAt.toISOString()
          : cp.requestedAt ? String(cp.requestedAt) : undefined,
        checkpointType: cp.type,
      });
    }
  }

  // Sort: critical first, then by requested time (oldest first)
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  entries.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 3;
    const pb = priorityOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return (a.requestedAt ?? '').localeCompare(b.requestedAt ?? '');
  });

  return { entries };
}

function formatAge(isoDate?: string): string {
  if (!isoDate) return '';
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function renderMarkdown(data: HumanQueueData): string {
  const lines: string[] = [];
  lines.push('# Human Queue');
  lines.push('');

  if (data.entries.length === 0) {
    lines.push('*Nothing waiting for human action.*');
    return lines.join('\n');
  }

  lines.push(`**${data.entries.length}** item(s) waiting for human action.`);
  lines.push('');

  // Group by assignee
  const byAssignee = new Map<string, HumanQueueEntry[]>();
  for (const entry of data.entries) {
    const group = byAssignee.get(entry.assignedTo) || [];
    group.push(entry);
    byAssignee.set(entry.assignedTo, group);
  }

  for (const [assignee, entries] of byAssignee) {
    lines.push(`## @${assignee} (${entries.length})`);
    lines.push('');

    for (const entry of entries) {
      const age = formatAge(entry.requestedAt);
      const ageStr = age ? ` — waiting ${age}` : '';
      const typeTag = entry.checkpointType ? ` \`${entry.checkpointType}\`` : '';

      lines.push(`- **${entry.taskTitle.slice(0, 60)}** \`${entry.taskId.slice(0, 8)}\` [${entry.priority}]${typeTag}${ageStr}`);

      if (entry.question) {
        lines.push(`  - **Q:** ${entry.question}`);
      } else if (entry.reason) {
        lines.push(`  - ${entry.reason}`);
      }

      if (entry.requestedBy) {
        lines.push(`  - Requested by: ${entry.requestedBy}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function toJSON(data: HumanQueueData) {
  const byAssignee: Record<string, number> = {};
  for (const e of data.entries) {
    byAssignee[e.assignedTo] = (byAssignee[e.assignedTo] ?? 0) + 1;
  }

  return {
    count: data.entries.length,
    byAssignee,
    entries: data.entries,
  };
}

export const humanQueuePanel: WheelhausPanel<HumanQueueData> = {
  id: 'human-queue',
  title: 'Human Queue',
  query,
  renderMarkdown,
  toJSON,
};
