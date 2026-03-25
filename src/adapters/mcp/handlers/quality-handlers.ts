/**
 * Quality Tool Handlers
 *
 * Handlers for quality expectations MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';

export interface GetQualityExpectationsParams {
  taskId: string;
}

export interface CheckQualityComplianceParams {
  taskId: string;
  completedItems: string[];
}

export async function handleGetQualityExpectations(
  service: CoordinationService,
  args: GetQualityExpectationsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.getQualityExpectations(args.taskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleCheckQualityCompliance(
  service: CoordinationService,
  args: CheckQualityComplianceParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.checkQualityCompliance(args.taskId, args.completedItems);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
