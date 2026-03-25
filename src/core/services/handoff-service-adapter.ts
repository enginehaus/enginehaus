/**
 * HandoffServiceAdapter — extracted from CoordinationService
 *
 * Wraps the existing HandoffService with consistent error handling
 * and provides the CoordinationService delegation surface.
 */

import type { ServiceContext } from './service-context.js';
import {
  HandoffService,
  HandoffContext,
  ContinuationPrompt,
  CompressedSessionState,
} from '../../coordination/handoff-service.js';

export class HandoffServiceAdapter {
  constructor(private ctx: ServiceContext) {}

  async getHandoffContext(params: {
    taskId: string; fromAgent: string; toAgent: string; sessionId?: string;
  }): Promise<{ success: boolean; context?: HandoffContext; error?: string }> {
    try {
      const svc = new HandoffService(this.ctx.storage);
      const context = await svc.getHandoffContext(params);
      return { success: true, context };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async generateContinuationPrompt(params: {
    taskId: string; targetAgent: string; fromAgent?: string; includeFiles?: boolean;
  }): Promise<{ success: boolean; prompt?: string; metadata?: ContinuationPrompt['metadata']; error?: string }> {
    try {
      const svc = new HandoffService(this.ctx.storage);
      const result = await svc.generateContinuationPrompt(params);
      return { success: true, prompt: result.prompt, metadata: result.metadata };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async compressSessionState(sessionId: string): Promise<{ success: boolean; compressed?: CompressedSessionState; error?: string }> {
    try {
      const svc = new HandoffService(this.ctx.storage);
      const compressed = await svc.compressSessionState(sessionId);
      return { success: true, compressed };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getHandoffStatus(params: { taskId?: string; sessionId?: string; projectId?: string } = {}): Promise<any> {
    try {
      const svc = new HandoffService(this.ctx.storage);
      const status = await svc.getHandoffStatus(params);
      return { success: true, ...status };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async generateStartSessionPrompt(projectSlug: string): Promise<{ success: boolean; prompt?: string; error?: string }> {
    try {
      const svc = new HandoffService(this.ctx.storage);
      const prompt = await svc.generateStartSessionPrompt(projectSlug);
      return { success: true, prompt };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async generateReviewPrompt(taskId: string): Promise<{ success: boolean; prompt?: string; error?: string }> {
    try {
      const svc = new HandoffService(this.ctx.storage);
      const prompt = await svc.generateReviewPrompt(taskId);
      return { success: true, prompt };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
