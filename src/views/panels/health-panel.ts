/**
 * Health Pulse Panel — "are we on track"
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { WheelhausPanel } from './types.js';

export interface HealthData {
  tasksReady: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksCompleted: number;
  totalTasks: number;
  decisionsRecent: number;
  activeSessions: number;
}

async function query(service: CoordinationService): Promise<HealthData> {
  const projectCtx = await service.getActiveProjectContext();
  const projectId = projectCtx?.projectId;

  const [tasks, decisionsResult, sessions] = await Promise.all([
    service.getTasks(projectId ? { projectId } : {}),
    service.getDecisions({ projectId, period: 'month', limit: 50 }),
    service.getActiveSessions(),
  ]);

  const byStatus: Record<string, number> = {};
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  }

  return {
    tasksReady: byStatus['ready'] ?? 0,
    tasksInProgress: byStatus['in-progress'] ?? 0,
    tasksBlocked: byStatus['blocked'] ?? 0,
    tasksCompleted: byStatus['completed'] ?? 0,
    totalTasks: tasks.length,
    decisionsRecent: decisionsResult.decisions.length,
    activeSessions: sessions.length,
  };
}

function renderMarkdown(data: HealthData): string {
  const lines: string[] = [];

  const blockedRatio = data.totalTasks > 0 ? data.tasksBlocked / data.totalTasks : 0;
  const completionRate = data.totalTasks > 0 ? data.tasksCompleted / data.totalTasks : 0;
  let healthStatus = 'Healthy';
  let healthEmoji = '🟢';
  if (blockedRatio > 0.3) { healthStatus = 'Blocked'; healthEmoji = '🔴'; }
  else if (blockedRatio > 0.15) { healthStatus = 'Constrained'; healthEmoji = '🟡'; }

  lines.push('# Health Pulse');
  lines.push('');
  lines.push(`**Status:** ${healthEmoji} ${healthStatus}`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Tasks Ready | ${data.tasksReady} |`);
  lines.push(`| Tasks In Progress | ${data.tasksInProgress} |`);
  lines.push(`| Tasks Blocked | ${data.tasksBlocked} |`);
  lines.push(`| Tasks Completed | ${data.tasksCompleted} |`);
  lines.push(`| Total Tasks | ${data.totalTasks} |`);
  lines.push(`| Completion Rate | ${(completionRate * 100).toFixed(0)}% |`);
  lines.push(`| Recent Decisions | ${data.decisionsRecent} |`);
  lines.push(`| Active Sessions | ${data.activeSessions} |`);
  lines.push('');

  if (data.totalTasks > 0) {
    const pct = Math.round(completionRate * 20);
    const bar = '█'.repeat(pct) + '░'.repeat(20 - pct);
    lines.push(`**Progress:** \`${bar}\` ${(completionRate * 100).toFixed(0)}%`);
    lines.push('');
  }

  if (blockedRatio > 0) {
    lines.push(`**Blocked ratio:** ${(blockedRatio * 100).toFixed(0)}% of tasks are blocked`);
    if (blockedRatio > 0.3) {
      lines.push('> ⚠️ High block rate — review dependency chains');
    }
    lines.push('');
  }

  return lines.join('\n');
}

function toJSON(data: HealthData) {
  const blockedRatio = data.totalTasks > 0 ? data.tasksBlocked / data.totalTasks : 0;
  const completionRate = data.totalTasks > 0 ? data.tasksCompleted / data.totalTasks : 0;
  let status: 'healthy' | 'constrained' | 'blocked' = 'healthy';
  if (blockedRatio > 0.3) status = 'blocked';
  else if (blockedRatio > 0.15) status = 'constrained';

  return {
    status,
    completionRate: Math.round(completionRate * 100),
    blockedRatio: Math.round(blockedRatio * 100),
    ...data,
  };
}

export const healthPanel: WheelhausPanel<HealthData> = {
  id: 'health',
  title: 'Health Pulse',
  query,
  renderMarkdown,
  toJSON,
};
