/**
 * Configuration Service
 * 
 * Handles loading, inheritance resolution, and management of Enginehaus configuration.
 * Supports the hierarchy: Organization → Team → Project → User → Session
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  EnginehausConfig,
  ResolvedConfig,
  ConfigScope,
  ConfigSource,
  ConfigOverride,
  DEFAULT_CONFIG,
  DEFAULT_PHASES,
  PhaseDefinition,
} from './types.js';

// ============================================================================
// Configuration Loading
// ============================================================================

export interface ConfigLoadResult {
  config: EnginehausConfig;
  source: ConfigSource;
  filePath?: string;
  fileHash?: string;
  errors: string[];
  warnings: string[];
}

/**
 * Load configuration from a JSON file
 */
export async function loadConfigFromFile(filePath: string): Promise<ConfigLoadResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      return {
        config: DEFAULT_CONFIG,
        source: 'default',
        errors: [`Configuration file not found: ${absolutePath}`],
        warnings: ['Using default configuration'],
      };
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const fileHash = createHash('sha256').update(content).digest('hex').substring(0, 16);
    
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      return {
        config: DEFAULT_CONFIG,
        source: 'default',
        filePath: absolutePath,
        errors: [`Invalid JSON in configuration file: ${parseError}`],
        warnings: ['Using default configuration'],
      };
    }

    // Validate and merge with defaults
    const validationResult = validateConfig(parsed);
    errors.push(...validationResult.errors);
    warnings.push(...validationResult.warnings);

    const mergedConfig = deepMerge(DEFAULT_CONFIG, parsed as Partial<EnginehausConfig>);

    return {
      config: mergedConfig,
      source: 'file',
      filePath: absolutePath,
      fileHash,
      errors,
      warnings,
    };
  } catch (error) {
    return {
      config: DEFAULT_CONFIG,
      source: 'default',
      errors: [`Error loading configuration: ${error}`],
      warnings: ['Using default configuration'],
    };
  }
}

/**
 * Find configuration file in project directory
 */
