/**
 * Combined Authentication Middleware
 *
 * Routes authentication to the appropriate handler based on configuration.
 * Supports: none (development), api-key (simple), oauth (production).
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthConfig, loadAuthConfig } from './config.js';
import { createApiKeyMiddleware } from './api-key.js';
import { createOAuthMiddleware } from './oauth.js';

/**
 * Auth info attached to authenticated requests.
 * Uses 'mcpAuth' to avoid conflict with SDK's 'auth' property.
 */
export interface RequestAuthInfo {
  /** Authenticated identity */
  identity: string;
  /** Granted scopes */
  scopes: string[];
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      mcpAuth?: RequestAuthInfo;
    }
  }
}

/**
 * Create authentication middleware based on configuration.
 *
 * @param config - Auth configuration (or loaded from environment if not provided)
 * @returns Express middleware that authenticates requests
 */
export function createAuthMiddleware(config?: AuthConfig): RequestHandler {
  const authConfig = config || loadAuthConfig();

  switch (authConfig.mode) {
    case 'none':
      // No authentication - pass through all requests
      console.error('[Auth] Mode: none (no authentication)');
      return (_req: Request, _res: Response, next: NextFunction) => {
        next();
      };

    case 'api-key':
      if (!authConfig.apiKeys || authConfig.apiKeys.length === 0) {
        console.error('[Auth] API key mode configured but no keys provided. Falling back to no auth.');
        return (_req: Request, _res: Response, next: NextFunction) => {
          next();
        };
      }
      console.error(`[Auth] Mode: api-key (${authConfig.apiKeys.length} key(s) configured)`);
      return createApiKeyMiddleware(authConfig.apiKeys);

    case 'oauth':
      if (!authConfig.oauth) {
        console.error('[Auth] OAuth mode configured but no OAuth config provided. Falling back to no auth.');
        return (_req: Request, _res: Response, next: NextFunction) => {
          next();
        };
      }
      console.error(`[Auth] Mode: oauth (issuer: ${authConfig.oauth.issuer})`);
      return createOAuthMiddleware(authConfig.oauth);

    default:
      console.error(`[Auth] Unknown mode: ${authConfig.mode}. Using no authentication.`);
      return (_req: Request, _res: Response, next: NextFunction) => {
        next();
      };
  }
}

/**
 * Middleware to skip authentication for specific paths.
 * Useful for health checks and public endpoints.
 */
export function skipAuthForPaths(
  authMiddleware: RequestHandler,
  skipPaths: string[]
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for specified paths
    if (skipPaths.some(path => req.path === path || req.path.startsWith(path + '/'))) {
      return next();
    }
    // Apply auth for all other paths
    return authMiddleware(req, res, next);
  };
}

/**
 * Check if request is authenticated.
 */
export function isAuthenticated(req: Request): boolean {
  return req.mcpAuth !== undefined && req.mcpAuth.identity !== undefined;
}

/**
 * Check if request has required scope.
 */
export function hasScope(req: Request, scope: string): boolean {
  if (!req.mcpAuth?.scopes) {
    return false;
  }
  return req.mcpAuth.scopes.includes(scope);
}

/**
 * Middleware to require specific scopes.
 */
export function requireScopes(...scopes: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.mcpAuth) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authentication required',
        },
        id: null,
      });
    }

    const missingScopes = scopes.filter(s => !req.mcpAuth!.scopes.includes(s));
    if (missingScopes.length > 0) {
      return res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32003,
          message: `Insufficient scopes. Required: ${scopes.join(', ')}`,
          data: { missing: missingScopes },
        },
        id: null,
      });
    }

    next();
  };
}
