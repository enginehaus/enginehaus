/**
 * OAuth 2.1 Authentication
 *
 * Token verification for OAuth-protected MCP endpoints.
 * MCP servers act as OAuth Resource Servers only - tokens are issued
 * by external Authorization Servers (Auth0, Okta, Cognito, etc.).
 *
 * This module provides:
 * - JWT token verification using JWKS
 * - Scope validation
 * - Caching of JWKS keys
 *
 * @see docs/research/mcp-http-transport-research.md
 */

import { Request, Response, NextFunction } from 'express';
import * as jose from 'jose';
import { OAuthConfig, AuthResult } from './config.js';

// Cache for JWKS key sets to avoid fetching on every request
const jwksCache = new Map<string, { keys: jose.JSONWebKeySet; expires: number }>();
const JWKS_CACHE_TTL = 3600000; // 1 hour

/**
 * Token claims after verification
 */
export interface TokenClaims {
  /** Subject (user or client ID) */
  sub: string;
  /** Issuer */
  iss: string;
  /** Audience */
  aud: string | string[];
  /** Expiration timestamp */
  exp: number;
  /** Issued at timestamp */
  iat: number;
  /** Scopes (space-separated string or array) */
  scope?: string | string[];
  /** Client ID (for client credentials flow) */
  client_id?: string;
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

/**
 * Parse scopes from token claims.
 * Handles both space-separated string and array formats.
 */
export function parseScopes(scope: string | string[] | undefined): string[] {
  if (!scope) {
    return [];
  }
  if (Array.isArray(scope)) {
    return scope;
  }
  return scope.split(' ').filter(Boolean);
}

/**
 * Verify that required scopes are present.
 */
export function hasRequiredScopes(grantedScopes: string[], requiredScopes: string[]): boolean {
  if (!requiredScopes || requiredScopes.length === 0) {
    return true;
  }
  return requiredScopes.every(required => grantedScopes.includes(required));
}

/**
 * Fetch JWKS from the issuer's well-known endpoint.
 * Uses caching to avoid repeated fetches.
 */
async function getJWKS(jwksUri: string): Promise<jose.JSONWebKeySet> {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expires > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS from ${jwksUri}: ${response.status}`);
  }

  const keys = await response.json() as jose.JSONWebKeySet;
  jwksCache.set(jwksUri, { keys, expires: Date.now() + JWKS_CACHE_TTL });
  return keys;
}

/**
 * Validate OAuth token using JWKS verification.
 */
export async function validateOAuthToken(
  token: string,
  config: OAuthConfig
): Promise<AuthResult> {
  if (!token) {
    return {
      authenticated: false,
      error: 'No bearer token provided',
    };
  }

  try {
    // Create JWKS remote key set for verification
    const JWKS = jose.createRemoteJWKSet(new URL(config.jwksUri));

    // Verify the JWT
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: config.issuer,
      audience: config.audience,
    });

    // Extract scopes
    const scopes = parseScopes(payload.scope as string | string[] | undefined);

    // Check required scopes if configured
    if (config.requiredScopes && config.requiredScopes.length > 0) {
      if (!hasRequiredScopes(scopes, config.requiredScopes)) {
        return {
          authenticated: false,
          error: `Insufficient scopes. Required: ${config.requiredScopes.join(', ')}`,
        };
      }
    }

    // Extract client ID (Auth0 uses 'azp' or 'client_id')
    const clientId = (payload.azp || payload.client_id || payload.sub) as string;

    return {
      authenticated: true,
      identity: `oauth:${clientId}`,
      scopes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token verification failed';

    // Provide helpful error messages
    if (message.includes('JWKSNoMatchingKey')) {
      return {
        authenticated: false,
        error: 'Token signature verification failed - key not found in JWKS',
      };
    }
    if (message.includes('JWTExpired')) {
      return {
        authenticated: false,
        error: 'Token has expired',
      };
    }
    if (message.includes('JWTClaimValidationFailed')) {
      return {
        authenticated: false,
        error: 'Token claims validation failed (issuer or audience mismatch)',
      };
    }

    console.error('[OAuth] Token verification error:', message);
    return {
      authenticated: false,
      error: message,
    };
  }
}

/**
 * Create Express middleware for OAuth authentication.
 */
export function createOAuthMiddleware(config: OAuthConfig) {
  console.error(`[OAuth] Configured with issuer: ${config.issuer}`);

  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    const result = await validateOAuthToken(token || '', config);

    if (result.authenticated) {
      // Attach auth info to request
      // Uses 'mcpAuth' to avoid conflict with SDK's 'auth' property
      (req as any).mcpAuth = {
        identity: result.identity,
        scopes: result.scopes,
      };
      return next();
    }

    // Return JSON-RPC formatted error
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: result.error || 'Authentication failed',
      },
      id: null,
    });
  };
}

/**
 * Token verifier interface compatible with SDK's requireBearerAuth.
 */
export interface OAuthTokenVerifier {
  verifyAccessToken(token: string): Promise<{
    token: string;
    clientId: string;
    scopes: string[];
    expiresAt?: number;
  }>;
}

/**
 * Create a token verifier for external IdP integration.
 *
 * Example with Auth0:
 * ```typescript
 * const verifier = createTokenVerifier({
 *   issuer: 'https://your-tenant.auth0.com/',
 *   audience: 'https://mcp.yourdomain.com',
 *   jwksUri: 'https://your-tenant.auth0.com/.well-known/jwks.json',
 * });
 * ```
 */
export function createTokenVerifier(config: OAuthConfig): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string) {
      const result = await validateOAuthToken(token, config);

      if (!result.authenticated) {
        throw new Error(result.error || 'Token verification failed');
      }

      // Extract client ID from identity (format: "oauth:clientId")
      const clientId = result.identity?.replace('oauth:', '') || 'unknown';

      return {
        token,
        clientId,
        scopes: result.scopes || [],
      };
    },
  };
}