export function findConfigFile(projectPath: string): string | null {
  const configNames = [
    'enginehaus.config.json',
    'enginehaus.json',
    '.enginehaus.json',
    '.enginehaus/config.json',
  ];

  for (const name of configNames) {
    const fullPath = path.join(projectPath, name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

// ============================================================================
// Configuration Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate configuration object
 */
export function validateConfig(config: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be an object'], warnings: [] };
  }

  const cfg = config as Record<string, unknown>;

  // Version check
  if (cfg.version && typeof cfg.version !== 'string') {
    errors.push('version must be a string');
  }

  // Validate workflow section
  if (cfg.workflow) {
    const workflow = cfg.workflow as Record<string, unknown>;
    
    if (workflow.sessions) {
      const sessions = workflow.sessions as Record<string, unknown>;
      if (sessions.expiryMinutes !== undefined) {
        const expiry = sessions.expiryMinutes as number;
        if (expiry < 1) {
          errors.push('workflow.sessions.expiryMinutes must be at least 1');
        }
        if (expiry > 1440) {
          warnings.push('workflow.sessions.expiryMinutes > 1440 (24h) may cause stale sessions');
        }
      }
    }
  }

  // Validate quality section
  if (cfg.quality) {
    const quality = cfg.quality as Record<string, unknown>;
    
    if (quality.coverage) {
      const coverage = quality.coverage as Record<string, unknown>;
      const min = coverage.minimum as number;
      const rec = coverage.recommended as number;
      const exc = coverage.excellent as number;
      
      if (min !== undefined && (min < 0 || min > 100)) {
        errors.push('quality.coverage.minimum must be between 0 and 100');
      }
      if (rec !== undefined && (rec < 0 || rec > 100)) {
        errors.push('quality.coverage.recommended must be between 0 and 100');
      }
      if (exc !== undefined && (exc < 0 || exc > 100)) {
        errors.push('quality.coverage.excellent must be between 0 and 100');
      }
      if (min !== undefined && rec !== undefined && min > rec) {
        warnings.push('quality.coverage.minimum > recommended is unusual');
      }
      if (rec !== undefined && exc !== undefined && rec > exc) {
        warnings.push('quality.coverage.recommended > excellent is unusual');
      }
    }
  }

  // Validate git section
  if (cfg.git) {
    const git = cfg.git as Record<string, unknown>;
    
    if (git.branchNaming) {
      const branchNaming = git.branchNaming as Record<string, unknown>;
      if (branchNaming.pattern && typeof branchNaming.pattern === 'string') {
        if (!branchNaming.pattern.includes('{{')) {
          warnings.push('git.branchNaming.pattern should include template variables like {{type}}, {{taskId}}, {{title}}');
        }
      }
    }
  }

  // Validate context section
  if (cfg.context) {
    const context = cfg.context as Record<string, unknown>;
    
    if (context.assembly) {
      const assembly = context.assembly as Record<string, unknown>;
      if (assembly.maxFileSizeKb !== undefined) {
        const maxSize = assembly.maxFileSizeKb as number;
        if (maxSize < 1) {
          errors.push('context.assembly.maxFileSizeKb must be at least 1');
        }
        if (maxSize > 10240) {
          warnings.push('context.assembly.maxFileSizeKb > 10MB may cause performance issues');
        }
      }
    }

    if (context.tokenBudgets) {
      const budgets = context.tokenBudgets as Record<string, unknown>;
      const minimal = budgets.minimal as number;
      const standard = budgets.standard as number;
      const full = budgets.full as number;

      if (minimal !== undefined && minimal > (standard ?? Infinity)) {
        warnings.push('context.tokenBudgets.minimal > standard is unusual');
      }
      if (standard !== undefined && standard > (full ?? Infinity)) {
        warnings.push('context.tokenBudgets.standard > full is unusual');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Configuration Inheritance & Resolution
// ============================================================================

export interface InheritanceContext {
  organizationConfig?: Partial<EnginehausConfig>;
  teamConfig?: Partial<EnginehausConfig>;
  projectConfig?: Partial<EnginehausConfig>;
  userConfig?: Partial<EnginehausConfig>;
  sessionOverrides?: Partial<EnginehausConfig>;
}

/**
 * Resolve configuration with full inheritance chain
 */
export function resolveConfig(
  context: InheritanceContext,
  projectId: string
): ResolvedConfig {
  const overrides: ConfigOverride[] = [];
  const inheritanceChain: string[] = [];
  
  // Start with defaults
  let resolved = { ...DEFAULT_CONFIG };
  inheritanceChain.push('default');

  // Apply organization config
  if (context.organizationConfig) {
    resolved = deepMerge(resolved, context.organizationConfig);
    inheritanceChain.push('organization');
    trackOverrides(context.organizationConfig, 'organization', 'database', overrides);
  }

  // Apply team config
  if (context.teamConfig) {
    resolved = deepMerge(resolved, context.teamConfig);
    inheritanceChain.push('team');
    trackOverrides(context.teamConfig, 'team', 'database', overrides);
  }

  // Apply project config (from file or database)
  if (context.projectConfig) {
    resolved = deepMerge(resolved, context.projectConfig);
    inheritanceChain.push('project');
    trackOverrides(context.projectConfig, 'project', 'file', overrides);
  }

  // Apply user config
  if (context.userConfig) {
    resolved = deepMerge(resolved, context.userConfig);
    inheritanceChain.push('user');
    trackOverrides(context.userConfig, 'user', 'database', overrides);
  }

  // Apply session overrides (ephemeral)
  if (context.sessionOverrides) {
    resolved = deepMerge(resolved, context.sessionOverrides);
    inheritanceChain.push('session');
    trackOverrides(context.sessionOverrides, 'session', 'api', overrides);
  }

  return {
    ...resolved,
    _metadata: {
      projectId,
      resolvedAt: new Date(),
      inheritanceChain,
      overrides,
      effectiveScope: context.sessionOverrides ? 'session' :
                      context.userConfig ? 'user' :
                      context.projectConfig ? 'project' :
                      context.teamConfig ? 'team' :
                      context.organizationConfig ? 'organization' : 'project',
    },
  };
}

/**
 * Track configuration overrides for audit/debugging
 */
function trackOverrides(
  config: Partial<EnginehausConfig>,
  scope: ConfigScope,
  source: ConfigSource,
  overrides: ConfigOverride[]
): void {
  const paths = flattenObject(config);
  for (const [path, value] of Object.entries(paths)) {
    overrides.push({
      path,
      value,
      source,
      scope,
      appliedAt: new Date(),
    });
  }
}

// ============================================================================
// Phase Resolution
// ============================================================================

/**
 * Get effective phase definitions based on configuration
 */
export function getEffectivePhases(config: EnginehausConfig): PhaseDefinition[] {
  if (!config.workflow.phases.enabled) {
    return [];
  }

  if (config.workflow.phases.definition === 'custom' && config.workflow.phases.custom) {
    return config.workflow.phases.custom.phases;
  }

  return DEFAULT_PHASES;
}

// ============================================================================
// Configuration Accessors
// ============================================================================

/**
 * Get a configuration value by path (e.g., 'quality.coverage.minimum')
 */
export function getConfigValue<T>(config: EnginehausConfig, path: string): T | undefined {
  const parts = path.split('.');
  let current: unknown = config;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current as T;
}

/**
 * Set a configuration value by path
 */
export function setConfigValue(
  config: EnginehausConfig,
  path: string,
  value: unknown
): EnginehausConfig {
  const result = { ...config };
  const parts = path.split('.');
  let current: Record<string, unknown> = result as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current[part] = { ...(current[part] as Record<string, unknown>) };
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Deep merge two objects
 */
export function deepMerge<T>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target } as Record<string, unknown>;
  const src = source as Record<string, unknown>;

  for (const key in src) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      const sourceValue = src[key];
      const targetValue = result[key];

      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        // Recursively merge objects
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else if (sourceValue !== undefined) {
        // Override with source value
        result[key] = sourceValue;
      }
    }
  }

  return result as T;
}

/**
 * Flatten an object to path/value pairs
 */
export function flattenObject(
  obj: Record<string, unknown>,
  prefix: string = ''
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      const path = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, flattenObject(value as Record<string, unknown>, path));
      } else {
        result[path] = value;
      }
    }
  }

  return result;
}

