import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleConfigureWorkflow, handleGetWorkflowConfig } from '../../src/adapters/mcp/handlers/workflow-config-handlers.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('workflow config handlers', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let dbDir: string;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-wfc-db-'));
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    const events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({
      name: 'Config Test',
      slug: 'config-test',
      rootPath: '/tmp/test',
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  function makeCtx() {
    return {
      service,
      resolvedAgentId: 'test-agent',
      getProjectContext: async () => ({ projectId, projectName: 'Config Test', projectSlug: 'config-test' }),
    };
  }

  it('returns current workflow config with defaults', async () => {
    const result = await handleGetWorkflowConfig(makeCtx());
    const data = JSON.parse(result.content[0].text);

    expect(data.branchStrategy).toBe('feature');
    expect(data.sessionOwnership).toBe('individual');
    expect(data.commitTarget).toBe('branch');
    expect(data.driverRotation).toBe(false);
  });

  it('configures branchStrategy', async () => {
    const result = await handleConfigureWorkflow(makeCtx(), {
      branchStrategy: 'trunk',
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.success).toBe(true);
    expect(data.changes.length).toBeGreaterThanOrEqual(1);
    expect(data.effective.branchStrategy).toBe('trunk');
    // trunk auto-derives commitTarget to main
    expect(data.effective.commitTarget).toBe('main');
  });

  it('configures qualityGates', async () => {
    const result = await handleConfigureWorkflow(makeCtx(), {
      qualityGates: ['tests_passing', 'min_decisions:1'],
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.success).toBe(true);
    expect(data.effective.qualityGates).toEqual(['tests_passing', 'min_decisions:1']);
  });

  it('configures sessionOwnership to collective', async () => {
    const result = await handleConfigureWorkflow(makeCtx(), {
      sessionOwnership: 'collective',
    });
    const data = JSON.parse(result.content[0].text);

    expect(data.success).toBe(true);
    expect(data.effective.sessionOwnership).toBe('collective');
  });

  it('returns no changes when config already matches', async () => {
    // Configure first
    await handleConfigureWorkflow(makeCtx(), { branchStrategy: 'trunk' });
    // Configure same thing again
    const result = await handleConfigureWorkflow(makeCtx(), { branchStrategy: 'trunk' });
    const data = JSON.parse(result.content[0].text);

    expect(data.success).toBe(true);
    expect(data.message).toContain('already matches');
  });

  it('errors when no fields provided', async () => {
    const result = await handleConfigureWorkflow(makeCtx(), {});
    const data = JSON.parse(result.content[0].text);

    expect(data.success).toBe(false);
    expect(data.error).toContain('No workflow fields');
  });

  it('errors when no active project', async () => {
    const ctx = {
      service,
      resolvedAgentId: 'test-agent',
      getProjectContext: async () => null,
    };
    const result = await handleConfigureWorkflow(ctx, { branchStrategy: 'trunk' });
    expect(result.isError).toBe(true);
  });

  it('persists config across calls', async () => {
    await handleConfigureWorkflow(makeCtx(), {
      branchStrategy: 'trunk',
      qualityGates: ['lint_clean'],
    });

    const result = await handleGetWorkflowConfig(makeCtx());
    const data = JSON.parse(result.content[0].text);

    expect(data.branchStrategy).toBe('trunk');
    expect(data.qualityGates).toEqual(['lint_clean']);
  });
});
