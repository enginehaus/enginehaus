/**
 * Agent Identity Resolution
 *
 * Resolves the calling agent's identity from MCP client info,
 * explicit parameters, or environment variables.
 */

/**
 * Derive a stable agentId from an MCP client name.
 * Maps known client names to canonical IDs.
 */
function normalizeClientName(name: string): string {
  const lower = name.toLowerCase().trim();

  // Known MCP client mappings
  if (lower.includes('claude') && lower.includes('code')) return 'claude-code';
  if (lower.includes('claude') && lower.includes('desktop')) return 'claude-desktop';
  if (lower === 'claude' || lower.includes('claude.ai')) return 'claude';
  if (lower.includes('cursor')) return 'cursor';
  if (lower.includes('continue')) return 'continue';
  if (lower.includes('chatgpt') || lower.includes('openai')) return 'chatgpt';
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('mistral')) return 'mistral';

  // Fallback: use the name as-is (kebab-cased)
  return lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export interface AgentIdentitySource {
  /** MCP client name from server.getClientVersion() */
  mcpClientName?: string;
  /** Explicit agentId from tool parameters */
  paramAgentId?: string;
  /** Environment variable override */
  envAgentId?: string;
}

export interface ResolvedAgentIdentity {
  agentId: string;
  source: 'mcp-client' | 'parameter' | 'environment' | 'default';
  /** True if param was provided but differs from MCP identity */
  mismatch: boolean;
}

/**
 * Resolve agent identity with precedence:
 * 1. MCP-verified client name (most trustworthy)
 * 2. Environment variable (configured by user)
 * 3. Explicit parameter (backward compatible)
 * 4. Default: 'claude-code'
 */
export function resolveAgentIdentity(source: AgentIdentitySource): ResolvedAgentIdentity {
  const mcpId = source.mcpClientName ? normalizeClientName(source.mcpClientName) : undefined;
  const envId = source.envAgentId || process.env.ENGINEHAUS_AGENT_ID;

  // Check for mismatch between MCP identity and parameter
  const mismatch = !!(
    mcpId &&
    source.paramAgentId &&
    source.paramAgentId !== mcpId
  );

  if (mcpId) {
    return { agentId: mcpId, source: 'mcp-client', mismatch };
  }

  if (envId) {
    return { agentId: envId, source: 'environment', mismatch: false };
  }

  if (source.paramAgentId) {
    return { agentId: source.paramAgentId, source: 'parameter', mismatch: false };
  }

  return { agentId: 'claude-code', source: 'default', mismatch: false };
}
