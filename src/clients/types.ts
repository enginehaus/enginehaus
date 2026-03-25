/**
 * Client Registry Types
 *
 * Defines the interface for AI client modules.
 * Enables pluggable support for different AI tools (Claude Desktop, Code, Cursor, etc.)
 */

import { Project } from '../coordination/types.js';

/**
 * Platform-specific configuration paths
 */
export interface PlatformPaths {
  darwin?: string;   // macOS
  win32?: string;    // Windows
  linux?: string;    // Linux
  default?: string;  // Fallback
}

/**
 * MCP server configuration format
 */
export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Client definition interface
 *
 * Implement this to add support for a new AI client (e.g., Cursor, Windsurf).
 */
export interface ClientDefinition {
  /** Unique identifier (e.g., 'claude-desktop', 'claude-code', 'cursor') */
  id: string;

  /** Display name for UI/CLI output */
  name: string;

  /** Short description of the client */
  description: string;

  /**
   * Platform-specific paths where MCP config lives.
   * Use ~ for home directory.
   */
  configPaths: PlatformPaths;

  /**
   * Generate instruction template for this client.
   * Used by `eh instructions <client>`.
   */
  generateInstructions: (options: InstructionOptions) => string;

  /**
   * Generate minimal/compact instructions.
   */
  generateMinimalInstructions?: (projectName: string) => string;

  /**
   * Format MCP server entry for this client's config.
   * Returns null if client doesn't use MCP config files.
   */
  formatMCPConfig?: (serverPath: string) => MCPServerConfig | null;

  /**
   * Format for handoff prompts to/from this client.
   * Used by generate_continuation_prompt.
   */
  handoffPromptFormat?: string;

  /**
   * Detect if this client is installed/available.
   * Returns version string if found, null otherwise.
   */
  detectVersion?: () => string | null;

  /**
   * Whether this client requires MCP configuration file modification.
   */
  requiresMCPConfig: boolean;

  /**
   * File this client reads for instructions (e.g., 'CLAUDE.md', '.cursorrules')
   */
  instructionFile?: string;
}

/**
 * Options for generating instructions
 */
export interface InstructionOptions {
  project: Project;
  webConsolePort?: number;
  capabilities?: string[];
}

/**
 * Result of reading/parsing client config
 */
export interface ClientConfigResult {
  exists: boolean;
  valid: boolean;
  hasEnginehaus: boolean;
  configPath: string;
  error?: string;
}
