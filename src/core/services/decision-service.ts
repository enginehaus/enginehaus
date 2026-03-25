/**
 * DecisionService — extracted from CoordinationService
 *
 * Decision logging, querying, similarity checking, and file-relevant decisions.
 */

import type {
  TaskStatus,
  TaskPriority,
  DecisionScope,
  DecisionLayer,
} from '../../coordination/types.js';
import type { ServiceContext } from './service-context.js';
import { audit, resolveProjectId } from './service-context.js';
import * as path from 'path';

export class DecisionService {
  constructor(private ctx: ServiceContext) {}

  /**
   * Extract keywords from text for similarity comparison
   */
  private extractKeywordsForSimilarity(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'this', 'that', 'these',
      'those', 'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you',
      'your', 'i', 'me', 'my', 'he', 'she', 'him', 'her', 'his', 'hers', 'use',
      'using', 'used', 'implement', 'implemented', 'add', 'added', 'create',
    ]);

    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  /**
   * Calculate keyword overlap similarity between two texts (Jaccard index)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const keywords1 = new Set(this.extractKeywordsForSimilarity(text1));
    const keywords2 = new Set(this.extractKeywordsForSimilarity(text2));

    if (keywords1.size === 0 || keywords2.size === 0) return 0;

    const intersection = new Set([...keywords1].filter(k => keywords2.has(k)));
    const union = new Set([...keywords1, ...keywords2]);

    return intersection.size / union.size;
  }

  /**
   * Layer-to-path mapping for decision scope matching.
   */
  private static readonly LAYER_PATHS: Record<DecisionLayer, string[]> = {
    interface: ['src/bin/', 'src/index.ts', 'src/adapters/'],
    handler: ['src/adapters/mcp/handlers/'],
    mcp: ['src/adapters/mcp/', 'src/index.ts'],
    cli: ['src/bin/'],
    rest: ['src/adapters/rest/'],
    service: ['src/core/services/'],
    storage: ['src/storage/'],
  };

  /**
   * Check if a file path matches a glob-style pattern.
   */
  private static matchesPattern(filePath: string, pattern: string): boolean {
    const normalized = filePath.replace(/^\.\//, '');
    const normalizedPattern = pattern.replace(/^\.\//, '');

    if (normalizedPattern.endsWith('/**') || normalizedPattern.endsWith('/*')) {
      const prefix = normalizedPattern.replace(/\/\*+$/, '/');
      return normalized.startsWith(prefix);
    }

    return normalized === normalizedPattern;
  }

  /**
   * Determine if a scoped decision applies to a set of task files.
   */
  private decisionAppliesToFiles(
    scope: DecisionScope,
    taskFiles: string[]
  ): boolean {
    if (scope.files?.some(f =>
      taskFiles.some(tf => tf.includes(f) || f.includes(tf))
    )) return true;

    if (scope.patterns?.some(pattern =>
      taskFiles.some(file => DecisionService.matchesPattern(file, pattern))
    )) return true;

    if (scope.layers?.some(layer => {
      const layerPrefixes = DecisionService.LAYER_PATHS[layer] || [];
      return layerPrefixes.some(prefix =>
        taskFiles.some(file => DecisionService.matchesPattern(file, prefix.endsWith('/') ? prefix + '**' : prefix))
      );
    })) return true;

    return false;
  }

  /**
   * Log a decision with similarity checking
   */
  async logDecision(params: {
    decision: string;
    rationale?: string;
    impact?: string;
    category?: string;
    taskId?: string;
    projectId?: string;
    createdBy?: string;
    scope?: DecisionScope;
    references?: Array<{ url: string; label?: string; type?: string }>;
  }): Promise<{
    success: boolean;
    decisionId: string;
    message: string;
    similarity?: {
      hasSimilar: boolean;
      highestScore: number;
      similarDecisions: Array<{
        id: string;
        decision: string;
        score: number;
        taskId?: string;
      }>;
    };
  }> {
    const resolvedProjectId = await resolveProjectId(this.ctx.storage, params.projectId) || undefined;

    // Check for similar existing decisions (AX metric: decision duplication rate)
    const decisionText = `${params.decision} ${params.rationale || ''}`;
    const similarDecisions: Array<{ id: string; decision: string; score: number; taskId?: string }> = [];
    let highestScore = 0;

    // Get prior decisions from same task and related tasks
    const priorDecisions = await this.ctx.storage.getDecisions({
      projectId: resolvedProjectId,
      limit: 50,
    });

    // Also get decisions from related tasks if we have a taskId
    let relatedTaskDecisions: typeof priorDecisions = [];
    if (params.taskId) {
      const relationships = await this.ctx.storage.getTaskRelationships(params.taskId, { direction: 'both' });
      for (const rel of relationships.slice(0, 5)) {
        const relatedTaskId = rel.sourceTaskId === params.taskId ? rel.targetTaskId : rel.sourceTaskId;
        const decisions = await this.ctx.storage.getDecisions({ taskId: relatedTaskId, limit: 10 });
        relatedTaskDecisions = relatedTaskDecisions.concat(decisions);
      }
    }

    const allPriorDecisions = [...priorDecisions, ...relatedTaskDecisions];

    for (const prior of allPriorDecisions) {
      const priorText = `${prior.decision} ${prior.rationale || ''}`;
      const score = this.calculateSimilarity(decisionText, priorText);

      if (score > highestScore) {
        highestScore = score;
      }

      if (score > 0.5) {
        similarDecisions.push({
          id: prior.id,
          decision: prior.decision,
          score: Math.round(score * 100) / 100,
          taskId: prior.taskId,
        });
      }
    }

    similarDecisions.sort((a, b) => b.score - a.score);

    // Log the decision
    const decisionId = await this.ctx.storage.logDecision({
      decision: params.decision,
      rationale: params.rationale,
      impact: params.impact,
      category: params.category,
      taskId: params.taskId,
      projectId: resolvedProjectId,
      createdBy: params.createdBy,
      scope: params.scope,
      references: params.references,
    });

    // Audit event
    await audit(this.ctx.storage, 'decision.logged', resolvedProjectId || 'unknown', 'decision', decisionId, `Decision logged: ${params.decision}`, { actorId: params.createdBy || 'unknown', actorType: params.createdBy ? 'agent' : 'system', metadata: { category: params.category, taskId: params.taskId, hasSimilar: similarDecisions.length > 0 } });

    // Log similarity metric
    if (similarDecisions.length > 0) {
      await audit(this.ctx.storage, 'quality.check_run', resolvedProjectId || 'unknown', 'quality', decisionId, `Decision similarity check: ${Math.round(highestScore * 100)}% max similarity`, { actorId: 'system', actorType: 'system', metadata: { checkType: 'decision_similarity', decisionId, highestScore: Math.round(highestScore * 100), similarCount: similarDecisions.length, taskId: params.taskId, potentialDuplicate: highestScore > 0.7 } });
    }

    // Emit event
    if (this.ctx.events) {
      await this.ctx.events.emitDecisionLogged(
        decisionId,
        params.decision,
        params.rationale || '',
        { taskId: params.taskId, category: params.category, projectId: resolvedProjectId },
      );
    }

    let message = `Decision logged: ${params.decision}`;
    if (similarDecisions.length > 0 && highestScore > 0.5) {
      message += ` (Note: ${Math.round(highestScore * 100)}% similar to existing decision)`;
    }

    return {
      success: true,
      decisionId,
      message,
      similarity: {
        hasSimilar: similarDecisions.length > 0,
        highestScore: Math.round(highestScore * 100) / 100,
        similarDecisions: similarDecisions.slice(0, 3),
      },
    };
  }

  /**
   * Get decisions
   */
  async getDecisions(params: {
    taskId?: string;
    category?: string;
    period?: 'day' | 'week' | 'month' | 'all';
    limit?: number;
    projectId?: string;
  } = {}): Promise<{
    decisions: Array<{
      id: string;
      decision: string;
      rationale?: string;
      impact?: string;
      category?: string;
      taskId?: string;
      createdAt: Date;
    }>;
    count: number;
  }> {
    let since: Date | undefined;
    if (params.period && params.period !== 'all') {
      since = new Date();
      switch (params.period) {
        case 'day':
          since.setDate(since.getDate() - 1);
          break;
        case 'week':
          since.setDate(since.getDate() - 7);
          break;
        case 'month':
          since.setMonth(since.getMonth() - 1);
          break;
      }
    }

    const resolvedProjectId = await resolveProjectId(this.ctx.storage, params.projectId) || undefined;
    const decisions = await this.ctx.storage.getDecisions({
      projectId: resolvedProjectId,
      taskId: params.taskId,
      category: params.category,
      since,
      limit: params.limit,
    });

    return {
      decisions,
      count: decisions.length,
    };
  }

  /**
   * Get decisions relevant to a set of files.
   */
  async getFileRelevantDecisions(taskId: string, taskFiles: string[]): Promise<{
    relevantDecisions: Array<{
      id: string;
      decision: string;
      rationale?: string;
      category?: string;
      createdAt: Date;
    }>;
    initiative?: {
      id: string;
      title: string;
      successCriteria?: string;
    };
  }> {
    const projectId = await this.ctx.storage.getActiveProjectId() || undefined;

    const allDecisions = await this.ctx.storage.getDecisions({
      projectId,
      limit: 50,
    });

    const architecturalDecisions = allDecisions.filter(d =>
      ['architecture', 'pattern', 'tradeoff'].includes(d.category)
    );

    const matched = architecturalDecisions.filter(d => {
      if (d.scope) {
        return this.decisionAppliesToFiles(d.scope as DecisionScope, taskFiles);
      }

      const text = `${d.decision} ${d.rationale || ''} ${d.impact || ''}`.toLowerCase();
      return taskFiles.some(f =>
        text.includes(f.toLowerCase()) ||
        text.includes(path.basename(f).toLowerCase())
      );
    });

    let initiative: { id: string; title: string; successCriteria?: string } | undefined;
    const taskInitiatives = await this.ctx.storage.getTaskInitiatives(taskId);
    if (taskInitiatives.length > 0) {
      const init = await this.ctx.storage.getInitiative(taskInitiatives[0].id);
      if (init) {
        initiative = {
          id: init.id,
          title: init.title,
          successCriteria: init.successCriteria,
        };
      }
    }

    return {
      relevantDecisions: matched.slice(0, 5).map(d => ({
        id: d.id,
        decision: d.decision,
        rationale: d.rationale,
        category: d.category,
        createdAt: d.createdAt,
      })),
      initiative,
    };
  }

  /**
   * Find decisions related to a task by keyword/tag similarity.
   * Surfaces unattached strategic decisions that aren't directly linked
   * but are topically relevant — matched at query time, no scripts needed.
   */
  async getRelatedDecisionsForTask(taskId: string): Promise<Array<{
    id: string;
    decision: string;
    rationale?: string;
    category?: string;
    createdAt: Date;
    relevanceScore: number;
    matchReason: string;
  }>> {
    const task = await this.ctx.storage.getTask(taskId);
    if (!task) return [];

    const projectId = task.projectId || await this.ctx.storage.getActiveProjectId() || undefined;

    // Get all project decisions (unattached or linked to other tasks)
    const allDecisions = await this.ctx.storage.getDecisions({
      projectId,
      limit: 100,
    });

    // Filter to decisions NOT already linked to this task
    const candidateDecisions = allDecisions.filter(d => d.taskId !== taskId);
    if (candidateDecisions.length === 0) return [];

    // Build task text for similarity matching
    const taskText = [
      task.title,
      task.description || '',
      ...(task.tags || []),
      task.strategicContext || '',
      task.technicalContext?.qualityGates?.join(' ') || '',
    ].join(' ');

    const results: Array<{
      id: string;
      decision: string;
      rationale?: string;
      category?: string;
      createdAt: Date;
      relevanceScore: number;
      matchReason: string;
    }> = [];

    // Match by tag overlap
    const taskTags = new Set((task.tags || []).map(t => t.toLowerCase()));

    for (const d of candidateDecisions) {
      let score = 0;
      const reasons: string[] = [];

      // Tag overlap (decisions may have tags in their text or category)
      if (taskTags.size > 0) {
        const decisionText = `${d.decision} ${d.rationale || ''} ${d.category || ''}`.toLowerCase();
        const tagMatches = [...taskTags].filter(tag => decisionText.includes(tag));
        if (tagMatches.length > 0) {
          score += 0.3 * (tagMatches.length / taskTags.size);
          reasons.push(`tag overlap: ${tagMatches.join(', ')}`);
        }
      }

      // Keyword similarity (Jaccard)
      const decisionFullText = `${d.decision} ${d.rationale || ''}`;
      const keywordScore = this.calculateSimilarity(taskText, decisionFullText);
      if (keywordScore > 0.15) {
        score += keywordScore;
        reasons.push(`keyword similarity: ${Math.round(keywordScore * 100)}%`);
      }

      if (score >= 0.2) {
        results.push({
          id: d.id,
          decision: d.decision,
          rationale: d.rationale,
          category: d.category,
          createdAt: d.createdAt,
          relevanceScore: Math.round(score * 100) / 100,
          matchReason: reasons.join('; '),
        });
      }
    }

    // Sort by relevance, return top matches
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 8);
  }

  /**
   * Capture a thought — single-string, lowest-friction decision entry point.
   * Stores as a draft decision with category 'thought'.
   */
  async captureThought(params: {
    thought: string;
    taskId?: string;
    createdBy?: string;
    projectId?: string;
  }): Promise<{
    success: boolean;
    thoughtId: string;
    message: string;
  }> {
    const resolvedProjectId = await resolveProjectId(this.ctx.storage, params.projectId) || undefined;

    const thoughtId = await this.ctx.storage.logDecision({
      decision: params.thought,
      category: 'thought',
      disposition: 'draft',
      taskId: params.taskId,
      projectId: resolvedProjectId,
      createdBy: params.createdBy,
    });

    // Audit event
    await audit(this.ctx.storage, 'decision.logged', resolvedProjectId || 'unknown', 'decision', thoughtId, `Thought captured: ${params.thought}`, { actorId: params.createdBy || 'unknown', actorType: params.createdBy ? 'agent' : 'system', metadata: { category: 'thought', disposition: 'draft', taskId: params.taskId } });

    // Emit event
    if (this.ctx.events) {
      await this.ctx.events.emitDecisionLogged(
        thoughtId,
        params.thought,
        '',
        { taskId: params.taskId, category: 'thought', projectId: resolvedProjectId },
      );
    }

    return {
      success: true,
      thoughtId,
      message: `Thought captured: "${params.thought.slice(0, 60)}${params.thought.length > 60 ? '...' : ''}" — review with review_thoughts`,
    };
  }

  /**
   * List pending draft thoughts for the active project
   */
  async reviewThoughts(params: {
    taskId?: string;
    projectId?: string;
    limit?: number;
  } = {}): Promise<{
    thoughts: Array<{
      id: string;
      thought: string;
      taskId?: string;
      createdAt: Date;
      createdBy?: string;
    }>;
    count: number;
  }> {
    const resolvedProjectId = await resolveProjectId(this.ctx.storage, params.projectId) || undefined;

    const thoughts = await this.ctx.storage.getThoughts({
      projectId: resolvedProjectId,
      taskId: params.taskId,
      limit: params.limit,
    });

    return {
      thoughts: thoughts.map(t => ({
        id: t.id,
        thought: t.decision,
        taskId: t.taskId,
        createdAt: t.createdAt,
        createdBy: t.createdBy,
      })),
      count: thoughts.length,
    };
  }

  /**
   * Promote a draft thought to an approved decision, optionally reclassifying
   */
  async promoteThought(decisionId: string, category?: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const updated = await this.ctx.storage.updateDisposition(decisionId, 'approved', category);
    if (!updated) {
      return { success: false, message: `Decision ${decisionId} not found` };
    }

    await audit(this.ctx.storage, 'decision.logged', 'unknown', 'decision', decisionId, `Thought promoted to approved${category ? ` (reclassified as ${category})` : ''}`, { actorId: 'system', actorType: 'system', metadata: { action: 'promote', newCategory: category } });

    return {
      success: true,
      message: `Thought promoted to approved decision${category ? ` (category: ${category})` : ''}`,
    };
  }

  /**
   * Discard a draft thought
   */
  async discardThought(decisionId: string): Promise<{ success: boolean; message: string }> {
    const updated = await this.ctx.storage.updateDisposition(decisionId, 'declined');
    if (!updated) {
      return { success: false, message: `Decision ${decisionId} not found` };
    }
    return { success: true, message: 'Thought discarded' };
  }

  /**
   * Defer a draft thought for later review
   */
  async deferThought(decisionId: string): Promise<{ success: boolean; message: string }> {
    const updated = await this.ctx.storage.updateDisposition(decisionId, 'deferred');
    if (!updated) {
      return { success: false, message: `Decision ${decisionId} not found` };
    }
    return { success: true, message: 'Thought deferred for later review' };
  }

  /**
   * Get a single decision by ID
   */
  async getDecision(decisionId: string): Promise<{
    success: boolean;
    decision?: {
      id: string;
      decision: string;
      rationale?: string;
      impact?: string;
      category?: string;
      taskId?: string;
      createdAt: Date;
    };
    linkedTask?: {
      id: string;
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
    };
    error?: string;
  }> {
    const decision = await this.ctx.storage.getDecision(decisionId);
    if (!decision) {
      return {
        success: false,
        error: 'Decision not found',
      };
    }

    let linkedTask: { id: string; title: string; status: TaskStatus; priority: TaskPriority } | undefined;
    if (decision.taskId) {
      const task = await this.ctx.storage.getTask(decision.taskId);
      if (task) {
        linkedTask = {
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
        };
      }
    }

    return {
      success: true,
      decision,
      linkedTask,
    };
  }
}
