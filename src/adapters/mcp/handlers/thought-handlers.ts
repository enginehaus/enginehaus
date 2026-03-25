/**
 * Thought Tool Handlers
 *
 * Handlers for low-friction thought capture MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import { sanitizeString } from '../../../validation/validators.js';

export interface CaptureThoughtParams {
  thought: string;
  taskId?: string;
}

export interface ReviewThoughtsParams {
  action?: 'list' | 'promote' | 'discard' | 'defer';
  decisionId?: string;
  category?: string;
}

export interface ThoughtHandlerContext {
  service: CoordinationService;
  resolvedAgentId: string;
}

export async function handleCaptureThought(
  serviceOrCtx: CoordinationService | ThoughtHandlerContext,
  args: CaptureThoughtParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const service = 'service' in serviceOrCtx ? serviceOrCtx.service : serviceOrCtx;
  const agentId = 'resolvedAgentId' in serviceOrCtx ? serviceOrCtx.resolvedAgentId : undefined;

  const thought = sanitizeString(args.thought);
  if (!thought) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'thought is required' }, null, 2) }],
      isError: true,
    };
  }

  const result = await service.captureThought({
    thought,
    taskId: args.taskId,
    createdBy: agentId,
  });

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

export async function handleReviewThoughts(
  service: CoordinationService,
  args: ReviewThoughtsParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const action = args.action || 'list';

  if (action === 'list') {
    const result = await service.reviewThoughts();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...result,
          hint: result.count > 0
            ? 'Use review_thoughts with action: "promote", "discard", or "defer" and the decisionId to act on a thought'
            : 'No pending thoughts. Use capture_thought to capture observations as you work.',
        }, null, 2),
      }],
    };
  }

  if (!args.decisionId) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: `decisionId is required for action "${action}"` }, null, 2) }],
      isError: true,
    };
  }

  let result: { success: boolean; message: string };

  switch (action) {
    case 'promote':
      result = await service.promoteThought(args.decisionId, args.category);
      break;
    case 'discard':
      result = await service.discardThought(args.decisionId);
      break;
    case 'defer':
      result = await service.deferThought(args.decisionId);
      break;
    default:
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unknown action: ${action}` }, null, 2) }],
        isError: true,
      };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}
