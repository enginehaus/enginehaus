/**
 * Authentication Configuration Types
 *
 * Defines configuration options for MCP HTTP transport authentication.
 * Supports multiple auth modes: none (dev), api-key (simple), oauth (production).
 */

/**
 * OAuth 2.1 configuration for external Identity Provider integration.
 * MCP servers act as OAuth Resource Servers only.
 */
export interface OAuthConfig {
  /** OAuth issuer URL (e.g., https://your-tenant.auth0.com/) */
  issuer: string;
  /** Expected audience for token validation */
  audience: string;
  /** JWKS URI for token signature verification */
  jwksUri: string;
  /** Required scopes for MCP access */
  requiredScopes?: string[];
}

/**
 * Authentication mode for the MCP HTTP transport
 */
export type AuthMode = 'none' | 'api-key' | 'oauth';

/**
 * Complete authentication configuration
 */
export interface AuthConfig {
  /** Authentication mode */
  mode: AuthMode;
  /** API keys for api-key mode */
  apiKeys?: string[];
  /** OAuth configuration for oauth mode */
  oauth?: OAuthConfig;
}

/**
 * Result of authentication attempt
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  authenticated: boolean;
  /** Error message if authentication failed */
  error?: string;
  /** Authenticated identity (api key name, OAuth client_id, etc.) */
  identity?: string;
  /** Granted scopes (for OAuth) */
  scopes?: string[];
}

/**
 * Standard MCP scopes for authorization
 */
export const MCP_SCOPES = {
  /** Read tasks, decisions, context */
  'mcp:read': 'Read tasks, decisions, and coordination context',
  /** Create/update tasks, log decisions */
  'mcp:write': 'Create and update tasks, log decisions',
  /** Delete tasks, manage projects */
  'mcp:admin': 'Administrative operations (delete, project management)',
} as const;

export type McpScope = keyof typeof MCP_SCOPES;

/**
 * Load authentication configuration from environment variables.
 *
 * Environment variables:
 * - MCP_AUTH_MODE: none | api-key | oauth (default: none)
 * - MCP_API_KEYS: comma-separated API keys for api-key mode
 * - MCP_OAUTH_ISSUER: OAuth issuer URL
 * - MCP_OAUTH_AUDIENCE: Expected token audience
 * - MCP_OAUTH_JWKS_URI: JWKS endpoint for signature verification
 * - MCP_OAUTH_SCOPES: Required scopes (comma-separated)
 */
export function loadAuthConfig(): AuthConfig {
  const mode = (process.env.MCP_AUTH_MODE || 'none') as AuthMode;

  if (!['none', 'api-key', 'oauth'].includes(mode)) {
    console.error(`Invalid MCP_AUTH_MODE: ${mode}. Using 'none'.`);
    return { mode: 'none' };
  }

  const config: AuthConfig = { mode };

  if (mode === 'api-key') {
    const apiKeysEnv = process.env.MCP_API_KEYS;
    if (!apiKeysEnv) {
      console.error('MCP_AUTH_MODE=api-key requires MCP_API_KEYS environment variable');
      return { mode: 'none' };
    }
    config.apiKeys = apiKeysEnv.split(',').map(k => k.trim()).filter(Boolean);
    if (config.apiKeys.length === 0) {
      console.error('MCP_API_KEYS is empty');
      return { mode: 'none' };
    }
  }

  if (mode === 'oauth') {
    const issuer = process.env.MCP_OAUTH_ISSUER;
    const audience = process.env.MCP_OAUTH_AUDIENCE;
    const jwksUri = process.env.MCP_OAUTH_JWKS_URI;

    if (!issuer || !audience || !jwksUri) {
      console.error('MCP_AUTH_MODE=oauth requires MCP_OAUTH_ISSUER, MCP_OAUTH_AUDIENCE, and MCP_OAUTH_JWKS_URI');
      return { mode: 'none' };
    }

    config.oauth = {
      issuer,
      audience,
      jwksUri,
      requiredScopes: process.env.MCP_OAUTH_SCOPES?.split(',').map(s => s.trim()).filter(Boolean),
    };
  }

  return config;
}
