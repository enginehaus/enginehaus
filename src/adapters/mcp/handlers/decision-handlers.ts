/**
 * Decision Tool Handlers
 *
 * Handlers for in-flight decision logging MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import { validateSchema, sanitizeString, SCHEMAS } from '../../../validation/validators.js';

export interface LogDecisionParams {
  decision: string;
  rationale?: string;
  impact?: string;
  category?: string;
  taskId?: string;
  tags?: string[];
  references?: Array<{ url: string; label?: string; type?: string }>;
  scope?: {
    layers?: ('interface' | 'service' | 'storage' | 'handler' | 'cli' | 'rest' | 'mcp')[];
    patterns?: string[];
    files?: string[];
    tags?: string[];
  };
}

export interface GetDecisionsParams {
  taskId?: string;
  category?: string;
  period?: 'day' | 'week' | 'month' | 'all';
  limit?: number;
}

export interface GetDecisionParams {
  decisionId: string;
}

export interface DecisionHandlerContext {
  service: CoordinationService;
  resolvedAgentId: string;
}

export async function handleLogDecision(
  serviceOrCtx: CoordinationService | DecisionHandlerContext,
  args: LogDecisionParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Support both old (service-only) and new (context) signatures
  const service = 'service' in serviceOrCtx ? serviceOrCtx.service : serviceOrCtx;
  const agentId = 'resolvedAgentId' in serviceOrCtx ? serviceOrCtx.resolvedAgentId : undefined;
  // Validate input
  const validation = validateSchema(args as unknown as Record<string, unknown>, SCHEMAS.logDecision);
  if (!validation.valid) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, errors: validation.errors }, null, 2) }],
      isError: true,
    };
  }

  // Sanitize inputs
  const decision = sanitizeString(args.decision) || '';
  const rationale = sanitizeString(args.rationale);
  const impact = sanitizeString(args.impact);

  // Merge top-level tags into scope for storage
  const scope = args.scope || (args.tags ? {} : undefined);
  if (args.tags && scope) {
    scope.tags = [...(scope.tags || []), ...args.tags];
  }

  // Delegate to CoordinationService for consistent business logic
  const result = await service.logDecision({
    decision,
    rationale,
    impact,
    category: args.category,
    taskId: args.taskId,
    createdBy: agentId,
    scope,
    references: args.references,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetDecisions(
  service: CoordinationService,
  args: GetDecisionsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.getDecisions({
    taskId: args.taskId,
    category: args.category,
    period: args.period,
    limit: args.limit,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetDecision(
  service: CoordinationService,
  args: GetDecisionParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.getDecision(args.decisionId);
  if (!result.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: result.error,
          decisionId: args.decisionId,
        }, null, 2),
      }],
      isError: true,
    };
  }
  // Return both decision and linked task for bidirectional linking
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...result.decision,
        linkedTask: result.linkedTask,
      }, null, 2),
    }],
  };
}

// ── Batch Operations ──────────────────────────────────────────────────

export interface BatchLogDecisionsParams {
  decisions: Array<{
    decision: string;
    rationale?: string;
    category?: string;
    taskId?: string;
  }>;
}

export async function handleBatchLogDecisions(
  service: CoordinationService,
  args: BatchLogDecisionsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const results: Array<{ decision: string; success: boolean; decisionId?: string; error?: string }> = [];

  for (const d of args.decisions) {
    try {
      const result = await service.logDecision({
        decision: sanitizeString(d.decision) || '',
        rationale: sanitizeString(d.rationale),
        category: d.category,
        taskId: d.taskId,
      });
      results.push({
        decision: d.decision.slice(0, 50),
        success: result.success,
        decisionId: result.decisionId,
      });
    } catch (err: any) {
      results.push({
        decision: d.decision.slice(0, 50),
        success: false,
        error: err.message,
      });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: failed === 0,
        summary: `${succeeded} logged, ${failed} failed`,
        results,
      }, null, 2),
    }],
  };
}
