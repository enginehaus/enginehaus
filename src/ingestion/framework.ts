// ============================================================================
// Ingestion Framework
// ============================================================================
// Orchestrates source ingestion: registers ingesters, runs jobs, coordinates
// with storage and reconciliation. Ingesters are stateless parsers - this
// framework handles all persistence and state management.
// ============================================================================

import { randomUUID } from 'crypto';
import {
  Ingester,
  SourceConfig,
  IngestionResult,
  IngestionJob,
  IngestionJobStatus,
  IngestionFrameworkConfig,
  DEFAULT_INGESTION_CONFIG,
  Snapshot,
  ChangeSet,
  EntityWithLevel,
  Relationship,
} from './types.js';
import { Reconciler, ReconcilerStorage } from './reconciler.js';
import { EventOrchestrator } from '../events/event-orchestrator.js';

/**
 * IngestionStorage
 *
 * Storage interface for ingestion state. Implemented by SQLiteStorageService.
 */
export interface IngestionStorage extends ReconcilerStorage {
  // Source configuration
  createSourceConfig(config: Omit<SourceConfig, 'id'>): Promise<SourceConfig>;
  getSourceConfig(id: string): Promise<SourceConfig | null>;
  getSourceConfigs(projectId: string): Promise<SourceConfig[]>;
  updateSourceConfig(id: string, updates: Partial<SourceConfig>): Promise<SourceConfig>;
  deleteSourceConfig(id: string): Promise<boolean>;

  // Ingestion jobs
  createIngestionJob(job: Omit<IngestionJob, 'id'>): Promise<IngestionJob>;
  getIngestionJob(id: string): Promise<IngestionJob | null>;
  getIngestionJobs(sourceId: string, limit?: number): Promise<IngestionJob[]>;
  updateIngestionJob(id: string, updates: Partial<IngestionJob>): Promise<IngestionJob>;

  // Snapshots
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  getLatestSnapshot(sourceId: string): Promise<Snapshot | null>;
}

/**
 * IngestionFramework
 *
 * Main orchestrator for source ingestion. Responsibilities:
 * - Register and manage ingesters
 * - Execute ingestion jobs (parse + reconcile)
 * - Track job state and history
 * - Coordinate with storage layer
 */
export class IngestionFramework {
  private ingesters: Map<string, Ingester> = new Map();
  private runningJobs: Map<string, IngestionJob> = new Map();
  private config: IngestionFrameworkConfig;
  private reconciler: Reconciler;

  constructor(
    private storage: IngestionStorage,
    private events?: EventOrchestrator,
    config?: Partial<IngestionFrameworkConfig>
  ) {
    this.config = { ...DEFAULT_INGESTION_CONFIG, ...config };
    this.reconciler = new Reconciler(storage, this.config.reconciliation);
  }

  // ============================================================================
  // Ingester Management
  // ============================================================================

  /**
   * Register an ingester for a source type.
   */
  registerIngester(ingester: Ingester): void {
    if (this.ingesters.has(ingester.sourceType)) {
      throw new Error(`Ingester for source type '${ingester.sourceType}' already registered`);
    }
    this.ingesters.set(ingester.sourceType, ingester);
  }

  /**
   * Get a registered ingester by source type.
   */
  getIngester(sourceType: string): Ingester | undefined {
    return this.ingesters.get(sourceType);
  }

  /**
   * List all registered ingesters.
   */
  listIngesters(): Ingester[] {
    return Array.from(this.ingesters.values());
  }

  // ============================================================================
  // Source Configuration
  // ============================================================================

  /**
   * Add a new source configuration.
   */
  async addSource(config: Omit<SourceConfig, 'id'>): Promise<SourceConfig> {
    const ingester = this.ingesters.get(config.sourceType);
    if (!ingester) {
      throw new Error(`No ingester registered for source type '${config.sourceType}'`);
    }

    // Validate configuration if ingester supports it
    if (ingester.validateConfig) {
      const validation = await ingester.validateConfig(config as SourceConfig);
      if (!validation.valid) {
        throw new Error(`Invalid source configuration: ${validation.errors.join(', ')}`);
      }
    }

    const source = await this.storage.createSourceConfig(config);

    this.emitEvent('source-added', {
      sourceId: source.id,
      projectId: source.projectId,
      sourceType: source.sourceType,
    });

    return source;
  }

  /**
   * Get a source configuration by ID.
   */
  async getSource(id: string): Promise<SourceConfig | null> {
    return this.storage.getSourceConfig(id);
  }

  /**
   * List all sources for a project.
   */
  async listSources(projectId: string): Promise<SourceConfig[]> {
    return this.storage.getSourceConfigs(projectId);
  }

  /**
   * Update a source configuration.
   */
  async updateSource(id: string, updates: Partial<SourceConfig>): Promise<SourceConfig> {
    return this.storage.updateSourceConfig(id, updates);
  }

