/**
 * Coordination Tool Handlers
 *
 * Handlers for coordination context and task graph MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { CoordinationEngine } from '../../../coordination/engine.js';
import type { GraphView } from '../../../visualization/task-graph.js';
import { checkInstructionsHealth, type InstructionsHealth } from '../../../instructions-version.js';

/**
 * Context required by coordination handlers
 */
export interface CoordinationHandlerContext {
  service: CoordinationService;
  coordination: CoordinationEngine;
}

// Parameter interfaces
export interface GetCoordinationContextParams {
  role: 'product-manager' | 'ux-director' | 'technical-lead' | 'claude-code';
}

export interface GetTaskGraphParams {
  view?: GraphView;
  projectId?: string;
  maxDepth?: number;
}

export interface GetBriefingParams {
  projectId?: string;
  focus?: string;
  agentId?: string;
  instructionsVersion?: string;
}

export interface GetClusterContextParams {
  taskId: string;
}

export async function handleGetCoordinationContext(
  ctx: CoordinationHandlerContext,
  args: GetCoordinationContextParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const context = await ctx.coordination.getCoordinationContext(args.role);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        context: {
          role: context.role,
          currentTask: context.currentTask,
          recentDecisions: context.recentDecisions.length,
          recentUXRequirements: context.recentUXRequirements.length,
          recentTechnicalPlans: context.recentTechnicalPlans.length,
          activeTasks: context.activeTasks.length,
          readyTasks: context.readyTasks.length,
        },
      }, null, 2),
    }],
  };
}

export async function handleGetTaskGraph(
  ctx: CoordinationHandlerContext,
  args: GetTaskGraphParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getTaskGraph(args);
  return {
    content: [{
      type: 'text',
      text: result.graph,
    }],
  };
}

export async function handleGetBriefing(
  ctx: CoordinationHandlerContext,
  args: GetBriefingParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await ctx.service.getBriefing(args);

  // Check instructions health if version provided
  const instructionsHealth = checkInstructionsHealth(args.instructionsVersion);

  // Build response with optional health info
  let responseText = result.briefing;

  // Append instructions health info if outdated or unknown
  if (instructionsHealth.status !== 'current' && instructionsHealth.message) {
    responseText += `\n\n---\n📋 **Instructions Health**: ${instructionsHealth.message}`;
  }

  return {
    content: [{
      type: 'text',
      text: responseText,
    }],
    // Include structured health data for programmatic access
    ...(args.instructionsVersion !== undefined && {
      _instructionsHealth: instructionsHealth,
    }),
  } as { content: Array<{ type: string; text: string }>; _instructionsHealth?: InstructionsHealth };
}

export interface WhatChangedParams {
  since?: string;
}

function parseSince(input?: string): Date {
  if (!input) return new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24h

  // Duration format: "2h", "1d", "30m"
  const durationMatch = input.match(/^(\d+)(m|h|d)$/);
  if (durationMatch) {
    const amount = parseInt(durationMatch[1]);
    const unit = durationMatch[2];
    const ms = unit === 'm' ? amount * 60000 : unit === 'h' ? amount * 3600000 : amount * 86400000;
    return new Date(Date.now() - ms);
  }

  // ISO datetime
  const date = new Date(input);
  if (!isNaN(date.getTime())) return date;

  return new Date(Date.now() - 24 * 60 * 60 * 1000); // Fallback
}

export async function handleWhatChanged(
  ctx: CoordinationHandlerContext,
  args: WhatChangedParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const since = parseSince(args.since);
  const result = await ctx.service.getChangeSummary(since);

  const parts: string[] = [];
  parts.push(`Changes since ${since.toISOString()}:\n`);

  if (result.completedTasks.length > 0) {
    parts.push(`**${result.completedTasks.length} task(s) completed:**`);
    for (const t of result.completedTasks.slice(0, 10)) {
      parts.push(`  - "${t.title}"${t.summary ? `: ${t.summary.slice(0, 80)}` : ''}`);
    }
    parts.push('');
  }

  if (result.newTasks.length > 0) {
    parts.push(`**${result.newTasks.length} new task(s) created:**`);
    for (const t of result.newTasks.slice(0, 10)) {
      parts.push(`  - [${t.priority}] "${t.title}"`);
    }
    parts.push('');
  }

  if (result.decisions.length > 0) {
    parts.push(`**${result.decisions.length} decision(s) logged:**`);
    for (const d of result.decisions.slice(0, 10)) {
      parts.push(`  - ${d.decision.slice(0, 80)}${d.decision.length > 80 ? '...' : ''}`);
    }
    parts.push('');
  }

  if (result.completedTasks.length === 0 && result.newTasks.length === 0 && result.decisions.length === 0) {
    parts.push('No changes detected in this period.');
  }

  return {
    content: [{
      type: 'text',
      text: parts.join('\n'),
    }],
  };
}

export async function handleGetClusterContext(
  ctx: CoordinationHandlerContext,
  args: GetClusterContextParams
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await ctx.service.getClusterContext(args.taskId);
  if (!result.success) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: result.error }),
      }],
      isError: true,
    };
  }
  return {
    content: [{
      type: 'text',
      text: result.context || '',
    }],
  };
}
