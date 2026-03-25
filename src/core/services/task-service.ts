/**
 * TaskService — extracted from CoordinationService
 *
 * Core task CRUD, lifecycle, search, and change summary operations.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  UnifiedTask,
  TaskStatus,
  TaskPriority,
  TaskType,
} from '../../coordination/types.js';
import type { ServiceContext } from './service-context.js';
import { audit, resolveProjectId } from './service-context.js';

export interface TaskFilter {
  projectId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
}

export class TaskService {
  constructor(private ctx: ServiceContext) {}

  async createTask(data: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    files?: string[];
    projectId?: string;
    type?: TaskType;
    tags?: string[];
    references?: Array<{ url: string; label?: string; type?: string }>;
    createdBy?: string;
  }): Promise<UnifiedTask> {
    const projectId = data.projectId || this.ctx.storage.getActiveProjectIdOrDefault();

    const task: UnifiedTask = {
      id: uuidv4(),
      projectId,
      title: data.title,
      description: data.description || '',
      priority: data.priority || 'medium',
      status: 'ready',
      type: data.type,
      tags: data.tags,
      references: data.references,
      files: data.files || [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: data.createdBy,
      version: 1,
    };

    await this.ctx.storage.saveTask(task);

    // Audit event
    await audit(this.ctx.storage, 'task.created', projectId, 'task', task.id, `Task created: ${task.title}`, { actorId: data.createdBy || 'system', actorType: data.createdBy ? 'agent' : 'system', metadata: { priority: task.priority, type: task.type } });

    // Emit event
    if (this.ctx.events) {
      await this.ctx.events.emitTaskCreated(task, 'internal');
    }

    return task;
  }

  async getTask(id: string): Promise<UnifiedTask | null> {
    return this.ctx.storage.getTask(id);
  }

  /**
   * Resolve a full or partial (prefix) task ID to a task.
   * Tries exact match first, then prefix match within the project.
   * Returns null if no match or ambiguous (multiple prefix matches).
   */
  async resolveTaskId(taskId: string, projectId?: string): Promise<UnifiedTask | null> {
    // Exact match first
    const exact = await this.ctx.storage.getTask(taskId);
    if (exact) {
      if (!projectId || exact.projectId === projectId) return exact;
      return null; // Matched a task in a different project
    }

    // Prefix match within project
    const resolvedProjectId = await resolveProjectId(this.ctx.storage, projectId);
    const allTasks = await this.ctx.storage.getTasks({ projectId: resolvedProjectId || undefined });
    const matches = allTasks.filter(t => t.id.startsWith(taskId));
    if (matches.length === 1) return matches[0];
    return null; // No match or ambiguous
  }

  async getTasks(filter: TaskFilter = {}): Promise<UnifiedTask[]> {
    return this.ctx.storage.getTasks(filter);
  }

  async searchTasks(query: string, options?: {
    projectId?: string;
    status?: TaskStatus;
    limit?: number;
  }): Promise<UnifiedTask[]> {
    return this.ctx.storage.searchTasks(query, options);
  }

  async getChangeSummary(since: Date, projectId?: string): Promise<{
    since: Date;
    completedTasks: Array<{ id: string; title: string; summary?: string }>;
    newTasks: Array<{ id: string; title: string; priority: string }>;
    decisions: Array<{ id: string; decision: string; category?: string; taskId?: string }>;
    statusChanges: number;
  }> {
    const resolvedProjectId = await resolveProjectId(this.ctx.storage, projectId) || undefined;

    // Tasks completed since timestamp
    const completedTasks = await this.ctx.storage.getTasksCompletedSince(since);
    const projectCompleted = resolvedProjectId
      ? completedTasks.filter(t => t.projectId === resolvedProjectId)
      : completedTasks;

    // Tasks created since timestamp
    const allTasks = await this.ctx.storage.getTasks({ projectId: resolvedProjectId });
    const newTasks = allTasks.filter(t => new Date(t.createdAt) > since);

    // Decisions since timestamp
    const decisions = await this.ctx.storage.getDecisions({
      projectId: resolvedProjectId,
      since,
      limit: 50,
    });

    return {
      since,
      completedTasks: projectCompleted.map(t => ({
        id: t.id,
        title: t.title,
        summary: t.implementation?.implementationSummary,
      })),
      newTasks: newTasks.map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
      })),
      decisions: decisions.map(d => ({
        id: d.id,
        decision: d.decision,
        category: d.category,
        taskId: d.taskId,
      })),
      statusChanges: projectCompleted.length + newTasks.length,
    };
  }

  async updateTask(id: string, updates: Partial<UnifiedTask>): Promise<UnifiedTask | null> {
    const existing = await this.ctx.storage.getTask(id);
    if (!existing) return null;

    // Validate projectId if provided
    if (updates.projectId) {
      const project = await this.ctx.storage.getProject(updates.projectId);
      if (!project) {
        throw new Error(`Project not found: ${updates.projectId}`);
      }
    }

    const previousState = { ...existing };

    // Field-level audit: detect what actually changed
    const changedFields: Record<string, { before: unknown; after: unknown }> = {};
    const auditableFields = ['title', 'description', 'priority', 'status', 'files', 'projectId', 'assignedTo', 'tags'] as const;
    for (const field of auditableFields) {
      if ((updates as Record<string, unknown>)[field] !== undefined) {
        const before = (existing as unknown as Record<string, unknown>)[field];
        const after = (updates as Record<string, unknown>)[field];
        const beforeStr = Array.isArray(before) ? JSON.stringify(before) : String(before ?? '');
        const afterStr = Array.isArray(after) ? JSON.stringify(after) : String(after ?? '');
        if (beforeStr !== afterStr) {
          changedFields[field] = { before: before ?? null, after: after ?? null };
        }
      }
    }

    await this.ctx.storage.updateTask(id, updates);
    const updated = await this.ctx.storage.getTask(id);

    // Audit field-level changes (beyond just status)
    if (Object.keys(changedFields).length > 0) {
      const activeSession = await this.ctx.storage.getActiveSessionForTask(id);
      const currentAgent = updates.lastModifiedBy || activeSession?.agentId || 'system';
      const previousAgent = existing.lastModifiedBy;

      await audit(this.ctx.storage, 'task.fields_updated', existing.projectId, 'task', id,
        `Task fields updated: ${Object.keys(changedFields).join(', ')}`,
        {
          actorId: currentAgent,
          actorType: activeSession ? 'agent' : 'system',
          metadata: {
            changedFields,
            previousModifiedBy: previousAgent || null,
            crossAgentOverwrite: !!(previousAgent && previousAgent !== currentAgent),
            taskTitle: existing.title,
          },
        },
      );
    }

    // Log status changes to audit log for AX metrics (especially reopens)
    if (updates.status && updates.status !== previousState.status) {
      const isReopen = previousState.status === 'completed' &&
                       (updates.status === 'in-progress' || updates.status === 'ready');

      // Get active session for actor attribution
      const activeSession = await this.ctx.storage.getActiveSessionForTask(id);

      await audit(this.ctx.storage, 'task.status_changed', existing.projectId, 'task', id, `Task status changed from ${previousState.status} to ${updates.status}`, { actorId: activeSession?.agentId || 'system', actorType: activeSession ? 'agent' : 'system', metadata: { isReopen, taskTitle: existing.title, previousStatus: previousState.status, newStatus: updates.status, beforeState: { status: previousState.status }, afterState: { status: updates.status } } });
    }

    // If task was completed, unblock any dependent tasks and log metric
    let unblockedTasks: string[] = [];
    if (updates.status === 'completed' && previousState.status !== 'completed') {
      unblockedTasks = await this.ctx.storage.unblockDependentTasks(id);

      // Get active session for consistent metric attribution
      const activeSession = await this.ctx.storage.getActiveSessionForTask(id);

      // Log completion metric at service layer (all adapters benefit)
      await this.ctx.storage.logMetric({
        eventType: 'task_completed',
        projectId: existing.projectId,
        taskId: id,
        sessionId: activeSession?.id,
        metadata: {
          completedAt: new Date().toISOString(),
          previousStatus: previousState.status,
          agentId: activeSession?.agentId,
        },
      });

      // Release the session so it doesn't pollute future getActiveSessions() calls
      if (activeSession) {
        await this.ctx.storage.completeSession(activeSession.id);
      }
    }

    // Emit events
    if (this.ctx.events && updated) {
      if (updates.status === 'completed' && previousState.status !== 'completed') {
        await this.ctx.events.emitTaskCompleted(updated, 'internal');
      } else {
        await this.ctx.events.emitTaskUpdated(updated, previousState, 'internal');
      }
    }

    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    await this.ctx.storage.deleteTask(id);
  }

  async getNextTask(filter: TaskFilter = {}): Promise<UnifiedTask | null> {
    const tasks = await this.ctx.storage.getTasks({
      ...filter,
      status: filter.status || 'ready',
    });

    if (tasks.length === 0) return null;

    // Sort by priority then creation date
    const priorityOrder: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return tasks[0];
  }
}
