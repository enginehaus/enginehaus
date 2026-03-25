/**
 * File-Lock Tool Handlers
 *
 * Handlers for file-lock conflict detection MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';

export interface CheckFileConflictsParams {
  taskId: string;
}

export async function handleGetLockedFiles(
  service: CoordinationService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.getLockedFiles();
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleCheckFileConflicts(
  service: CoordinationService,
  args: CheckFileConflictsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Delegate to CoordinationService for consistent business logic
  const result = await service.checkFileConflicts(args.taskId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
