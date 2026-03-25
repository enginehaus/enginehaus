import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import { IngestionFramework } from '../../src/ingestion/framework.js';
import {
  Ingester,
  SourceConfig,
  IngestionResult,
  EntityWithLevel,
  Relationship,
  ChangeSet,
  Snapshot,
} from '../../src/ingestion/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Wait for an ingestion job to reach a terminal state by polling.
 * Avoids flaky setTimeout delays on CI environments with CPU contention.
 */
async function waitForJobCompletion(
  framework: IngestionFramework,
  jobId: string,
  timeoutMs = 5000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await framework.getJobStatus(jobId);
    if (status && (status.status === 'completed' || status.status === 'failed')) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Job ${jobId} did not complete within ${timeoutMs}ms`);
}

// Mock ingester for testing
class MockIngester implements Ingester {
  readonly sourceType = 'custom' as const;
  readonly name = 'Mock Ingester';
  readonly version = '1.0.0';

  private entities: EntityWithLevel[] = [];
  private relationships: Relationship[] = [];

  setEntities(entities: EntityWithLevel[]) {
    this.entities = entities;
  }

  setRelationships(relationships: Relationship[]) {
    this.relationships = relationships;
  }

  async parse(config: SourceConfig): Promise<IngestionResult> {
    return {
      sourceId: config.id,
      entities: this.entities,
      relationships: this.relationships,
      metadata: {
        startedAt: new Date(),
        completedAt: new Date(),
        itemsProcessed: this.entities.length,
        warnings: [],
        errors: [],
        ingesterVersion: this.version,
      },
    };
  }
}

describe('Source Ingestion Framework', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let events: EventOrchestrator;
  let framework: IngestionFramework;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-ingestion-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    // Create a test project
    const project = await service.createProject({
      name: 'Ingestion Test Project',
      slug: 'ingestion-test',
      rootPath: testDir,
      domain: 'api',
    });
    projectId = project.id;

    // Create framework with storage
    framework = new IngestionFramework(storage as any, events);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Ingester Registration', () => {
    it('should register an ingester', () => {
      const ingester = new MockIngester();
      framework.registerIngester(ingester);

      expect(framework.getIngester('custom')).toBe(ingester);
    });

    it('should prevent duplicate ingester registration', () => {
      const ingester1 = new MockIngester();
      const ingester2 = new MockIngester();

      framework.registerIngester(ingester1);

      expect(() => framework.registerIngester(ingester2)).toThrow(
        "Ingester for source type 'custom' already registered"
      );
    });

    it('should list registered ingesters', () => {
      const ingester = new MockIngester();
      framework.registerIngester(ingester);

      const ingesters = framework.listIngesters();
      expect(ingesters.length).toBe(1);
      expect(ingesters[0].name).toBe('Mock Ingester');
    });
  });

  describe('Source Configuration', () => {
    beforeEach(() => {
      framework.registerIngester(new MockIngester());
    });

    it('should add a source configuration', async () => {
      const source = await framework.addSource({
        projectId,
        sourceType: 'custom',
        name: 'Test Source',
        location: '/path/to/source',
        config: { option: 'value' },
        autoSync: false,
      });

      expect(source.id).toBeDefined();
      expect(source.name).toBe('Test Source');
      expect(source.projectId).toBe(projectId);
    });

    it('should reject source with unknown ingester type', async () => {
      await expect(
        framework.addSource({
          projectId,
          sourceType: 'unknown' as any,
          name: 'Bad Source',
          location: '/path',
          config: {},
          autoSync: false,
        })
      ).rejects.toThrow("No ingester registered for source type 'unknown'");
    });

    it('should get a source configuration', async () => {
      const created = await framework.addSource({
        projectId,
        sourceType: 'custom',
        name: 'Test Source',
        location: '/path/to/source',
        config: {},
        autoSync: false,
      });

      const retrieved = await framework.getSource(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Source');
    });

    it('should list sources for a project', async () => {
      await framework.addSource({
        projectId,
        sourceType: 'custom',
        name: 'Source 1',
        location: '/path/1',
        config: {},
        autoSync: false,
      });

      await framework.addSource({
        projectId,
        sourceType: 'custom',
        name: 'Source 2',
        location: '/path/2',
        config: {},
        autoSync: false,
      });

      const sources = await framework.listSources(projectId);
      expect(sources.length).toBe(2);
    });

    it('should update a source configuration', async () => {
      const source = await framework.addSource({
        projectId,
        sourceType: 'custom',
        name: 'Original Name',
        location: '/path',
        config: {},
        autoSync: false,
      });

      const updated = await framework.updateSource(source.id, {
        name: 'Updated Name',
        autoSync: true,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.autoSync).toBe(true);
    });

    it('should remove a source configuration', async () => {
      const source = await framework.addSource({
        projectId,
        sourceType: 'custom',
        name: 'To Delete',
        location: '/path',
        config: {},
        autoSync: false,
      });

      const deleted = await framework.removeSource(source.id);
      expect(deleted).toBe(true);

      const retrieved = await framework.getSource(source.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Ingestion Jobs', () => {
    let mockIngester: MockIngester;
    let sourceId: string;

    beforeEach(async () => {
      mockIngester = new MockIngester();
      framework.registerIngester(mockIngester);

      const source = await framework.addSource({
        projectId,
        sourceType: 'custom',
        name: 'Test Source',
        location: '/path',
        config: {},
        autoSync: false,
      });
      sourceId = source.id;
    });

    it('should start an ingestion job', async () => {
      mockIngester.setEntities([
        {
          sourceId: 'entity-1',
          name: 'Test Entity',
          levelId: 'component',
          entityType: 'virtual',
        },
      ]);

      const job = await framework.ingest(sourceId);

      expect(job.id).toBeDefined();
      expect(job.sourceId).toBe(sourceId);
      expect(job.status).toBe('pending');
    });

    it('should reject ingestion for unknown source', async () => {
      await expect(framework.ingest('unknown-source-id')).rejects.toThrow(
        "Source configuration 'unknown-source-id' not found"
      );
    });

    it('should track job status', async () => {
      mockIngester.setEntities([]);

      const job = await framework.ingest(sourceId);

      // Poll until the background job reaches a terminal state
      await waitForJobCompletion(framework, job.id);

      const status = await framework.getJobStatus(job.id);
      expect(status).toBeDefined();
      // Job should be completed or still running
      expect(['pending', 'parsing', 'reconciling', 'completed', 'failed']).toContain(
        status?.status
      );
    });

    it('should get job history for a source', async () => {
      mockIngester.setEntities([]);

      const job = await framework.ingest(sourceId);
      // Poll until the background job reaches a terminal state
      await waitForJobCompletion(framework, job.id);

      const history = await framework.getJobHistory(sourceId);
      expect(history.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Storage Integration', () => {
    it('should store and retrieve source configs', async () => {
      const config = await storage.createSourceConfig({
        projectId,
        sourceType: 'git-repo',
        name: 'Test Repo',
        location: 'https://github.com/test/repo',
        config: { branch: 'main' },
        autoSync: true,
        syncIntervalMinutes: 60,
      });

      expect(config.id).toBeDefined();

      const retrieved = await storage.getSourceConfig(config.id);
      expect(retrieved?.name).toBe('Test Repo');
      expect(retrieved?.config).toEqual({ branch: 'main' });
      expect(retrieved?.autoSync).toBe(true);
    });

    it('should store and retrieve ingestion jobs', async () => {
      const sourceConfig = await storage.createSourceConfig({
        projectId,
        sourceType: 'custom',
        name: 'Test Source',
        location: '/path',
        config: {},
        autoSync: false,
      });

      const job = await storage.createIngestionJob({
        sourceId: sourceConfig.id,
        projectId,
        status: 'pending',
        startedAt: new Date(),
      });

      expect(job.id).toBeDefined();

      const retrieved = await storage.getIngestionJob(job.id);
      expect(retrieved?.status).toBe('pending');

      // Update job
      await storage.updateIngestionJob(job.id, { status: 'completed' });
      const updated = await storage.getIngestionJob(job.id);
      expect(updated?.status).toBe('completed');
    });

    it('should store and retrieve snapshots', async () => {
      const sourceConfig = await storage.createSourceConfig({
        projectId,
        sourceType: 'custom',
        name: 'Test Source',
        location: '/path',
        config: {},
        autoSync: false,
      });

      const entityHashes = new Map<string, string>();
      entityHashes.set('entity-1', 'hash-abc');
      entityHashes.set('entity-2', 'hash-def');

      const relationshipHashes = new Map<string, string>();
      relationshipHashes.set('rel-1', 'hash-xyz');

      await storage.saveSnapshot({
        timestamp: new Date(),
        sourceId: sourceConfig.id,
        entityHashes,
        relationshipHashes,
      });

      const latest = await storage.getLatestSnapshot(sourceConfig.id);
      expect(latest).toBeDefined();
      expect(latest?.entityHashes.get('entity-1')).toBe('hash-abc');
      expect(latest?.relationshipHashes.get('rel-1')).toBe('hash-xyz');
    });
  });

  describe('Hierarchy Node Extensions', () => {
    let hierarchyId: string;

    beforeEach(async () => {
      const definition = await storage.createHierarchyDefinition({
        projectId,
        name: 'Test Hierarchy',
        levels: [
          { id: 'module', name: 'Module', pluralName: 'Modules', order: 0 },
          { id: 'component', name: 'Component', pluralName: 'Components', order: 1 },
        ],
      });
      hierarchyId = definition.id;
    });

    it('should get hierarchy node by source ID', async () => {
      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        entityType: 'virtual',
        entityId: 'source-id-123',
        name: 'Test Module',
      });

      const node = await storage.getHierarchyNodeBySourceId(hierarchyId, 'source-id-123');
      expect(node).toBeDefined();
      expect(node?.name).toBe('Test Module');
    });

    it('should update hierarchy node', async () => {
      const node = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        entityType: 'virtual',
        entityId: 'test-entity',
        name: 'Original Name',
      });

      const updated = await storage.updateHierarchyNode(node.id, {
        name: 'Updated Name',
        metadata: { key: 'value' },
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.metadata).toEqual({ key: 'value' });
    });

    it('should archive hierarchy node', async () => {
      const node = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        entityType: 'virtual',
        entityId: 'to-archive',
        name: 'Node to Archive',
      });

      await storage.archiveHierarchyNode(node.id, 'Removed from source');

      const archived = await storage.getHierarchyNode(node.id);
      expect(archived?.metadata?.archived).toBe(true);
      expect(archived?.metadata?.archivedReason).toBe('Removed from source');
    });
  });
});
