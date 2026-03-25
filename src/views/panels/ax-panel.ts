/**
 * AX (Agent Experience) Panel — productivity, friction, and quality trends
 *
 * Surfaces agent self-reported feedback: productivity ratings, friction
 * sources, and quality trends. Makes Enginehaus self-aware about whether
 * it's actually helping agents be productive.
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { WheelhausPanel } from './types.js';

export interface AXData {
  totalFeedback: number;
  avgProductivityRating: number | null;
  ratingDistribution: Record<number, number>; // 1-5 → count
  topFriction: Array<{ tag: string; count: number; percentage: number }>;
  recentTrend: 'improving' | 'declining' | 'stable' | 'insufficient-data';
  recentFeedback: Array<{
    rating?: number;
    frictionTags: string[];
    notes?: string;
    createdAt: string;
  }>;
}

const FRICTION_LABELS: Record<string, string> = {
  'repeated_context': 'Repeated context',
  'wrong_context': 'Wrong context',
  'tool_confusion': 'Tool confusion',
  'missing_files': 'Missing files',
  'slow_response': 'Slow response',
  'unclear_task': 'Unclear task',
  'dependency_blocked': 'Dependency blocked',
  'quality_rework': 'Quality rework',
  'scope_creep': 'Scope creep',
  'other': 'Other',
};

async function query(service: CoordinationService): Promise<AXData> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get all feedback from last 30 days
  const allFeedback = await service.getSessionFeedback({ since: thirtyDaysAgo });
  const recentFeedback = allFeedback.filter(f => new Date(f.createdAt) >= sevenDaysAgo);
  const olderFeedback = allFeedback.filter(f => new Date(f.createdAt) < sevenDaysAgo);

  // Rating distribution
  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  let ratingCount = 0;

  for (const fb of allFeedback) {
    if (fb.productivityRating) {
      ratingDistribution[fb.productivityRating] = (ratingDistribution[fb.productivityRating] || 0) + 1;
      ratingSum += fb.productivityRating;
      ratingCount++;
    }
  }

  const avgProductivityRating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;

  // Friction tag counts
  const tagCounts: Record<string, number> = {};
  for (const fb of allFeedback) {
    for (const tag of fb.frictionTags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const totalTagged = Object.values(tagCounts).reduce((a, b) => a + b, 0);
  const topFriction = Object.entries(tagCounts)
    .map(([tag, count]) => ({
      tag,
      count,
      percentage: totalTagged > 0 ? Math.round((count / totalTagged) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Trend: compare recent 7d avg to older 23d avg
  let recentTrend: AXData['recentTrend'] = 'insufficient-data';
  if (ratingCount >= 3) {
    const recentRatings = recentFeedback.filter(f => f.productivityRating).map(f => f.productivityRating!);
    const olderRatings = olderFeedback.filter(f => f.productivityRating).map(f => f.productivityRating!);

    if (recentRatings.length >= 2 && olderRatings.length >= 2) {
      const recentAvg = recentRatings.reduce((a, b) => a + b, 0) / recentRatings.length;
      const olderAvg = olderRatings.reduce((a, b) => a + b, 0) / olderRatings.length;
      const diff = recentAvg - olderAvg;

      if (diff > 0.3) recentTrend = 'improving';
      else if (diff < -0.3) recentTrend = 'declining';
      else recentTrend = 'stable';
    }
  }

  return {
    totalFeedback: allFeedback.length,
    avgProductivityRating,
    ratingDistribution,
    topFriction,
    recentTrend,
    recentFeedback: allFeedback.slice(0, 5).map(fb => ({
      rating: fb.productivityRating,
      frictionTags: fb.frictionTags,
      notes: fb.notes,
      createdAt: fb.createdAt instanceof Date ? fb.createdAt.toISOString() : String(fb.createdAt),
    })),
  };
}

const TREND_LABEL: Record<AXData['recentTrend'], string> = {
  'improving': 'Improving',
  'declining': 'Declining',
  'stable': 'Stable',
  'insufficient-data': 'Not enough data',
};

const TREND_EMOJI: Record<AXData['recentTrend'], string> = {
  'improving': '📈',
  'declining': '📉',
  'stable': '➡️',
  'insufficient-data': '—',
};

function renderRatingBar(rating: number | null): string {
  if (rating === null) return '—';
  const filled = Math.round(rating);
  return '★'.repeat(filled) + '☆'.repeat(5 - filled) + ` ${rating}/5`;
}

function renderMarkdown(data: AXData): string {
  const lines: string[] = [];

  lines.push('## Agent Experience (AX)');
  lines.push('');

  if (data.totalFeedback === 0) {
    lines.push('*No agent feedback collected yet. Feedback is requested at task completion.*');
    return lines.join('\n');
  }

  // Summary row
  lines.push(`**${data.totalFeedback}** feedback response${data.totalFeedback === 1 ? '' : 's'} (last 30 days)`);
  lines.push('');

  // Rating + Trend
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Avg Productivity | ${renderRatingBar(data.avgProductivityRating)} |`);
  lines.push(`| Trend (7d vs prior) | ${TREND_EMOJI[data.recentTrend]} ${TREND_LABEL[data.recentTrend]} |`);
  lines.push('');

  // Rating distribution
  if (data.avgProductivityRating !== null) {
    lines.push('### Rating Distribution');
    lines.push('');
    for (let r = 5; r >= 1; r--) {
      const count = data.ratingDistribution[r] || 0;
      const maxCount = Math.max(...Object.values(data.ratingDistribution));
      const barLen = maxCount > 0 ? Math.round((count / maxCount) * 15) : 0;
      lines.push(`${r}★ ${'█'.repeat(barLen)}${'░'.repeat(15 - barLen)} ${count}`);
    }
    lines.push('');
  }

  // Top friction sources
  if (data.topFriction.length > 0) {
    lines.push('### Top Friction Sources');
    lines.push('');
    for (const f of data.topFriction) {
      const label = FRICTION_LABELS[f.tag] || f.tag;
      lines.push(`- **${label}** — ${f.count} report${f.count === 1 ? '' : 's'} (${f.percentage}%)`);
    }
    lines.push('');
  }

  // Recent feedback (last 5)
  if (data.recentFeedback.length > 0) {
    lines.push('### Recent Feedback');
    lines.push('');
    for (const fb of data.recentFeedback) {
      const parts: string[] = [];
      if (fb.rating) parts.push(`${fb.rating}/5`);
      if (fb.frictionTags.length > 0) {
        parts.push(fb.frictionTags.map(t => FRICTION_LABELS[t] || t).join(', '));
      }
      if (fb.notes) parts.push(`"${fb.notes}"`);
      const age = formatAge(fb.createdAt);
      lines.push(`- ${parts.join(' · ')} *${age}*`);
    }
    lines.push('');
  }

  return lines.join('\n');
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

function toJSON(data: AXData): unknown {
  return {
    ...data,
    generatedAt: new Date().toISOString(),
  };
}

export const axPanel: WheelhausPanel<AXData> = {
  id: 'ax',
  title: 'Agent Experience (AX)',
  query,
  renderMarkdown,
  toJSON,
};
