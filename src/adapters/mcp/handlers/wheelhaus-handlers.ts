/**
 * Wheelhaus Tool Handlers
 *
 * Agent-accessible wrapper for Wheelhaus panel views.
 * Returns Markdown text + structured JSON resource for rich client rendering.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { UnifiedTask } from '../../../coordination/types.js';
import {
  renderPanel,
  renderDashboard,
  queryPanelJSON,
  queryDashboardJSON,
  getPanel,
} from '../../../views/panels/index.js';

export interface ViewWheelhausParams {
  view?: 'dashboard' | 'tasks' | 'decisions' | 'health' | 'sessions' | 'human-queue' | 'bottlenecks' | 'stream' | 'ax';
  taskId?: string;
  decisionId?: string;
  format?: 'markdown' | 'json' | 'both';
}

type ContentBlock = { type: string; text: string } | { type: string; resource: { uri: string; mimeType: string; text: string } };

interface Decision {
  id: string;
  decision: string;
  rationale?: string;
  category?: string;
  taskId?: string;
  createdAt: Date;
}

function renderTaskDetail(task: UnifiedTask, decisions: Decision[]): string {
  const lines: string[] = [];
  lines.push(`# Task: ${task.title}`);
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| ID | \`${task.id}\` |`);
  lines.push(`| Status | ${task.status} |`);
  lines.push(`| Priority | ${task.priority} |`);
  if (task.assignedTo) lines.push(`| Assigned To | ${task.assignedTo} |`);
  if (task.tags?.length) lines.push(`| Tags | ${task.tags.join(', ')} |`);
  if (task.createdAt) lines.push(`| Created | ${new Date(task.createdAt).toISOString().split('T')[0]} |`);
  if (task.updatedAt) lines.push(`| Updated | ${new Date(task.updatedAt).toISOString().split('T')[0]} |`);
  lines.push('');

  if (task.description) {
    lines.push('## Description');
    lines.push('');
    lines.push(task.description);
    lines.push('');
  }

  if (task.blockedBy?.length) {
    lines.push('## Blocked By');
    lines.push('');
    for (const dep of task.blockedBy) {
      lines.push(`- \`${dep}\``);
    }
    lines.push('');
  }

  if (task.files?.length) {
    lines.push('## Files');
    lines.push('');
    for (const f of task.files) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  const taskDecisions = decisions.filter(d => d.taskId === task.id);
  if (taskDecisions.length > 0) {
    lines.push('## Decisions');
    lines.push('');
    for (const d of taskDecisions) {
      lines.push(`### ${d.decision}`);
      if (d.rationale) lines.push(`> ${d.rationale}`);
      const meta: string[] = [];
      if (d.category) meta.push(d.category);
      if (d.createdAt) meta.push(new Date(d.createdAt).toISOString().split('T')[0]);
      if (meta.length) lines.push(`*${meta.join(' · ')}*`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderDecisionDetail(decision: Decision): string {
  const lines: string[] = [];
  lines.push(`# Decision: ${decision.decision}`);
  lines.push('');

  if (decision.rationale) {
    lines.push('## Rationale');
    lines.push('');
    lines.push(`> ${decision.rationale}`);
    lines.push('');
  }

  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| ID | \`${decision.id}\` |`);
  if (decision.category) lines.push(`| Category | ${decision.category} |`);
  if (decision.taskId) lines.push(`| Task | \`${decision.taskId}\` |`);
  if (decision.createdAt) lines.push(`| Date | ${new Date(decision.createdAt).toISOString().split('T')[0]} |`);
  lines.push('');

  return lines.join('\n');
}

export async function handleViewWheelhaus(
  service: CoordinationService,
  args: ViewWheelhausParams
): Promise<{ content: ContentBlock[] }> {
  const format = args.format || 'markdown';

  // Deep link: specific task
  if (args.taskId) {
    const taskId = args.taskId;
    let task = await service.getTask(taskId);
    if (!task) {
      const allTasks = await service.getTasks({});
      task = allTasks.find(t => t.id.startsWith(taskId)) ?? null;
    }
    if (!task) {
      return { content: [{ type: 'text', text: `Task not found: \`${taskId}\`` }] };
    }
    const decisionsResult = await service.getDecisions({ taskId: task.id, limit: 20 });
    const text = renderTaskDetail(task, decisionsResult.decisions);
    return { content: [{ type: 'text', text }] };
  }

  // Deep link: specific decision
  if (args.decisionId) {
    const result = await service.getDecisions({ limit: 200 });
    const decision = result.decisions.find(d => d.id === args.decisionId || d.id.startsWith(args.decisionId!));
    if (!decision) {
      return { content: [{ type: 'text', text: `Decision not found: \`${args.decisionId}\`` }] };
    }
    const text = renderDecisionDetail(decision);
    return { content: [{ type: 'text', text }] };
  }

  // Panel views
  const view = args.view || 'dashboard';
  const content: ContentBlock[] = [];

  // Markdown rendering
  if (format === 'markdown' || format === 'both') {
    const text = view === 'dashboard'
      ? await renderDashboard(service)
      : await renderPanel(view, service);
    content.push({ type: 'text', text });
  }

  // JSON rendering (as embedded resource)
  if (format === 'json' || format === 'both') {
    const json = view === 'dashboard'
      ? await queryDashboardJSON(service)
      : getPanel(view)
        ? await queryPanelJSON(view, service)
        : { error: `Unknown panel: ${view}` };
    content.push({
      type: 'resource',
      resource: {
        uri: `wheelhaus://panels/${view}`,
        mimeType: 'application/json',
        text: JSON.stringify(json, null, 2),
      },
    });
  }

  return { content };
}
