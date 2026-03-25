/**
 * MCP Authentication Module
 *
 * Provides authentication middleware for MCP HTTP transport.
 *
 * Usage:
 * ```typescript
 * import { createAuthMiddleware, loadAuthConfig } from './auth/index.js';
 *
 * const authMiddleware = createAuthMiddleware();
 * app.use('/mcp', authMiddleware, mcpHandler);
 * ```
 *
 * Configuration via environment variables:
 * - MCP_AUTH_MODE: none | api-key | oauth
 * - MCP_API_KEYS: comma-separated API keys (for api-key mode)
 * - MCP_OAUTH_*: OAuth configuration (for oauth mode)
 */

export * from './config.js';
export * from './api-key.js';
export * from './oauth.js';
export * from './middleware.js';
