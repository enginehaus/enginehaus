/**
 * Wheelhaus Panel Registry
 *
 * Composable data views. Each panel queries its own data and renders
 * independently. Dashboard composes panels; individual views render one.
 */

export type { WheelhausPanel } from './types.js';

export { healthPanel } from './health-panel.js';
export type { HealthData } from './health-panel.js';

export { readyWorkPanel } from './ready-work-panel.js';
export type { ReadyWorkData } from './ready-work-panel.js';

export { decisionStreamPanel } from './decision-stream-panel.js';
export type { DecisionStreamData, DecisionData } from './decision-stream-panel.js';

export { sessionsPanel } from './sessions-panel.js';
export type { SessionsData, SessionEntry } from './sessions-panel.js';

export { humanQueuePanel } from './human-queue-panel.js';
export type { HumanQueueData, HumanQueueEntry } from './human-queue-panel.js';

export { bottleneckPanel } from './bottleneck-panel.js';
export type { BottleneckData, BottleneckEntry } from './bottleneck-panel.js';

export { contextStreamPanel } from './context-stream-panel.js';
export type { ContextStreamData, StreamEntry, StreamEntryType } from './context-stream-panel.js';

export { axPanel } from './ax-panel.js';
export type { AXData } from './ax-panel.js';

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { WheelhausPanel } from './types.js';
import { healthPanel } from './health-panel.js';
import { readyWorkPanel } from './ready-work-panel.js';
import { decisionStreamPanel } from './decision-stream-panel.js';
import { sessionsPanel } from './sessions-panel.js';
import { humanQueuePanel } from './human-queue-panel.js';
import { bottleneckPanel } from './bottleneck-panel.js';
import { contextStreamPanel } from './context-stream-panel.js';
import { axPanel } from './ax-panel.js';

/** All registered core panels */
export const corePanels: WheelhausPanel<unknown>[] = [
  healthPanel,
  humanQueuePanel,
  bottleneckPanel,
  sessionsPanel,
  readyWorkPanel,
  decisionStreamPanel,
  contextStreamPanel,
  axPanel,
];

/** Panel lookup by id */
const panelMap = new Map<string, WheelhausPanel<unknown>>(
  corePanels.map(p => [p.id, p])
);

/** Get a panel by id */
export function getPanel(id: string): WheelhausPanel<unknown> | undefined {
  return panelMap.get(id);
}

/** Render a single panel as Markdown */
export async function renderPanel(
  id: string,
  service: CoordinationService
): Promise<string> {
  const panel = panelMap.get(id);
  if (!panel) throw new Error(`Unknown panel: ${id}`);
  const data = await panel.query(service);
  return panel.renderMarkdown(data);
}

/** Query a single panel and return serializable JSON */
export async function queryPanelJSON(
  id: string,
  service: CoordinationService
): Promise<{ panel: string; title: string; data: unknown }> {
  const panel = panelMap.get(id);
  if (!panel) throw new Error(`Unknown panel: ${id}`);
  const data = await panel.query(service);
  return { panel: panel.id, title: panel.title, data: panel.toJSON(data) };
}

/** Query all panels and return full snapshot as JSON */
export async function queryDashboardJSON(
  service: CoordinationService
): Promise<{ generatedAt: string; panels: Record<string, unknown> }> {
  const entries = await Promise.all(
    corePanels.map(async (panel) => {
      const data = await panel.query(service);
      return [panel.id, panel.toJSON(data)] as const;
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    panels: Object.fromEntries(entries),
  };
}

/** Render the full dashboard (all core panels composed as Markdown) */
export async function renderDashboard(
  service: CoordinationService
): Promise<string> {
  const sections = await Promise.all(
    corePanels.map(async (panel) => {
      const data = await panel.query(service);
      return panel.renderMarkdown(data);
    })
  );

  const lines: string[] = [];
  lines.push('# Wheelhaus Dashboard');
  lines.push('');
  lines.push(`*Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC*`);
  lines.push('');

  for (const section of sections) {
    lines.push('---');
    lines.push('');
    lines.push(section);
  }

  return lines.join('\n');
}
