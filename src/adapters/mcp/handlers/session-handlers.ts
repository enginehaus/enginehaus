/**
 * Session Tool Handlers
 *
 * Handlers for session management and handoff MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { CoordinationEngine } from '../../../coordination/engine.js';
import type { AbandonmentReason } from '../../../analytics/types.js';

/**
 * Context required by session handlers
 */
export interface SessionHandlerContext {
  service: CoordinationService;
  coordination: CoordinationEngine;
  resolvedAgentId: string;
}

// Parameter interfaces
export interface ClaimTaskParams {
  taskId: string;
  agentId?: string;
  force?: boolean;
  capacity?: number;
}

export interface ReleaseTaskParams {
  sessionId: string;
  completed?: boolean;
  reason?: 'test' | 'redirect' | 'blocked' | 'stuck' | 'scope_change' | 'user_requested' | 'context_limit' | 'other';
  notes?: string;
}

export interface SessionHeartbeatParams {
  sessionId: string;
}

export interface GetTaskSessionStatusParams {
  taskId: string;
}

export interface GetHandoffContextParams {
  taskId: string;
  fromAgent: string;
  toAgent: string;
  sessionId?: string;
}

export interface GenerateContinuationPromptParams {
  taskId: string;
  targetAgent: string;
  fromAgent?: string;
  includeFiles?: boolean;
}

export interface CompressSessionStateParams {
  sessionId: string;
}

export interface GetHandoffStatusParams {
  taskId?: string;
  sessionId?: string;
}

export interface QuickHandoffParams {
  note?: string;
  taskId?: string;
}

export async function handleClaimTask(
  ctx: SessionHandlerContext,
  args: ClaimTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const agentId = args.agentId || ctx.resolvedAgentId;
  const result = await ctx.service.claimTaskWithResponse(
    args.taskId,
    agentId,
    { force: args.force, capacity: args.capacity ?? 1 }
  );

  // Update agent last-seen timestamp (best-effort, don't block on failure)
  ctx.service.touchAgentLastSeen(agentId).catch(() => {});

  // Surface related decisions on successful claims
  let relatedDecisions: Array<{
    id: string;
    decision: string;
    rationale?: string;
    category?: string;
    relevanceScore: number;
    matchReason: string;
  }> | undefined;
  if (result.success) {
    try {
      const related = await ctx.service.getRelatedDecisionsForTask(args.taskId);
      if (related.length > 0) {
        relatedDecisions = related;
      }
    } catch {
      // Non-critical
    }
  }

  const response = relatedDecisions
    ? { ...result, relatedDecisions }
    : result;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2),
    }],
  };
}

export async function handleReleaseTask(
  ctx: SessionHandlerContext,
  args: ReleaseTaskParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.releaseTaskWithResponse(
    args.sessionId,
    args.completed || false,
    {
      reason: args.reason as AbandonmentReason | undefined,
      notes: args.notes,
      agentId: ctx.resolvedAgentId,
    }
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleSessionHeartbeat(
  ctx: SessionHandlerContext,
  args: SessionHeartbeatParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.coordination.sessionHeartbeat(args.sessionId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: result.success,
        expired: result.expired,
        message: result.success
          ? 'Heartbeat recorded'
          : 'Session not found or expired',
      }, null, 2),
    }],
  };
}

export async function handleGetTaskSessionStatus(
  ctx: SessionHandlerContext,
  args: GetTaskSessionStatusParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const status = await ctx.coordination.getTaskSessionStatus(args.taskId);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        hasActiveSession: status.hasActiveSession,
        activeSession: status.session ? {
          sessionId: status.session.id,
          agentId: status.session.agentId,
          startTime: status.session.startTime,
          lastHeartbeat: status.session.lastHeartbeat,
        } : null,
        sessionHistory: status.sessionHistory.map(s => ({
          sessionId: s.id,
          agentId: s.agentId,
          status: s.status,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      }, null, 2),
    }],
  };
}

export async function handleGetHandoffContext(
  ctx: SessionHandlerContext,
  args: GetHandoffContextParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getHandoffContext(args);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGenerateContinuationPrompt(
  ctx: SessionHandlerContext,
  args: GenerateContinuationPromptParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.generateContinuationPrompt(args);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleCompressSessionState(
  ctx: SessionHandlerContext,
  args: CompressSessionStateParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.compressSessionState(args.sessionId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetHandoffStatus(
  ctx: SessionHandlerContext,
  args: GetHandoffStatusParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getHandoffStatus(args);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

/**
 * Quick handoff - simplified handoff for Desktop→Code transitions.
 * Auto-detects task from active session, generates compact prompt.
 */
export async function handleQuickHandoff(
  ctx: SessionHandlerContext,
  args: QuickHandoffParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.generateQuickHandoff({
    taskId: args.taskId,
    note: args.note,
  });

  if (!result.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: result.error,
          ...(result.taskTitle && { taskTitle: result.taskTitle }),
          ...(result.taskStatus && { taskStatus: result.taskStatus }),
        }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        taskId: result.taskId,
        handoffPrompt: result.handoffPrompt,
        instructions: 'Copy the handoffPrompt above and paste it into a new Claude Code session.',
      }, null, 2),
    }],
  };
}
