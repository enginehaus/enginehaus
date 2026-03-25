/**
 * Session Tools
 *
 * Task claiming, releasing, handoff, and session management.
 */

import { registry, type ToolContext, type ToolResult } from '../tool-registry.js';
import {
  claimTaskSchema,
  releaseTaskSchema,
  sessionHeartbeatSchema,
  getTaskSessionStatusSchema,
  getHandoffContextSchema,
  generateContinuationPromptSchema,
  compressSessionStateSchema,
  getHandoffStatusSchema,
  quickHandoffSchema,
} from '../schemas/session-schemas.js';
import {
  handleClaimTask,
  handleReleaseTask,
  handleSessionHeartbeat,
  handleGetTaskSessionStatus,
  handleGetHandoffContext,
  handleGenerateContinuationPrompt,
  handleCompressSessionState,
  handleGetHandoffStatus,
  handleQuickHandoff,
} from '../handlers/session-handlers.js';

function sessionCtx(ctx: ToolContext) {
  return {
    service: ctx.service,
    coordination: ctx.coordination,
    resolvedAgentId: ctx.resolvedAgentId,
  };
}

registry.register({
  ...claimTaskSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleClaimTask(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...releaseTaskSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleReleaseTask(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...sessionHeartbeatSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleSessionHeartbeat(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...getTaskSessionStatusSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetTaskSessionStatus(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...getHandoffContextSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetHandoffContext(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...generateContinuationPromptSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGenerateContinuationPrompt(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...compressSessionStateSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleCompressSessionState(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...getHandoffStatusSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleGetHandoffStatus(sessionCtx(ctx), args as any);
  },
});

registry.register({
  ...quickHandoffSchema,
  domain: 'session',
  handler: async (ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> => {
    return handleQuickHandoff(sessionCtx(ctx), args as any);
  },
});
