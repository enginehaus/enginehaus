/**
 * API Key Authentication
 *
 * Simple authentication using static API keys.
 * Suitable for personal use, development, and testing.
 *
 * API keys can be provided via:
 * - X-API-Key header
 * - Authorization: Bearer <key>
 * - Authorization: ApiKey <key>
 */

import { Request, Response, NextFunction } from 'express';
import { AuthResult } from './config.js';

/**
 * Extract API key from request headers.
 * Checks multiple header formats for flexibility.
 */
export function extractApiKey(req: Request): string | null {
  // Check X-API-Key header (preferred)
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.length > 0) {
    return xApiKey;
  }

  // Check Authorization header
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string') {
    // Bearer token format
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }
    // ApiKey format
    if (authHeader.toLowerCase().startsWith('apikey ')) {
      return authHeader.slice(7).trim();
    }
  }

  return null;
}

/**
 * Validate an API key against a list of valid keys.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateApiKey(apiKey: string, validKeys: string[]): AuthResult {
  if (!apiKey) {
    return {
      authenticated: false,
      error: 'No API key provided',
    };
  }

  // Constant-time comparison to prevent timing attacks
  let isValid = false;
  for (const validKey of validKeys) {
    if (constantTimeEquals(apiKey, validKey)) {
      isValid = true;
      break;
    }
  }

  if (isValid) {
    return {
      authenticated: true,
      identity: `api-key:${hashForLogging(apiKey)}`,
      scopes: ['mcp:read', 'mcp:write'], // API keys get full access
    };
  }

  return {
    authenticated: false,
    error: 'Invalid API key',
  };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Create a short hash of API key for logging (never log full key).
 */
function hashForLogging(key: string): string {
  if (key.length <= 8) {
    return '***';
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Create Express middleware for API key authentication.
 */
export function createApiKeyMiddleware(validKeys: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = extractApiKey(req);
    const result = validateApiKey(apiKey || '', validKeys);

    if (result.authenticated) {
      // Attach auth info to request for downstream handlers
      // Uses 'mcpAuth' to avoid conflict with SDK's 'auth' property
      (req as any).mcpAuth = {
        identity: result.identity,
        scopes: result.scopes,
      };
      return next();
    }

    // Return JSON-RPC formatted error for MCP compatibility
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001, // Custom auth error code
        message: result.error || 'Authentication failed',
      },
      id: null,
    });
  };
}
