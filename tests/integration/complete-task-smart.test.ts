import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('completeTaskSmart integration', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;
  let repoDir: string;
  let projectId: string;

  beforeEach(async () => {
    // Separate dirs for DB storage and git repo
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-smart-db-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-smart-repo-'));

    // Initialize storage and service
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    // Initialize git repo
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    // Initial commit so branch exists
    fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
    execSync('git add .gitkeep && git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

    // Create project pointing to the repo
    const project = await service.createProject({
      name: 'Smart Test Project',
      slug: 'smart-test',
      rootPath: repoDir,
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('completes task with git analysis', async () => {
    const task = await service.createTask({ title: 'Feature task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Make a commit in the repo
    fs.writeFileSync(path.join(repoDir, 'feature.ts'), 'export const x = 1;\n');
    execSync('git add feature.ts && git commit -m "feat: add feature"', {
      cwd: repoDir,
      stdio: 'ignore',
    });

    // Log a decision and add a test file to satisfy quality gates
    await service.logDecision({
      decision: 'Use simple export',
      rationale: 'Minimal implementation',
      category: 'architecture',
      taskId: task.id,
    });
    fs.writeFileSync(path.join(repoDir, 'feature.test.ts'), 'test("x", () => {});\n');
    execSync('git add feature.test.ts && git commit -m "test: add test"', {
      cwd: repoDir,
      stdio: 'ignore',
    });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Added feature with test',
      defaultProjectRoot: repoDir,
      enforceQuality: true,
    });

    expect(result.success).toBe(true);
    expect(result.gitAnalysis).toBeDefined();
    expect(result.gitAnalysis!.commits).toBeGreaterThanOrEqual(1);
    expect(result.gitAnalysis!.filesChanged).toBeGreaterThanOrEqual(1);
  });

  it('handles task with no commits gracefully', async () => {
    const task = await service.createTask({ title: 'No commits task', priority: 'low' });
    await service.claimTask(task.id, 'test-agent');

    // Use a future sessionStartTime so no commits match
    const futureTime = new Date(Date.now() + 60000).toISOString();
    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Nothing committed',
      defaultProjectRoot: repoDir,
      sessionStartTime: futureTime,
      enforceQuality: false,
    });

    expect(result.success).toBe(true);
    expect(result.gitAnalysis).toBeDefined();
    expect(result.gitAnalysis!.commits).toBe(0);
    expect(result.gitAnalysis!.filesChanged).toBe(0);
  });

  it('blocks on uncommitted changes', async () => {
    const task = await service.createTask({ title: 'Dirty tree task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Create a file but don't commit
    fs.writeFileSync(path.join(repoDir, 'uncommitted.ts'), 'const y = 2;\n');

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Has uncommitted changes',
      defaultProjectRoot: repoDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('uncommitted');
    expect(result.uncommittedChanges).toBeDefined();
    expect(
      result.uncommittedChanges!.untrackedFiles.length +
      result.uncommittedChanges!.modifiedFiles.length +
      result.uncommittedChanges!.stagedFiles.length
    ).toBeGreaterThan(0);
  });

  it('blocks on unpushed commits', async () => {
    // Create a bare repo to act as "remote"
    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-smart-bare-'));
    execSync('git init --bare', { cwd: bareDir, stdio: 'ignore' });

    // Add the bare repo as a remote and push initial commit
    execSync(`git remote add origin ${bareDir}`, { cwd: repoDir, stdio: 'ignore' });
    execSync('git push -u origin HEAD', { cwd: repoDir, stdio: 'ignore' });

    const task = await service.createTask({ title: 'Unpushed task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Make a commit but don't push
    fs.writeFileSync(path.join(repoDir, 'local-only.ts'), 'export const x = 1;\n');
    execSync('git add local-only.ts && git commit -m "feat: local only"', {
      cwd: repoDir,
      stdio: 'ignore',
    });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Has unpushed commits',
      defaultProjectRoot: repoDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('unpushed');
    expect(result.unpushedCommits).toBeDefined();
    expect(result.unpushedCommits!.unpushedCount).toBeGreaterThan(0);

    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it('completes when commits are pushed', async () => {
    // Create a bare repo to act as "remote"
    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-smart-bare-'));
    execSync('git init --bare', { cwd: bareDir, stdio: 'ignore' });

    // Add the bare repo as a remote and push initial commit
    execSync(`git remote add origin ${bareDir}`, { cwd: repoDir, stdio: 'ignore' });
    execSync('git push -u origin HEAD', { cwd: repoDir, stdio: 'ignore' });

    const task = await service.createTask({ title: 'Pushed task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Make a commit AND push it
    fs.writeFileSync(path.join(repoDir, 'pushed.ts'), 'export const y = 2;\n');
    execSync('git add pushed.ts && git commit -m "feat: pushed feature"', {
      cwd: repoDir,
      stdio: 'ignore',
    });
    // Log a decision and add test to satisfy quality gates
    await service.logDecision({
      decision: 'Use simple export',
      rationale: 'Minimal implementation',
      category: 'architecture',
      taskId: task.id,
    });
    fs.writeFileSync(path.join(repoDir, 'pushed.test.ts'), 'test("y", () => {});\n');
    execSync('git add pushed.test.ts && git commit -m "test: add test"', {
      cwd: repoDir,
      stdio: 'ignore',
    });
    execSync('git push', { cwd: repoDir, stdio: 'ignore' });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'All pushed',
      defaultProjectRoot: repoDir,
      enforceQuality: true,
    });

    expect(result.success).toBe(true);

    fs.rmSync(bareDir, { recursive: true, force: true });
  });

  it('skips push check when no remote configured', async () => {
    // repoDir has no remote by default in this test setup
    const task = await service.createTask({ title: 'No remote task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Make a commit (no remote to push to — check should be a no-op)
    fs.writeFileSync(path.join(repoDir, 'no-remote.ts'), 'export const z = 3;\n');
    execSync('git add no-remote.ts && git commit -m "feat: no remote"', {
      cwd: repoDir,
      stdio: 'ignore',
    });
    await service.logDecision({
      decision: 'Use simple export',
      rationale: 'Minimal implementation',
      category: 'architecture',
      taskId: task.id,
    });
    fs.writeFileSync(path.join(repoDir, 'no-remote.test.ts'), 'test("z", () => {});\n');
    execSync('git add no-remote.test.ts && git commit -m "test: add test"', {
      cwd: repoDir,
      stdio: 'ignore',
    });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'No remote configured',
      defaultProjectRoot: repoDir,
      enforceQuality: true,
    });

    // Should succeed — no remote means push check is skipped
    expect(result.success).toBe(true);
  });

  it('includes surveyDue after 5 completions', async () => {
    // Complete 5 tasks to trigger survey
    for (let i = 0; i < 5; i++) {
      const t = await service.createTask({ title: `Task ${i}`, priority: 'low' });
      await service.claimTask(t.id, `agent-${i}`);

      fs.writeFileSync(path.join(repoDir, `file${i}.ts`), `export const x${i} = ${i};\n`);
      fs.writeFileSync(path.join(repoDir, `file${i}.test.ts`), `test("${i}", () => {});\n`);
      execSync(`git add file${i}.ts file${i}.test.ts && git commit -m "feat: task ${i} with test"`, {
        cwd: repoDir,
        stdio: 'ignore',
      });
      await service.logDecision({
        decision: `Decision ${i}`,
        rationale: 'Testing',
        category: 'architecture',
        taskId: t.id,
      });

      const result = await service.completeTaskSmart({
        taskId: t.id,
        summary: `Completed task ${i}`,
        defaultProjectRoot: repoDir,
        enforceQuality: false,
      });
      expect(result.success).toBe(true);

      // The 5th completion (i=4) should trigger surveyDue
      if (i < 4) {
        expect(result.surveyDue).toBeUndefined();
      } else {
        expect(result.surveyDue).toBeDefined();
        expect(result.surveyDue!.questions.length).toBe(3);
        expect(result.surveyDue!.submitTool).toBe('submit_feedback');
        expect(result.message).toContain('survey');
      }
    }
  });

  it('auto-creates pending outcome on completion', async () => {
    const task = await service.createTask({ title: 'Outcome tracking task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    fs.writeFileSync(path.join(repoDir, 'outcome.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'outcome.test.ts'), 'test("x", () => {});\n');
    execSync('git add outcome.ts outcome.test.ts && git commit -m "feat: outcome tracking with test"', {
      cwd: repoDir,
      stdio: 'ignore',
    });
    await service.logDecision({
      decision: 'Use structural outcome tracking',
      rationale: 'Dogfooding our own metrics',
      category: 'architecture',
      taskId: task.id,
    });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Added outcome tracking',
      defaultProjectRoot: repoDir,
      enforceQuality: true,
    });

    expect(result.success).toBe(true);
    expect(result.pendingOutcomeCreated).toBe(true);
    expect(result.message).toContain('pending outcome');

    // Verify outcome exists in storage
    const outcome = await storage.getTaskOutcome(task.id);
    expect(outcome).toBeDefined();
    expect(outcome!.status).toBe('pending');
    expect(outcome!.notes).toContain('Auto-created');
  });

  it('does not duplicate outcome if already exists', async () => {
    const task = await service.createTask({ title: 'Existing outcome task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Pre-record an outcome
    await service.recordTaskOutcome({ taskId: task.id, status: 'shipped', notes: 'Already shipped' });

    fs.writeFileSync(path.join(repoDir, 'existing.ts'), 'export const y = 2;\n');
    fs.writeFileSync(path.join(repoDir, 'existing.test.ts'), 'test("y", () => {});\n');
    execSync('git add existing.ts existing.test.ts && git commit -m "feat: existing outcome with test"', {
      cwd: repoDir,
      stdio: 'ignore',
    });
    await service.logDecision({
      decision: 'Test existing outcome',
      rationale: 'Testing',
      category: 'architecture',
      taskId: task.id,
    });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Already had outcome',
      defaultProjectRoot: repoDir,
      enforceQuality: true,
    });

    expect(result.success).toBe(true);
    expect(result.pendingOutcomeCreated).toBeUndefined(); // Already existed, no new creation

    // Verify outcome wasn't overwritten
    const outcome = await storage.getTaskOutcome(task.id);
    expect(outcome!.status).toBe('shipped');
    expect(outcome!.notes).toBe('Already shipped');
  });

  it('enforceQuality downgrades to warnings for small changes without decisions or tests', async () => {
    const task = await service.createTask({ title: 'Small change task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Single code file, small delta — below substantial threshold
    fs.writeFileSync(path.join(repoDir, 'code.ts'), 'export const z = 3;\n');
    execSync('git add code.ts && git commit -m "add code"', {
      cwd: repoDir,
      stdio: 'ignore',
    });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Small code change',
      defaultProjectRoot: repoDir,
      enforceQuality: true,
    });

    // Small changes should pass — decisions/tests are advisory, not blocking
    expect(result.success).toBe(true);
  });

  it('enforceQuality blocks substantial changes without decisions or tests', async () => {
    const task = await service.createTask({ title: 'Large change task', priority: 'medium' });
    await service.claimTask(task.id, 'test-agent');

    // Create 5 code files to exceed substantial threshold (>=4 code files)
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(repoDir, `module${i}.ts`), `export const val${i} = ${i};\n`);
    }
    execSync('git add *.ts && git commit -m "add modules"', {
      cwd: repoDir,
      stdio: 'ignore',
    });

    const result = await service.completeTaskSmart({
      taskId: task.id,
      summary: 'Large change without tests or decisions',
      defaultProjectRoot: repoDir,
      enforceQuality: true,
    });

    expect(result.success).toBe(false);
    expect(result.qualityEnforced).toBe(true);
    expect(result.qualityGaps).toBeDefined();
    expect(result.qualityGaps!.length).toBeGreaterThan(0);
  });
});
