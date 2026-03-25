/**
 * Product Role Tool Handlers
 *
 * Handlers for product manager, UX director, and technical lead MCP tools.
 */

import type { CoordinationEngine } from '../../../coordination/engine.js';

/**
 * Context required by product role handlers
 */
export interface ProductRoleHandlerContext {
  coordination: CoordinationEngine;
}

// Parameter interfaces
export interface RecordStrategicDecisionParams {
  decision: string;
  rationale: string;
  impact: string;
  timeline: string;
  stakeholders?: string[];
  requirements?: {
    technical?: string;
    ux?: string;
    quality?: string;
  };
}

export interface RecordUxRequirementsParams {
  feature: string;
  userExperience: string;
  designPattern: string;
  progressiveDisclosure?: string;
  technicalConstraints?: string;
  responseTo?: string;
}

export interface RecordTechnicalPlanParams {
  feature: string;
  strategicContext: string;
  technicalApproach: string;
  uxContext?: string;
  architecture?: string;
  estimatedEffort?: string;
  files?: string[];
  qualityGates?: string[];
  unifiedTasks?: Array<{
    title: string;
    description?: string;
    priority?: string;
    requirements?: string;
    files?: string[];
  }>;
}

export async function handleRecordStrategicDecision(
  ctx: ProductRoleHandlerContext,
  args: RecordStrategicDecisionParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const decision = await ctx.coordination.recordStrategicDecision({
    ...args,
    stakeholders: args.stakeholders || [],
  });
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          decisionId: decision.id,
          decision: decision.decision,
          message: 'Strategic decision recorded successfully',
        }, null, 2),
      },
    ],
  };
}

export async function handleRecordUxRequirements(
  ctx: ProductRoleHandlerContext,
  args: RecordUxRequirementsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const requirements = await ctx.coordination.recordUXRequirements(args);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          requirementsId: requirements.id,
          feature: requirements.feature,
          message: 'UX requirements recorded successfully',
        }, null, 2),
      },
    ],
  };
}

export async function handleRecordTechnicalPlan(
  ctx: ProductRoleHandlerContext,
  args: RecordTechnicalPlanParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Handler params are intentionally looser than engine type (engine provides defaults)
  const plan = await ctx.coordination.recordTechnicalPlan(args as any);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          planId: plan.id,
          feature: plan.feature,
          tasksCreated: plan.unifiedTasks?.length || 0,
          message: 'Technical plan recorded and tasks created successfully',
        }, null, 2),
      },
    ],
  };
}
