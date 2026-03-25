/**
 * Context Stream Panel — unified priority-sorted feed
 *
 * Merges human-queue, bottlenecks, active sessions, and recent decisions
 * into a single stream sorted by urgency. This is what the landing page
 * shows — the "intervention feed" that tells you what needs attention.
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { WheelhausPanel } from './types.js';
import { humanQueuePanel, type HumanQueueData } from './human-queue-panel.js';
import { bottleneckPanel, type BottleneckData } from './bottleneck-panel.js';
import { sessionsPanel, type SessionsData } from './sessions-panel.js';
import { decisionStreamPanel, type DecisionStreamData } from './decision-stream-panel.js';

export type StreamEntryType = 'waiting-on-human' | 'bottleneck' | 'in-progress' | 'decision';

export interface StreamEntry {
  type: StreamEntryType;
  text: string;
  meta: string;
  timestamp?: string;
}

export interface ContextStreamData {
  entries: StreamEntry[];
  counts: {
    waitingOnHuman: number;
    bottlenecks: number;
    activeSessions: number;
    recentDecisions: number;
  };
}

/** Priority order: lower = more urgent */
const TYPE_PRIORITY: Record<StreamEntryType, number> = {
  'waiting-on-human': 0,
  'bottleneck': 1,
  'in-progress': 2,
  'decision': 3,
};

async function query(service: CoordinationService): Promise<ContextStreamData> {
  const [humanQueue, bottlenecks, sessions, decisions] = await Promise.all([
    humanQueuePanel.query(service) as Promise<HumanQueueData>,
    bottleneckPanel.query(service) as Promise<BottleneckData>,
    sessionsPanel.query(service) as Promise<SessionsData>,
    decisionStreamPanel.query(service) as Promise<DecisionStreamData>,
  ]);

  const entries: StreamEntry[] = [];

  // Human queue → waiting-on-human
  for (const entry of humanQueue.entries) {
    const text = entry.question || entry.reason || entry.taskTitle;
    const parts: string[] = [];
    if (entry.requestedBy) parts.push(`from ${entry.requestedBy}`);
    parts.push(entry.taskTitle);
    if (entry.requestedAt) parts.push(formatAge(entry.requestedAt));
    entries.push({
      type: 'waiting-on-human',
      text,
      meta: parts.join(' · '),
      timestamp: entry.requestedAt,
    });
  }

  // Bottlenecks
  for (const b of bottlenecks.bottlenecks.slice(0, 5)) {
    entries.push({
      type: 'bottleneck',
      text: `${b.task.title} blocks ${b.blocksCount} downstream task${b.blocksCount === 1 ? '' : 's'}`,
      meta: `${b.blockedTaskTitles.slice(0, 3).join(', ')}${b.blocksCount > 3 ? ` +${b.blocksCount - 3} more` : ''} · ${b.task.priority} priority`,
    });
  }

  // Active sessions → in-progress
  for (const s of sessions.sessions) {
    const duration = formatDuration(s.startTime);
    entries.push({
      type: 'in-progress',
      text: s.taskTitle || s.taskId,
      meta: `${s.agentId} · ${duration} active`,
      timestamp: s.startTime,
    });
  }

  // Recent decisions (limit to 10)
  for (const d of decisions.decisions.slice(0, 10)) {
    const parts: string[] = [];
    if (d.category) parts.push(d.category);
    parts.push(formatAge(d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt)));
    entries.push({
      type: 'decision',
      text: d.decision,
      meta: parts.join(' · '),
      timestamp: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
    });
  }

  // Sort by type priority (urgency), then recency within type
  entries.sort((a, b) => {
    const priorityDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
    if (priorityDiff !== 0) return priorityDiff;
    if (a.timestamp && b.timestamp) return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    return 0;
  });

  return {
    entries,
    counts: {
      waitingOnHuman: humanQueue.entries.length,
      bottlenecks: bottlenecks.bottlenecks.length,
      activeSessions: sessions.sessions.length,
      recentDecisions: decisions.decisions.length,
    },
  };
}

function formatAge(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

const TYPE_LABELS: Record<StreamEntryType, string> = {
  'waiting-on-human': 'waiting on you',
  'bottleneck': 'bottleneck',
  'in-progress': 'in progress',
  'decision': 'decision',
};

const TYPE_EMOJI: Record<StreamEntryType, string> = {
  'waiting-on-human': '⏳',
  'bottleneck': '🚧',
  'in-progress': '🔄',
  'decision': '📋',
};

function renderMarkdown(data: ContextStreamData): string {
  const { entries, counts } = data;
  const lines: string[] = [];

  lines.push('# Context Stream');
  lines.push('');
  const summary: string[] = [];
  if (counts.waitingOnHuman > 0) summary.push(`**${counts.waitingOnHuman}** waiting on you`);
  if (counts.bottlenecks > 0) summary.push(`**${counts.bottlenecks}** bottleneck${counts.bottlenecks === 1 ? '' : 's'}`);
  if (counts.activeSessions > 0) summary.push(`**${counts.activeSessions}** active session${counts.activeSessions === 1 ? '' : 's'}`);
  if (counts.recentDecisions > 0) summary.push(`**${counts.recentDecisions}** recent decision${counts.recentDecisions === 1 ? '' : 's'}`);
  if (summary.length > 0) {
    lines.push(summary.join(' · '));
    lines.push('');
  }

  if (entries.length === 0) {
    lines.push('*No activity to show.*');
    return lines.join('\n');
  }

  for (const entry of entries) {
    lines.push(`${TYPE_EMOJI[entry.type]} **${TYPE_LABELS[entry.type]}** — ${entry.text}`);
    lines.push(`  *${entry.meta}*`);
    lines.push('');
  }

  return lines.join('\n');
}

function toJSON(data: ContextStreamData): unknown {
  return {
    entries: data.entries,
    counts: data.counts,
    generatedAt: new Date().toISOString(),
  };
}

export const contextStreamPanel: WheelhausPanel<ContextStreamData> = {
  id: 'stream',
  title: 'Context Stream',
  query,
  renderMarkdown,
  toJSON,
};
