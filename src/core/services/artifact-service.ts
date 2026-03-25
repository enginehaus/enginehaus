/**
 * ArtifactService — extracted from CoordinationService
 *
 * Artifact CRUD, linking, search, lineage, and insight capture.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Artifact,
  ArtifactType,
  ArtifactContentType,
  ArtifactEvolution,
} from '../../coordination/types.js';
import type { ServiceContext } from './service-context.js';
import { resolveProjectId } from './service-context.js';

/**
 * Callbacks for cross-service operations.
 */
export interface ArtifactCallbacks {
  logDecision: (params: {
    decision: string;
    rationale?: string;
    impact?: string;
    category?: string;
    taskId?: string;
  }) => Promise<{ success: boolean; decisionId?: string }>;
  storeArtifact: (params: {
    taskId: string;
    type: ArtifactType;
    content: string;
    contentType: string;
    title?: string;
    description?: string;
    parentArtifactId?: string;
  }) => Promise<{
    success: boolean;
    artifactId?: string;
    error?: string;
  }>;
}

export class ArtifactService {
  private callbacks!: ArtifactCallbacks;

  constructor(private ctx: ServiceContext) {}

  setCallbacks(callbacks: ArtifactCallbacks): void {
    this.callbacks = callbacks;
  }

  async linkArtifact(params: {
    taskId: string;
    type: string;
    uri: string;
    title?: string;
    description?: string;
    parentArtifactId?: string;
  }): Promise<any> {
    const task = await this.ctx.storage.getTask(params.taskId);
    if (!task) return { success: false, error: `Task not found: ${params.taskId}` };

    let parentArtifact: Artifact | null = null;
    if (params.parentArtifactId) {
      parentArtifact = await this.ctx.storage.getArtifact(params.parentArtifactId);
      if (!parentArtifact) return { success: false, error: `Parent artifact not found: ${params.parentArtifactId}` };
    }

    const evolutionHistory: ArtifactEvolution[] = [{
      artifactId: uuidv4(),
      timestamp: new Date(),
      action: parentArtifact ? 'refined' : 'created',
      summary: parentArtifact ? `Evolved from ${parentArtifact.title || parentArtifact.id}` : 'Initial creation',
    }];

    if (parentArtifact?.evolutionHistory) {
      evolutionHistory.unshift(...parentArtifact.evolutionHistory);
    }

    const artifactId = evolutionHistory[evolutionHistory.length - 1].artifactId;

    const artifact = await this.ctx.storage.createArtifact({
      id: artifactId, taskId: params.taskId, projectId: task.projectId,
      type: params.type as ArtifactType, uri: params.uri,
      title: params.title, description: params.description,
      createdAt: new Date(), evolutionHistory,
      parentArtifactId: params.parentArtifactId,
    });

    return {
      success: true,
      artifact: {
        id: artifact.id, type: artifact.type, uri: artifact.uri,
        title: artifact.title, parentArtifactId: artifact.parentArtifactId,
        evolutionDepth: evolutionHistory.length,
      },
      message: parentArtifact
        ? `Artifact evolved from ${parentArtifact.id} and linked to task ${params.taskId}`
        : `Artifact linked to task ${params.taskId}`,
    };
  }

  async listArtifacts(params: { taskId: string; type?: string; includeContent?: boolean }): Promise<any> {
    const artifacts = await this.ctx.storage.getArtifactsForTask(params.taskId, params.type as ArtifactType | undefined);

    return {
      success: true, taskId: params.taskId,
      artifacts: artifacts.map(a => {
        const item: any = {
          id: a.id, type: a.type, uri: a.uri, title: a.title, description: a.description,
          createdAt: a.createdAt, parentArtifactId: a.parentArtifactId,
          evolutionDepth: a.evolutionHistory?.length || 0, hasContent: !!a.content,
          contentType: a.contentType, contentSize: a.contentSize,
        };
        if (params.includeContent && a.content) item.content = a.content;
        else if (a.content) item.contentPreview = a.content.substring(0, 100) + (a.content.length > 100 ? '...' : '');
        return item;
      }),
      count: artifacts.length,
      storedContentCount: artifacts.filter(a => a.content).length,
    };
  }

  async removeArtifact(artifactId: string): Promise<any> {
    const deleted = await this.ctx.storage.deleteArtifact(artifactId);
    if (!deleted) return { success: false, error: `Artifact not found: ${artifactId}` };
    return { success: true, message: `Artifact ${artifactId} removed` };
  }

  async getArtifactLineage(artifactId: string): Promise<any> {
    const artifact = await this.ctx.storage.getArtifact(artifactId);
    if (!artifact) return { success: false, error: `Artifact not found: ${artifactId}` };

    const children = await this.ctx.storage.getArtifactChildren(artifactId);

    return {
      success: true,
      artifact: { id: artifact.id, type: artifact.type, uri: artifact.uri, title: artifact.title, parentArtifactId: artifact.parentArtifactId, createdAt: artifact.createdAt },
      evolutionHistory: artifact.evolutionHistory || [],
      children: children.map(c => ({ id: c.id, type: c.type, uri: c.uri, title: c.title, createdAt: c.createdAt })),
      stats: { evolutionDepth: artifact.evolutionHistory?.length || 0, childCount: children.length },
    };
  }

