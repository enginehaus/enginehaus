/**
 * Shared ServiceContext for all decomposed services.
 *
 * Every extracted service receives this context instead of accessing
 * CoordinationService internals directly.
 */

import type { StorageAdapter } from '../../storage/storage-adapter.js';
import type { EventOrchestrator } from '../../events/event-orchestrator.js';

export interface ServiceContext {
  storage: StorageAdapter;
  events?: EventOrchestrator;
}

/**
 * Shorthand for storage.logAuditEvent with consistent defaults.
 * Shared by all services that need audit logging.
 */
export function audit(
  storage: StorageAdapter,
  eventType: string,
  projectId: string,
  resourceType: string,
  resourceId: string,
  action: string,
  opts: {
    actorId?: string;
    actorType?: 'user' | 'agent' | 'system';
    metadata?: Record<string, unknown>;
  } = {},
) {
  return storage.logAuditEvent({
    eventType,
    actorId: opts.actorId ?? 'agent',
    actorType: opts.actorType ?? 'agent',
    projectId,
    resourceType,
    resourceId,
    action,
    metadata: opts.metadata,
  });
}

/**
 * Resolve a project ID, falling back to the active project.
 * Shared by all services that accept optional projectId.
 *
 * Accepts either a UUID or a slug. When a slug is passed, it's
 * resolved to the project's actual ID via getProjectBySlug.
 */
export async function resolveProjectId(
  storage: StorageAdapter,
  explicit?: string | null,
): Promise<string | null> {
  if (!explicit) return storage.getActiveProjectId();

  // If it looks like a UUID, use it directly
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(explicit)) {
    return explicit;
  }

  // Otherwise treat as slug and resolve
  const project = await storage.getProjectBySlug(explicit);
  if (project) return project.id;

  // Fall through — might be a non-UUID ID format, pass as-is
  return explicit;
}
