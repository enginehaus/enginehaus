/**
 * Source Ingesters
 *
 * Export all built-in ingesters for registration with the ingestion framework.
 */

export { TypeScriptIngester } from './typescript.js';
export { MCPIngester } from './mcp.js';
export { OpenAPIIngester } from './openapi.js';
export { ReactIngester } from './react.js';
export { XcodeIngester } from './xcode.js';

// Re-export config types
export type { TypeScriptConfig } from './typescript.js';
export type { MCPConfig } from './mcp.js';
export type { OpenAPIConfig } from './openapi.js';
export type { ReactConfig } from './react.js';
export type { XcodeConfig } from './xcode.js';
