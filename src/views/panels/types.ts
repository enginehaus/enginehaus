/**
 * Wheelhaus Panel Types
 *
 * Each panel is a focused data view that queries specific service methods
 * and renders the result in multiple formats. Panels compose into dashboards.
 *
 * query()          → TData            (single query layer)
 * renderMarkdown() → string           (MCP tool, agents, CLI)
 * toJSON()         → serializable     (REST API, WebSocket, programmatic)
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';

export interface WheelhausPanel<TData = unknown> {
  /** Unique panel identifier */
  id: string;
  /** Human-readable panel title */
  title: string;
  /** Query service for panel-specific data */
  query(service: CoordinationService): Promise<TData>;
  /** Render data as Markdown */
  renderMarkdown(data: TData): string;
  /** Serialize data for REST/programmatic consumption */
  toJSON(data: TData): unknown;
}
