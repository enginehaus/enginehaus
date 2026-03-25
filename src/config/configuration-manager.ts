/**
 * ConfigurationManager
 *
 * Primary interface for accessing and managing Enginehaus configuration.
 * Handles:
 * - Loading config from files and database
 * - Resolving inheritance hierarchy (Org → Team → Project → User → Session)
 * - Caching resolved configuration
 * - Syncing file changes to database
 * - Audit logging of configuration changes
 */

import type { StorageAdapter } from '../storage/storage-adapter.js';
import {
  EnginehausConfig,
  ResolvedConfig,
  DEFAULT_CONFIG,
  PhaseDefinition,
  DEFAULT_PHASES,
} from './types.js';
import {
  loadConfigFromFile,
  findConfigFile,
  resolveConfig,
  getEffectivePhases,
  getConfigValue,
  setConfigValue,
  InheritanceContext,
  deepMerge,
} from './config-service.js';

export interface ConfigurationManagerOptions {
  storage: StorageAdapter;
  autoSyncFromFile?: boolean;
  cacheEnabled?: boolean;
  cacheTTLMs?: number;
}

interface CacheEntry {
  config: ResolvedConfig;
  timestamp: number;
}

export class ConfigurationManager {
  private storage: StorageAdapter;
  private autoSyncFromFile: boolean;
  private cacheEnabled: boolean;
  private cacheTTLMs: number;
  private configCache: Map<string, CacheEntry> = new Map();

  constructor(options: ConfigurationManagerOptions) {
    this.storage = options.storage;
    this.autoSyncFromFile = options.autoSyncFromFile ?? true;
    this.cacheEnabled = options.cacheEnabled ?? true;
    this.cacheTTLMs = options.cacheTTLMs ?? 60000; // 1 minute default
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get fully resolved configuration for a project.
   * This is the main entry point for configuration access.
   */
  async getEffectiveConfig(
    projectId: string,
    options: {
      userId?: string;
      sessionId?: string;
      forceRefresh?: boolean;
    } = {}
  ): Promise<ResolvedConfig> {
    const cacheKey = `${projectId}:${options.userId || ''}:${options.sessionId || ''}`;

    // Check cache first
    if (this.cacheEnabled && !options.forceRefresh) {
      const cached = this.configCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTLMs) {
        return cached.config;
      }
    }

    // Build inheritance context
    const context: InheritanceContext = {};

    // Get project config (from file or database)
    const projectConfig = await this.loadProjectConfig(projectId);
    if (projectConfig) {
      context.projectConfig = projectConfig;
    }

    // Get session overrides if sessionId provided
    if (options.sessionId) {
      const sessionOverrides = await this.storage.getSessionConfig(options.sessionId);
      if (sessionOverrides) {
        context.sessionOverrides = sessionOverrides as Partial<EnginehausConfig>;
      }
    }

    // Resolve the full config with inheritance
    const resolved = resolveConfig(context, projectId);

    // Cache the result
    if (this.cacheEnabled) {
      this.configCache.set(cacheKey, {
        config: resolved,
        timestamp: Date.now(),
      });
    }

    return resolved;
  }

  /**
   * Get a specific configuration value by path.
   * E.g., 'quality.coverage.minimum' or 'workflow.sessions.expiryMinutes'
   */
  async getConfigValue<T>(
    projectId: string,
    path: string,
    options: { sessionId?: string } = {}
  ): Promise<T | undefined> {
    const config = await this.getEffectiveConfig(projectId, options);
    return getConfigValue<T>(config, path);
  }

  /**
   * Get effective phases for a project.
   */
  async getPhases(projectId: string): Promise<PhaseDefinition[]> {
    const config = await this.getEffectiveConfig(projectId);
    return getEffectivePhases(config);
  }

  /**
   * Get session-specific configuration (workflow.sessions section).
   */
  async getSessionSettings(projectId: string): Promise<{
    heartbeatIntervalSeconds: number;
    expiryMinutes: number;
    defaultAgentCapacity: number;
    allowMultipleAgents: boolean;
  }> {
    const config = await this.getEffectiveConfig(projectId);
    return config.workflow.sessions;
  }

  /**
   * Get quality configuration.
   */
  async getQualityConfig(projectId: string): Promise<EnginehausConfig['quality']> {
    const config = await this.getEffectiveConfig(projectId);
    return config.quality;
  }

  /**
   * Get context assembly configuration.
   */
  async getContextConfig(projectId: string): Promise<EnginehausConfig['context']> {
    const config = await this.getEffectiveConfig(projectId);
    return config.context;
  }

