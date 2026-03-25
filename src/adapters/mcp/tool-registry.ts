/**
 * Tool Registry
 *
 * Central registry for MCP tool definitions with schema + handler co-located.
 * Replaces the 137-case switch statement in index.ts with a data-driven
 * dispatch pattern.
 */

import type { CoordinationService } from '../../core/services/coordination-service.js';
import type { CoordinationEngine } from '../../coordination/engine.js';
import type { TelemetryService } from '../../telemetry/index.js';

/**
 * Unified context passed to all tool handlers.
 * Replaces the 13 domain-specific handler context interfaces.
 */
export interface ToolContext {
  service: CoordinationService;
  coordination: CoordinationEngine;
  projectRoot: string;
  resolvedAgentId: string;
  telemetry: TelemetryService;
  sessionState: { taskCount: number };
  getProjectContext: () => Promise<{ projectId: string; projectName: string; projectSlug: string } | null>;
}

/**
 * Standard tool result shape (matches MCP SDK).
 */
export interface ToolResult {
  content: Array<{ type: string; text: string; [key: string]: unknown }>;
  isError?: boolean;
}

/**
 * A self-contained tool definition: schema + handler in one object.
 */
export interface ToolDefinition<TArgs = Record<string, unknown>> {
  /** Canonical tool name (used in MCP) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for input validation */
  inputSchema: Record<string, unknown>;
  /** Handler function */
  handler: (ctx: ToolContext, args: TArgs) => Promise<ToolResult>;
  /** Legacy aliases that should also resolve to this tool */
  aliases?: string[];
  /** Logical domain for grouping (informational) */
  domain?: string;
  /** Whether this tool mutates state (used for server-side enforcement) */
  mutating?: boolean;
  /** Optional _meta field for MCP extensions (e.g., Wheelhaus UI link) */
  _meta?: Record<string, unknown>;
}

/**
 * Central registry that tools self-register into.
 *
 * Usage:
 *   import { registry } from './tool-registry.js';
 *   registry.register({ name: 'my_tool', ... });
 */
class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private aliases: Map<string, string> = new Map();
  // Track registration order for deterministic listing
  private registrationOrder: string[] = [];

  /**
   * Register a tool definition. Throws if a name or alias conflicts
   * with an already-registered tool.
   */
  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Tool already registered: ${def.name}`);
    }
    if (this.aliases.has(def.name)) {
      throw new Error(`Tool name conflicts with existing alias: ${def.name}`);
    }
    this.tools.set(def.name, def);
    this.registrationOrder.push(def.name);

    if (def.aliases) {
      for (const alias of def.aliases) {
        if (this.tools.has(alias)) {
          throw new Error(`Alias conflicts with existing tool: ${alias}`);
        }
        if (this.aliases.has(alias)) {
          throw new Error(`Alias already registered: ${alias} (for ${this.aliases.get(alias)})`);
        }
        this.aliases.set(alias, def.name);
      }
    }
  }

  /**
   * Return MCP-compatible schema list in registration order.
   */
  listSchemas(): Array<{ name: string; description: string; inputSchema: Record<string, unknown>; _meta?: Record<string, unknown> }> {
    return this.registrationOrder.map(name => {
      const def = this.tools.get(name)!;
      const meta: Record<string, unknown> = {
        ...(def._meta || {}),
        ...(def.domain ? { domain: def.domain } : {}),
      };
      const schema: { name: string; description: string; inputSchema: Record<string, unknown>; _meta?: Record<string, unknown> } = {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
      };
      if (Object.keys(meta).length > 0) {
        schema._meta = meta;
      }
      return schema;
    });
  }

  /**
   * Resolve a tool name (canonical or alias) to its definition.
   */
  resolve(name: string): ToolDefinition | undefined {
    const direct = this.tools.get(name);
    if (direct) return direct;

    const canonical = this.aliases.get(name);
    if (canonical) return this.tools.get(canonical);

    return undefined;
  }

  /**
   * Return names of tools marked as mutating (for server-side enforcement).
   */
  getMutatingToolNames(): string[] {
    return this.registrationOrder.filter(name => this.tools.get(name)!.mutating);
  }

  /**
   * Return tools grouped by domain with descriptions, for discoverability.
   */
  listByDomain(): Record<string, Array<{ name: string; description: string }>> {
    const domains: Record<string, Array<{ name: string; description: string }>> = {};
    for (const name of this.registrationOrder) {
      const def = this.tools.get(name)!;
      const domain = def.domain || 'other';
      if (!domains[domain]) domains[domain] = [];
      domains[domain].push({ name: def.name, description: def.description });
    }
    return domains;
  }

  /**
   * Search tools by keyword matching against name and description.
   * Returns tools where the query appears in the name or description (case-insensitive).
   */
  search(query: string): Array<{ name: string; description: string; domain: string }> {
    const q = query.toLowerCase();
    const results: Array<{ name: string; description: string; domain: string }> = [];
    for (const name of this.registrationOrder) {
      const def = this.tools.get(name)!;
      if (def.name.toLowerCase().includes(q) || def.description.toLowerCase().includes(q)) {
        results.push({ name: def.name, description: def.description, domain: def.domain || 'other' });
      }
    }
    return results;
  }

  /**
   * Number of registered tools (not counting aliases).
   */
  get size(): number {
    return this.tools.size;
  }
}

/** Singleton registry instance */
export const registry = new ToolRegistry();
