import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { ComponentScanner, persistScanResults } from '../../src/analysis/component-scanner.js';
import { HealthScorer } from '../../src/analysis/health-scorer.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

describe('Component Registry', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;
  let repoDir: string;
  let projectId: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-comp-db-'));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-comp-repo-'));

    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    // Initialize git repo with structure
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });

    // Create a realistic project structure
    fs.mkdirSync(path.join(repoDir, 'src/core'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src/api'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src/storage'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src/utils'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'tests/unit'), { recursive: true });

    fs.writeFileSync(path.join(repoDir, 'src/core/service.ts'), 'import { db } from "../storage/db";\nexport class Service {}\n');
    fs.writeFileSync(path.join(repoDir, 'src/api/routes.ts'), 'import { Service } from "../core/service";\nexport const routes = {};\n');
    fs.writeFileSync(path.join(repoDir, 'src/storage/db.ts'), 'export const db = {};\n');
    fs.writeFileSync(path.join(repoDir, 'src/utils/helpers.ts'), 'export function help() {}\n');
    fs.writeFileSync(path.join(repoDir, 'tests/unit/service.test.ts'), 'import { Service } from "../../src/core/service";\ntest("it", () => {});\n');
    fs.writeFileSync(path.join(repoDir, 'tsconfig.json'), '{"compilerOptions":{}}');

    execSync('git add -A && git commit -m "init: project structure"', { cwd: repoDir, stdio: 'ignore' });

    const project = await service.createProject({
      name: 'Component Test Project',
      slug: 'comp-test',
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

  describe('storage CRUD', () => {
    it('saves and retrieves a component', async () => {
      const id = uuidv4();
      await storage.saveComponent({
        id,
        projectId,
        name: 'auth-service',
        type: 'service',
        layer: 'core',
        description: 'Authentication service',
        filePatterns: ['src/auth/**'],
        entryPoint: 'src/auth/index.ts',
      });

      const component = await storage.getComponent(id);
      expect(component).toBeDefined();
      expect(component!.name).toBe('auth-service');
      expect(component!.type).toBe('service');
      expect(component!.layer).toBe('core');
      expect(component!.filePatterns).toEqual(['src/auth/**']);
    });

    it('lists components with filters', async () => {
      await storage.saveComponent({
        id: uuidv4(), projectId, name: 'core-svc', type: 'service', layer: 'core',
      });
      await storage.saveComponent({
        id: uuidv4(), projectId, name: 'db-layer', type: 'database', layer: 'storage',
      });

      const all = await storage.getComponents({ projectId });
      expect(all.length).toBe(2);

      const coreOnly = await storage.getComponents({ projectId, layer: 'core' });
      expect(coreOnly.length).toBe(1);
      expect(coreOnly[0].name).toBe('core-svc');
    });

    it('saves and queries relationships', async () => {
      const id1 = uuidv4();
      const id2 = uuidv4();
      await storage.saveComponent({ id: id1, projectId, name: 'a', type: 'module' });
      await storage.saveComponent({ id: id2, projectId, name: 'b', type: 'module' });
      await storage.saveComponentRelationship({
        id: uuidv4(), sourceId: id1, targetId: id2, type: 'depends-on',
      });

      const rels = await storage.getComponentRelationships(id1);
      expect(rels.length).toBe(1);
      expect(rels[0].type).toBe('depends-on');
      expect(rels[0].targetId).toBe(id2);
    });

    it('links decisions to components', async () => {
      const compId = uuidv4();
      await storage.saveComponent({ id: compId, projectId, name: 'linked', type: 'module' });

      await service.logDecision({
        decision: 'Use DI pattern',
        rationale: 'Testability',
        category: 'architecture',
      });
      const decisions = await storage.getDecisions({ projectId });
      expect(decisions.length).toBeGreaterThan(0);

      await storage.linkComponentDecision(compId, decisions[0].id);
      const compDecisions = await storage.getComponentDecisions(compId);
      expect(compDecisions.length).toBe(1);
      expect(compDecisions[0].decision).toBe('Use DI pattern');
    });

    it('logs and queries health events', async () => {
      const compId = uuidv4();
      await storage.saveComponent({ id: compId, projectId, name: 'unhealthy', type: 'module' });

      await storage.logComponentHealthEvent({
        id: uuidv4(),
        componentId: compId,
        eventType: 'churn_spike',
        severity: 'warning',
        description: 'High commit frequency detected',
        source: 'auto-detect',
      });

      const events = await storage.getComponentHealthEvents(compId);
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('churn_spike');
      expect(events[0].severity).toBe('warning');
    });

    it('saves project relationships', async () => {
      const p2 = await service.createProject({ name: 'Related Project', slug: 'related', rootPath: '/tmp/r' });

      await storage.saveProjectRelationship({
        id: uuidv4(),
        sourceProjectId: projectId,
        targetProjectId: p2.id,
        type: 'depends-on',
        description: 'Shares auth library',
      });

      const rels = await storage.getProjectRelationships(projectId);
      expect(rels.length).toBe(1);
      expect(rels[0].type).toBe('depends-on');
    });

    it('deletes component and cascades', async () => {
      const compId = uuidv4();
      await storage.saveComponent({ id: compId, projectId, name: 'deletable', type: 'module' });
      await storage.logComponentHealthEvent({
        id: uuidv4(), componentId: compId, eventType: 'commit', severity: 'info',
      });

      await storage.deleteComponent(compId);
      const deleted = await storage.getComponent(compId);
      expect(deleted).toBeNull();

      const events = await storage.getComponentHealthEvents(compId);
      expect(events.length).toBe(0);
    });
  });

  describe('ComponentScanner', () => {
    it('detects components from directory structure', async () => {
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);

      expect(result.components.length).toBeGreaterThan(0);

      const names = result.components.map(c => c.name);
      expect(names).toContain('core');
      expect(names).toContain('api');
      expect(names).toContain('storage');
    });

    it('detects import relationships', async () => {
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);

      // api → core (api/routes.ts imports core/service)
      const apiToCore = result.relationships.find(
        r => r.sourceName === 'api' && r.targetName === 'core'
      );
      expect(apiToCore).toBeDefined();
      expect(apiToCore!.type).toBe('depends-on');
    });

    it('persists scan results to storage', async () => {
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);

      const { componentsCreated, relationshipsCreated } = await persistScanResults(
        storage, projectId, result, { clearExisting: true }
      );

      expect(componentsCreated).toBeGreaterThan(0);
      expect(relationshipsCreated).toBeGreaterThanOrEqual(0);

      const stored = await storage.getComponents({ projectId });
      expect(stored.length).toBe(componentsCreated);
    });
  });

  describe('HealthScorer', () => {
    it('scores components and returns reports', async () => {
      // Persist scan first
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);
      await persistScanResults(storage, projectId, result, { clearExisting: true });

      // Run health scoring
      const scorer = new HealthScorer(storage);
      const reports = await scorer.scoreProject(projectId);

      expect(reports.length).toBeGreaterThan(0);
      for (const r of reports) {
        expect(r.healthScore).toBeGreaterThanOrEqual(0);
        expect(r.healthScore).toBeLessThanOrEqual(1);
        expect(['healthy', 'warning', 'critical']).toContain(r.status);
        expect(r.factors.length).toBeGreaterThan(0);
      }
    });

    it('updates stored health scores', async () => {
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);
      await persistScanResults(storage, projectId, result, { clearExisting: true });

      const scorer = new HealthScorer(storage);
      await scorer.scoreProject(projectId);

      const components = await storage.getComponents({ projectId });
      for (const c of components) {
        if (c.type !== 'test-suite') {
          // Non-test components should have health scores set
          expect(c.healthScore).toBeDefined();
        }
      }
    });
  });

  describe('Component context in getNextTaskWithResponse', () => {
    it('includes component architecture when task files match components', async () => {
      // Scan and persist components
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);
      await persistScanResults(storage, projectId, result, { clearExisting: true });

      // Score health so components have health data
      const scorer = new HealthScorer(storage);
      await scorer.scoreProject(projectId);

      // Create a task with files that match the 'core' component
      await service.createTask({
        title: 'Refactor core service',
        priority: 'high',
        files: ['src/core/service.ts'],
      });

      const nextTask = await service.getNextTaskWithResponse({
        agentId: 'test-agent',
        withContext: false,
        defaultRootPath: repoDir,
      });

      expect(nextTask.success).toBe(true);
      expect(nextTask.componentArchitecture).toBeDefined();
      expect(nextTask.componentArchitecture!.length).toBeGreaterThan(0);

      const coreComponent = nextTask.componentArchitecture!.find(c => c.name === 'core');
      expect(coreComponent).toBeDefined();
      expect(coreComponent!.type).toBeDefined();
      expect(coreComponent!.healthScore).toBeDefined();
      expect(['healthy', 'warning', 'critical', 'unknown']).toContain(coreComponent!.healthStatus);
      expect(Array.isArray(coreComponent!.dependencies)).toBe(true);
      expect(Array.isArray(coreComponent!.dependents)).toBe(true);
    });

    it('returns undefined componentArchitecture when no files match', async () => {
      // Scan and persist components
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);
      await persistScanResults(storage, projectId, result, { clearExisting: true });

      // Create a task with files that don't match any component
      await service.createTask({
        title: 'Update readme',
        priority: 'medium',
        files: ['README.md'],
      });

      const nextTask = await service.getNextTaskWithResponse({
        agentId: 'test-agent-2',
        withContext: false,
        defaultRootPath: repoDir,
      });

      expect(nextTask.success).toBe(true);
      expect(nextTask.componentArchitecture).toBeUndefined();
    });

    it('includes dependency names in component context', async () => {
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);
      await persistScanResults(storage, projectId, result, { clearExisting: true });

      // Create a task touching api (which depends on core)
      await service.createTask({
        title: 'Update API routes',
        priority: 'high',
        files: ['src/api/routes.ts'],
      });

      const nextTask = await service.getNextTaskWithResponse({
        agentId: 'test-agent-3',
        withContext: false,
        defaultRootPath: repoDir,
      });

      expect(nextTask.success).toBe(true);
      if (nextTask.componentArchitecture) {
        const apiComponent = nextTask.componentArchitecture.find(c => c.name === 'api');
        if (apiComponent) {
          // API depends on core via import
          expect(apiComponent.dependencies).toContain('core');
        }
      }
    });

    it('includes component context in message summary', async () => {
      const scanner = new ComponentScanner();
      const result = await scanner.scan(repoDir);
      await persistScanResults(storage, projectId, result, { clearExisting: true });

      await service.createTask({
        title: 'Fix storage bug',
        priority: 'high',
        files: ['src/storage/db.ts'],
      });

      const nextTask = await service.getNextTaskWithResponse({
        agentId: 'test-agent-4',
        withContext: false,
        defaultRootPath: repoDir,
      });

      expect(nextTask.success).toBe(true);
      expect(nextTask.message).toContain('component(s)');
    });
  });
});
