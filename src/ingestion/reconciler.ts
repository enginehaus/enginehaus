// ============================================================================
// Ingestion Reconciler
// ============================================================================
// Reconciles changes from source ingestion into the entity graph while
// preserving human-added metadata. Handles conflict resolution, archival,
// and creates review tasks for manual intervention.
// ============================================================================

import { randomUUID } from 'crypto';
import {
  ChangeSet,
  ReconciliationConfig,
  ReconciliationResult,
  ReconciliationConflict,
  ConflictResolutionStrategy,
  EntityWithLevel,
  ModifiedEntity,
  RemovedEntity,
  Relationship,
} from './types.js';
import { HierarchyNode, HierarchyEntityType } from '../coordination/types.js';

/**
 * ReconcilerStorage
 *
 * Storage interface for the reconciler. Implemented by SQLiteStorageService.
 */
export interface ReconcilerStorage {
  // Hierarchy node operations
  createHierarchyNode(node: {
    hierarchyId: string;
    levelId: string;
    parentNodeId?: string;
    entityType: HierarchyEntityType;
    entityId: string;
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<HierarchyNode>;

  getHierarchyNode(id: string): Promise<HierarchyNode | null>;
  getHierarchyNodeForEntity(entityType: string, entityId: string): Promise<HierarchyNode | null>;
  getHierarchyNodeBySourceId(hierarchyId: string, sourceId: string): Promise<HierarchyNode | null>;

  updateHierarchyNode(id: string, updates: Partial<HierarchyNode>): Promise<HierarchyNode>;
  deleteHierarchyNode(id: string, cascade?: boolean): Promise<boolean>;

  // Archive operations
  archiveHierarchyNode(id: string, reason: string): Promise<void>;

  // Relationship operations (if stored separately from hierarchy)
  createEntityRelationship?(relationship: {
    fromNodeId: string;
    toNodeId: string;
    type: string;
    confidence: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;

  deleteEntityRelationship?(id: string): Promise<boolean>;

  getEntityRelationships?(nodeId: string): Promise<Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    type: string;
  }>>;

  // Review task creation
  createTask?(task: {
    projectId: string;
    title: string;
    description: string;
    priority: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

/**
 * Reconciler
 *
 * Reconciles ingested changes with existing entity graph. Key responsibilities:
 * - Apply changes while preserving human-added metadata
 * - Handle conflicts according to configured strategy
 * - Archive removed entities (soft delete)
 * - Create review tasks for items needing human attention
 */
export class Reconciler {
  constructor(
    private storage: ReconcilerStorage,
    private config: ReconciliationConfig
  ) {}

  /**
   * Reconcile a changeset into the entity graph.
   */
  async reconcile(
    changeSet: ChangeSet,
    hierarchyId?: string
  ): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      sourceId: changeSet.sourceId,
      reconciledAt: new Date(),
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesArchived: 0,
      relationshipsCreated: 0,
      relationshipsRemoved: 0,
      conflicts: [],
      warnings: [],
    };

    if (!hierarchyId) {
      result.warnings.push('No hierarchy ID provided - entities will be created but not linked to hierarchy');
    }

    // Process additions
    const sourceIdToNodeId = new Map<string, string>();
    for (const entity of changeSet.added) {
      try {
        const nodeId = await this.createEntity(entity, hierarchyId, sourceIdToNodeId);
        sourceIdToNodeId.set(entity.sourceId, nodeId);
        result.entitiesCreated++;
      } catch (error) {
        result.warnings.push(`Failed to create entity ${entity.sourceId}: ${error}`);
      }
    }

    // Process modifications
    for (const modified of changeSet.modified) {
      try {
        const conflicts = await this.updateEntity(modified, hierarchyId);
        result.entitiesUpdated++;
        result.conflicts.push(...conflicts);
      } catch (error) {
        result.warnings.push(`Failed to update entity ${modified.entity.sourceId}: ${error}`);
      }
    }

    // Process removals
    for (const removed of changeSet.removed) {
      try {
        const archived = await this.handleRemoval(removed, hierarchyId);
        if (archived) {
          result.entitiesArchived++;
        }
      } catch (error) {
        result.warnings.push(`Failed to archive entity ${removed.sourceId}: ${error}`);
      }
    }

    // Process relationship additions
    for (const rel of changeSet.addedRelationships) {
      try {
        await this.createRelationship(rel, sourceIdToNodeId, hierarchyId);
        result.relationshipsCreated++;
      } catch (error) {
        result.warnings.push(`Failed to create relationship ${rel.fromSourceId}->${rel.toSourceId}: ${error}`);
      }
    }

    // Process relationship removals
    for (const rel of changeSet.removedRelationships) {
      try {
        await this.removeRelationship(rel, hierarchyId);
        result.relationshipsRemoved++;
      } catch (error) {
        result.warnings.push(`Failed to remove relationship: ${error}`);
      }
    }

    // Create review tasks for conflicts needing attention
    if (this.config.createReviewTasks && result.conflicts.some(c => c.needsReview)) {
      await this.createReviewTasksForConflicts(result.conflicts, changeSet.sourceId);
    }

    return result;
  }

  /**
   * Create a new entity in the hierarchy.
   */
  private async createEntity(
    entity: EntityWithLevel,
    hierarchyId: string | undefined,
    sourceIdToNodeId: Map<string, string>
  ): Promise<string> {
    if (!hierarchyId) {
      // Without hierarchy, we can't create hierarchy nodes
      // Just return a placeholder ID
      return randomUUID();
    }

    // Resolve parent node ID
    let parentNodeId: string | undefined;
    if (entity.parentSourceId) {
      // Check if parent was just created in this batch
      parentNodeId = sourceIdToNodeId.get(entity.parentSourceId);

      // If not, look up in storage
      if (!parentNodeId) {
        const parentNode = await this.storage.getHierarchyNodeBySourceId(
          hierarchyId,
          entity.parentSourceId
        );
        parentNodeId = parentNode?.id;
      }
    }

    const node = await this.storage.createHierarchyNode({
      hierarchyId,
      levelId: entity.levelId,
      parentNodeId,
      entityType: entity.entityType,
      entityId: entity.sourceId, // Use sourceId as entityId for ingested entities
      name: entity.name,
      metadata: {
        ...entity.metadata,
        sourceLocation: entity.sourceLocation,
        contentHash: entity.contentHash,
        ingestedAt: new Date().toISOString(),
        isIngested: true,
      },
    });

    return node.id;
  }

  /**
   * Update an existing entity, handling conflicts.
   */
  private async updateEntity(
    modified: ModifiedEntity,
    hierarchyId: string | undefined
  ): Promise<ReconciliationConflict[]> {
    const conflicts: ReconciliationConflict[] = [];

    if (!hierarchyId) {
      return conflicts;
    }

    const existingNode = await this.storage.getHierarchyNodeBySourceId(
      hierarchyId,
      modified.entity.sourceId
    );

    if (!existingNode) {
      // Entity no longer exists - skip update
      return conflicts;
    }

    // Check for human-added metadata that might conflict
    const existingMetadata = existingNode.metadata || {};
    const hasHumanEdits = existingMetadata.humanEdited === true;

    for (const change of modified.changes) {
      const strategy = this.getStrategy(change.field);

      if (hasHumanEdits && strategy === 'preserve_human') {
        // Skip update, record as conflict
        conflicts.push({
          entitySourceId: modified.entity.sourceId,
          field: change.field,
          sourceValue: change.currentValue,
          existingValue: change.previousValue,
          resolution: 'preserve_human',
          needsReview: false,
        });
        continue;
      }

      if (strategy === 'manual') {
        // Queue for manual review
        conflicts.push({
          entitySourceId: modified.entity.sourceId,
          field: change.field,
          sourceValue: change.currentValue,
          existingValue: change.previousValue,
          needsReview: true,
        });
        continue;
      }

      // Apply update
      await this.storage.updateHierarchyNode(existingNode.id, {
        name: modified.entity.name,
        metadata: {
          ...existingMetadata,
          ...modified.entity.metadata,
          sourceLocation: modified.entity.sourceLocation,
          contentHash: modified.entity.contentHash,
          lastUpdatedFromSource: new Date().toISOString(),
        },
      });
    }

    return conflicts;
  }

  /**
   * Handle entity removal (archive or delete based on config).
   */
  private async handleRemoval(
    removed: RemovedEntity,
    hierarchyId: string | undefined
  ): Promise<boolean> {
    if (!hierarchyId) {
      return false;
    }

    const existingNode = await this.storage.getHierarchyNodeBySourceId(
      hierarchyId,
      removed.sourceId
    );

    if (!existingNode) {
      return false;
    }

    if (this.config.archiveRemovedEntities) {
      // Soft delete - archive the node
      if (this.storage.archiveHierarchyNode) {
        await this.storage.archiveHierarchyNode(
          existingNode.id,
          `Removed from source during ingestion at ${new Date().toISOString()}`
        );
      } else {
        // Fallback: update metadata to mark as archived
        await this.storage.updateHierarchyNode(existingNode.id, {
          metadata: {
            ...existingNode.metadata,
            archived: true,
            archivedAt: new Date().toISOString(),
            archivedReason: 'Removed from source during ingestion',
          },
        });
      }
    } else {
      // Hard delete
      await this.storage.deleteHierarchyNode(existingNode.id, true);
    }

    return true;
  }

  /**
   * Create a relationship between entities.
   */
  private async createRelationship(
    rel: Relationship,
    sourceIdToNodeId: Map<string, string>,
    hierarchyId: string | undefined
  ): Promise<void> {
    if (!hierarchyId || !this.storage.createEntityRelationship) {
      return;
    }

    // Resolve node IDs
    let fromNodeId = sourceIdToNodeId.get(rel.fromSourceId);
    if (!fromNodeId) {
      const fromNode = await this.storage.getHierarchyNodeBySourceId(hierarchyId, rel.fromSourceId);
      fromNodeId = fromNode?.id;
    }

    let toNodeId = sourceIdToNodeId.get(rel.toSourceId);
    if (!toNodeId) {
      const toNode = await this.storage.getHierarchyNodeBySourceId(hierarchyId, rel.toSourceId);
      toNodeId = toNode?.id;
    }

    if (!fromNodeId || !toNodeId) {
      return; // Can't create relationship without both endpoints
    }

    await this.storage.createEntityRelationship({
      fromNodeId,
      toNodeId,
      type: rel.type,
      confidence: rel.confidence,
      metadata: rel.metadata,
    });
  }

  /**
   * Remove a relationship.
   */
  private async removeRelationship(
    rel: Relationship,
    hierarchyId: string | undefined
  ): Promise<void> {
    if (!hierarchyId || !this.storage.getEntityRelationships || !this.storage.deleteEntityRelationship) {
      return;
    }

    // Find the relationship by looking up nodes and their relationships
    const fromNode = await this.storage.getHierarchyNodeBySourceId(hierarchyId, rel.fromSourceId);
    if (!fromNode) return;

    const relationships = await this.storage.getEntityRelationships(fromNode.id);
    const toRemove = relationships.find(r =>
      r.type === rel.type &&
      r.toNodeId === rel.toSourceId // This might need adjustment based on actual storage
    );

    if (toRemove) {
      await this.storage.deleteEntityRelationship(toRemove.id);
    }
  }

  /**
   * Get the conflict resolution strategy for a field.
   */
  private getStrategy(field: string): ConflictResolutionStrategy {
    if (this.config.fieldStrategies?.[field]) {
      return this.config.fieldStrategies[field];
    }
    return this.config.defaultStrategy;
  }

  /**
   * Create review tasks for conflicts that need human attention.
   */
  private async createReviewTasksForConflicts(
    conflicts: ReconciliationConflict[],
    sourceId: string
  ): Promise<void> {
    if (!this.storage.createTask) {
      return;
    }

    const needsReview = conflicts.filter(c => c.needsReview);
    if (needsReview.length === 0) {
      return;
    }

    // Group conflicts by entity
    const byEntity = new Map<string, ReconciliationConflict[]>();
    for (const conflict of needsReview) {
      const existing = byEntity.get(conflict.entitySourceId) || [];
      existing.push(conflict);
      byEntity.set(conflict.entitySourceId, existing);
    }

    // Create a task for each entity with conflicts
    for (const [entitySourceId, entityConflicts] of byEntity) {
      const fieldList = entityConflicts.map(c => c.field).join(', ');
      await this.storage.createTask({
        projectId: sourceId, // This should be resolved to actual projectId
        title: `Review ingestion conflicts for ${entitySourceId}`,
        description: `The following fields have conflicts that need manual review: ${fieldList}`,
        priority: 'medium',
        metadata: {
          type: 'ingestion-review',
          sourceId,
          entitySourceId,
          conflicts: entityConflicts,
        },
      });
    }
  }
}
