/**
 * InitiativeService — extracted from CoordinationService
 *
 * Initiative CRUD, task linking, outcome recording, learnings,
 * and initiative suggestions.
 */

import type { ServiceContext } from './service-context.js';
import { audit, resolveProjectId } from './service-context.js';
import { suggestInitiatives as suggestInitiativesFromTasks } from '../../utils/initiative-suggestions.js';

export class InitiativeService {
  constructor(private ctx: ServiceContext) {}

  async createInitiative(params: {
    title: string; description?: string; successCriteria?: string; projectId?: string;
  }): Promise<{ success: boolean; initiativeId?: string; message: string }> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    if (!projectId) return { success: false, message: 'No active project. Set a project first.' };

    const id = `init-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await this.ctx.storage.createInitiative({ id, projectId, title: params.title, description: params.description, successCriteria: params.successCriteria });
    await audit(this.ctx.storage, 'initiative.created', projectId, 'initiative', id, `Initiative created: ${params.title}`, { metadata: { title: params.title, successCriteria: params.successCriteria } });
    return { success: true, initiativeId: id, message: `Initiative created: ${params.title}` };
  }

  async getInitiative(initiativeId: string): Promise<any> {
    const initiative = await this.ctx.storage.getInitiative(initiativeId);
    if (!initiative) return { success: false, error: 'Initiative not found' };
    return { success: true, initiative };
  }

  async listInitiatives(params: { projectId?: string; status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned'; limit?: number } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    const initiatives = await this.ctx.storage.listInitiatives({ projectId: projectId || undefined, status: params.status, limit: params.limit });
    return { success: true, initiatives, count: initiatives.length };
  }

  async linkTaskToInitiative(params: { taskId: string; initiativeId: string; contributionNotes?: string }): Promise<any> {
    const task = await this.ctx.storage.getTask(params.taskId);
    if (!task) return { success: false, message: 'Task not found' };
    const initiative = await this.ctx.storage.getInitiative(params.initiativeId);
    if (!initiative) return { success: false, message: 'Initiative not found' };

    await this.ctx.storage.linkTaskToInitiative({ taskId: params.taskId, initiativeId: params.initiativeId, contributionNotes: params.contributionNotes });
    await audit(this.ctx.storage, 'initiative.task_linked', task.projectId, 'initiative', params.initiativeId, `Task linked to initiative: "${task.title}" → "${initiative.title}"`, { metadata: { taskId: params.taskId, initiativeId: params.initiativeId, contributionNotes: params.contributionNotes } });
    return { success: true, message: `Task "${task.title}" linked to initiative "${initiative.title}"` };
  }

  async recordInitiativeOutcome(params: { initiativeId: string; status: 'succeeded' | 'failed' | 'pivoted' | 'abandoned'; outcomeNotes: string }): Promise<any> {
    const initiative = await this.ctx.storage.getInitiative(params.initiativeId);
    if (!initiative) return { success: false, message: 'Initiative not found' };

    await this.ctx.storage.recordInitiativeOutcome({ initiativeId: params.initiativeId, status: params.status, outcomeNotes: params.outcomeNotes });
    await audit(this.ctx.storage, 'initiative.outcome_recorded', initiative.projectId, 'initiative', params.initiativeId, `Initiative outcome: "${initiative.title}" → ${params.status}`, { metadata: { status: params.status, outcomeNotes: params.outcomeNotes } });
    return { success: true, message: `Outcome recorded for "${initiative.title}": ${params.status}` };
  }

  async updateInitiative(params: {
    initiativeId: string; title?: string; description?: string; successCriteria?: string;
    status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned'; outcomeNotes?: string; projectId?: string;
  }): Promise<any> {
    const initiative = await this.ctx.storage.getInitiative(params.initiativeId);
    if (!initiative) return { success: false, message: 'Initiative not found' };

    if (params.projectId) {
      const project = await this.ctx.storage.getProject(params.projectId);
      if (!project) return { success: false, message: `Target project not found: ${params.projectId}` };
    }

    const changes: Record<string, { from: any; to: any }> = {};
    if (params.title !== undefined && params.title !== initiative.title) changes.title = { from: initiative.title, to: params.title };
    if (params.description !== undefined && params.description !== initiative.description) changes.description = { from: initiative.description, to: params.description };
    if (params.successCriteria !== undefined && params.successCriteria !== initiative.successCriteria) changes.successCriteria = { from: initiative.successCriteria, to: params.successCriteria };
    if (params.status !== undefined && params.status !== initiative.status) changes.status = { from: initiative.status, to: params.status };
    if (params.outcomeNotes !== undefined && params.outcomeNotes !== initiative.outcomeNotes) changes.outcomeNotes = { from: initiative.outcomeNotes, to: params.outcomeNotes };
    if (params.projectId !== undefined && params.projectId !== initiative.projectId) changes.projectId = { from: initiative.projectId, to: params.projectId };

    if (Object.keys(changes).length === 0) return { success: true, message: `Initiative "${initiative.title}" unchanged — values already match`, initiative };

    await this.ctx.storage.updateInitiative({
      initiativeId: params.initiativeId, title: params.title, description: params.description,
      successCriteria: params.successCriteria, status: params.status, outcomeNotes: params.outcomeNotes, projectId: params.projectId,
    });

    await audit(this.ctx.storage, 'initiative.updated', params.projectId || initiative.projectId, 'initiative', params.initiativeId, `Initiative updated: "${initiative.title}" — changed ${Object.keys(changes).join(', ')}`, { metadata: { changes } });
    const updated = await this.ctx.storage.getInitiative(params.initiativeId);
    return { success: true, message: `Updated "${initiative.title}": changed ${Object.keys(changes).join(', ')}`, initiative: updated };
  }

  async getInitiativeLearnings(params: { projectId?: string } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    const learnings = await this.ctx.storage.getInitiativeLearnings({ projectId: projectId || undefined });
    return { success: true, learnings };
  }

  async suggestInitiatives(params: { projectId?: string; minClusterSize?: number; maxSuggestions?: number } = {}): Promise<any> {
    const projectId = await resolveProjectId(this.ctx.storage, params.projectId);
    const tasks = await this.ctx.storage.getTasks({ projectId: projectId || undefined });
    const suggestions = suggestInitiativesFromTasks(tasks, { minClusterSize: params.minClusterSize, maxSuggestions: params.maxSuggestions });

    if (suggestions.length === 0) return { success: true, suggestions: [], message: 'No initiative groupings found. Tasks may be too diverse or too few for clustering.' };
    return { success: true, suggestions, message: `Found ${suggestions.length} potential initiative(s). Create with: create_initiative({ title: "...", successCriteria: "..." }) then link tasks with: link_task_to_initiative({ taskId, initiativeId })` };
  }

  async getTaskInitiatives(taskId: string): Promise<any> {
    const initiatives = await this.ctx.storage.getTaskInitiatives(taskId);
    return { success: true, initiatives };
  }
}
