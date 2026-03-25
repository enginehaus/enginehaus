import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator, TaskEventPayload } from '../../src/events/event-orchestrator.js';
import { ViewMaterializer } from '../../src/views/view-materializer.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Parallel Agent Safety Tests
 *
 * Proves that the "Structure > Instruction" principle works:
 * Multiple agents can work simultaneously on non-conflicting tasks,
 * and the system structurally prevents conflicts without relying on
 * agents following instructions.
 */
describe('Parallel agent coordination (structural safety)', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let materializer: ViewMaterializer;
  let dbDir: string;
  let repoDir: string;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-parallel-db-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-parallel-repo-'));
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);
    materializer = new ViewMaterializer(events);
    await materializer.start();

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    const project = await service.createProject({
      name: 'Parallel Test',
      slug: 'parallel-test',
      rootPath: repoDir,
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    materializer.stop();
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('three agents claim non-conflicting tasks simultaneously', async () => {
    const frontend = await service.createTask({
      title: 'Build login UI',
      priority: 'high',
      files: ['src/ui/login.tsx', 'src/ui/login.css'],
    });
    const backend = await service.createTask({
      title: 'Auth API endpoint',
      priority: 'high',
      files: ['src/api/auth.ts', 'src/api/middleware.ts'],
    });
    const infra = await service.createTask({
      title: 'Deploy config',
      priority: 'medium',
      files: ['infra/terraform.tf', 'infra/variables.tf'],
    });

    // All three agents claim simultaneously - no conflicts
    const [r1, r2, r3] = await Promise.all([
      service.claimTask(frontend.id, 'agent-frontend'),
      service.claimTask(backend.id, 'agent-backend'),
      service.claimTask(infra.id, 'agent-infra'),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(true);

    // Verify all three sessions are active
    const snapshot = materializer.getSnapshot();
    expect(snapshot.sessions.size).toBe(3);
  });

  it('file conflict blocks one agent while others proceed', async () => {
    const rejections: TaskEventPayload[] = [];
    events.on('task.claim_rejected', (e: TaskEventPayload) => rejections.push(e));

    const task1 = await service.createTask({
      title: 'Refactor auth module',
      priority: 'high',
      files: ['src/auth/service.ts', 'src/auth/types.ts'],
    });
    const task2 = await service.createTask({
      title: 'Add auth tests',
      priority: 'medium',
      files: ['src/auth/service.ts', 'tests/auth.test.ts'], // overlaps service.ts
    });
    const task3 = await service.createTask({
      title: 'Update docs',
      priority: 'low',
      files: ['docs/api.md'],
    });

    // Agent 1 claims auth refactor
    const claim1 = await service.claimTask(task1.id, 'agent-1');
    expect(claim1.success).toBe(true);

    // Agent 2 tries auth tests (blocked by file conflict) AND Agent 3 tries docs (succeeds)
    const [claim2, claim3] = await Promise.all([
      service.claimTask(task2.id, 'agent-2'),
      service.claimTask(task3.id, 'agent-3'),
    ]);

    expect(claim2.success).toBe(false);
    expect(claim2.fileConflicts).toBeDefined();
    expect(claim3.success).toBe(true);

    // Rejection event was emitted to feed
    expect(rejections.length).toBe(1);
    expect(rejections[0].agentId).toBe('agent-2');
  });

  it('dependency chain enforces ordering across agents', async () => {
    // Create a 3-step pipeline: schema → migration → seed
    const schema = await service.createTask({ title: 'Define schema', priority: 'high' });
    const migration = await service.createTask({ title: 'Write migration', priority: 'high' });
    const seed = await service.createTask({ title: 'Seed data', priority: 'medium' });

    await service.addTaskDependency(schema.id, migration.id);
    await service.addTaskDependency(migration.id, seed.id);

    // Only schema is claimable
    const claimSchema = await service.claimTask(schema.id, 'agent-1');
    const claimMigration = await service.claimTask(migration.id, 'agent-2');
    const claimSeed = await service.claimTask(seed.id, 'agent-3');

    expect(claimSchema.success).toBe(true);
    expect(claimMigration.success).toBe(false);
    expect(claimMigration.dependencyBlock).toBeDefined();
    expect(claimSeed.success).toBe(false);
    expect(claimSeed.dependencyBlock).toBeDefined();

    // Complete schema → migration unblocks
    await storage.updateTask(schema.id, { status: 'completed' });
    await storage.onTaskCompleted(schema.id);

    const claimMigration2 = await service.claimTask(migration.id, 'agent-2');
    expect(claimMigration2.success).toBe(true);

    // Seed still blocked (migration not done)
    const claimSeed2 = await service.claimTask(seed.id, 'agent-3');
    expect(claimSeed2.success).toBe(false);

    // Complete migration → seed unblocks
    await storage.updateTask(migration.id, { status: 'completed' });
    await storage.onTaskCompleted(migration.id);

    const claimSeed3 = await service.claimTask(seed.id, 'agent-3');
    expect(claimSeed3.success).toBe(true);
  });

  it('getNextTaskWithResponse routes agents to safe tasks automatically', async () => {
    // Set up a scenario: agent-1 is working on shared files,
    // agent-2 needs a task but the highest priority one conflicts
    const highConflict = await service.createTask({
      title: 'High priority conflicting',
      priority: 'high',
      files: ['src/core.ts'],
    });
    await service.createTask({
      title: 'Medium safe task',
      priority: 'medium',
      files: ['src/utils.ts'],
    });

    // Agent-1 claims the file
    await service.claimTask(highConflict.id, 'agent-1');

    // Agent-2 uses getNextTaskWithResponse - should skip conflicting and get safe task
    const result = await service.getNextTaskWithResponse({ agentId: 'agent-2' });

    expect(result.success).toBe(true);
    expect(result.task!.title).toBe('Medium safe task');
  });

  it('combined file + dependency blocking with feed visibility', async () => {
    const rejections: TaskEventPayload[] = [];
    events.on('task.claim_rejected', (e: TaskEventPayload) => rejections.push(e));

    // Task A: foundation work
    const foundation = await service.createTask({
      title: 'Foundation',
      priority: 'high',
      files: ['src/base.ts'],
    });
    // Task B: depends on A, shares files with C
    const dependent = await service.createTask({
      title: 'Dependent + Conflict',
      priority: 'high',
      files: ['src/feature.ts', 'src/shared.ts'],
    });
    // Task C: no dependency, but shares files with B
    const conflicting = await service.createTask({
      title: 'File Conflict',
      priority: 'medium',
      files: ['src/shared.ts'],
    });

    // Set up dependency: B depends on A
    await service.addTaskDependency(foundation.id, dependent.id);

    // Agent-1 claims foundation
    const r1 = await service.claimTask(foundation.id, 'agent-1');
    expect(r1.success).toBe(true);

    // Agent-2 tries B (blocked by dependency)
    const r2 = await service.claimTask(dependent.id, 'agent-2');
    expect(r2.success).toBe(false);
    expect(r2.dependencyBlock).toBeDefined();

    // Agent-3 claims C (succeeds - no dependency, no file conflict yet)
    const r3 = await service.claimTask(conflicting.id, 'agent-3');
    expect(r3.success).toBe(true);

    // Complete foundation → B unblocks from dependency
    await storage.updateTask(foundation.id, { status: 'completed' });
    await storage.onTaskCompleted(foundation.id);

    // Agent-2 tries B again - now blocked by file conflict with C (shared.ts)
    const r4 = await service.claimTask(dependent.id, 'agent-2');
    expect(r4.success).toBe(false);
    expect(r4.fileConflicts).toBeDefined();

    // Feed shows both rejections
    expect(rejections.length).toBe(2);
    expect(rejections[0].rejectionReason).toBe('dependency_block');
    expect(rejections[1].rejectionReason).toBe('file_conflict');

    // Coordination feed items visible in materializer
    const snapshot = materializer.getSnapshot();
    const coordItems = snapshot.decisions.filter(d => d.category === 'coordination');
    expect(coordItems.length).toBe(2);
  });

  it('agent capacity limit prevents over-commitment', async () => {
    const task1 = await service.createTask({ title: 'Task 1', priority: 'high' });
    const task2 = await service.createTask({ title: 'Task 2', priority: 'medium' });

    // Claim first task with capacity=1
    const r1 = await service.claimTask(task1.id, 'agent-1', { capacity: 1 });
    expect(r1.success).toBe(true);

    // Same agent tries second task - capacity exceeded
    const r2 = await service.claimTask(task2.id, 'agent-1', { capacity: 1 });
    expect(r2.success).toBe(false);
    expect(r2.capacityExceeded).toBeDefined();
    expect(r2.capacityExceeded!.capacity).toBe(1);
  });
});
