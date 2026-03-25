/**
 * Decision Stream Panel — "why we chose this"
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { WheelhausPanel } from './types.js';

export interface DecisionData {
  id: string;
  decision: string;
  rationale?: string;
  category?: string;
  taskId?: string;
  createdAt: Date;
}

export interface DecisionStreamData {
  decisions: DecisionData[];
}

async function query(service: CoordinationService): Promise<DecisionStreamData> {
  const projectCtx = await service.getActiveProjectContext();
  const projectId = projectCtx?.projectId;
  const result = await service.getDecisions({ projectId, period: 'month', limit: 50 });
  return { decisions: result.decisions };
}

function renderMarkdown(data: DecisionStreamData): string {
  const { decisions } = data;
  const lines: string[] = [];
  lines.push('# Decision Stream');
  lines.push('');

  if (decisions.length === 0) {
    lines.push('*No decisions recorded yet.*');
    return lines.join('\n');
  }

  lines.push(`${decisions.length} decision(s) recorded.`);
  lines.push('');

  const byCategory: Record<string, DecisionData[]> = {};
  for (const d of decisions) {
    const cat = d.category || 'other';
    (byCategory[cat] ??= []).push(d);
  }

  for (const [category, catDecisions] of Object.entries(byCategory)) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)} (${catDecisions.length})`);
    lines.push('');

    for (const d of catDecisions.slice(0, 15)) {
      const date = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : '';
      lines.push(`### ${d.decision}`);
      if (d.rationale) {
        lines.push(`> ${d.rationale}`);
      }
      const meta: string[] = [];
      if (date) meta.push(date);
      if (d.taskId) meta.push(`task: \`${d.taskId.slice(0, 8)}\``);
      if (meta.length > 0) {
        lines.push(`*${meta.join(' · ')}*`);
      }
      lines.push('');
    }
    if (catDecisions.length > 15) {
      lines.push(`*... and ${catDecisions.length - 15} more ${category} decisions*`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function toJSON(data: DecisionStreamData) {
  const byCategory: Record<string, number> = {};
  for (const d of data.decisions) {
    const cat = d.category || 'other';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  return {
    count: data.decisions.length,
    byCategory,
    decisions: data.decisions.map(d => ({
      id: d.id,
      decision: d.decision,
      rationale: d.rationale,
      category: d.category || 'other',
      taskId: d.taskId,
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
    })),
  };
}

export const decisionStreamPanel: WheelhausPanel<DecisionStreamData> = {
  id: 'decisions',
  title: 'Decision Stream',
  query,
  renderMarkdown,
  toJSON,
};
