/**
 * Client Registry
 *
 * Central registry for AI client definitions.
 * Enables pluggable support for different AI tools.
 *
 * To add a new client:
 * 1. Create a new file (e.g., cursor.ts) implementing ClientDefinition
 * 2. Import and register it in this file
 * 3. The client becomes available via getClient('cursor')
 */

import * as os from 'os';
import * as fs from 'fs';
import { ClientDefinition, ClientConfigResult, PlatformPaths } from './types.js';
import { claudeDesktopClient } from './claude-desktop.js';
import { claudeCodeClient } from './claude-code.js';

// Re-export types
export * from './types.js';

/**
 * Registry of all available clients
 */
const clientRegistry: Map<string, ClientDefinition> = new Map();

// Register built-in clients
clientRegistry.set(claudeDesktopClient.id, claudeDesktopClient);
clientRegistry.set(claudeCodeClient.id, claudeCodeClient);

/**
 * Get a client definition by ID
 */
export function getClient(clientId: string): ClientDefinition | undefined {
  return clientRegistry.get(clientId);
}

/**
 * List all registered clients
 */
export function listClients(): ClientDefinition[] {
  return Array.from(clientRegistry.values());
}

/**
 * List client IDs
 */
export function listClientIds(): string[] {
  return Array.from(clientRegistry.keys());
}

/**
 * Register a new client (for plugins/extensions)
 */
export function registerClient(client: ClientDefinition): void {
  clientRegistry.set(client.id, client);
}

/**
 * Resolve platform-specific config path
 */
export function resolveConfigPath(paths: PlatformPaths): string {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';
  return paths[platform] || paths.default || '';
}

/**
 * Get config path for a specific client
 */
export function getClientConfigPath(clientId: string): string | null {
  const client = getClient(clientId);
  if (!client) return null;
  return resolveConfigPath(client.configPaths);
}

/**
 * Read and validate client MCP configuration
 */
export function readClientConfig(clientId: string): ClientConfigResult {
  const configPath = getClientConfigPath(clientId);

  if (!configPath) {
    return {
      exists: false,
      valid: false,
      hasEnginehaus: false,
      configPath: '',
      error: 'Client has no config path',
    };
  }

  const result: ClientConfigResult = {
    exists: false,
    valid: false,
    hasEnginehaus: false,
    configPath,
  };

  if (!fs.existsSync(configPath)) {
    return result;
  }

  result.exists = true;

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    result.valid = true;

    // Check for enginehaus entry
    if (config.mcpServers?.enginehaus) {
      result.hasEnginehaus = true;
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : 'Parse error';
  }

  return result;
}

/**
 * Write MCP configuration for a client
 */
export function writeClientMCPConfig(
  clientId: string,
  serverPath: string
): { success: boolean; error?: string } {
  const client = getClient(clientId);
  if (!client) {
    return { success: false, error: `Unknown client: ${clientId}` };
  }

  if (!client.requiresMCPConfig || !client.formatMCPConfig) {
    return { success: false, error: 'Client does not use MCP config files' };
  }

  const configPath = resolveConfigPath(client.configPaths);
  if (!configPath) {
    return { success: false, error: 'No config path for this platform' };
  }

  try {
    // Read existing config or create new
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    }

    // Ensure mcpServers object exists
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add/update enginehaus entry
    const mcpConfig = client.formatMCPConfig(serverPath);
    (config.mcpServers as Record<string, unknown>).enginehaus = mcpConfig;

    // Write back
    const configDir = require('path').dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Write error' };
  }
}

/**
 * Generate instructions for a client
 */
export function generateClientInstructions(
  clientId: string,
  options: Parameters<ClientDefinition['generateInstructions']>[0]
): string | null {
  const client = getClient(clientId);
  if (!client) return null;
  return client.generateInstructions(options);
}

/**
 * Get all clients that require MCP configuration
 */
export function getMCPClients(): ClientDefinition[] {
  return listClients().filter(c => c.requiresMCPConfig);
}

/**
 * Get all clients that use instruction files
 */
export function getInstructionFileClients(): ClientDefinition[] {
  return listClients().filter(c => c.instructionFile);
}

// Export individual clients for direct access
export { claudeDesktopClient } from './claude-desktop.js';
export { claudeCodeClient } from './claude-code.js';
