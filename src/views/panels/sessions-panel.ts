/**
 * Active Sessions Panel — "who's working"
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { WheelhausPanel } from './types.js';

export interface SessionEntry {
  agentId: string;
  taskId: string;
  taskTitle?: string;
  startTime: string;
  status: string;
}

export interface SessionsData {
  sessions: SessionEntry[];
}

async function query(service: CoordinationService): Promise<SessionsData> {
  const raw = await service.getActiveSessions();
  return {
    sessions: raw.map(s => ({
      agentId: s.agentId,
      taskId: s.taskId,
      startTime: s.startTime instanceof Date ? s.startTime.toISOString() : String(s.startTime),
      status: s.status,
    })),
  };
}

function formatDuration(startTime: string): string {
  const ms = Date.now() - new Date(startTime).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function renderMarkdown(data: SessionsData): string {
  const lines: string[] = [];
  lines.push('# Active Sessions');
  lines.push('');

  if (data.sessions.length === 0) {
    lines.push('*No active agent sessions.*');
    return lines.join('\n');
  }

  lines.push(`${data.sessions.length} active session(s).`);
  lines.push('');
  lines.push('| Agent | Task | Duration | Status |');
  lines.push('|-------|------|----------|--------|');

  for (const s of data.sessions) {
    const duration = formatDuration(s.startTime);
    const title = s.taskTitle || s.taskId.slice(0, 8);
    lines.push(`| ${s.agentId} | ${title.slice(0, 40)} | ${duration} | ${s.status} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function toJSON(data: SessionsData) {
  return {
    count: data.sessions.length,
    sessions: data.sessions.map(s => ({
      ...s,
      durationMinutes: Math.floor((Date.now() - new Date(s.startTime).getTime()) / 60000),
    })),
  };
}

export const sessionsPanel: WheelhausPanel<SessionsData> = {
  id: 'sessions',
  title: 'Active Sessions',
  query,
  renderMarkdown,
  toJSON,
};
