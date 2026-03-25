// ============================================================================
// Source Ingestion Framework Types
// ============================================================================
// Transforms external sources (repos, specs, configs) into the unified entity
// graph with appropriate hierarchy levels and relationships.
// ============================================================================

import { HierarchyLevel, HierarchyEntityType } from '../coordination/types.js';

// ============================================================================
// Source Configuration
// ============================================================================

export type SourceType =
  | 'git-repo'
  | 'openapi'
  | 'typescript'
  | 'directory'
  | 'xcode'
  | 'mcp'
  | 'react'
  | 'custom';

/**
 * SourceConfig
 *
 * Configuration for a source to be ingested. Each source type has its own
 * configuration shape defined by the ingester.
 */
export interface SourceConfig {
  /** Unique identifier for this source configuration */
  id: string;
  /** Project this source belongs to */
  projectId: string;
  /** Type of source (determines which ingester to use) */
  sourceType: SourceType;
  /** Human-readable name for this source */
  name: string;
  /** Root path or URL of the source */
  location: string;
  /** Ingester-specific configuration */
  config: Record<string, unknown>;
  /** Whether to automatically re-ingest on detected changes */
  autoSync: boolean;
  /** Interval for auto-sync in minutes (if enabled) */
  syncIntervalMinutes?: number;
  /** Last successful ingestion timestamp */
  lastIngestedAt?: Date;
  /** Hierarchy definition to map entities into */
  hierarchyId?: string;
  /** Level mappings from source structures to hierarchy levels */
  levelMappings?: LevelMapping[];
}

/**
 * LevelMapping
 *
 * Maps a source-native structure type to a hierarchy level.
 * Example: "directory" -> "module", "file" -> "component"
 */
export interface LevelMapping {
  /** Source-native structure type (e.g., "directory", "class", "function") */
  sourceStructure: string;
  /** Target hierarchy level ID */
  levelId: string;
  /** Optional filter pattern (e.g., "*.tsx" for React components only) */
  pattern?: string;
}

// ============================================================================
// Ingestion Results
// ============================================================================

/**
 * EntityWithLevel
 *
 * An entity discovered during ingestion, with its hierarchy position.
 */
export interface EntityWithLevel {
  /** Unique identifier from the source (e.g., file path, class name) */
  sourceId: string;
  /** Human-readable name */
  name: string;
  /** Hierarchy level this entity belongs to */
  levelId: string;
  /** Parent entity's sourceId (for building tree) */
  parentSourceId?: string;
  /** Entity type for the hierarchy node */
  entityType: HierarchyEntityType;
  /** Additional metadata from source */
  metadata?: Record<string, unknown>;
  /** Source file/location for traceability */
  sourceLocation?: string;
  /** Hash of entity content for change detection */
  contentHash?: string;
}

/**
 * Relationship
 *
 * A relationship between entities discovered during ingestion.
 */
export interface Relationship {
  /** Source entity's sourceId */
  fromSourceId: string;
  /** Target entity's sourceId */
  toSourceId: string;
  /** Type of relationship */
  type: RelationshipType;
  /** Relationship strength/confidence (0.0-1.0) */
  confidence: number;
  /** Additional context about the relationship */
  metadata?: Record<string, unknown>;
}

export type RelationshipType =
  | 'imports'      // Code imports/requires
  | 'extends'      // Inheritance
  | 'implements'   // Interface implementation
  | 'calls'        // Function/method calls
  | 'depends_on'   // Generic dependency
  | 'contains'     // Container relationship (alternative to hierarchy)
  | 'references'   // Generic reference
  | 'custom';      // Extension point

/**
 * IngestionResult
 *
 * Complete result from parsing a source.
 */
export interface IngestionResult {
  /** Source configuration that was ingested */
  sourceId: string;
  /** All entities discovered */
  entities: EntityWithLevel[];
  /** All relationships discovered */
  relationships: Relationship[];
  /** Suggested hierarchy levels (for new projects without a hierarchy) */
  suggestedHierarchy?: HierarchyLevel[];
  /** Ingestion metadata */
  metadata: IngestionMetadata;
}

export interface IngestionMetadata {
  /** When ingestion started */
  startedAt: Date;
  /** When ingestion completed */
  completedAt: Date;
  /** Number of files/items processed */
  itemsProcessed: number;
  /** Any warnings during ingestion */
  warnings: string[];
  /** Any errors during ingestion (non-fatal) */
  errors: string[];
  /** Ingester version (for compatibility tracking) */
  ingesterVersion: string;
}

// ============================================================================
// Change Detection
// ============================================================================

/**
 * Snapshot
 *
 * Point-in-time snapshot of ingested entities for change detection.
 */
export interface Snapshot {
  /** When this snapshot was taken */
  timestamp: Date;
  /** Source configuration ID */
  sourceId: string;
  /** Map of sourceId -> entity hash */
  entityHashes: Map<string, string>;
  /** Map of relationship key -> relationship hash */
  relationshipHashes: Map<string, string>;
}

/**
 * ChangeSet
 *
 * Detected changes between two snapshots.
 */
export interface ChangeSet {
  /** Source configuration ID */
  sourceId: string;
  /** Previous snapshot timestamp */
  previousTimestamp?: Date;
  /** Current snapshot timestamp */
  currentTimestamp: Date;
  /** Newly added entities */
  added: EntityWithLevel[];
  /** Entities that were modified */
  modified: ModifiedEntity[];
  /** Entities that were removed */
  removed: RemovedEntity[];
  /** New relationships */
  addedRelationships: Relationship[];
  /** Removed relationships */
  removedRelationships: Relationship[];
}

