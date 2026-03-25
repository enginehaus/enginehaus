/**
 * Ready Work Panel — "what can start now"
 *
 * Shows tasks sorted by priority with status counts,
 * in-progress tasks, blocked tasks, and dependency graph.
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { UnifiedTask } from '../../coordination/types.js';
import type { WheelhausPanel } from './types.js';

export interface ReadyWorkData {
  tasks: UnifiedTask[];
}

async function query(service: CoordinationService): Promise<ReadyWorkData> {
  const projectCtx = await service.getActiveProjectContext();
  const projectId = projectCtx?.projectId;
  const tasks = await service.getTasks(projectId ? { projectId } : {});
  return { tasks };
}

function renderMarkdown(data: ReadyWorkData): string {
  const { tasks } = data;
  const lines: string[] = [];
  lines.push('# Task Graph');
  lines.push('');

  const byStatus: Record<string, UnifiedTask[]> = {};
  for (const t of tasks) {
    (byStatus[t.status] ??= []).push(t);
  }

  const ready = byStatus['ready']?.length ?? 0;
  const inProgress = byStatus['in-progress']?.length ?? 0;
  const blocked = byStatus['blocked']?.length ?? 0;
  const completed = byStatus['completed']?.length ?? 0;

  lines.push('| Status | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Ready | ${ready} |`);
  lines.push(`| In Progress | ${inProgress} |`);
  lines.push(`| Blocked | ${blocked} |`);
  lines.push(`| Completed | ${completed} |`);
  lines.push(`| **Total** | **${tasks.length}** |`);
  lines.push('');

  // In-progress tasks
  const ipTasks = byStatus['in-progress'] ?? [];
  if (ipTasks.length > 0) {
    lines.push('## In Progress');
    lines.push('');
    for (const t of ipTasks) {
      lines.push(`- **${t.title}** \`${t.id.slice(0, 8)}\``);
      if (t.assignedTo) lines.push(`  - Assigned to: ${t.assignedTo}`);
      if (t.description) lines.push(`  - ${t.description.slice(0, 120)}${t.description.length > 120 ? '...' : ''}`);
    }
    lines.push('');
  }

  // Blocked tasks
  const blockedTasks = byStatus['blocked'] ?? [];
  if (blockedTasks.length > 0) {
    lines.push('## Blocked');
    lines.push('');
    for (const t of blockedTasks) {
      const blockers = t.blockedBy?.join(', ') ?? 'unknown';
      lines.push(`- **${t.title}** \`${t.id.slice(0, 8)}\``);
      lines.push(`  - Blocked by: ${blockers}`);
    }
    lines.push('');
  }

  // Ready tasks (top 10 by priority)
  const readyTasks = (byStatus['ready'] ?? [])
    .sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
    })
    .slice(0, 10);

  if (readyTasks.length > 0) {
    lines.push('## Ready to Start');
    lines.push('');
    lines.push('| # | Priority | Task | ID |');
    lines.push('|---|----------|------|----|');
    for (let i = 0; i < readyTasks.length; i++) {
      const t = readyTasks[i];
      lines.push(`| ${i + 1} | ${t.priority} | ${t.title.slice(0, 50)} | \`${t.id.slice(0, 8)}\` |`);
    }
    if (ready > 10) {
      lines.push(`| | | *... and ${ready - 10} more* | |`);
    }
    lines.push('');
  }

  // Dependency graph (Mermaid)
  const tasksWithDeps = tasks.filter(t =>
    t.status !== 'completed' && (t.blockedBy?.length ?? 0) > 0
  );
  if (tasksWithDeps.length > 0) {
    lines.push('## Dependency Graph');
    lines.push('');
    lines.push('```mermaid');
    lines.push('graph TD');

    const referenced = new Set<string>();
    for (const t of tasksWithDeps) {
      referenced.add(t.id);
      for (const dep of t.blockedBy ?? []) {
        referenced.add(dep);
      }
    }

    const taskMap = new Map(tasks.map(t => [t.id, t]));
    for (const id of referenced) {
      const t = taskMap.get(id);
      if (!t) continue;
      const shortId = id.slice(0, 8);
      const label = t.title.slice(0, 30).replace(/"/g, "'");
      lines.push(`    ${shortId}["${label}"]`);
    }

    for (const t of tasksWithDeps) {
      for (const dep of t.blockedBy ?? []) {
        if (taskMap.has(dep)) {
          lines.push(`    ${dep.slice(0, 8)} --> ${t.id.slice(0, 8)}`);
        }
      }
    }

    const statusStyles: Record<string, string[]> = {
      'completed': [], 'in-progress': [], 'blocked': [], 'ready': [],
    };
    for (const id of referenced) {
      const t = taskMap.get(id);
      if (t && statusStyles[t.status]) {
        statusStyles[t.status].push(id.slice(0, 8));
      }
    }
    if (statusStyles['completed'].length > 0) lines.push(`    style ${statusStyles['completed'].join(',')} fill:#22A06B,color:#fff`);
    if (statusStyles['in-progress'].length > 0) lines.push(`    style ${statusStyles['in-progress'].join(',')} fill:#646cff,color:#fff`);
    if (statusStyles['blocked'].length > 0) lines.push(`    style ${statusStyles['blocked'].join(',')} fill:#D93C15,color:#fff`);

    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function toJSON(data: ReadyWorkData) {
  const byStatus: Record<string, number> = {};
  for (const t of data.tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }

  return {
    total: data.tasks.length,
    byStatus,
    tasks: data.tasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignedTo: t.assignedTo,
      blockedBy: t.blockedBy ?? [],
      blocks: t.blocks ?? [],
      tags: t.tags ?? [],
      updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : String(t.updatedAt),
    })),
  };
}

export const readyWorkPanel: WheelhausPanel<ReadyWorkData> = {
  id: 'tasks',
  title: 'Ready Work',
  query,
  renderMarkdown,
  toJSON,
};
