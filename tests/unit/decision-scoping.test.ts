import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Decision Scoping', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-scope-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({
      name: 'Scope Test Project',
      slug: 'scope-test',
      rootPath: testDir,
      domain: 'api',
    });
    projectId = project.id;
    await service.setActiveProject(projectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Storage round-trip', () => {
    it('should persist and return scope_json', async () => {
      const scope = { layers: ['interface' as const, 'handler' as const], patterns: ['src/adapters/**'], tags: ['thin-interface'] };
      const result = await service.logDecision({
        decision: 'Route through CoordinationService',
        rationale: 'Prevents divergence',
        category: 'architecture',
        scope,
      });

      const stored = await storage.getDecision(result.decisionId);
      expect(stored).not.toBeNull();
      expect(stored!.scope).toEqual(scope);
    });

    it('should return undefined scope for unscoped decisions', async () => {
      const result = await service.logDecision({
        decision: 'Use SQLite',
        rationale: 'Simple deployment',
        category: 'architecture',
      });

      const stored = await storage.getDecision(result.decisionId);
      expect(stored!.scope).toBeUndefined();
    });

    it('should return scope in getDecisions list', async () => {
      const scope = { layers: ['storage' as const] };
      await service.logDecision({
        decision: 'Use prepared statements',
        category: 'pattern',
        scope,
      });

      const decisions = await storage.getDecisions({ projectId });
      const found = decisions.find(d => d.decision === 'Use prepared statements');
      expect(found).toBeDefined();
      expect(found!.scope).toEqual(scope);
    });
  });

  describe('Layer matching', () => {
    it('should match interface layer to adapter files', async () => {
      await service.logDecision({
        decision: 'All operations route through CoordinationService',
        rationale: 'Prevents divergence',
        category: 'architecture',
        scope: { layers: ['interface'] },
      });

      const task = await service.createTask({
        title: 'Update workflow handler',
        priority: 'high',
        files: ['src/adapters/mcp/handlers/workflow-handlers.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
      expect(result.relevantDecisions[0].decision).toBe('All operations route through CoordinationService');
    });

    it('should match handler layer to handler files', async () => {
      await service.logDecision({
        decision: 'Handlers must be thin wrappers',
        category: 'architecture',
        scope: { layers: ['handler'] },
      });

      const task = await service.createTask({
        title: 'Fix task handler',
        priority: 'medium',
        files: ['src/adapters/mcp/handlers/task-handlers.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
      expect(result.relevantDecisions[0].decision).toBe('Handlers must be thin wrappers');
    });

    it('should match storage layer to storage files', async () => {
      await service.logDecision({
        decision: 'Use safeJsonParse for all DB reads',
        category: 'pattern',
        scope: { layers: ['storage'] },
      });

      const task = await service.createTask({
        title: 'Fix storage bug',
        priority: 'high',
        files: ['src/storage/sqlite-storage-service.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
    });

    it('should NOT match handler-scoped decision to storage files', async () => {
      await service.logDecision({
        decision: 'Handlers must validate inputs',
        category: 'architecture',
        scope: { layers: ['handler'] },
      });

      const task = await service.createTask({
        title: 'Optimize storage queries',
        priority: 'medium',
        files: ['src/storage/sqlite-storage-service.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(0);
    });

    it('should match multiple layers', async () => {
      await service.logDecision({
        decision: 'Consistent error handling across interfaces',
        category: 'architecture',
        scope: { layers: ['cli', 'rest', 'mcp'] },
      });

      const task = await service.createTask({
        title: 'Fix CLI error display',
        priority: 'medium',
        files: ['src/bin/enginehaus.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
    });
  });

  describe('Pattern matching', () => {
    it('should match glob pattern with ** suffix', async () => {
      await service.logDecision({
        decision: 'REST endpoints must validate auth',
        category: 'architecture',
        scope: { patterns: ['src/adapters/rest/**'] },
      });

      const task = await service.createTask({
        title: 'Add REST endpoint',
        priority: 'high',
        files: ['src/adapters/rest/server.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
    });

    it('should NOT match pattern for unrelated directory', async () => {
      await service.logDecision({
        decision: 'REST auth required',
        category: 'architecture',
        scope: { patterns: ['src/adapters/rest/**'] },
      });

      const task = await service.createTask({
        title: 'Fix CLI bug',
        priority: 'medium',
        files: ['src/bin/enginehaus.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(0);
    });

    it('should match exact file pattern', async () => {
      await service.logDecision({
        decision: 'index.ts must not grow beyond 500 lines',
        category: 'tradeoff',
        scope: { patterns: ['src/index.ts'] },
      });

      const task = await service.createTask({
        title: 'Update MCP server',
        priority: 'medium',
        files: ['src/index.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
    });
  });

  describe('Explicit file matching', () => {
    it('should match explicit file paths', async () => {
      await service.logDecision({
        decision: 'Coordination service is the single source of truth',
        category: 'architecture',
        scope: { files: ['src/core/services/coordination-service.ts'] },
      });

      const task = await service.createTask({
        title: 'Add method to coordination service',
        priority: 'high',
        files: ['src/core/services/coordination-service.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
    });

    it('should match partial file path inclusion', async () => {
      await service.logDecision({
        decision: 'All validators go through validators.ts',
        category: 'pattern',
        scope: { files: ['validators.ts'] },
      });

      const task = await service.createTask({
        title: 'Add new validator',
        priority: 'medium',
        files: ['src/validation/validators.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
    });
  });

  describe('Text matching fallback (backward compatible)', () => {
    it('should match unscoped decisions by text content', async () => {
      await service.logDecision({
        decision: 'The sqlite-storage-service.ts must use prepared statements',
        rationale: 'Prevents SQL injection',
        category: 'architecture',
      });

      const task = await service.createTask({
        title: 'Fix storage query',
        priority: 'medium',
        files: ['src/storage/sqlite-storage-service.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(1);
    });

    it('should NOT match unscoped decision when text has no file reference', async () => {
      await service.logDecision({
        decision: 'Use TypeScript strict mode',
        rationale: 'Better type safety',
        category: 'architecture',
      });

      const task = await service.createTask({
        title: 'Fix something',
        priority: 'medium',
        files: ['src/adapters/mcp/handlers/task-handlers.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(0);
    });
  });

  describe('Category filtering', () => {
    it('should only match architecture/pattern/tradeoff categories', async () => {
      // This decision has a matching scope but wrong category
      await service.logDecision({
        decision: 'Use uuid v4 for IDs',
        category: 'dependency',
        scope: { layers: ['storage'] },
      });

      const task = await service.createTask({
        title: 'Fix storage',
        priority: 'medium',
        files: ['src/storage/sqlite-storage-service.ts'],
      });

      const result = await service.getFileRelevantDecisions(task.id, task.files!);
      expect(result.relevantDecisions).toHaveLength(0);
    });
  });

  describe('Combined scope fields', () => {
    it('should match if any scope field matches', async () => {
      await service.logDecision({
        decision: 'Separation of concerns',
        category: 'architecture',
        scope: {
          layers: ['service'],
          patterns: ['src/adapters/rest/**'],
          files: ['src/index.ts'],
        },
      });

      // Matches via layers
      const task1 = await service.createTask({
        title: 'Update service',
        priority: 'medium',
        files: ['src/core/services/coordination-service.ts'],
      });
      const r1 = await service.getFileRelevantDecisions(task1.id, task1.files!);
      expect(r1.relevantDecisions).toHaveLength(1);

      // Matches via patterns
      const task2 = await service.createTask({
        title: 'Update REST',
        priority: 'medium',
        files: ['src/adapters/rest/server.ts'],
      });
      const r2 = await service.getFileRelevantDecisions(task2.id, task2.files!);
      expect(r2.relevantDecisions).toHaveLength(1);

      // Matches via files
      const task3 = await service.createTask({
        title: 'Update index',
        priority: 'medium',
        files: ['src/index.ts'],
      });
      const r3 = await service.getFileRelevantDecisions(task3.id, task3.files!);
      expect(r3.relevantDecisions).toHaveLength(1);

      // Does NOT match unrelated file
      const task4 = await service.createTask({
        title: 'Update types',
        priority: 'medium',
        files: ['src/coordination/types.ts'],
      });
      const r4 = await service.getFileRelevantDecisions(task4.id, task4.files!);
      expect(r4.relevantDecisions).toHaveLength(0);
    });
  });
});