  /**
   * Get git configuration.
   */
  async getGitConfig(projectId: string): Promise<EnginehausConfig['git']> {
    const config = await this.getEffectiveConfig(projectId);
    return config.git;
  }

  /**
   * Get workflow configuration.
   */
  async getWorkflowConfig(projectId: string): Promise<EnginehausConfig['workflow']> {
    const config = await this.getEffectiveConfig(projectId);
    return config.workflow;
  }

  // ============================================================================
  // Configuration Updates
  // ============================================================================

  /**
   * Update project configuration (stored in database).
   */
  async updateProjectConfig(
    projectId: string,
    updates: Partial<EnginehausConfig>,
    options: { changedBy?: string; reason?: string } = {}
  ): Promise<void> {
    const existing = await this.loadProjectConfig(projectId);
    const current = existing || DEFAULT_CONFIG;

    // Get old value for audit
    const oldConfig = { ...current };

    // Merge updates
    const updated = deepMerge(current, updates);

    // Save to database
    await this.storage.saveProjectConfig(projectId, updated as unknown as Record<string, unknown>, {
      source: 'database',
    });

    // Log the change
    await this.storage.logConfigChange({
      scope: 'project',
      scopeId: projectId,
      changeType: existing ? 'update' : 'create',
      oldValue: oldConfig,
      newValue: updated,
      changedBy: options.changedBy,
      reason: options.reason,
    });

    // Invalidate cache
    this.invalidateCache(projectId);
  }

  /**
   * Set a specific configuration value.
   */
  async setConfigValue(
    projectId: string,
    path: string,
    value: unknown,
    options: { changedBy?: string; reason?: string } = {}
  ): Promise<void> {
    const current = await this.loadProjectConfig(projectId) || DEFAULT_CONFIG;
    const oldValue = getConfigValue(current, path);
    const updated = setConfigValue(current, path, value);

    await this.storage.saveProjectConfig(projectId, updated as unknown as Record<string, unknown>, {
      source: 'database',
    });

    await this.storage.logConfigChange({
      scope: 'project',
      scopeId: projectId,
      changeType: 'update',
      configPath: path,
      oldValue,
      newValue: value,
      changedBy: options.changedBy,
      reason: options.reason,
    });

    this.invalidateCache(projectId);
  }

  /**
   * Set session-level configuration overrides.
   */
  async setSessionOverrides(
    sessionId: string,
    overrides: Partial<EnginehausConfig>,
    expiresInMinutes?: number
  ): Promise<void> {
    await this.storage.setSessionConfig(sessionId, overrides as Record<string, unknown>, expiresInMinutes);
    // Invalidate all caches that might include this session
    this.configCache.clear();
  }

  /**
   * Clear session-level configuration overrides.
   */
  async clearSessionOverrides(sessionId: string): Promise<void> {
    await this.storage.clearSessionConfig(sessionId);
    this.configCache.clear();
  }

  /**
   * Reset project config to defaults.
   */
  async resetProjectConfig(
    projectId: string,
    options: { changedBy?: string; reason?: string } = {}
  ): Promise<void> {
    const oldConfig = await this.loadProjectConfig(projectId);

    await this.storage.saveProjectConfig(projectId, DEFAULT_CONFIG as unknown as Record<string, unknown>, {
      source: 'default',
    });

    if (oldConfig) {
      await this.storage.logConfigChange({
        scope: 'project',
        scopeId: projectId,
        changeType: 'reset',
        oldValue: oldConfig,
        newValue: DEFAULT_CONFIG,
        changedBy: options.changedBy,
        reason: options.reason || 'Reset to defaults',
      });
    }

    this.invalidateCache(projectId);
  }

  // ============================================================================
  // File Synchronization
  // ============================================================================