  async storeArtifact(params: {
    taskId: string; type: ArtifactType; content: string; contentType: string;
    title?: string; description?: string; parentArtifactId?: string;
  }): Promise<any> {
    const contentSize = Buffer.byteLength(params.content, 'utf8');
    if (contentSize > 1024 * 1024) return { success: false, error: `Content too large: ${contentSize} bytes exceeds 1MB limit` };

    const task = await this.ctx.storage.getTask(params.taskId);
    if (!task) return { success: false, error: `Task not found: ${params.taskId}` };

    let evolutionHistory: ArtifactEvolution[] | undefined;
    if (params.parentArtifactId) {
      const parentArtifact = await this.ctx.storage.getArtifact(params.parentArtifactId);
      if (parentArtifact) {
        evolutionHistory = [
          ...(parentArtifact.evolutionHistory || []),
          { artifactId: parentArtifact.id, timestamp: new Date(), action: 'refined' as const, summary: params.title ? `Refined into: ${params.title}` : 'Refined from parent artifact' },
        ];
      }
    }

    const artifactId = uuidv4();
    const artifact = await this.ctx.storage.createArtifact({
      id: artifactId, taskId: params.taskId, projectId: task.projectId,
      type: params.type, uri: '', title: params.title, description: params.description,
      content: params.content, contentType: params.contentType as ArtifactContentType,
      contentSize, evolutionHistory, parentArtifactId: params.parentArtifactId, createdAt: new Date(),
    });

    if (evolutionHistory && evolutionHistory.length === 1 && !params.parentArtifactId) {
      evolutionHistory[0].artifactId = artifact.id;
      await this.ctx.storage.updateArtifact(artifact.id, { evolutionHistory });
    }

    return {
      success: true, artifactId: artifact.id, taskId: params.taskId, type: params.type,
      contentType: params.contentType, contentSize, title: params.title,
      hasLineage: !!params.parentArtifactId, message: `Artifact stored successfully (${contentSize} bytes)`,
    };
  }

  async captureInsight(params: {
    taskId: string; content: string;
    type: 'design' | 'rationale' | 'requirement' | 'note' | 'decision';
    title?: string;
  }): Promise<any> {
    const task = await this.ctx.storage.getTask(params.taskId);
    if (!task) return { success: false, error: `Task not found: ${params.taskId}` };

    const artifactTypeMap: Record<string, ArtifactType> = {
      design: 'design', rationale: 'doc', requirement: 'doc', note: 'doc', decision: 'doc',
    };

    const title = params.title || `${params.type.charAt(0).toUpperCase() + params.type.slice(1)}: ${
      params.content.slice(0, 50).replace(/\n/g, ' ')}${params.content.length > 50 ? '...' : ''}`;

    const artifactResult = await this.callbacks.storeArtifact({
      taskId: params.taskId, type: artifactTypeMap[params.type],
      content: params.content, contentType: 'text/markdown',
      title, description: `Captured ${params.type} from conversation`,
    });

    if (!artifactResult.success) return { success: false, error: artifactResult.error };

    let decisionId: string | undefined;
    if (params.type === 'decision') {
      const decisionResult = await this.callbacks.logDecision({
        decision: title, rationale: params.content, impact: 'Captured from conversation',
        category: 'architecture', taskId: params.taskId,
      });
      if (decisionResult.success && decisionResult.decisionId) decisionId = decisionResult.decisionId;
    }

    return {
      success: true, artifactId: artifactResult.artifactId, decisionId,
      taskId: params.taskId, type: params.type, title,
      message: decisionId ? 'Insight captured as artifact and decision record linked to task' : 'Insight captured and attached to task',
    };
  }

  async searchArtifacts(params: { query: string; type?: ArtifactType; projectId?: string; limit?: number }): Promise<any> {
    if (!params.query || params.query.trim().length === 0) {
      return { success: false, results: [], total: 0, query: params.query, message: 'Search query is required', error: 'Empty search query' };
    }

    const projectId = await resolveProjectId(this.ctx.storage, params.projectId) || undefined;
    const limit = Math.min(params.limit || 10, 50);

    const searchResults = await this.ctx.storage.searchArtifacts({ query: params.query, projectId, type: params.type, limit });

    const enrichedResults = await Promise.all(
      searchResults.map(async (result) => {
        const task = await this.ctx.storage.getTask(result.artifact.taskId);
        return {
          artifactId: result.artifact.id, title: result.artifact.title, type: result.artifact.type,
          taskId: result.artifact.taskId, taskTitle: task?.title, snippet: result.snippet,
          relevance: Math.abs(result.rank), createdAt: result.artifact.createdAt,
        };
      })
    );

    return {
      success: true, results: enrichedResults, total: enrichedResults.length, query: params.query,
      message: enrichedResults.length > 0 ? `Found ${enrichedResults.length} artifact(s) matching "${params.query}"` : `No artifacts found matching "${params.query}"`,
    };
  }

  async getArtifact(artifactId: string, includeContent: boolean = true): Promise<any> {
    const artifact = await this.ctx.storage.getArtifact(artifactId);
    if (!artifact) return { success: false, error: `Artifact not found: ${artifactId}` };

    const response: any = {
      id: artifact.id, taskId: artifact.taskId, projectId: artifact.projectId,
      type: artifact.type, uri: artifact.uri, title: artifact.title,
      description: artifact.description, contentType: artifact.contentType,
      contentSize: artifact.contentSize, parentArtifactId: artifact.parentArtifactId,
      evolutionHistory: artifact.evolutionHistory, createdAt: artifact.createdAt,
      createdBy: artifact.createdBy,
    };

    if (includeContent && artifact.content) response.content = artifact.content;
    else if (artifact.content) {
      response.hasContent = true;
      response.contentPreview = artifact.content.substring(0, 200) + (artifact.content.length > 200 ? '...' : '');
    }

    return { success: true, artifact: response };
  }
}
