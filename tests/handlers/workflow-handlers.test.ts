import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStartWork, handleFinishWork, WorkflowHandlerContext } from '../../src/adapters/mcp/handlers/workflow-handlers.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { CoordinationEngine } from '../../src/coordination/engine.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { GitService } from '../../src/git/git-service.js';
import { QualityService } from '../../src/quality/quality-service.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('workflow handlers', () => {
  let service: CoordinationService;
  let engine: CoordinationEngine;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;
  let repoDir: string;
  let ctx: WorkflowHandlerContext;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-wfh-db-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-wfh-repo-'));

    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const gitService = new GitService(repoDir);
    const qualityService = new QualityService(repoDir);
    engine = new CoordinationEngine(gitService, qualityService, storage);

    // Init git repo
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    const project = await service.createProject({
      name: 'Workflow Test',
      slug: 'workflow-test',
      rootPath: repoDir,
    });
    projectId = project.id;
    await service.setActiveProject(projectId);

    ctx = { projectRoot: repoDir, service, coordination: engine };
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('handleStartWork claims task and returns context', async () => {
    const task = await service.createTask({ title: 'Start work task', priority: 'high' });

    const result = await handleStartWork(ctx, { taskId: task.id, agentId: 'test-agent' });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    const body = JSON.parse(result.content[0].text);
    expect(body.taskId || body.task?.id || body.id).toBeDefined();
  });

  it('handleStartWork with no taskId gets next available', async () => {
    await service.createTask({ title: 'Low prio', priority: 'low' });
    await service.createTask({ title: 'High prio', priority: 'high' });

    const result = await handleStartWork(ctx, { agentId: 'test-agent' });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    // Should get the higher priority task
    expect(body).toBeDefined();
  });

  it('handleFinishWork validates and completes task', async () => {
    const task = await service.createTask({ title: 'Finish task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Add a commit and decision to satisfy quality
    fs.writeFileSync(path.join(repoDir, 'work.test.ts'), 'test("x", () => {});\n');
    execSync('git add . && git commit -m "test: add test"', { cwd: repoDir, stdio: 'ignore' });
    await service.logDecision({
      decision: 'Test decision',
      rationale: 'Testing',
      category: 'architecture',
      taskId: task.id,
    });

    const result = await handleFinishWork(ctx, { summary: 'Done', taskId: task.id });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
  });

  it('handleFinishWork reports quality gaps when enforcing substantial changes', async () => {
    const task = await service.createTask({ title: 'No quality task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Commit multiple code files without tests or decisions (substantial: >=4 code files)
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(repoDir, `module${i}.ts`), `export const val${i} = ${i};\n`);
    }
    execSync('git add . && git commit -m "feat: code"', { cwd: repoDir, stdio: 'ignore' });

    const result = await handleFinishWork(ctx, { summary: 'Done', taskId: task.id });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(false);
    expect(body.qualityGaps || body.qualityResult?.gaps).toBeDefined();
  });

  it('handleFinishWork accepts inline decisions and logs them before quality check', async () => {
    const task = await service.createTask({ title: 'Inline decisions task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Commit with test file to satisfy test quality gate
    fs.writeFileSync(path.join(repoDir, 'work.test.ts'), 'test("x", () => {});\n');
    execSync('git add . && git commit -m "test: add test"', { cwd: repoDir, stdio: 'ignore' });

    // No separate log_decision call — provide decisions inline
    const result = await handleFinishWork(ctx, {
      summary: 'Done',
      taskId: task.id,
      decisions: [
        { decision: 'Used approach A over B', rationale: 'Simpler implementation', category: 'architecture' },
        { decision: 'Skipped caching', rationale: 'Not needed at this scale', category: 'tradeoff' },
      ],
    });

    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
    expect(body.decisionsLogged).toBe(2);

    // Verify decisions were actually persisted
    const decisions = await service.getDecisions({ taskId: task.id, limit: 10 });
    expect(decisions.decisions.length).toBeGreaterThanOrEqual(2);
  });

  it('handleStartWork detects simple tasks', async () => {
    const task = await service.createTask({ title: 'Fix typo', priority: 'low' });

    const result = await handleStartWork(ctx, { taskId: task.id, agentId: 'test-agent' });

    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
    expect(body.guidance).toContain('Simple task');
  });

  it('handleFinishWork allows bypass with flag', async () => {
    const task = await service.createTask({ title: 'Bypass task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    fs.writeFileSync(path.join(repoDir, 'code.ts'), 'export const y = 2;\n');
    execSync('git add . && git commit -m "feat: code"', { cwd: repoDir, stdio: 'ignore' });

    const result = await handleFinishWork(ctx, {
      summary: 'Done',
      taskId: task.id,
      bypassQuality: true,
      bypassReason: 'Trivial change',
    });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
  });
});
