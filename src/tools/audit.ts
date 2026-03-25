/**
 * Consolidated Audit Tool
 *
 * Combines 3 audit tools into 1 with a `mode` parameter:
 * - query_audit_log → mode: "query"
 * - get_audit_summary → mode: "summary"
 * - export_audit_log → mode: "export"
 *
 * All answer: "tell me about audit history"
 */

import { CoordinationService } from '../core/services/coordination-service.js';
import { AuditEventType } from '../audit/audit-service.js';

export type AuditMode = 'query' | 'summary' | 'export';

export interface AuditParams {
  mode: AuditMode;
  // Query/common filters
  eventTypes?: string[];
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  // Export-specific
  format?: 'json' | 'csv';
}

export const auditToolSchema = {
  name: 'audit',
  description: 'Query and analyze audit logs. Modes: "query" (search logs with filters), "summary" (aggregated statistics), "export" (download as JSON/CSV)',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['query', 'summary', 'export'],
        description: 'Audit operation mode',
      },
      eventTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by event types (e.g., task.created, session.started)',
      },
      actorId: {
        type: 'string',
        description: 'Filter by actor ID',
      },
      resourceType: {
        type: 'string',
        description: 'Filter by resource type (task, session, project)',
      },
      resourceId: {
        type: 'string',
        description: 'Filter by specific resource ID',
      },
      startTime: {
        type: 'string',
        description: 'Start time (ISO 8601 format)',
      },
      endTime: {
        type: 'string',
        description: 'End time (ISO 8601 format)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 100)',
      },
      format: {
        type: 'string',
        enum: ['json', 'csv'],
        description: 'Export format (export mode only)',
      },
    },
    required: ['mode'],
  },
};

export async function handleAudit(
  service: CoordinationService,
  args: AuditParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: any;

  switch (args.mode) {
    case 'query':
      result = await service.queryAuditLog({
        eventTypes: args.eventTypes as AuditEventType[],
        actorId: args.actorId,
        resourceType: args.resourceType as any,
        resourceId: args.resourceId,
        startTime: args.startTime ? new Date(args.startTime) : undefined,
        endTime: args.endTime ? new Date(args.endTime) : undefined,
        limit: args.limit || 100,
      });
      break;

    case 'summary':
      result = await service.getAuditSummary({
        startTime: args.startTime ? new Date(args.startTime) : undefined,
        endTime: args.endTime ? new Date(args.endTime) : undefined,
      });
      break;

    case 'export':
      if (!args.format) {
        throw new Error('Export mode requires format parameter (json or csv)');
      }
      result = await service.exportAuditLog({
        format: args.format,
        startTime: args.startTime ? new Date(args.startTime) : undefined,
        endTime: args.endTime ? new Date(args.endTime) : undefined,
        limit: args.limit,
      });
      break;

    default:
      throw new Error(`Unknown audit mode: ${args.mode}`);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