  /**
   * Remove a source configuration.
   */
  async removeSource(id: string): Promise<boolean> {
    return this.storage.deleteSourceConfig(id);
  }

  // ============================================================================
  // Ingestion Jobs
  // ============================================================================

  /**
   * Start an ingestion job for a source.
   */
  async ingest(sourceId: string): Promise<IngestionJob> {
    // Check concurrent job limit
    if (this.runningJobs.size >= this.config.maxConcurrentJobs) {
      throw new Error(`Maximum concurrent jobs (${this.config.maxConcurrentJobs}) reached`);
    }

    const source = await this.storage.getSourceConfig(sourceId);
    if (!source) {
      throw new Error(`Source configuration '${sourceId}' not found`);
    }

    const ingester = this.ingesters.get(source.sourceType);
    if (!ingester) {
      throw new Error(`No ingester registered for source type '${source.sourceType}'`);
    }

    // Create job record
    const job = await this.storage.createIngestionJob({
      sourceId,
      projectId: source.projectId,
      status: 'pending',
      startedAt: new Date(),
    });

    this.runningJobs.set(job.id, job);

    this.emitEvent('ingestion-started', {
      jobId: job.id,
      sourceId,
      projectId: source.projectId,
    });

    // Run ingestion asynchronously
    this.runIngestion(job, source, ingester).catch((error) => {
      console.error(`Ingestion job ${job.id} failed:`, error);
    });

    return job;
  }

