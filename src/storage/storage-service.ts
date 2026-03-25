import {
  UnifiedTask,
  StrategicDecision,
  UXRequirements,
  TechnicalPlan,
  CoordinationSession,
  CoordinationEvent,
  TaskStatus,
} from '../coordination/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * StorageService Interface
 * 
 * Abstract interface for storage - can be implemented with:
 * - JSON files (for local/simple deployments)
 * - PostgreSQL (for production)
 * - SQLite (for embedded deployments)
 */
export interface StorageService {
  // Strategic Decisions
  saveStrategicDecision(decision: StrategicDecision): Promise<void>;
  getStrategicDecision(id: string): Promise<StrategicDecision | null>;
  getRecentStrategicDecisions(limit: number): Promise<StrategicDecision[]>;

  // UX Requirements
  saveUXRequirements(requirements: UXRequirements): Promise<void>;
  getUXRequirements(id: string): Promise<UXRequirements | null>;
  getRecentUXRequirements(limit: number): Promise<UXRequirements[]>;

  // Technical Plans
  saveTechnicalPlan(plan: TechnicalPlan): Promise<void>;
  getTechnicalPlan(id: string): Promise<TechnicalPlan | null>;
  getRecentTechnicalPlans(limit: number): Promise<TechnicalPlan[]>;

  // Tasks
  saveTask(task: UnifiedTask): Promise<void>;
  getTask(id: string): Promise<UnifiedTask | null>;
  getTasks(filter: {
    status?: TaskStatus;
    priority?: 'critical' | 'high' | 'medium' | 'low';
  }): Promise<UnifiedTask[]>;
  getTasksCompletedSince(since: Date): Promise<UnifiedTask[]>;

  // Sessions
  saveSession(session: CoordinationSession): Promise<void>;
  getSession(id: string): Promise<CoordinationSession | null>;
  getActiveSessions(): Promise<CoordinationSession[]>;

  // Events
  saveEvent(event: CoordinationEvent): Promise<void>;
  getRecentEvents(limit: number): Promise<CoordinationEvent[]>;

  // Project metadata
  getProjectMetadata(): Promise<Record<string, any>>;
  saveProjectMetadata(metadata: Record<string, any>): Promise<void>;
}

/**
 * JSONStorageService
 * 
 * Simple file-based storage implementation using JSON files.
 * Good for local development and small deployments.
 */
