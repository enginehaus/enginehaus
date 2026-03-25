import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Audit events for all operations', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-audit-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Audit Test Project' });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  async function getAuditEvents(eventType: string) {
    return storage.queryAuditLog({ eventTypes: [eventType] });
  }

  it('createProject generates audit event', async () => {
    // createProject already called in beforeEach
    const events = await getAuditEvents('project.created');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].action).toContain('Audit Test Project');
  });

  it('startTaskPhases generates audit event', async () => {
    const task = await service.createTask({ title: 'Phase test task' });
    // Don't claim task — claimTask already initializes phases
    await service.startTaskPhases(task.id);

    const auditEvents = await getAuditEvents('task.phases_started');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].resourceId).toBe(task.id);
    expect(auditEvents[0].action).toContain('Phase test task');
  });

  it('advanceTaskPhase generates audit event', async () => {
    const task = await service.createTask({ title: 'Advance phase task' });
    await service.claimTask(task.id, 'agent-1');
    // claimTask already initializes phases; use valid 7+ char hex SHA
    await service.advanceTaskPhase(task.id, 'abc1234', 'Done with planning');

    const auditEvents = await getAuditEvents('task.phase_advanced');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('Phase advanced');
  });

  it('skipTaskPhase generates audit event', async () => {
    const task = await service.createTask({ title: 'Skip phase task' });
    await service.claimTask(task.id, 'agent-1');
    // claimTask already initializes phases
    await service.skipTaskPhase(task.id, true);

    const auditEvents = await getAuditEvents('task.phase_skipped');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('Phase skipped');
  });

  it('addTaskDependency generates audit event', async () => {
    const blocker = await service.createTask({ title: 'Blocker task' });
    const blocked = await service.createTask({ title: 'Blocked task' });
    await service.addTaskDependency(blocker.id, blocked.id);

    const auditEvents = await getAuditEvents('task.dependency_added');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('Dependency added');
  });

  it('removeTaskDependency generates audit event', async () => {
    const blocker = await service.createTask({ title: 'Blocker task' });
    const blocked = await service.createTask({ title: 'Blocked task' });
    await service.addTaskDependency(blocker.id, blocked.id);
    await service.removeTaskDependency(blocker.id, blocked.id);

    const auditEvents = await getAuditEvents('task.dependency_removed');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('no longer blocked');
  });

  it('createInitiative generates audit event', async () => {
    await service.createInitiative({
      title: 'Test Initiative',
      successCriteria: 'All green',
    });

    const auditEvents = await getAuditEvents('initiative.created');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('Test Initiative');
  });

  it('linkTaskToInitiative generates audit event', async () => {
    const initiative = await service.createInitiative({ title: 'Link Test' });
    const task = await service.createTask({ title: 'Linked task' });
    await service.linkTaskToInitiative({
      taskId: task.id,
      initiativeId: initiative.initiativeId!,
      contributionNotes: 'Helps',
    });

    const auditEvents = await getAuditEvents('initiative.task_linked');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('Linked task');
  });

  it('recordInitiativeOutcome generates audit event', async () => {
    const initiative = await service.createInitiative({ title: 'Outcome Test' });
    await service.recordInitiativeOutcome({
      initiativeId: initiative.initiativeId!,
      status: 'succeeded',
      outcomeNotes: 'All metrics met',
    });

    const auditEvents = await getAuditEvents('initiative.outcome_recorded');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('succeeded');
  });

  it('recordTaskOutcome generates audit event', async () => {
    const task = await service.createTask({ title: 'Outcome task' });
    await service.claimTask(task.id, 'agent-1');
    await service.recordTaskOutcome({
      taskId: task.id,
      status: 'shipped',
      prMerged: true,
    });

    const auditEvents = await getAuditEvents('task.outcome_recorded');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('shipped');
  });

  it('updateTask generates field-level audit with before/after values', async () => {
    const task = await service.createTask({ title: 'Original title', description: 'Original desc' });

    await service.updateTask(task.id, {
      title: 'Updated title',
      priority: 'high',
    });

    const auditEvents = await getAuditEvents('task.fields_updated');
    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toContain('title');
    expect(auditEvents[0].action).toContain('priority');

    const metadata = typeof auditEvents[0].metadata === 'string' ? JSON.parse(auditEvents[0].metadata) : auditEvents[0].metadata || {};
    expect(metadata.changedFields.title.before).toBe('Original title');
    expect(metadata.changedFields.title.after).toBe('Updated title');
    expect(metadata.changedFields.priority).toBeDefined();
  });

  it('updateTask detects cross-agent overwrite', async () => {
    const task = await service.createTask({ title: 'Agent 1 title' });

    // First agent modifies the task
    await service.updateTask(task.id, {
      description: 'Agent 1 wrote this',
      lastModifiedBy: 'claude-code',
    });

    // Second agent overwrites
    await service.updateTask(task.id, {
      description: 'Agent 2 overwrote this',
      lastModifiedBy: 'gemini-cli',
    });

    const auditEvents = await getAuditEvents('task.fields_updated');
    // Should have 2 events (one per update)
    expect(auditEvents.length).toBe(2);

    // Find the cross-agent overwrite event (order is nondeterministic when timestamps match)
    const crossAgentEvent = auditEvents.find(e => {
      const m = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata || {};
      return m.crossAgentOverwrite === true;
    });
    expect(crossAgentEvent).toBeDefined();
    const metadata = typeof crossAgentEvent!.metadata === 'string' ? JSON.parse(crossAgentEvent!.metadata) : crossAgentEvent!.metadata || {};
    expect(metadata.previousModifiedBy).toBe('claude-code');
    expect(metadata.changedFields.description.before).toBe('Agent 1 wrote this');
    expect(metadata.changedFields.description.after).toBe('Agent 2 overwrote this');
  });

  it('updateTask does not flag same-agent updates as cross-agent', async () => {
    const task = await service.createTask({ title: 'My task' });

    await service.updateTask(task.id, {
      title: 'First edit',
      lastModifiedBy: 'claude-code',
    });

    await service.updateTask(task.id, {
      title: 'Second edit',
      lastModifiedBy: 'claude-code',
    });

    const auditEvents = await getAuditEvents('task.fields_updated');
    // Most recent event (index 0, DESC order)
    const lastEvent = auditEvents[0];
    const metadata = typeof lastEvent.metadata === 'string' ? JSON.parse(lastEvent.metadata) : lastEvent.metadata || {};
    expect(metadata.crossAgentOverwrite).toBe(false);
  });

  it('updateTaskWithResponse includes cross-agent warnings', async () => {
    const task = await service.createTask({ title: 'Shared task' });

    // First agent sets description
    await service.updateTask(task.id, {
      description: 'Agent A wrote this',
      lastModifiedBy: 'claude-code',
    });

    // Second agent overwrites via MCP path
    const result = await service.updateTaskWithResponse({
      taskId: task.id,
      description: 'Agent B overwrote this',
      lastModifiedBy: 'gemini-cli',
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBe(1);
    expect(result.warnings![0]).toContain('Cross-agent overwrite');
    expect(result.warnings![0]).toContain('gemini-cli');
    expect(result.warnings![0]).toContain('claude-code');
  });

  // ── Optimistic Locking ──────────────────────────────────────────────

  it('version increments on each update', async () => {
    const task = await service.createTask({ title: 'Versioned task' });
    const initial = await storage.getTask(task.id);
    expect(initial!.version).toBe(1);

    await service.updateTask(task.id, { title: 'v2' });
    const v2 = await storage.getTask(task.id);
    expect(v2!.version).toBe(2);

    await service.updateTask(task.id, { title: 'v3' });
    const v3 = await storage.getTask(task.id);
    expect(v3!.version).toBe(3);
  });

  it('expectedVersion rejects stale updates', async () => {
    const task = await service.createTask({ title: 'Locked task' });

    // Agent A reads version 1
    const readVersion = 1;

    // Agent B updates (bumps to version 2)
    await service.updateTask(task.id, { title: 'Agent B edit' });

    // Agent A tries to update with stale version
    const result = await service.updateTaskWithResponse({
      taskId: task.id,
      title: 'Agent A stale edit',
      expectedVersion: readVersion,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Version conflict');
    expect(result.error).toContain('version 1');
    expect(result.error).toContain('version 2');
  });

  it('expectedVersion allows current-version updates', async () => {
    const task = await service.createTask({ title: 'Locked task' });

    const result = await service.updateTaskWithResponse({
      taskId: task.id,
      title: 'Valid edit',
      expectedVersion: 1,
    });

    expect(result.success).toBe(true);
    expect(result.task!.version).toBe(2);
  });

  // ── Append Mode ────────────────────────────────────────────────────

  it('writeMode append adds content below existing description', async () => {
    const task = await service.createTask({
      title: 'Shared task',
      description: 'Original description by Agent A',
    });

    const result = await service.updateTaskWithResponse({
      taskId: task.id,
      description: 'Additional context from Agent B',
      writeMode: 'append',
      lastModifiedBy: 'gemini-cli',
    });

    expect(result.success).toBe(true);
    expect(result.task!.description).toContain('Original description by Agent A');
    expect(result.task!.description).toContain('Additional context from Agent B');
    expect(result.task!.description).toContain('gemini-cli');
    expect(result.task!.description).toContain('---');
  });

  it('writeMode replace overwrites description (default behavior)', async () => {
    const task = await service.createTask({
      title: 'Replace task',
      description: 'Original',
    });

    const result = await service.updateTaskWithResponse({
      taskId: task.id,
      description: 'Replaced',
      writeMode: 'replace',
    });

    expect(result.success).toBe(true);
    expect(result.task!.description).toBe('Replaced');
  });

  it('writeMode append on empty description just sets it', async () => {
    const task = await service.createTask({ title: 'Empty desc task' });

    const result = await service.updateTaskWithResponse({
      taskId: task.id,
      description: 'First content',
      writeMode: 'append',
      lastModifiedBy: 'claude-code',
    });

    expect(result.success).toBe(true);
    // Empty string description means append should just set it
    expect(result.task!.description).toBe('First content');
  });

  it('logDecision emits event via event orchestrator', async () => {
    // Track emitted events via wildcard listener
    const emittedEventTypes: string[] = [];
    events.on('*', (event: { eventType: string }) => {
      emittedEventTypes.push(event.eventType);
    });

    await service.logDecision({
      decision: 'Use SQLite',
      rationale: 'Simple deployment',
      category: 'architecture',
    });

    // Verify audit event exists (was already there before fix)
    const auditEvents = await getAuditEvents('decision.logged');
    expect(auditEvents.length).toBe(1);

    // The emit call was the fix — verify emitDecisionLogged was called
    expect(emittedEventTypes).toContain('decision.logged');
  });
});
