/**
 * Session Health Checker
 *
 * Provides automatic periodic health checks for active sessions:
 * - Expires stale sessions based on heartbeat timeout
 * - Frees up tasks from abandoned sessions
 * - Syncs in-memory session state with SQLite
 * - Database health monitoring and WAL checkpointing
 * - Configurable check interval
 */

import { SQLiteStorageService } from '../storage/sqlite-storage-service.js';
import { CoordinationEngine } from './engine.js';

export interface HealthCheckConfig {
  /** Interval between health checks in milliseconds (default: 60000 = 1 minute) */
  checkIntervalMs: number;
  /** Session timeout in milliseconds (default: 300000 = 5 minutes) */
  sessionTimeoutMs: number;
  /** Whether to log health check results */
  verbose: boolean;
  /** WAL size threshold in bytes before auto-checkpoint (default: 1MB) */
  walCheckpointThresholdBytes?: number;
  /** Whether to auto-reconnect on database errors (default: true) */
  autoReconnect?: boolean;
}

export interface HealthCheckResult {
  timestamp: Date;
  expiredSessions: number;
  activeSessions: number;
  healthyProjects: number;
  issues: string[];
  // Database health info
  dbHealthy?: boolean;
  walSizeBytes?: number;
  walCheckpointed?: boolean;
  dbReconnected?: boolean;
}

export class SessionHealthChecker {
  private storage: SQLiteStorageService;
  private engine: CoordinationEngine | null;
  private config: HealthCheckConfig;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastResult: HealthCheckResult | null = null;
  private consecutiveDbErrors: number = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 3;

  constructor(
    storage: SQLiteStorageService,
    config?: Partial<HealthCheckConfig>,
    engine?: CoordinationEngine
  ) {
    this.storage = storage;
    this.engine = engine ?? null;
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 60 * 1000, // 1 minute
      sessionTimeoutMs: config?.sessionTimeoutMs ?? 5 * 60 * 1000, // 5 minutes
      verbose: config?.verbose ?? false,
      walCheckpointThresholdBytes: config?.walCheckpointThresholdBytes ?? 1024 * 1024, // 1MB
      autoReconnect: config?.autoReconnect ?? true,
    };
  }

  /**
   * Start periodic health checks
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Run immediately on start
    this.runCheck().catch(err => {
      if (this.config.verbose) {
        console.error('Health check error:', err);
      }
    });

    // Schedule periodic checks
    this.intervalHandle = setInterval(() => {
      this.runCheck().catch(err => {
        if (this.config.verbose) {
          console.error('Health check error:', err);
        }
      });
    }, this.config.checkIntervalMs);

    if (this.config.verbose) {
      console.error(`Session health checker started (interval: ${this.config.checkIntervalMs}ms)`);
    }
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.isRunning = false;

    if (this.config.verbose) {
      console.error('Session health checker stopped');
    }
  }

  /**
   * Check if the health checker is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get the last health check result
   */
  getLastResult(): HealthCheckResult | null {
    return this.lastResult;
  }

  /**
   * Run a single health check
   */
  async runCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    let dbHealthy = true;
    let walSizeBytes = 0;
    let walCheckpointed = false;
    let dbReconnected = false;

    // First, check database health
    try {
      const healthResult = await this.storage.healthCheck();
      dbHealthy = healthResult.healthy;
      walSizeBytes = healthResult.details.walSize;

      if (!dbHealthy) {
        this.consecutiveDbErrors++;
        issues.push(`Database health check failed: ${healthResult.details.error}`);

        // Attempt reconnect if enabled and we've hit error threshold
        if (this.config.autoReconnect && this.consecutiveDbErrors >= this.MAX_CONSECUTIVE_ERRORS) {
          console.error(`Database unhealthy after ${this.consecutiveDbErrors} checks, attempting reconnect...`);
          const reconnected = await this.storage.reconnect();
          if (reconnected) {
            dbReconnected = true;
            this.consecutiveDbErrors = 0;
            console.error('Database reconnection successful');
          } else {
            issues.push('Database reconnection failed - manual restart may be required');
            console.error('Database reconnection failed');
          }
        }
      } else {
        this.consecutiveDbErrors = 0;
      }

      // Auto-checkpoint WAL if it's getting large
      if (dbHealthy && walSizeBytes > (this.config.walCheckpointThresholdBytes || 1024 * 1024)) {
        if (this.config.verbose) {
          console.error(`WAL size ${Math.round(walSizeBytes / 1024)}KB exceeds threshold, checkpointing...`);
        }
        const checkpointResult = await this.storage.checkpointWal('PASSIVE');
        walCheckpointed = checkpointResult.success;
        if (this.config.verbose && walCheckpointed) {
          console.error(`WAL checkpoint complete: ${checkpointResult.checkpointedFrames} frames`);
        }
      }
    } catch (error) {
      dbHealthy = false;
      this.consecutiveDbErrors++;
      issues.push(`Database check error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Only proceed with session checks if database is healthy
    let expiredCount = 0;
    let activeSessions = 0;
    let healthyProjects = 0;

    if (dbHealthy) {
      try {
        // Expire stale sessions in SQLite
        expiredCount = await this.storage.expireStaleSessions(this.config.sessionTimeoutMs);

        // Sync in-memory sessions with SQLite (remove expired sessions from memory)
        if (expiredCount > 0 && this.engine) {
          await this.engine.syncSessions();
        }

        if (expiredCount > 0 && this.config.verbose) {
          console.error(`Expired ${expiredCount} stale session(s)`);
        }

        // Get active sessions across all projects
        const projects = await this.storage.listProjects();
        let sessions: Awaited<ReturnType<typeof this.storage.getActiveSessions>> = [];
        for (const project of projects) {
          const projectSessions = await this.storage.getActiveSessions(project.id);
          sessions.push(...projectSessions);
        }
        activeSessions = sessions.length;

        // Check for any sessions that are close to expiring (warning threshold: 80% of timeout)
        const warningThreshold = this.config.sessionTimeoutMs * 0.8;
        const now = Date.now();

        for (const session of sessions) {
          const timeSinceHeartbeat = now - session.lastHeartbeat.getTime();
          if (timeSinceHeartbeat > warningThreshold) {
            issues.push(`Session ${session.id.substring(0, 8)} for task ${session.taskId.substring(0, 8)} may expire soon (${Math.round(timeSinceHeartbeat / 1000)}s since last heartbeat)`);
          }
        }

        // Count healthy projects
        healthyProjects = projects.filter(p => p.status === 'active').length;
      } catch (error) {
        issues.push(`Session check error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const result: HealthCheckResult = {
      timestamp: new Date(),
      expiredSessions: expiredCount,
      activeSessions,
      healthyProjects,
      issues,
      dbHealthy,
      walSizeBytes,
      walCheckpointed,
      dbReconnected,
    };

    this.lastResult = result;
    return result;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HealthCheckConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): HealthCheckConfig {
    return { ...this.config };
  }
}

/**
 * Create a health checker instance with default configuration
 */
export function createHealthChecker(
  storage: SQLiteStorageService,
  config?: Partial<HealthCheckConfig>,
  engine?: CoordinationEngine
): SessionHealthChecker {
  return new SessionHealthChecker(storage, config, engine);
}