/**
 * Expand environment variables in configuration
 */
export function expandEnvironmentVariables(config: EnginehausConfig): EnginehausConfig {
  const json = JSON.stringify(config);
  const expanded = json.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const value = process.env[varName];
    return value !== undefined ? value : match;
  });
  try {
    return JSON.parse(expanded);
  } catch {
    // Env var expansion may have broken JSON structure; return original config
    return config;
  }
}

/**
 * Export configuration to JSON string
 */
export function exportConfig(config: EnginehausConfig, pretty: boolean = true): string {
  // Remove metadata if present
  const exportable = { ...config };
  if ('_metadata' in exportable) {
    delete (exportable as Record<string, unknown>)._metadata;
  }

  return pretty ? JSON.stringify(exportable, null, 2) : JSON.stringify(exportable);
}

/**
 * Generate a default configuration file for a project
 */
export function generateDefaultConfigFile(
  projectName: string,
  projectSlug: string,
  options: {
    domain?: string;
    techStack?: string[];
    rootPath?: string;
  } = {}
): string {
  const config: Partial<EnginehausConfig> = {
    $schema: 'https://enginehaus.dev/schema/config.v1.json',
    version: '1.0',
    project: {
      name: projectName,
      slug: projectSlug,
      domain: (options.domain as EnginehausConfig['project']['domain']) || 'other',
      techStack: options.techStack || [],
      rootPath: options.rootPath || './',
    },
    // Only include non-default values
    workflow: {
      phases: {
        enabled: true,
        definition: 'default',
        enforcement: 'flexible',
      },
      sessions: {
        heartbeatIntervalSeconds: 60,
        expiryMinutes: 5,
        defaultAgentCapacity: 1,
        allowMultipleAgents: true,
        autoClaimOnStart: true,
        preserveContextOnExpiry: true,
      },
      tasks: {
        requireDescription: true,
        requireFiles: false,
        defaultPriority: 'medium',
        autoAssignPhases: true,
        autoDetectType: true,
        requireCommitOnCompletion: true,
        requirePushOnCompletion: true,
        requireMergeOnCompletion: true,
        requireOutcomeTracking: true,
        checkpointProtocol: 'git' as const,
        useWorktree: false,
        cleanupBranchOnCompletion: true,
      },
    },
    quality: {
      coverage: {
        minimum: 70,
        recommended: 80,
        excellent: 90,
        enforcement: 'warn',
      },
      testRequirements: {
        critical: { unit: true, integration: true, e2e: true },
        high: { unit: true, integration: true, e2e: false },
        medium: { unit: true, integration: false, e2e: false },
        low: { unit: true, integration: false, e2e: false },
      },
      gates: {
        compilation: { required: true, blocking: true },
        linting: { required: true, blocking: false },
        tests: { required: true, blocking: true },
        coverage: { required: true, blocking: false },
      },
      healthCheck: {
        intervalMinutes: 30,
        failOnIssues: false,
        checks: ['stale-sessions', 'blocked-tasks'],
      },
      enforceOnCompletion: true,
      completionValidation: {
        enabled: true,
        useLLM: false,
        timeoutMs: 5000,
        skipForSmallChanges: 0,
      },
    },
  };

  return JSON.stringify(config, null, 2);
}