export class JSONStorageService implements StorageService {
  private dataDir: string;
  private cache: {
    strategicDecisions: Map<string, StrategicDecision>;
    uxRequirements: Map<string, UXRequirements>;
    technicalPlans: Map<string, TechnicalPlan>;
    tasks: Map<string, UnifiedTask>;
    sessions: Map<string, CoordinationSession>;
    events: CoordinationEvent[];
    projectMetadata: Record<string, any>;
  };

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    this.cache = {
      strategicDecisions: new Map(),
      uxRequirements: new Map(),
      technicalPlans: new Map(),
      tasks: new Map(),
      sessions: new Map(),
      events: [],
      projectMetadata: {},
    };
  }

  async initialize(): Promise<void> {
    // Create data directory if it doesn't exist
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'strategic'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'ux'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'technical'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'tasks'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'events'), { recursive: true });

    // Load existing data into cache
    await this.loadCache();
  }

  private async loadCache(): Promise<void> {
    // Load strategic decisions
    await this.loadDirectory(
      path.join(this.dataDir, 'strategic'),
      this.cache.strategicDecisions
    );

    // Load UX requirements
    await this.loadDirectory(
      path.join(this.dataDir, 'ux'),
      this.cache.uxRequirements
    );

    // Load technical plans
    await this.loadDirectory(
      path.join(this.dataDir, 'technical'),
      this.cache.technicalPlans
    );

    // Load tasks
    await this.loadDirectory(
      path.join(this.dataDir, 'tasks'),
      this.cache.tasks
    );

    // Load sessions
    await this.loadDirectory(
      path.join(this.dataDir, 'sessions'),
      this.cache.sessions
    );

    // Load events
    const eventsDir = path.join(this.dataDir, 'events');
    try {
      const files = await fs.readdir(eventsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(eventsDir, file), 'utf-8');
          const event = this.deserialize(content);
          this.cache.events.push(event);
        }
      }
      // Sort events by timestamp
      this.cache.events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      // Directory doesn't exist or is empty
    }

    // Load project metadata
    try {
      const metadataPath = path.join(this.dataDir, 'project-metadata.json');
      const content = await fs.readFile(metadataPath, 'utf-8');
      this.cache.projectMetadata = this.deserialize(content);
    } catch (error) {
      // File doesn't exist - use empty metadata
      this.cache.projectMetadata = {};
    }
  }

  private async loadDirectory<T extends { id: string }>(
    dir: string,
    cache: Map<string, T>
  ): Promise<void> {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          const item = this.deserialize(content);
          cache.set(item.id, item);
        }
      }
    } catch (error) {
      // Directory doesn't exist or is empty
    }
  }

  private serialize(obj: any): string {
    return JSON.stringify(obj, null, 2);
  }

  private deserialize(json: string): any {
    return JSON.parse(json, (key, value) => {
      // Convert ISO date strings back to Date objects
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return new Date(value);
      }
      return value;
    });
  }

  // ========================================================================
  // Strategic Decisions
  // ========================================================================

  async saveStrategicDecision(decision: StrategicDecision): Promise<void> {
    this.cache.strategicDecisions.set(decision.id, decision);
    const filePath = path.join(this.dataDir, 'strategic', `${decision.id}.json`);
    await fs.writeFile(filePath, this.serialize(decision));
  }

  async getStrategicDecision(id: string): Promise<StrategicDecision | null> {
    return this.cache.strategicDecisions.get(id) || null;
  }

  async getRecentStrategicDecisions(limit: number): Promise<StrategicDecision[]> {
    const decisions = Array.from(this.cache.strategicDecisions.values());
    decisions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return decisions.slice(0, limit);
  }

  // ========================================================================
  // UX Requirements
  // ========================================================================

  async saveUXRequirements(requirements: UXRequirements): Promise<void> {
    this.cache.uxRequirements.set(requirements.id, requirements);
    const filePath = path.join(this.dataDir, 'ux', `${requirements.id}.json`);
    await fs.writeFile(filePath, this.serialize(requirements));
  }

  async getUXRequirements(id: string): Promise<UXRequirements | null> {
    return this.cache.uxRequirements.get(id) || null;
  }

  async getRecentUXRequirements(limit: number): Promise<UXRequirements[]> {
    const requirements = Array.from(this.cache.uxRequirements.values());
    requirements.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return requirements.slice(0, limit);
  }

  // ========================================================================
  // Technical Plans
  // ========================================================================

  async saveTechnicalPlan(plan: TechnicalPlan): Promise<void> {
    this.cache.technicalPlans.set(plan.id, plan);
    const filePath = path.join(this.dataDir, 'technical', `${plan.id}.json`);
    await fs.writeFile(filePath, this.serialize(plan));
  }

  async getTechnicalPlan(id: string): Promise<TechnicalPlan | null> {
    return this.cache.technicalPlans.get(id) || null;
  }

  async getRecentTechnicalPlans(limit: number): Promise<TechnicalPlan[]> {
    const plans = Array.from(this.cache.technicalPlans.values());
    plans.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return plans.slice(0, limit);
  }

  // ========================================================================
  // Tasks
  // ========================================================================

  async saveTask(task: UnifiedTask): Promise<void> {
    this.cache.tasks.set(task.id, task);
    const filePath = path.join(this.dataDir, 'tasks', `${task.id}.json`);
    await fs.writeFile(filePath, this.serialize(task));
  }

  async getTask(id: string): Promise<UnifiedTask | null> {
    return this.cache.tasks.get(id) || null;
  }

  async getTasks(filter: {
    status?: TaskStatus;
    priority?: 'critical' | 'high' | 'medium' | 'low';
  }): Promise<UnifiedTask[]> {
    let tasks = Array.from(this.cache.tasks.values());

    if (filter.status) {
      tasks = tasks.filter(t => t.status === filter.status);
    }

    if (filter.priority) {
      tasks = tasks.filter(t => t.priority === filter.priority);
    }

    // Sort by priority and creation date
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    tasks.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return tasks;
  }

  async getTasksCompletedSince(since: Date): Promise<UnifiedTask[]> {
    const tasks = Array.from(this.cache.tasks.values());
    return tasks.filter(
      t =>
        t.status === 'completed' &&
        t.implementation?.completedAt &&
        t.implementation.completedAt >= since
    );
  }

  // ========================================================================
  // Sessions
  // ========================================================================

  async saveSession(session: CoordinationSession): Promise<void> {
    this.cache.sessions.set(session.id, session);
    const filePath = path.join(this.dataDir, 'sessions', `${session.id}.json`);
    await fs.writeFile(filePath, this.serialize(session));
  }

  async getSession(id: string): Promise<CoordinationSession | null> {
    return this.cache.sessions.get(id) || null;
  }

  async getActiveSessions(): Promise<CoordinationSession[]> {
    const sessions = Array.from(this.cache.sessions.values());
    return sessions.filter(s => s.status === 'active');
  }

  // ========================================================================
  // Events
  // ========================================================================

  async saveEvent(event: CoordinationEvent): Promise<void> {
    this.cache.events.unshift(event); // Add to beginning
    
    // Keep only last 1000 events in cache
    if (this.cache.events.length > 1000) {
      this.cache.events = this.cache.events.slice(0, 1000);
    }

    // Save to file with timestamp-based name for easy chronological access
    const timestamp = event.timestamp.toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(this.dataDir, 'events', `${timestamp}-${event.id}.json`);
    await fs.writeFile(filePath, this.serialize(event));
  }

  async getRecentEvents(limit: number): Promise<CoordinationEvent[]> {
    return this.cache.events.slice(0, limit);
  }

  // ========================================================================
  // Project Metadata
  // ========================================================================

  async getProjectMetadata(): Promise<Record<string, any>> {
    return this.cache.projectMetadata;
  }

  async saveProjectMetadata(metadata: Record<string, any>): Promise<void> {
    this.cache.projectMetadata = metadata;
    const filePath = path.join(this.dataDir, 'project-metadata.json');
    await fs.writeFile(filePath, this.serialize(metadata));
  }
}
