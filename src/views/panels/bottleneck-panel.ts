/**
 * Bottleneck Panel — "what's blocking them"
 *
 * Identifies tasks that block the most other work. A task is a bottleneck
 * if it appears in other tasks' blockedBy lists and isn't completed yet.
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { UnifiedTask } from '../../coordination/types.js';
import type { WheelhausPanel } from './types.js';

export interface BottleneckEntry {
  task: UnifiedTask;
  blocksCount: number;
  blockedTaskTitles: string[];
}

export interface BottleneckData {
  bottlenecks: BottleneckEntry[];
  totalBlocked: number;
}

async function query(service: CoordinationService): Promise<BottleneckData> {
  const projectCtx = await service.getActiveProjectContext();
  const projectId = projectCtx?.projectId;
  const tasks = await service.getTasks(projectId ? { projectId } : {});

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // Count how many incomplete tasks each task blocks
  const blocksCounts = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.status === 'completed') continue;
    for (const blockerId of task.blockedBy ?? []) {
      const blocker = taskMap.get(blockerId);
      if (blocker && blocker.status !== 'completed') {
        const existing = blocksCounts.get(blockerId) || [];
        existing.push(task.id);
        blocksCounts.set(blockerId, existing);
      }
    }
  }

  // Build entries sorted by blocks count descending
  const bottlenecks: BottleneckEntry[] = [];
  for (const [taskId, blockedIds] of blocksCounts) {
    const task = taskMap.get(taskId);
    if (!task) continue;
    bottlenecks.push({
      task,
      blocksCount: blockedIds.length,
      blockedTaskTitles: blockedIds
        .map(id => taskMap.get(id)?.title ?? id.slice(0, 8))
        .slice(0, 5),
    });
  }

  bottlenecks.sort((a, b) => b.blocksCount - a.blocksCount);

  const totalBlocked = tasks.filter(t => t.status === 'blocked').length;

  return { bottlenecks: bottlenecks.slice(0, 15), totalBlocked };
}

function renderMarkdown(data: BottleneckData): string {
  const lines: string[] = [];
  lines.push('# Bottlenecks');
  lines.push('');

  if (data.bottlenecks.length === 0) {
    lines.push('*No dependency bottlenecks detected.*');
    return lines.join('\n');
  }

  lines.push(`**${data.totalBlocked}** task(s) currently blocked. Top blockers:`);
  lines.push('');

  for (const entry of data.bottlenecks) {
    const { task, blocksCount, blockedTaskTitles } = entry;
    const statusTag = task.status === 'in-progress' ? ' (in progress)' : '';

    lines.push(`### ${task.title.slice(0, 60)} \`${task.id.slice(0, 8)}\``);
    lines.push(`Blocks **${blocksCount}** task(s)${statusTag} — priority: ${task.priority}`);

    if (task.assignedTo) {
      lines.push(`Assigned to: ${task.assignedTo}`);
    }

    lines.push('');
    lines.push('Waiting on this:');
    for (const title of blockedTaskTitles) {
      lines.push(`- ${title.slice(0, 50)}`);
    }
    if (blocksCount > 5) {
      lines.push(`- *... and ${blocksCount - 5} more*`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function toJSON(data: BottleneckData) {
  return {
    totalBlocked: data.totalBlocked,
    bottlenecks: data.bottlenecks.map(e => ({
      taskId: e.task.id,
      title: e.task.title,
      status: e.task.status,
      priority: e.task.priority,
      assignedTo: e.task.assignedTo,
      blocksCount: e.blocksCount,
      blockedTaskTitles: e.blockedTaskTitles,
    })),
  };
}

export const bottleneckPanel: WheelhausPanel<BottleneckData> = {
  id: 'bottlenecks',
  title: 'Bottlenecks',
  query,
  renderMarkdown,
  toJSON,
};
