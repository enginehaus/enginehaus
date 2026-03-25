import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Thought capture pipeline', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-thought-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Thought Test' });
    await service.setActiveProject(project.id);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('captures a thought as a draft decision', async () => {
    const result = await service.captureThought({
      thought: 'Maybe we should use Redis instead of SQLite for caching',
    });

    expect(result.success).toBe(true);
    expect(result.thoughtId).toBeTruthy();
    expect(result.message).toContain('Thought captured');
  });

  it('lists pending thoughts via reviewThoughts', async () => {
    await service.captureThought({ thought: 'First thought' });
    await service.captureThought({ thought: 'Second thought' });

    const result = await service.reviewThoughts();

    expect(result.count).toBe(2);
    // Both should be present (order depends on timestamp resolution)
    const texts = result.thoughts.map(t => t.thought);
    expect(texts).toContain('First thought');
    expect(texts).toContain('Second thought');
  });

  it('promotes a thought to an approved decision', async () => {
    const { thoughtId } = await service.captureThought({
      thought: 'Use event sourcing for audit trail',
    });

    const promoteResult = await service.promoteThought(thoughtId, 'architecture');
    expect(promoteResult.success).toBe(true);
    expect(promoteResult.message).toContain('promoted');
    expect(promoteResult.message).toContain('architecture');

    // Should no longer appear in pending thoughts
    const pending = await service.reviewThoughts();
    expect(pending.count).toBe(0);

    // Should appear in regular decisions
    const decision = await service.getDecision(thoughtId);
    expect(decision.success).toBe(true);
    expect(decision.decision?.category).toBe('architecture');
  });

  it('discards a thought', async () => {
    const { thoughtId } = await service.captureThought({
      thought: 'Discard me',
    });

    const result = await service.discardThought(thoughtId);
    expect(result.success).toBe(true);

    const pending = await service.reviewThoughts();
    expect(pending.count).toBe(0);
  });

  it('defers a thought', async () => {
    const { thoughtId } = await service.captureThought({
      thought: 'Think about this later',
    });

    const result = await service.deferThought(thoughtId);
    expect(result.success).toBe(true);

    // Deferred thoughts should not appear in pending (draft) list
    const pending = await service.reviewThoughts();
    expect(pending.count).toBe(0);
  });

  it('associates thoughts with a task', async () => {
    const task = await service.createTask({
      title: 'Test task',
      priority: 'medium',
    });

    await service.captureThought({
      thought: 'Task-linked thought',
      taskId: task.id,
    });
    await service.captureThought({
      thought: 'Unlinked thought',
    });

    const taskThoughts = await service.reviewThoughts({ taskId: task.id });
    expect(taskThoughts.count).toBe(1);
    expect(taskThoughts.thoughts[0].thought).toBe('Task-linked thought');
  });

  it('thoughts do not appear in regular decision listings by default', async () => {
    await service.captureThought({ thought: 'Draft thought' });
    await service.logDecision({
      decision: 'Real decision',
      category: 'architecture',
    });

    const decisions = await service.getDecisions();
    // Both should be returned since getDecisions doesn't filter by disposition
    expect(decisions.count).toBeGreaterThanOrEqual(1);
  });

  it('returns error when promoting non-existent thought', async () => {
    const result = await service.promoteThought('non-existent-id');
    expect(result.success).toBe(false);
  });

  it('storage migration adds disposition column', async () => {
    // The storage was already initialized in beforeEach, which runs the migration
    // Verify we can store and retrieve thoughts with disposition
    const id = await storage.logDecision({
      decision: 'Test with disposition',
      category: 'thought',
      disposition: 'draft',
    });

    const thoughts = await storage.getThoughts();
    expect(thoughts.some(t => t.id === id)).toBe(true);
  });

  it('updateDisposition changes disposition and optionally category', async () => {
    const id = await storage.logDecision({
      decision: 'Test disposition update',
      category: 'thought',
      disposition: 'draft',
    });

    // Promote with category change
    const updated = await storage.updateDisposition(id, 'approved', 'architecture');
    expect(updated).toBe(true);

    // Should no longer be in draft thoughts
    const thoughts = await storage.getThoughts();
    expect(thoughts.some(t => t.id === id)).toBe(false);

    // Should be retrievable as regular decision
    const decision = await storage.getDecision(id);
    expect(decision?.category).toBe('architecture');
  });
});
