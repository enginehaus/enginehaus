/**
 * Wheelhaus Panel Tests
 *
 * Edge cases: empty data, large datasets, missing fields, special characters,
 * multi-assignee grouping, dependency graph extremes, and dashboard composition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoordinationService } from '../../src/core/services/coordination-service.js';
import type { UnifiedTask } from '../../src/coordination/types.js';

import { healthPanel } from '../../src/views/panels/health-panel.js';
import { readyWorkPanel } from '../../src/views/panels/ready-work-panel.js';
import { decisionStreamPanel } from '../../src/views/panels/decision-stream-panel.js';
import { sessionsPanel } from '../../src/views/panels/sessions-panel.js';
import { humanQueuePanel } from '../../src/views/panels/human-queue-panel.js';
import { bottleneckPanel } from '../../src/views/panels/bottleneck-panel.js';
import { contextStreamPanel } from '../../src/views/panels/context-stream-panel.js';
import { axPanel } from '../../src/views/panels/ax-panel.js';
import {
  corePanels,
  getPanel,
  renderPanel,
  renderDashboard,
  queryPanelJSON,
  queryDashboardJSON,
} from '../../src/views/panels/index.js';

// ============================================================================
// Factories
// ============================================================================

function makeTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
  return {
    id: overrides.id ?? 'task-' + Math.random().toString(36).slice(2, 10),
    projectId: 'proj-1',
    title: 'Test Task',
    description: '',
    priority: 'medium',
    status: 'ready',
    files: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UnifiedTask;
}

function makeTasks(count: number, overrides: Partial<UnifiedTask> = {}): UnifiedTask[] {
  return Array.from({ length: count }, (_, i) =>
    makeTask({ title: `Task ${i + 1}`, id: `task-${String(i).padStart(4, '0')}`, ...overrides })
  );
}

function makeCheckpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cp-1',
    taskId: 'task-1',
    projectId: 'proj-1',
    type: 'decision-required',
    status: 'pending',
    reason: 'Need approval',
    requestedBy: 'agent-1',
    requestedAt: new Date('2026-03-01T12:00:00Z'),
    ...overrides,
  };
}

function makeDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd-1',
    decision: 'Use approach A',
    rationale: 'Because reasons',
    category: 'architecture',
    taskId: 'task-1',
    createdAt: new Date('2026-03-01'),
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'agent-1',
    taskId: 'task-1',
    startTime: new Date('2026-03-10T08:00:00Z'),
    status: 'active',
    ...overrides,
  };
}

// ============================================================================
// Mock service factory
// ============================================================================

function mockService(overrides: Record<string, unknown> = {}): CoordinationService {
  return {
    getActiveProjectContext: vi.fn().mockResolvedValue({ projectId: 'proj-1' }),
    getTasks: vi.fn().mockResolvedValue([]),
    getDecisions: vi.fn().mockResolvedValue({ decisions: [] }),
    getActiveSessions: vi.fn().mockResolvedValue([]),
    getTasksAwaitingHuman: vi.fn().mockResolvedValue([]),
    getPendingCheckpoints: vi.fn().mockResolvedValue([]),
    getSessionFeedback: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as CoordinationService;
}

// ============================================================================
// Health Panel
// ============================================================================

describe('healthPanel', () => {
  it('renders empty state with zero tasks', async () => {
    const service = mockService();
    const data = await healthPanel.query(service);
    const md = healthPanel.renderMarkdown(data);
    expect(md).toContain('Health Pulse');
    expect(md).toContain('Healthy');
    expect(md).toContain('Total Tasks | 0');
  });

  it('detects blocked status when >30% blocked', async () => {
    const tasks = [
      ...makeTasks(3, { status: 'blocked' }),
      ...makeTasks(5, { status: 'ready' }),
    ];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await healthPanel.query(service);
    const md = healthPanel.renderMarkdown(data);
    expect(md).toContain('Blocked');
    expect(md).toContain('🔴');
    expect(md).toContain('blocked');
  });

  it('detects constrained status when 15-30% blocked', async () => {
    const tasks = [
      ...makeTasks(2, { status: 'blocked' }),
      ...makeTasks(8, { status: 'ready' }),
    ];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await healthPanel.query(service);
    const md = healthPanel.renderMarkdown(data);
    expect(md).toContain('Constrained');
    expect(md).toContain('🟡');
  });

  it('handles large task counts without crashing', async () => {
    const tasks = makeTasks(500, { status: 'completed' });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await healthPanel.query(service);
    const md = healthPanel.renderMarkdown(data);
    expect(md).toContain('500');
    expect(md).toContain('100%');
  });

  it('handles no active project context', async () => {
    const service = mockService({
      getActiveProjectContext: vi.fn().mockResolvedValue(null),
    });
    const data = await healthPanel.query(service);
    expect(data.totalTasks).toBe(0);
  });

  it('renders progress bar at boundary values', async () => {
    // 0% completion
    const service0 = mockService({ getTasks: vi.fn().mockResolvedValue(makeTasks(5, { status: 'ready' })) });
    const md0 = healthPanel.renderMarkdown(await healthPanel.query(service0));
    expect(md0).toContain('0%');

    // 100% completion
    const service100 = mockService({ getTasks: vi.fn().mockResolvedValue(makeTasks(5, { status: 'completed' })) });
    const md100 = healthPanel.renderMarkdown(await healthPanel.query(service100));
    expect(md100).toContain('100%');
  });
});

// ============================================================================
// Ready Work Panel
// ============================================================================

describe('readyWorkPanel', () => {
  it('renders empty state', async () => {
    const service = mockService();
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    expect(md).toContain('Task Graph');
    expect(md).toContain('**Total** | **0**');
  });

  it('sorts ready tasks by priority', async () => {
    const tasks = [
      makeTask({ status: 'ready', priority: 'low', title: 'Low prio' }),
      makeTask({ status: 'ready', priority: 'critical', title: 'Critical prio' }),
      makeTask({ status: 'ready', priority: 'high', title: 'High prio' }),
    ];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    const critIdx = md.indexOf('Critical prio');
    const highIdx = md.indexOf('High prio');
    const lowIdx = md.indexOf('Low prio');
    expect(critIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('caps ready list at 10 and shows overflow', async () => {
    const tasks = makeTasks(15, { status: 'ready' });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    expect(md).toContain('and 5 more');
  });

  it('renders Mermaid dependency graph', async () => {
    const blocker = makeTask({ id: 'blocker-1', status: 'ready', title: 'Blocker' });
    const blocked = makeTask({ id: 'blocked-1', status: 'blocked', title: 'Blocked', blockedBy: ['blocker-1'] });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([blocker, blocked]) });
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    expect(md).toContain('```mermaid');
    expect(md).toContain('graph TD');
    expect(md).toContain('blocker-');
    expect(md).toContain('-->');
  });

  it('handles tasks with no dependencies (no Mermaid)', async () => {
    const tasks = makeTasks(3, { status: 'ready' });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    expect(md).not.toContain('```mermaid');
  });

  it('truncates long task titles', async () => {
    const longTitle = 'A'.repeat(100);
    const tasks = [makeTask({ status: 'ready', title: longTitle })];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    // Title in table should be truncated to 50 chars
    expect(md).not.toContain(longTitle);
    expect(md).toContain('A'.repeat(50));
  });

  it('handles all statuses in counts', async () => {
    const tasks = [
      makeTask({ status: 'ready' }),
      makeTask({ status: 'in-progress' }),
      makeTask({ status: 'blocked' }),
      makeTask({ status: 'completed' }),
    ];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    expect(md).toContain('Ready | 1');
    expect(md).toContain('In Progress | 1');
    expect(md).toContain('Blocked | 1');
    expect(md).toContain('Completed | 1');
    expect(md).toContain('**Total** | **4**');
  });

  it('handles task titles with special Markdown characters', async () => {
    const tasks = [makeTask({ status: 'ready', title: 'Fix | pipe & "quotes"' })];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await readyWorkPanel.query(service);
    const md = readyWorkPanel.renderMarkdown(data);
    // Should still produce valid output (not crash)
    expect(md).toContain('Fix');
  });
});

// ============================================================================
// Decision Stream Panel
// ============================================================================

describe('decisionStreamPanel', () => {
  it('renders empty state', async () => {
    const service = mockService();
    const data = await decisionStreamPanel.query(service);
    const md = decisionStreamPanel.renderMarkdown(data);
    expect(md).toContain('Decision Stream');
    expect(md).toContain('No decisions recorded yet');
  });

  it('groups decisions by category', async () => {
    const decisions = [
      makeDecision({ category: 'architecture', decision: 'Arch decision' }),
      makeDecision({ category: 'tradeoff', decision: 'Tradeoff decision', id: 'd-2' }),
      makeDecision({ category: 'architecture', decision: 'Arch decision 2', id: 'd-3' }),
    ];
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });
    const data = await decisionStreamPanel.query(service);
    const md = decisionStreamPanel.renderMarkdown(data);
    expect(md).toContain('Architecture (2)');
    expect(md).toContain('Tradeoff (1)');
  });

  it('caps at 15 decisions per category', async () => {
    const decisions = Array.from({ length: 20 }, (_, i) =>
      makeDecision({ id: `d-${i}`, decision: `Decision ${i}`, category: 'architecture' })
    );
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });
    const data = await decisionStreamPanel.query(service);
    const md = decisionStreamPanel.renderMarkdown(data);
    expect(md).toContain('and 5 more architecture decisions');
  });

  it('handles decisions with no category', async () => {
    const decisions = [makeDecision({ category: undefined })];
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });
    const data = await decisionStreamPanel.query(service);
    const md = decisionStreamPanel.renderMarkdown(data);
    expect(md).toContain('Other (1)');
  });

  it('handles decisions with no rationale', async () => {
    const decisions = [makeDecision({ rationale: undefined })];
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });
    const data = await decisionStreamPanel.query(service);
    const md = decisionStreamPanel.renderMarkdown(data);
    expect(md).not.toContain('> undefined');
    expect(md).toContain('Use approach A');
  });

  it('handles decisions with no taskId', async () => {
    const decisions = [makeDecision({ taskId: undefined })];
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });
    const data = await decisionStreamPanel.query(service);
    const md = decisionStreamPanel.renderMarkdown(data);
    expect(md).not.toContain('task: `undefined`');
  });

  it('handles large decision count', async () => {
    const decisions = Array.from({ length: 200 }, (_, i) =>
      makeDecision({ id: `d-${i}`, decision: `Decision ${i}`, category: i % 2 === 0 ? 'architecture' : 'tradeoff' })
    );
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });
    const data = await decisionStreamPanel.query(service);
    const md = decisionStreamPanel.renderMarkdown(data);
    expect(md).toContain('200 decision(s)');
  });
});

// ============================================================================
// Sessions Panel
// ============================================================================

describe('sessionsPanel', () => {
  it('renders empty state', async () => {
    const service = mockService();
    const data = await sessionsPanel.query(service);
    const md = sessionsPanel.renderMarkdown(data);
    expect(md).toContain('Active Sessions');
    expect(md).toContain('No active agent sessions');
  });

  it('renders sessions table with duration', async () => {
    const sessions = [
      makeSession({ startTime: new Date(Date.now() - 30 * 60000) }), // 30 minutes ago
    ];
    const service = mockService({ getActiveSessions: vi.fn().mockResolvedValue(sessions) });
    const data = await sessionsPanel.query(service);
    const md = sessionsPanel.renderMarkdown(data);
    expect(md).toContain('| Agent | Task | Duration | Status |');
    expect(md).toContain('agent-1');
    expect(md).toContain('30m');
  });

  it('formats hours correctly', async () => {
    const sessions = [
      makeSession({ startTime: new Date(Date.now() - 90 * 60000) }), // 1h 30m ago
    ];
    const service = mockService({ getActiveSessions: vi.fn().mockResolvedValue(sessions) });
    const data = await sessionsPanel.query(service);
    const md = sessionsPanel.renderMarkdown(data);
    expect(md).toContain('1h 30m');
  });

  it('handles string startTime', async () => {
    const sessions = [
      makeSession({ startTime: new Date(Date.now() - 5 * 60000).toISOString() }),
    ];
    const service = mockService({ getActiveSessions: vi.fn().mockResolvedValue(sessions) });
    const data = await sessionsPanel.query(service);
    const md = sessionsPanel.renderMarkdown(data);
    expect(md).toContain('5m');
  });

  it('handles many sessions', async () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSession({ agentId: `agent-${i}`, taskId: `task-${i}`, startTime: new Date() })
    );
    const service = mockService({ getActiveSessions: vi.fn().mockResolvedValue(sessions) });
    const data = await sessionsPanel.query(service);
    const md = sessionsPanel.renderMarkdown(data);
    expect(md).toContain('50 active session(s)');
  });

  it('truncates long task titles to 40 chars', async () => {
    const sessions = [
      makeSession({ taskTitle: 'A'.repeat(60) }),
    ];
    const service = mockService({ getActiveSessions: vi.fn().mockResolvedValue(sessions) });
    const data = await sessionsPanel.query(service);
    const md = sessionsPanel.renderMarkdown(data);
    expect(md).not.toContain('A'.repeat(60));
  });

  it('falls back to short task ID when no title', async () => {
    const sessions = [
      makeSession({ taskId: 'abcdef1234567890' }),
    ];
    const service = mockService({ getActiveSessions: vi.fn().mockResolvedValue(sessions) });
    const data = await sessionsPanel.query(service);
    const md = sessionsPanel.renderMarkdown(data);
    expect(md).toContain('abcdef12');
  });
});

// ============================================================================
// Human Queue Panel
// ============================================================================

describe('humanQueuePanel', () => {
  it('renders empty state', async () => {
    const service = mockService();
    const data = await humanQueuePanel.query(service);
    const md = humanQueuePanel.renderMarkdown(data);
    expect(md).toContain('Human Queue');
    expect(md).toContain('Nothing waiting for human action');
  });

  it('groups entries by assignee', async () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'awaiting-human', assignedTo: 'alice', title: 'Alice task' }),
      makeTask({ id: 'task-2', status: 'awaiting-human', assignedTo: 'bob', title: 'Bob task' }),
      makeTask({ id: 'task-3', status: 'awaiting-human', assignedTo: 'alice', title: 'Alice task 2' }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
    });
    const data = await humanQueuePanel.query(service);
    const md = humanQueuePanel.renderMarkdown(data);
    expect(md).toContain('@alice (2)');
    expect(md).toContain('@bob (1)');
    expect(md).toContain('**3** item(s)');
  });

  it('merges checkpoint details into task entries', async () => {
    const tasks = [makeTask({ id: 'task-1', status: 'awaiting-human', title: 'Review PR' })];
    const checkpoints = [
      makeCheckpoint({ taskId: 'task-1', question: 'Approve the PR?', type: 'approval-required' }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });
    const data = await humanQueuePanel.query(service);
    const md = humanQueuePanel.renderMarkdown(data);
    expect(md).toContain('**Q:** Approve the PR?');
    expect(md).toContain('`approval-required`');
  });

  it('includes orphan checkpoints (no matching awaiting task)', async () => {
    const tasks: UnifiedTask[] = [];
    const checkpoints = [
      makeCheckpoint({ taskId: 'orphan-task', reason: 'Orphan checkpoint reason' }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });
    const data = await humanQueuePanel.query(service);
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].taskTitle).toContain('checkpoint:');
    expect(data.entries[0].assignedTo).toBe('unassigned');
  });

  it('sorts by priority then age', async () => {
    const tasks = [
      makeTask({ id: 'task-low', status: 'awaiting-human', priority: 'low', title: 'Low' }),
      makeTask({ id: 'task-crit', status: 'awaiting-human', priority: 'critical', title: 'Critical' }),
    ];
    const checkpoints = [
      makeCheckpoint({ taskId: 'task-low', requestedAt: new Date('2026-03-01') }),
      makeCheckpoint({ taskId: 'task-crit', requestedAt: new Date('2026-03-05') }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });
    const data = await humanQueuePanel.query(service);
    expect(data.entries[0].priority).toBe('critical');
    expect(data.entries[1].priority).toBe('low');
  });

  it('handles tasks with no assignee', async () => {
    const tasks = [
      makeTask({ id: 'task-1', status: 'awaiting-human', assignedTo: undefined, title: 'Unassigned task' }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
    });
    const data = await humanQueuePanel.query(service);
    const md = humanQueuePanel.renderMarkdown(data);
    expect(md).toContain('@unassigned');
  });

  it('shows reason when no question exists', async () => {
    const tasks = [makeTask({ id: 'task-1', status: 'awaiting-human', title: 'Task' })];
    const checkpoints = [
      makeCheckpoint({ taskId: 'task-1', question: undefined, reason: 'Needs design review' }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });
    const data = await humanQueuePanel.query(service);
    const md = humanQueuePanel.renderMarkdown(data);
    expect(md).toContain('Needs design review');
    expect(md).not.toContain('**Q:**');
  });

  it('handles many entries without crashing', async () => {
    const tasks = Array.from({ length: 100 }, (_, i) =>
      makeTask({ id: `task-${i}`, status: 'awaiting-human', assignedTo: `user-${i % 5}`, title: `Task ${i}` })
    );
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
    });
    const data = await humanQueuePanel.query(service);
    const md = humanQueuePanel.renderMarkdown(data);
    expect(md).toContain('**100** item(s)');
  });

  it('truncates long task titles to 60 chars', async () => {
    const tasks = [makeTask({ id: 'task-1', status: 'awaiting-human', title: 'X'.repeat(80) })];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
    });
    const data = await humanQueuePanel.query(service);
    const md = humanQueuePanel.renderMarkdown(data);
    expect(md).not.toContain('X'.repeat(80));
    expect(md).toContain('X'.repeat(60));
  });

  it('handles no active project context', async () => {
    const service = mockService({
      getActiveProjectContext: vi.fn().mockResolvedValue(null),
    });
    const data = await humanQueuePanel.query(service);
    expect(data.entries).toEqual([]);
  });
});

// ============================================================================
// Bottleneck Panel
// ============================================================================

describe('bottleneckPanel', () => {
  it('renders empty state', async () => {
    const service = mockService();
    const data = await bottleneckPanel.query(service);
    const md = bottleneckPanel.renderMarkdown(data);
    expect(md).toContain('Bottlenecks');
    expect(md).toContain('No dependency bottlenecks detected');
  });

  it('identifies a single bottleneck', async () => {
    const blocker = makeTask({ id: 'blocker-1', status: 'ready', title: 'The Blocker' });
    const blocked1 = makeTask({ id: 'b1', status: 'blocked', title: 'Blocked A', blockedBy: ['blocker-1'] });
    const blocked2 = makeTask({ id: 'b2', status: 'blocked', title: 'Blocked B', blockedBy: ['blocker-1'] });
    const service = mockService({
      getTasks: vi.fn().mockResolvedValue([blocker, blocked1, blocked2]),
    });
    const data = await bottleneckPanel.query(service);
    expect(data.bottlenecks.length).toBe(1);
    expect(data.bottlenecks[0].blocksCount).toBe(2);
    expect(data.totalBlocked).toBe(2);
  });

  it('sorts bottlenecks by blocks count descending', async () => {
    const big = makeTask({ id: 'big', status: 'ready', title: 'Big Blocker' });
    const small = makeTask({ id: 'small', status: 'ready', title: 'Small Blocker' });
    const tasks = [
      big, small,
      makeTask({ id: 'b1', status: 'blocked', blockedBy: ['big'] }),
      makeTask({ id: 'b2', status: 'blocked', blockedBy: ['big'] }),
      makeTask({ id: 'b3', status: 'blocked', blockedBy: ['big'] }),
      makeTask({ id: 'b4', status: 'blocked', blockedBy: ['small'] }),
    ];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await bottleneckPanel.query(service);
    expect(data.bottlenecks[0].task.id).toBe('big');
    expect(data.bottlenecks[0].blocksCount).toBe(3);
    expect(data.bottlenecks[1].task.id).toBe('small');
  });

  it('excludes completed blockers', async () => {
    const done = makeTask({ id: 'done', status: 'completed', title: 'Done' });
    const blocked = makeTask({ id: 'b1', status: 'blocked', blockedBy: ['done'] });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([done, blocked]) });
    const data = await bottleneckPanel.query(service);
    expect(data.bottlenecks.length).toBe(0);
  });

  it('excludes completed blocked tasks from count', async () => {
    const blocker = makeTask({ id: 'blocker', status: 'ready', title: 'Blocker' });
    const doneBlocked = makeTask({ id: 'done-b', status: 'completed', blockedBy: ['blocker'] });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([blocker, doneBlocked]) });
    const data = await bottleneckPanel.query(service);
    // Completed tasks are skipped in the loop
    expect(data.bottlenecks.length).toBe(0);
  });

  it('caps at 15 bottlenecks', async () => {
    const blockers = Array.from({ length: 20 }, (_, i) =>
      makeTask({ id: `blocker-${i}`, status: 'ready', title: `Blocker ${i}` })
    );
    const blocked = Array.from({ length: 20 }, (_, i) =>
      makeTask({ id: `blocked-${i}`, status: 'blocked', blockedBy: [`blocker-${i}`] })
    );
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([...blockers, ...blocked]) });
    const data = await bottleneckPanel.query(service);
    expect(data.bottlenecks.length).toBe(15);
  });

  it('caps blocked task titles at 5 and shows overflow in render', async () => {
    const blocker = makeTask({ id: 'mega', status: 'ready', title: 'Mega Blocker' });
    const blocked = Array.from({ length: 8 }, (_, i) =>
      makeTask({ id: `b-${i}`, status: 'blocked', title: `Task ${i}`, blockedBy: ['mega'] })
    );
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([blocker, ...blocked]) });
    const data = await bottleneckPanel.query(service);
    expect(data.bottlenecks[0].blockedTaskTitles.length).toBe(5);

    const md = bottleneckPanel.renderMarkdown(data);
    expect(md).toContain('and 3 more');
  });

  it('handles dangling blockedBy references (task not in list)', async () => {
    const blocked = makeTask({ id: 'b1', status: 'blocked', blockedBy: ['nonexistent-task'] });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([blocked]) });
    const data = await bottleneckPanel.query(service);
    // nonexistent blocker is skipped
    expect(data.bottlenecks.length).toBe(0);
  });

  it('shows in-progress tag for bottlenecks being worked on', async () => {
    const blocker = makeTask({ id: 'ip-blocker', status: 'in-progress', title: 'WIP Blocker' });
    const blocked = makeTask({ id: 'b1', status: 'blocked', blockedBy: ['ip-blocker'] });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([blocker, blocked]) });
    const data = await bottleneckPanel.query(service);
    const md = bottleneckPanel.renderMarkdown(data);
    expect(md).toContain('(in progress)');
  });

  it('handles no project context', async () => {
    const service = mockService({
      getActiveProjectContext: vi.fn().mockResolvedValue(null),
    });
    const data = await bottleneckPanel.query(service);
    expect(data.bottlenecks).toEqual([]);
    expect(data.totalBlocked).toBe(0);
  });

  it('handles complex dependency chains', async () => {
    // A → B → C (A blocks B, B blocks C)
    const a = makeTask({ id: 'a', status: 'ready', title: 'Task A' });
    const b = makeTask({ id: 'b', status: 'blocked', title: 'Task B', blockedBy: ['a'] });
    const c = makeTask({ id: 'c', status: 'blocked', title: 'Task C', blockedBy: ['b'] });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([a, b, c]) });
    const data = await bottleneckPanel.query(service);
    // Both A and B are bottlenecks
    expect(data.bottlenecks.length).toBe(2);
    // A blocks 1 (B), B blocks 1 (C) — same count, order may vary
    expect(data.bottlenecks.every(e => e.blocksCount === 1)).toBe(true);
  });
});

// ============================================================================
// Context Stream Panel
// ============================================================================

describe('contextStreamPanel', () => {
  it('renders empty state', async () => {
    const service = mockService();
    const data = await contextStreamPanel.query(service);
    const md = contextStreamPanel.renderMarkdown(data);
    expect(md).toContain('Context Stream');
    expect(md).toContain('No activity to show');
  });

  it('returns zero counts when no data', async () => {
    const service = mockService();
    const data = await contextStreamPanel.query(service);
    expect(data.counts.waitingOnHuman).toBe(0);
    expect(data.counts.bottlenecks).toBe(0);
    expect(data.counts.activeSessions).toBe(0);
    expect(data.counts.recentDecisions).toBe(0);
    expect(data.entries.length).toBe(0);
  });

  it('merges entries from all four sources', async () => {
    const tasks = [
      makeTask({ id: 'blocker-1', status: 'ready', title: 'Blocker Task' }),
      makeTask({ id: 'blocked-1', status: 'blocked', title: 'Blocked', blockedBy: ['blocker-1'] }),
    ];
    const awaitingTasks = [
      makeTask({ id: 'await-1', status: 'awaiting-human', assignedTo: 'trevor', title: 'Review PR' }),
    ];
    const checkpoints = [
      makeCheckpoint({ taskId: 'await-1', question: 'Approve?', requestedBy: 'agent-1', requestedAt: new Date('2026-03-10T10:00:00Z') }),
    ];
    const decisions = [
      makeDecision({ decision: 'Use SQLite', category: 'architecture', createdAt: new Date('2026-03-10T09:00:00Z') }),
    ];
    const sessions = [
      makeSession({ agentId: 'claude-1', taskId: 'task-active', taskTitle: 'Active Work', startTime: new Date(Date.now() - 15 * 60000).toISOString() }),
    ];

    const service = mockService({
      getTasks: vi.fn().mockResolvedValue(tasks),
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(awaitingTasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
      getActiveSessions: vi.fn().mockResolvedValue(sessions),
    });

    const data = await contextStreamPanel.query(service);
    expect(data.counts.waitingOnHuman).toBe(1);
    expect(data.counts.bottlenecks).toBe(1);
    expect(data.counts.activeSessions).toBe(1);
    expect(data.counts.recentDecisions).toBe(1);
    expect(data.entries.length).toBe(4);
  });

  it('sorts by urgency: waiting-on-human first, then bottleneck, in-progress, decision', async () => {
    const tasks = [
      makeTask({ id: 'blocker-1', status: 'ready', title: 'Blocker' }),
      makeTask({ id: 'blocked-1', status: 'blocked', title: 'Blocked', blockedBy: ['blocker-1'] }),
    ];
    const awaitingTasks = [
      makeTask({ id: 'await-1', status: 'awaiting-human', title: 'Human Task' }),
    ];
    const checkpoints = [
      makeCheckpoint({ taskId: 'await-1', reason: 'Need approval', requestedAt: new Date('2026-03-10T10:00:00Z') }),
    ];
    const decisions = [
      makeDecision({ createdAt: new Date('2026-03-10T09:00:00Z') }),
    ];
    const sessions = [
      makeSession({ taskTitle: 'Active', startTime: new Date(Date.now() - 5 * 60000).toISOString() }),
    ];

    const service = mockService({
      getTasks: vi.fn().mockResolvedValue(tasks),
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(awaitingTasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
      getActiveSessions: vi.fn().mockResolvedValue(sessions),
    });

    const data = await contextStreamPanel.query(service);
    expect(data.entries[0].type).toBe('waiting-on-human');
    expect(data.entries[1].type).toBe('bottleneck');
    expect(data.entries[2].type).toBe('in-progress');
    expect(data.entries[3].type).toBe('decision');
  });

  it('renders summary counts in markdown', async () => {
    const awaitingTasks = [
      makeTask({ id: 'a1', status: 'awaiting-human', title: 'Task A' }),
      makeTask({ id: 'a2', status: 'awaiting-human', title: 'Task B' }),
    ];
    const checkpoints = [
      makeCheckpoint({ taskId: 'a1', requestedAt: new Date() }),
      makeCheckpoint({ taskId: 'a2', requestedAt: new Date() }),
    ];

    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(awaitingTasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });

    const data = await contextStreamPanel.query(service);
    const md = contextStreamPanel.renderMarkdown(data);
    expect(md).toContain('**2** waiting on you');
  });

  it('renders emoji labels for each type', async () => {
    const awaitingTasks = [
      makeTask({ id: 'a1', status: 'awaiting-human', title: 'Review' }),
    ];
    const checkpoints = [
      makeCheckpoint({ taskId: 'a1', reason: 'Approval', requestedAt: new Date() }),
    ];

    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(awaitingTasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });

    const data = await contextStreamPanel.query(service);
    const md = contextStreamPanel.renderMarkdown(data);
    expect(md).toContain('⏳');
    expect(md).toContain('waiting on you');
  });

  it('limits decisions to 10 entries', async () => {
    const decisions = Array.from({ length: 20 }, (_, i) =>
      makeDecision({ id: `d-${i}`, decision: `Decision ${i}`, createdAt: new Date() })
    );
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });

    const data = await contextStreamPanel.query(service);
    const decisionEntries = data.entries.filter(e => e.type === 'decision');
    expect(decisionEntries.length).toBe(10);
    // But counts reflect the full panel data
    expect(data.counts.recentDecisions).toBe(20);
  });

  it('limits bottlenecks to 5 entries', async () => {
    const blockers = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `blocker-${i}`, status: 'ready', title: `Blocker ${i}` })
    );
    const blocked = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `blocked-${i}`, status: 'blocked', blockedBy: [`blocker-${i}`] })
    );
    const service = mockService({
      getTasks: vi.fn().mockResolvedValue([...blockers, ...blocked]),
    });

    const data = await contextStreamPanel.query(service);
    const bottleneckEntries = data.entries.filter(e => e.type === 'bottleneck');
    expect(bottleneckEntries.length).toBe(5);
    // Counts reflect full bottleneck data
    expect(data.counts.bottlenecks).toBe(10);
  });

  it('toJSON returns entries, counts, and generatedAt', async () => {
    const service = mockService();
    const data = await contextStreamPanel.query(service);
    const json = contextStreamPanel.toJSON(data) as { entries: unknown[]; counts: Record<string, number>; generatedAt: string };
    expect(json.entries).toBeDefined();
    expect(json.counts).toBeDefined();
    expect(json.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('toJSON is fully serializable', async () => {
    const awaitingTasks = [
      makeTask({ id: 'a1', status: 'awaiting-human', title: 'Task' }),
    ];
    const checkpoints = [
      makeCheckpoint({ taskId: 'a1', requestedAt: new Date() }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(awaitingTasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });

    const data = await contextStreamPanel.query(service);
    const json = contextStreamPanel.toJSON(data);
    const serialized = JSON.stringify(json);
    const parsed = JSON.parse(serialized);
    expect(parsed.entries.length).toBeGreaterThan(0);
    expect(parsed.counts.waitingOnHuman).toBe(1);
  });

  it('has correct panel metadata', () => {
    expect(contextStreamPanel.id).toBe('stream');
    expect(contextStreamPanel.title).toBe('Context Stream');
  });
});

// ============================================================================
// AX (Agent Experience) Panel
// ============================================================================

describe('axPanel', () => {
  function makeFeedback(overrides: Record<string, unknown> = {}) {
    return {
      id: 'fb-' + Math.random().toString(36).slice(2, 8),
      sessionId: 'sess-1',
      projectId: 'proj-1',
      productivityRating: 4,
      frictionTags: [],
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('renders empty state', async () => {
    const service = mockService();
    const data = await axPanel.query(service);
    const md = axPanel.renderMarkdown(data);
    expect(md).toContain('Agent Experience');
    expect(md).toContain('No agent feedback collected yet');
  });

  it('returns zero counts when no data', async () => {
    const service = mockService();
    const data = await axPanel.query(service);
    expect(data.totalFeedback).toBe(0);
    expect(data.avgProductivityRating).toBeNull();
    expect(data.topFriction).toEqual([]);
    expect(data.recentTrend).toBe('insufficient-data');
  });

  it('calculates average productivity rating', async () => {
    const feedback = [
      makeFeedback({ productivityRating: 5 }),
      makeFeedback({ productivityRating: 3 }),
      makeFeedback({ productivityRating: 4 }),
    ];
    const service = mockService({
      getSessionFeedback: vi.fn().mockResolvedValue(feedback),
    });
    const data = await axPanel.query(service);
    expect(data.avgProductivityRating).toBe(4);
    expect(data.totalFeedback).toBe(3);
  });

  it('builds rating distribution', async () => {
    const feedback = [
      makeFeedback({ productivityRating: 5 }),
      makeFeedback({ productivityRating: 5 }),
      makeFeedback({ productivityRating: 3 }),
      makeFeedback({ productivityRating: 1 }),
    ];
    const service = mockService({
      getSessionFeedback: vi.fn().mockResolvedValue(feedback),
    });
    const data = await axPanel.query(service);
    expect(data.ratingDistribution[5]).toBe(2);
    expect(data.ratingDistribution[3]).toBe(1);
    expect(data.ratingDistribution[1]).toBe(1);
    expect(data.ratingDistribution[2]).toBe(0);
  });

  it('counts friction tags with percentages', async () => {
    const feedback = [
      makeFeedback({ frictionTags: ['tool_confusion', 'slow_response'] }),
      makeFeedback({ frictionTags: ['tool_confusion'] }),
      makeFeedback({ frictionTags: ['missing_files'] }),
    ];
    const service = mockService({
      getSessionFeedback: vi.fn().mockResolvedValue(feedback),
    });
    const data = await axPanel.query(service);
    expect(data.topFriction[0].tag).toBe('tool_confusion');
    expect(data.topFriction[0].count).toBe(2);
    expect(data.topFriction[0].percentage).toBe(50);
  });

  it('limits friction to top 5', async () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const feedback = tags.map(tag => makeFeedback({ frictionTags: [tag] }));
    const service = mockService({
      getSessionFeedback: vi.fn().mockResolvedValue(feedback),
    });
    const data = await axPanel.query(service);
    expect(data.topFriction.length).toBe(5);
  });

  it('renders rating bar in markdown', async () => {
    const feedback = [
      makeFeedback({ productivityRating: 4 }),
      makeFeedback({ productivityRating: 4 }),
    ];
    const service = mockService({
      getSessionFeedback: vi.fn().mockResolvedValue(feedback),
    });
    const data = await axPanel.query(service);
    const md = axPanel.renderMarkdown(data);
    expect(md).toContain('★★★★☆');
    expect(md).toContain('4/5');
    expect(md).toContain('Avg Productivity');
  });

  it('renders friction sources in markdown', async () => {
    const feedback = [
      makeFeedback({ frictionTags: ['tool_confusion'] }),
    ];
    const service = mockService({
      getSessionFeedback: vi.fn().mockResolvedValue(feedback),
    });
    const data = await axPanel.query(service);
    const md = axPanel.renderMarkdown(data);
    expect(md).toContain('Tool confusion');
    expect(md).toContain('Top Friction Sources');
  });

  it('toJSON returns all fields with generatedAt', async () => {
    const service = mockService();
    const data = await axPanel.query(service);
    const json = axPanel.toJSON(data) as Record<string, unknown>;
    expect(json.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(json.totalFeedback).toBe(0);
    expect(json.ratingDistribution).toBeDefined();
  });

  it('toJSON is fully serializable', async () => {
    const feedback = [
      makeFeedback({ productivityRating: 5, frictionTags: ['scope_creep'], notes: 'Great session' }),
    ];
    const service = mockService({
      getSessionFeedback: vi.fn().mockResolvedValue(feedback),
    });
    const data = await axPanel.query(service);
    const json = axPanel.toJSON(data);
    const serialized = JSON.stringify(json);
    const parsed = JSON.parse(serialized);
    expect(parsed.totalFeedback).toBe(1);
    expect(parsed.avgProductivityRating).toBe(5);
  });

  it('has correct panel metadata', () => {
    expect(axPanel.id).toBe('ax');
    expect(axPanel.title).toBe('Agent Experience (AX)');
  });
});

// ============================================================================
// Panel Registry & Dashboard
// ============================================================================

describe('panel registry', () => {
  it('has all 8 core panels registered', () => {
    expect(corePanels.length).toBe(8);
    const ids = corePanels.map(p => p.id);
    expect(ids).toContain('health');
    expect(ids).toContain('human-queue');
    expect(ids).toContain('bottlenecks');
    expect(ids).toContain('sessions');
    expect(ids).toContain('tasks');
    expect(ids).toContain('decisions');
    expect(ids).toContain('stream');
    expect(ids).toContain('ax');
  });

  it('getPanel returns correct panel by id', () => {
    expect(getPanel('health')?.id).toBe('health');
    expect(getPanel('human-queue')?.id).toBe('human-queue');
    expect(getPanel('bottlenecks')?.id).toBe('bottlenecks');
  });

  it('getPanel returns undefined for unknown id', () => {
    expect(getPanel('nonexistent')).toBeUndefined();
  });

  it('all panels have unique ids', () => {
    const ids = corePanels.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all panels have non-empty titles', () => {
    for (const panel of corePanels) {
      expect(panel.title.length).toBeGreaterThan(0);
    }
  });
});

describe('renderPanel', () => {
  it('renders a known panel', async () => {
    const service = mockService();
    const md = await renderPanel('health', service);
    expect(md).toContain('Health Pulse');
  });

  it('throws for unknown panel id', async () => {
    const service = mockService();
    await expect(renderPanel('fake-panel', service)).rejects.toThrow('Unknown panel: fake-panel');
  });
});

describe('renderDashboard', () => {
  it('composes all panels with header and dividers', async () => {
    const service = mockService();
    const md = await renderDashboard(service);
    expect(md).toContain('# Wheelhaus Dashboard');
    expect(md).toContain('Generated:');
    expect(md).toContain('---');
    // Should contain each panel's heading
    expect(md).toContain('Health Pulse');
    expect(md).toContain('Human Queue');
    expect(md).toContain('Bottlenecks');
    expect(md).toContain('Active Sessions');
    expect(md).toContain('Task Graph');
    expect(md).toContain('Decision Stream');
    expect(md).toContain('Context Stream');
    expect(md).toContain('Agent Experience');
  });

  it('handles empty data across all panels', async () => {
    const service = mockService();
    const md = await renderDashboard(service);
    // Should not crash — all panels render their empty states
    expect(md.length).toBeGreaterThan(100);
    expect(md).toContain('No active agent sessions');
    expect(md).toContain('No dependency bottlenecks detected');
    expect(md).toContain('Nothing waiting for human action');
    expect(md).toContain('No decisions recorded yet');
  });

  it('handles large data across all panels', async () => {
    const tasks = [
      ...makeTasks(200, { status: 'ready' }),
      ...makeTasks(50, { status: 'blocked', blockedBy: ['task-0000'] }),
      ...makeTasks(100, { status: 'completed' }),
    ];
    const decisions = Array.from({ length: 100 }, (_, i) =>
      makeDecision({ id: `d-${i}`, decision: `Decision ${i}` })
    );
    const sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession({ agentId: `agent-${i}`, startTime: new Date() })
    );
    const awaitingTasks = makeTasks(30, { status: 'awaiting-human' });

    const service = mockService({
      getTasks: vi.fn().mockResolvedValue(tasks),
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
      getActiveSessions: vi.fn().mockResolvedValue(sessions),
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(awaitingTasks),
    });

    const md = await renderDashboard(service);
    expect(md.length).toBeGreaterThan(500);
    // Shouldn't contain undefined or NaN
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('NaN');
  });
});

// ============================================================================
// toJSON — serializable output for REST/programmatic use
// ============================================================================

describe('toJSON', () => {
  it('all panels implement toJSON', () => {
    for (const panel of corePanels) {
      expect(typeof panel.toJSON).toBe('function');
    }
  });

  it('all panels produce JSON.stringify-safe output', async () => {
    const tasks = [
      makeTask({ status: 'ready', priority: 'critical' }),
      makeTask({ status: 'blocked', blockedBy: ['task-0000'] }),
      makeTask({ status: 'completed' }),
    ];
    const decisions = [makeDecision()];
    const sessions = [makeSession()];
    const awaitingTasks = [makeTask({ status: 'awaiting-human' })];
    const checkpoints = [makeCheckpoint()];

    const service = mockService({
      getTasks: vi.fn().mockResolvedValue(tasks),
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
      getActiveSessions: vi.fn().mockResolvedValue(sessions),
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(awaitingTasks),
      getPendingCheckpoints: vi.fn().mockResolvedValue(checkpoints),
    });

    for (const panel of corePanels) {
      const data = await panel.query(service);
      const json = panel.toJSON(data);
      // Must not throw
      const serialized = JSON.stringify(json);
      expect(serialized).toBeTruthy();
      // Must round-trip
      const parsed = JSON.parse(serialized);
      expect(parsed).toBeTruthy();
    }
  });

  it('healthPanel.toJSON includes computed fields', async () => {
    const tasks = [
      ...makeTasks(3, { status: 'blocked' }),
      ...makeTasks(7, { status: 'ready' }),
    ];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await healthPanel.query(service);
    const json = healthPanel.toJSON(data) as Record<string, unknown>;
    expect(json.status).toBe('constrained');
    expect(json.completionRate).toBe(0);
    expect(json.blockedRatio).toBe(30);
    expect(json.totalTasks).toBe(10);
  });

  it('readyWorkPanel.toJSON serializes tasks with ISO dates', async () => {
    const tasks = [makeTask({ status: 'ready' })];
    const service = mockService({ getTasks: vi.fn().mockResolvedValue(tasks) });
    const data = await readyWorkPanel.query(service);
    const json = readyWorkPanel.toJSON(data) as { tasks: Array<{ updatedAt: string }> };
    expect(json.tasks[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('decisionStreamPanel.toJSON includes category counts', async () => {
    const decisions = [
      makeDecision({ category: 'architecture', id: 'd1' }),
      makeDecision({ category: 'architecture', id: 'd2' }),
      makeDecision({ category: 'tradeoff', id: 'd3' }),
    ];
    const service = mockService({
      getDecisions: vi.fn().mockResolvedValue({ decisions }),
    });
    const data = await decisionStreamPanel.query(service);
    const json = decisionStreamPanel.toJSON(data) as { byCategory: Record<string, number>; count: number };
    expect(json.count).toBe(3);
    expect(json.byCategory.architecture).toBe(2);
    expect(json.byCategory.tradeoff).toBe(1);
  });

  it('sessionsPanel.toJSON adds durationMinutes', async () => {
    const sessions = [
      makeSession({ startTime: new Date(Date.now() - 45 * 60000) }),
    ];
    const service = mockService({ getActiveSessions: vi.fn().mockResolvedValue(sessions) });
    const data = await sessionsPanel.query(service);
    const json = sessionsPanel.toJSON(data) as { sessions: Array<{ durationMinutes: number }> };
    expect(json.sessions[0].durationMinutes).toBeGreaterThanOrEqual(44);
    expect(json.sessions[0].durationMinutes).toBeLessThanOrEqual(46);
  });

  it('humanQueuePanel.toJSON includes assignee counts', async () => {
    const tasks = [
      makeTask({ id: 't1', status: 'awaiting-human', assignedTo: 'alice' }),
      makeTask({ id: 't2', status: 'awaiting-human', assignedTo: 'alice' }),
      makeTask({ id: 't3', status: 'awaiting-human', assignedTo: 'bob' }),
    ];
    const service = mockService({
      getTasksAwaitingHuman: vi.fn().mockResolvedValue(tasks),
    });
    const data = await humanQueuePanel.query(service);
    const json = humanQueuePanel.toJSON(data) as { byAssignee: Record<string, number>; count: number };
    expect(json.count).toBe(3);
    expect(json.byAssignee.alice).toBe(2);
    expect(json.byAssignee.bob).toBe(1);
  });

  it('bottleneckPanel.toJSON strips UnifiedTask to essential fields', async () => {
    const blocker = makeTask({ id: 'blocker', status: 'ready', title: 'Blocker', assignedTo: 'agent-1' });
    const blocked = makeTask({ id: 'b1', status: 'blocked', blockedBy: ['blocker'] });
    const service = mockService({ getTasks: vi.fn().mockResolvedValue([blocker, blocked]) });
    const data = await bottleneckPanel.query(service);
    const json = bottleneckPanel.toJSON(data) as { bottlenecks: Array<{ taskId: string; title: string; blocksCount: number }> };
    expect(json.bottlenecks[0].taskId).toBe('blocker');
    expect(json.bottlenecks[0].title).toBe('Blocker');
    expect(json.bottlenecks[0].blocksCount).toBe(1);
    // Should NOT include full UnifiedTask fields like createdAt, description, etc.
    expect((json.bottlenecks[0] as Record<string, unknown>).createdAt).toBeUndefined();
    expect((json.bottlenecks[0] as Record<string, unknown>).description).toBeUndefined();
  });
});

// ============================================================================
// queryPanelJSON & queryDashboardJSON
// ============================================================================

describe('queryPanelJSON', () => {
  it('returns panel id, title, and data', async () => {
    const service = mockService();
    const result = await queryPanelJSON('health', service);
    expect(result.panel).toBe('health');
    expect(result.title).toBe('Health Pulse');
    expect(result.data).toBeTruthy();
  });

  it('throws for unknown panel', async () => {
    const service = mockService();
    await expect(queryPanelJSON('nonexistent', service)).rejects.toThrow('Unknown panel: nonexistent');
  });
});

describe('queryDashboardJSON', () => {
  it('returns all panels with generatedAt timestamp', async () => {
    const service = mockService();
    const result = await queryDashboardJSON(service);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(result.panels)).toContain('health');
    expect(Object.keys(result.panels)).toContain('human-queue');
    expect(Object.keys(result.panels)).toContain('bottlenecks');
    expect(Object.keys(result.panels)).toContain('sessions');
    expect(Object.keys(result.panels)).toContain('tasks');
    expect(Object.keys(result.panels)).toContain('decisions');
    expect(Object.keys(result.panels)).toContain('stream');
    expect(Object.keys(result.panels)).toContain('ax');
  });

  it('produces fully serializable output', async () => {
    const service = mockService();
    const result = await queryDashboardJSON(service);
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized);
    expect(Object.keys(parsed.panels).length).toBe(8);
  });
});
