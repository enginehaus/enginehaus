/**
 * Validation Tool Handlers
 *
 * Handlers for quality validation MCP tools.
 */

import { QualityService } from '../../../quality/quality-service.js';
import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { CoordinationEngine } from '../../../coordination/engine.js';
import { expandPath } from '../../../utils/paths.js';

/**
 * Context required by validation handlers
 */
export interface ValidationHandlerContext {
  service: CoordinationService;
  coordination: CoordinationEngine;
  projectRoot: string;
}

// Parameter interfaces
export interface ValidateQualityGatesParams {
  taskId?: string;
  files?: string[];
  requirements?: string[];
}

export interface ValidateForCiParams {
  outputFormat: 'github-annotations' | 'junit-xml' | 'json';
  failOnCritical?: boolean;
  taskId?: string;
}

export async function handleValidateQualityGates(
  ctx: ValidationHandlerContext,
  args: ValidateQualityGatesParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Get project rootPath for correct working directory via CoordinationService
  const rootPath = await ctx.service.getActiveProjectRoot();
  const projectRoot = rootPath ? expandPath(rootPath) : ctx.projectRoot;

  // Create QualityService with correct root
  const qualityService = new QualityService(projectRoot);

  const result = await qualityService.validateQualityGates(
    args.requirements || [],
    args.files || []
  );

  // Log quality gate result as metric for tracking
  const activeProject = await ctx.service.getActiveProject();
  const projectId = activeProject?.id || 'unknown';

  // Extract gate results for metadata
  const gateResults: Record<string, boolean> = {};
  for (const r of result.results) {
    gateResults[r.gate] = r.passed;
  }

  await ctx.service.logMetric({
    eventType: result.passed ? 'quality_gate_passed' : 'quality_gate_failed',
    taskId: args.taskId,
    metadata: {
      projectId,
      gatesChecked: result.results.length,
      gatesPassed: result.results.filter((r: { passed: boolean }) => r.passed).length,
      ...gateResults,
    },
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          projectRoot,
          ...result,
        }, null, 2),
      },
    ],
  };
}

export async function handleValidateForCi(
  ctx: ValidationHandlerContext,
  args: ValidateForCiParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Get project rootPath for correct working directory via CoordinationService
  const rootPath = await ctx.service.getActiveProjectRoot();
  const projectRoot = rootPath ? expandPath(rootPath) : ctx.projectRoot;

  const qualityService = new QualityService(projectRoot);

  const result = await qualityService.validateForCI({
    outputFormat: args.outputFormat,
    failOnCritical: args.failOnCritical !== false, // Default to true
    taskId: args.taskId,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          projectRoot,
          ...result,
        }, null, 2),
      },
    ],
  };
}