  /**
   * Sync configuration from a file.
   * Returns the loaded config and any warnings/errors.
   */
  async syncFromFile(
    projectId: string,
    filePath?: string,
    options: { changedBy?: string } = {}
  ): Promise<{
    success: boolean;
    config?: EnginehausConfig;
    errors: string[];
    warnings: string[];
    fileHash?: string;
  }> {
    // Get project to find root path
    const project = await this.storage.getProject(projectId);
    if (!project && !filePath) {
      return {
        success: false,
        errors: ['Project not found and no file path provided'],
        warnings: [],
      };
    }

    // Find config file
    const targetPath = filePath || findConfigFile(project?.rootPath || '.');
    if (!targetPath) {
      return {
        success: false,
        errors: ['No configuration file found'],
        warnings: ['Looked for: enginehaus.config.json, enginehaus.json, .enginehaus.json, .enginehaus/config.json'],
      };
    }

    // Load from file
    const result = await loadConfigFromFile(targetPath);

    if (result.errors.length > 0 && result.source === 'default') {
      return {
        success: false,
        errors: result.errors,
        warnings: result.warnings,
      };
    }

    // Get old config for audit
    const oldConfig = await this.loadProjectConfig(projectId);

    // Save to database
    await this.storage.saveProjectConfig(projectId, result.config as unknown as Record<string, unknown>, {
      source: 'file',
      filePath: result.filePath,
      fileHash: result.fileHash,
    });

    // Log the sync
    await this.storage.logConfigChange({
      scope: 'project',
      scopeId: projectId,
      changeType: 'sync',
      oldValue: oldConfig,
      newValue: result.config,
      changedBy: options.changedBy || 'file-sync',
      reason: `Synced from ${result.filePath}`,
    });

    this.invalidateCache(projectId);

    return {
      success: true,
      config: result.config,
      errors: result.errors,
      warnings: result.warnings,
      fileHash: result.fileHash,
    };
  }

  /**
   * Check if file config is newer than database config.
   */
  async isFileNewerThanDatabase(projectId: string, filePath?: string): Promise<{
    fileExists: boolean;
    needsSync: boolean;
    currentHash?: string;
    fileHash?: string;
  }> {
    const project = await this.storage.getProject(projectId);
    const targetPath = filePath || findConfigFile(project?.rootPath || '.');

    if (!targetPath) {
      return { fileExists: false, needsSync: false };
    }

    const dbConfig = await this.storage.getProjectConfig(projectId);
    const fileResult = await loadConfigFromFile(targetPath);

    return {
      fileExists: fileResult.source === 'file',
      needsSync: fileResult.fileHash !== dbConfig?.fileHash,
      currentHash: dbConfig?.fileHash,
      fileHash: fileResult.fileHash,
    };
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Invalidate cache for a specific project.
   */
  invalidateCache(projectId: string): void {
    for (const key of this.configCache.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.configCache.delete(key);
      }
    }
  }

  /**
   * Clear all cached configurations.
   */
  clearCache(): void {
    this.configCache.clear();
  }

  // ============================================================================
  // Audit Log Access
  // ============================================================================

  /**
   * Get configuration change history.
   */
  async getConfigHistory(options: {
    projectId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Array<{
    id: string;
    scope: string;
    scopeId: string;
    changeType: string;
    configPath?: string;
    oldValue?: unknown;
    newValue?: unknown;
    changedBy?: string;
    changedAt: Date;
    reason?: string;
  }>> {
    return this.storage.getConfigAuditLog({
      scope: 'project',
      scopeId: options.projectId,
      limit: options.limit,
      offset: options.offset,
    });
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  /**
   * Load project configuration from database or file.
   */
  private _loadingProjects = new Set<string>();

  private async loadProjectConfig(projectId: string): Promise<EnginehausConfig | null> {
    // First check database
    const dbConfig = await this.storage.getProjectConfig(projectId);

    if (dbConfig) {
      // If auto-sync is enabled and config came from file, check for updates
      // Guard against re-entrant calls (syncFromFile -> loadProjectConfig -> syncFromFile...)
      if (this.autoSyncFromFile && dbConfig.source === 'file' && dbConfig.filePath && !this._loadingProjects.has(projectId)) {
        this._loadingProjects.add(projectId);
        try {
          const syncCheck = await this.isFileNewerThanDatabase(projectId, dbConfig.filePath);
          if (syncCheck.needsSync) {
            const syncResult = await this.syncFromFile(projectId, dbConfig.filePath);
            if (syncResult.success && syncResult.config) {
              return syncResult.config;
            }
          }
        } finally {
          this._loadingProjects.delete(projectId);
        }
      }
      return dbConfig.configJson as unknown as EnginehausConfig;
    }

    // No database config, try to find and load from file
    const project = await this.storage.getProject(projectId);
    if (project?.rootPath) {
      const configPath = findConfigFile(project.rootPath);
      if (configPath) {
        const fileResult = await loadConfigFromFile(configPath);
        if (fileResult.source === 'file') {
          // Save to database for future use
          await this.storage.saveProjectConfig(projectId, fileResult.config as unknown as Record<string, unknown>, {
            source: 'file',
            filePath: fileResult.filePath,
            fileHash: fileResult.fileHash,
          });
          return fileResult.config;
        }
      }
    }

    return null;
  }
}