  /**
   * Execute the ingestion pipeline: parse -> detect changes -> reconcile.
   */
  private async runIngestion(
    job: IngestionJob,
    source: SourceConfig,
    ingester: Ingester
  ): Promise<void> {
    try {
      // Update status to parsing
      await this.updateJob(job.id, { status: 'parsing' });

      // Get previous snapshot for incremental detection
      const previousSnapshot = await this.storage.getLatestSnapshot(source.id);

      let result: IngestionResult;
      let changeSet: ChangeSet | null = null;

      // Try incremental detection first
      if (previousSnapshot && ingester.detectChanges) {
        changeSet = await ingester.detectChanges(previousSnapshot, source);
      }

      // Full parse if no incremental or first ingestion
      if (!changeSet) {
        result = await ingester.parse(source);

        // Generate changeset by diffing with previous snapshot
        if (previousSnapshot) {
          changeSet = this.diffSnapshots(previousSnapshot, result);
        } else {
          // First ingestion - all entities are new
          changeSet = {
            sourceId: source.id,
            currentTimestamp: new Date(),
            added: result.entities,
            modified: [],
            removed: [],
            addedRelationships: result.relationships,
            removedRelationships: [],
          };
        }
      } else {
        // Incremental detection succeeded - build minimal result
        result = {
          sourceId: source.id,
          entities: changeSet.added.concat(changeSet.modified.map(m => m.entity)),
          relationships: changeSet.addedRelationships,
          metadata: {
            startedAt: job.startedAt,
            completedAt: new Date(),
            itemsProcessed: changeSet.added.length + changeSet.modified.length,
            warnings: [],
            errors: [],
            ingesterVersion: ingester.version,
          },
        };
      }

      // Update job with parse result
      await this.updateJob(job.id, { status: 'reconciling', result });

      // Reconcile changes into the entity graph
      const reconciliationResult = await this.reconciler.reconcile(
        changeSet,
        source.hierarchyId
      );

      // Save new snapshot
      const newSnapshot = this.createSnapshot(source.id, result);
      await this.storage.saveSnapshot(newSnapshot);

      // Update source last ingested timestamp
      await this.storage.updateSourceConfig(source.id, {
        lastIngestedAt: new Date(),
      });

      // Mark job complete
      await this.updateJob(job.id, {
        status: 'completed',
        completedAt: new Date(),
        reconciliationResult,
      });

      this.emitEvent('ingestion-completed', {
        jobId: job.id,
        sourceId: source.id,
        projectId: source.projectId,
        entitiesCreated: reconciliationResult.entitiesCreated,
        entitiesUpdated: reconciliationResult.entitiesUpdated,
        conflicts: reconciliationResult.conflicts.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.updateJob(job.id, {
        status: 'failed',
        completedAt: new Date(),
        error: errorMessage,
      });

      this.emitEvent('ingestion-failed', {
        jobId: job.id,
        sourceId: source.id,
        projectId: source.projectId,
        error: errorMessage,
      });

      throw error;
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  /**
   * Get the status of an ingestion job.
   */
  async getJobStatus(jobId: string): Promise<IngestionJob | null> {
    // Check running jobs first
    const running = this.runningJobs.get(jobId);
    if (running) {
      return running;
    }

    return this.storage.getIngestionJob(jobId);
  }

  /**
   * Get recent ingestion jobs for a source.
   */
  async getJobHistory(sourceId: string, limit = 10): Promise<IngestionJob[]> {
    return this.storage.getIngestionJobs(sourceId, limit);
  }

  /**
   * Cancel a running ingestion job.
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.runningJobs.get(jobId);
    if (!job) {
      return false;
    }

    await this.updateJob(jobId, {
      status: 'failed',
      completedAt: new Date(),
      error: 'Cancelled by user',
    });

    this.runningJobs.delete(jobId);
    return true;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Update a job record.
   */
  private async updateJob(
    jobId: string,
    updates: Partial<IngestionJob>
  ): Promise<IngestionJob> {
    const updated = await this.storage.updateIngestionJob(jobId, updates);

    // Update running job cache
    const running = this.runningJobs.get(jobId);
    if (running) {
      Object.assign(running, updates);
    }

    return updated;
  }

  /**
   * Create a snapshot from ingestion result.
   */
  private createSnapshot(sourceId: string, result: IngestionResult): Snapshot {
    const entityHashes = new Map<string, string>();
    for (const entity of result.entities) {
      entityHashes.set(entity.sourceId, entity.contentHash || this.hashEntity(entity));
    }

    const relationshipHashes = new Map<string, string>();
    for (const rel of result.relationships) {
      const key = `${rel.fromSourceId}:${rel.type}:${rel.toSourceId}`;
      relationshipHashes.set(key, this.hashRelationship(rel));
    }

    return {
      timestamp: new Date(),
      sourceId,
      entityHashes,
      relationshipHashes,
    };
  }

  /**
   * Diff two snapshots to generate a changeset.
   */
  private diffSnapshots(previous: Snapshot, result: IngestionResult): ChangeSet {
    const added: EntityWithLevel[] = [];
    const modified: { entity: EntityWithLevel; changes: { field: string; previousValue?: unknown; currentValue?: unknown }[] }[] = [];
    const removed: { sourceId: string; name: string; hasHumanMetadata: boolean }[] = [];

    const currentEntityMap = new Map<string, EntityWithLevel>();
    for (const entity of result.entities) {
      currentEntityMap.set(entity.sourceId, entity);
    }

    // Find added and modified entities
    for (const entity of result.entities) {
      const previousHash = previous.entityHashes.get(entity.sourceId);
      const currentHash = entity.contentHash || this.hashEntity(entity);

      if (!previousHash) {
        added.push(entity);
      } else if (previousHash !== currentHash) {
        modified.push({
          entity,
          changes: [{ field: 'content', previousValue: previousHash, currentValue: currentHash }],
        });
      }
    }

    // Find removed entities
    for (const [sourceId] of previous.entityHashes) {
      if (!currentEntityMap.has(sourceId)) {
        removed.push({
          sourceId,
          name: sourceId, // We don't have the name without stored entity data
          hasHumanMetadata: false, // Would need to check storage
        });
      }
    }

    // Relationship changes
    const addedRelationships: Relationship[] = [];
    const removedRelationships: Relationship[] = [];

    const currentRelKeys = new Set<string>();
    for (const rel of result.relationships) {
      const key = `${rel.fromSourceId}:${rel.type}:${rel.toSourceId}`;
      currentRelKeys.add(key);
      if (!previous.relationshipHashes.has(key)) {
        addedRelationships.push(rel);
      }
    }

    for (const [key] of previous.relationshipHashes) {
      if (!currentRelKeys.has(key)) {
        const [fromSourceId, type, toSourceId] = key.split(':');
        removedRelationships.push({
          fromSourceId,
          toSourceId,
          type: type as Relationship['type'],
          confidence: 1.0,
        });
      }
    }

    return {
      sourceId: previous.sourceId,
      previousTimestamp: previous.timestamp,
      currentTimestamp: new Date(),
      added,
      modified,
      removed,
      addedRelationships,
      removedRelationships,
    };
  }

  /**
   * Generate a hash for an entity (for change detection).
   */
  private hashEntity(entity: EntityWithLevel): string {
    const str = JSON.stringify({
      sourceId: entity.sourceId,
      name: entity.name,
      levelId: entity.levelId,
      parentSourceId: entity.parentSourceId,
      sourceLocation: entity.sourceLocation,
    });
    // Simple hash - in production use crypto
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Generate a hash for a relationship.
   */
  private hashRelationship(rel: Relationship): string {
    const str = JSON.stringify({
      from: rel.fromSourceId,
      to: rel.toSourceId,
      type: rel.type,
      confidence: rel.confidence,
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Log/emit an event if events are enabled.
   * Note: Full EventOrchestrator integration pending - currently logs only.
   * TODO: Add ingestion event types to EnginehausEventPayload union.
   */
  private emitEvent(type: string, data: Record<string, unknown>): void {
    if (this.config.emitEvents) {
      // For now, use Node.js EventEmitter directly for ingestion events
      // Full typed integration with EnginehausEventPayload will be added
      // when ingestion events are formalized.
      if (this.events) {
        this.events.emit(`ingestion:${type}`, {
          type,
          timestamp: new Date(),
          ...data,
        });
      }
    }
  }
}