export interface ModifiedEntity {
  /** The entity with updated values */
  entity: EntityWithLevel;
  /** What changed */
  changes: EntityChange[];
}

export interface EntityChange {
  field: string;
  previousValue?: unknown;
  currentValue?: unknown;
}

export interface RemovedEntity {
  /** sourceId of the removed entity */
  sourceId: string;
  /** Name at time of removal */
  name: string;
  /** Whether the entity had human-added metadata that will be lost */
  hasHumanMetadata: boolean;
}

// ============================================================================
// Reconciliation
// ============================================================================

/**
 * ConflictResolutionStrategy
 *
 * How to handle conflicts between ingested data and human-added data.
 */
export type ConflictResolutionStrategy =
  | 'preserve_human'   // Always keep human-added data
  | 'prefer_source'    // Source wins, human data archived
  | 'merge'            // Attempt to merge, flag conflicts
  | 'manual';          // Queue for human review

/**
 * ReconciliationConfig
 *
 * Configuration for how to reconcile changes.
 */
export interface ReconciliationConfig {
  /** Default strategy for conflicts */
  defaultStrategy: ConflictResolutionStrategy;
  /** Per-field strategy overrides */
  fieldStrategies?: Record<string, ConflictResolutionStrategy>;
  /** Whether to archive removed entities or hard delete */
  archiveRemovedEntities: boolean;
  /** Days to retain archived entities before purging */
  archiveRetentionDays: number;
  /** Whether to create tasks for manual review items */
  createReviewTasks: boolean;
}

/**
 * ReconciliationResult
 *
 * Result of reconciling a changeset into the entity graph.
 */
export interface ReconciliationResult {
  /** Source configuration ID */
  sourceId: string;
  /** Timestamp of reconciliation */
  reconciledAt: Date;
  /** Entities successfully created */
  entitiesCreated: number;
  /** Entities successfully updated */
  entitiesUpdated: number;
  /** Entities archived (soft deleted) */
  entitiesArchived: number;
  /** Relationships created */
  relationshipsCreated: number;
  /** Relationships removed */
  relationshipsRemoved: number;
  /** Conflicts that need manual review */
  conflicts: ReconciliationConflict[];
  /** Warnings during reconciliation */
  warnings: string[];
}

export interface ReconciliationConflict {
  /** Entity sourceId */
  entitySourceId: string;
  /** Field with conflict */
  field: string;
  /** Value from source */
  sourceValue: unknown;
  /** Existing value (human-added or previous) */
  existingValue: unknown;
  /** Resolution applied (if auto-resolved) */
  resolution?: ConflictResolutionStrategy;
  /** Whether this needs human review */
  needsReview: boolean;
}

// ============================================================================
// Ingester Interface
// ============================================================================

/**
 * Ingester
 *
 * Interface for source-specific parsers. Ingesters are stateless - they
 * parse sources and emit entities/relationships. The framework handles
 * persistence and reconciliation.
 */
export interface Ingester {
  /** Unique identifier for this ingester type */
  readonly sourceType: SourceType;
  /** Human-readable name */
  readonly name: string;
  /** Version of this ingester */
  readonly version: string;

  /**
   * Parse a source and return discovered entities and relationships.
   */
  parse(config: SourceConfig): Promise<IngestionResult>;

  /**
   * Detect changes between two snapshots without full re-parse.
   * Returns null if the ingester doesn't support incremental detection
   * (framework will fall back to full re-parse and diff).
   */
  detectChanges?(previous: Snapshot, config: SourceConfig): Promise<ChangeSet | null>;

  /**
   * Validate source configuration before ingestion.
   */
  validateConfig?(config: SourceConfig): Promise<ValidationResult>;

  /**
   * Suggest hierarchy levels based on source structure.
   * Used for new projects that don't have a hierarchy defined.
   */
  suggestHierarchy?(config: SourceConfig): Promise<HierarchyLevel[]>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Framework Types
// ============================================================================

/**
 * IngestionJob
 *
 * Tracks the state of an ingestion job (in-progress or completed).
 */
export interface IngestionJob {
  id: string;
  sourceId: string;
  projectId: string;
  status: IngestionJobStatus;
  startedAt: Date;
  completedAt?: Date;
  result?: IngestionResult;
  reconciliationResult?: ReconciliationResult;
  error?: string;
}

export type IngestionJobStatus = 'pending' | 'parsing' | 'reconciling' | 'completed' | 'failed';

/**
 * IngestionFrameworkConfig
 *
 * Global configuration for the ingestion framework.
 */
export interface IngestionFrameworkConfig {
  /** Default reconciliation config */
  reconciliation: ReconciliationConfig;
  /** Maximum concurrent ingestion jobs */
  maxConcurrentJobs: number;
  /** Timeout for ingestion jobs in milliseconds */
  jobTimeoutMs: number;
  /** Whether to emit events for ingestion progress */
  emitEvents: boolean;
}

/**
 * Default framework configuration
 */
export const DEFAULT_INGESTION_CONFIG: IngestionFrameworkConfig = {
  reconciliation: {
    defaultStrategy: 'preserve_human',
    archiveRemovedEntities: true,
    archiveRetentionDays: 90,
    createReviewTasks: true,
  },
  maxConcurrentJobs: 3,
  jobTimeoutMs: 5 * 60 * 1000, // 5 minutes
  emitEvents: true,
};
