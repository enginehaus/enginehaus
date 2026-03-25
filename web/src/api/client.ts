/**
 * Enginehaus API Client
 *
 * Typed client for the REST API
 */

// Uses Vite proxy in dev, or relative path in production
const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Types
export interface Project {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  domain: string;
  techStack?: string[];
  status: 'active' | 'archived' | 'paused';
  createdAt: string;
  updatedAt: string;
}

export interface PhaseProgress {
  currentPhase: number;
  completedPhases: number[];
  skippedPhases: number[];
  phaseNotes?: Record<number, string>;
  /** Commit SHA recorded at each phase completion - links phases to specific commits */
  phaseCommits?: Record<number, string>;
}

export interface ImplementationTracking {
  sessionId?: string;
  gitBranch?: string;
  startedAt?: string;
  completedAt?: string;
  phaseProgress?: PhaseProgress;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'ready' | 'in-progress' | 'blocked' | 'completed';
  projectId: string;
  files?: string[];
  blockedBy?: string[];  // Task IDs that block this task
  blocks?: string[];     // Task IDs that this task blocks
  implementation?: ImplementationTracking;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  taskId: string;
  agentId: string;
  status: 'active' | 'completed' | 'expired';
  startedAt: string;
  lastHeartbeat: string;
  projectId: string;
}

export interface Decision {
  id: string;
  decision: string;
  rationale: string;
  impact?: string;
  category?: string;
  taskId?: string;
  projectId: string;
  createdAt: string;
}

export interface Stats {
  tasks: {
    total: number;
    byStatus: {
      ready: number;
      'in-progress': number;
      completed: number;
      blocked: number;
    };
    byPriority: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
  sessions: {
    active: number;
  };
  projects: {
    total: number;
    activeId: string | null;
  };
}

export type AuditEventType =
  | 'task.created' | 'task.updated' | 'task.status_changed'
  | 'task.assigned' | 'task.completed' | 'task.deleted'
  | 'session.started' | 'session.heartbeat' | 'session.expired'
  | 'session.completed' | 'session.force_claimed'
  | 'project.created' | 'project.updated' | 'project.deleted' | 'project.activated'
  | 'dependency.added' | 'dependency.removed' | 'task.blocked' | 'task.unblocked'
  | 'phase.started' | 'phase.completed' | 'phase.skipped'
  | 'quality.gate_passed' | 'quality.gate_failed' | 'quality.check_run'
  | 'system.health_check' | 'system.migration' | 'system.backup'
  | 'error.tool_failed' | 'error.validation_failed' | 'error.internal';

export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  actorId: string;
  actorType: 'user' | 'agent' | 'system';
  projectId: string;
  resourceType: 'task' | 'session' | 'project' | 'dependency' | 'phase' | 'quality' | 'system' | 'error';
  resourceId: string;
  action: string;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: Record<string, unknown>;
}

export type ArtifactType = 'design' | 'doc' | 'code' | 'test' | 'screenshot' | 'url' | 'reference' | 'other';

// Configuration types
export interface ConfigValidationIssue {
  level: 'error' | 'warning' | 'info';
  path: string;
  message: string;
}

export interface ConfigHistoryEntry {
  id: string;
  scope: string;
  scopeId: string;
  changeType: string;
  configPath?: string;
  oldValue?: unknown;
  newValue?: unknown;
  changedBy?: string;
  changedAt: string;
  reason?: string;
}

export type PhaseRole = 'pm' | 'ux' | 'tech-lead' | 'developer' | 'qa' | 'human';

export interface PhaseDefinition {
  id: number;
  name: string;
  shortName: string;
  description?: string;
  commitPrefix: string;
  requiredOutputs?: string[];
  canSkip: boolean;
  roleSet?: PhaseRole[];
  primaryRole?: PhaseRole;
}

export interface QualityGateConfig {
  required: boolean;
  blocking: boolean;
  command?: string;
  timeoutSeconds?: number;
}

export interface CustomQualityGate {
  name: string;
  command: string;
  required: boolean;
  blocking: boolean;
  timeoutSeconds?: number;
}

export interface QualityGatesConfig {
  compilation: QualityGateConfig;
  linting: QualityGateConfig;
  tests: QualityGateConfig;
  coverage: QualityGateConfig;
  custom?: CustomQualityGate[];
}

// Integration configuration types
export interface LinearIntegrationConfig {
  enabled: boolean;
  apiKey: string;
  teamId?: string;
  syncInterval: number;
  bidirectional: boolean;
  statusMapping: Record<string, string>;
}

export interface JiraIntegrationConfig {
  enabled: boolean;
  host?: string;
  email?: string;
  apiToken: string;
  projectKey?: string;
  syncInterval: number;
  bidirectional: boolean;
  statusMapping?: Record<string, string>;
}

export interface GitHubIntegrationConfig {
  enabled: boolean;
  token: string;
  owner?: string;
  repo?: string;
  autoCreatePRs: boolean;
  prLabels: string[];
}

export interface SlackIntegrationConfig {
  enabled: boolean;
  webhookUrl: string;
  channel?: string;
  notifications: Record<string, boolean>;
}

export interface WebhookIntegrationConfig {
  enabled: boolean;
  url: string;
  secret?: string;
  events: string[];
}

export interface IntegrationsConfig {
  linear?: LinearIntegrationConfig;
  jira?: JiraIntegrationConfig;
  github?: GitHubIntegrationConfig;
  slack?: SlackIntegrationConfig;
  webhook?: WebhookIntegrationConfig;
}

export type IntegrationStatus = 'connected' | 'error' | 'unconfigured' | 'disabled';

export interface IntegrationTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

// Context configuration types
export interface ContextAssemblyConfig {
  maxFileSizeKb: number;
  maxLinesPerFile: number;
  includeHiddenFiles: boolean;
  binaryExtensions: string[];
  excludePatterns: string[];
}

export interface ContextLimitsConfig {
  recentDecisions: number;
  recentUxRequirements: number;
  recentTechnicalPlans: number;
  readyTasksPreview: number;
  sessionHistoryDepth: number;
}

export interface TokenBudgetsConfig {
  minimal: number;
  standard: number;
  full: number;
}

export interface ContextConfig {
  assembly: ContextAssemblyConfig;
  limits: ContextLimitsConfig;
  tokenBudgets: TokenBudgetsConfig;
}

export interface Artifact {
  id: string;
  taskId: string;
  projectId: string;
  type: ArtifactType;
  uri: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  content?: string;
  contentType?: string;
  contentSize?: number;
  originChatUri?: string;
  createdAt: string;
}

// API Methods
export const api = {
  // Health
  health: () => request<{ status: string; timestamp: string }>('/health'),

  // Projects
  projects: {
    list: () => request<{ projects: Project[] }>('/projects'),
    get: (id: string) => request<{ project: Project }>(`/projects/${id}`),
    getActive: () => request<{ project: Project | null }>('/projects/active'),
    create: (data: Partial<Project>) => request<{ success: boolean; project: Project }>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    update: (id: string, data: Partial<Project>) => request<{ success: boolean; project: Project }>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    delete: (id: string) => request<{ success: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
    activate: (id: string) => request<{ success: boolean; project: Project }>(`/projects/${id}/activate`, { method: 'POST' }),
  },

  // Tasks
  tasks: {
    list: (params?: { status?: string; priority?: string; projectId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ tasks: Task[]; count: number }>(`/tasks${query ? `?${query}` : ''}`);
    },
    get: (id: string) => request<{ task: Task }>(`/tasks/${id}`),
    getNext: (params?: { priority?: string; projectId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ task: Task | null }>(`/tasks/next${query ? `?${query}` : ''}`);
    },
    create: (data: Partial<Task>) => request<{ success: boolean; task: Task }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    update: (id: string, data: Partial<Task>) => request<{ success: boolean; task: Task }>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    delete: (id: string) => request<{ success: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
    claim: (id: string, agentId?: string) => request<{ success: boolean; sessionId: string; task: Task }>(`/tasks/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    }),
    release: (id: string, completed?: boolean) => request<{ success: boolean; task: Task }>(`/tasks/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ completed }),
    }),
    complete: (id: string, summary?: string) => request<{ success: boolean; task: Task }>(`/tasks/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ summary }),
    }),
  },

  // Sessions
  sessions: {
    list: (params?: { projectId?: string; status?: string; agentId?: string; activeOnly?: boolean; limit?: number; offset?: number }) => {
      const query = new URLSearchParams();
      if (params?.projectId) query.set('projectId', params.projectId);
      if (params?.status) query.set('status', params.status);
      if (params?.agentId) query.set('agentId', params.agentId);
      if (params?.activeOnly !== undefined) query.set('activeOnly', String(params.activeOnly));
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      const queryStr = query.toString();
      return request<{ sessions: Session[]; count: number }>(`/sessions${queryStr ? `?${queryStr}` : ''}`);
    },
    get: (id: string) => request<{ session: Session }>(`/sessions/${id}`),
    heartbeat: (id: string) => request<{ success: boolean }>(`/sessions/${id}/heartbeat`, { method: 'POST' }),
  },

  // Decisions
  decisions: {
    list: (params?: { taskId?: string; category?: string; limit?: number; projectId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ decisions: Decision[]; count: number }>(`/decisions${query ? `?${query}` : ''}`);
    },
    get: (id: string) => request<{ decision: Decision }>(`/decisions/${id}`),
    create: (data: Partial<Decision>) => request<{ success: boolean; decisionId: string }>('/decisions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  },

  // Stats & Metrics
  stats: (projectId?: string) => {
    const query = projectId ? `?projectId=${projectId}` : '';
    return request<Stats>(`/stats${query}`);
  },
  metrics: (params?: { period?: string; projectId?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ metrics: unknown; period: string }>(`/metrics${query ? `?${query}` : ''}`);
  },

  // Events (in-memory, real-time)
  events: {
    list: (params?: { limit?: number; eventTypes?: string; since?: string; projectId?: string }) => {
      const query = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ events: AuditEvent[]; count: number }>(`/events${query ? `?${query}` : ''}`);
    },
    stats: (since?: string) => {
      const query = since ? `?since=${since}` : '';
      return request<{ stats: Record<string, number>; subscriptionCount: number }>(`/events/stats${query}`);
    },
  },

  // Audit Log (persisted in SQLite)
  audit: {
    list: (params?: {
      eventTypes?: string;
      actorId?: string;
      projectId?: string;
      resourceType?: string;
      resourceId?: string;
      since?: string;
      until?: string;
      limit?: number;
      offset?: number;
    }) => {
      const query = new URLSearchParams();
      if (params?.eventTypes) query.set('eventTypes', params.eventTypes);
      if (params?.actorId) query.set('actorId', params.actorId);
      if (params?.projectId) query.set('projectId', params.projectId);
      if (params?.resourceType) query.set('resourceType', params.resourceType);
      if (params?.resourceId) query.set('resourceId', params.resourceId);
      if (params?.since) query.set('since', params.since);
      if (params?.until) query.set('until', params.until);
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      const queryStr = query.toString();
      return request<{ entries: AuditEvent[]; count: number }>(`/audit${queryStr ? `?${queryStr}` : ''}`);
    },
    summary: (params?: { projectId?: string; since?: string; until?: string }) => {
      const query = new URLSearchParams();
      if (params?.projectId) query.set('projectId', params.projectId);
      if (params?.since) query.set('since', params.since);
      if (params?.until) query.set('until', params.until);
      const queryStr = query.toString();
      return request<{
        totalEvents: number;
        eventsByType: Record<string, number>;
        eventsByActor: Record<string, number>;
        eventsByResource: Record<string, number>;
        timeRange: { earliest: string | null; latest: string | null };
      }>(`/audit/summary${queryStr ? `?${queryStr}` : ''}`);
    },
  },

  // Artifacts
  artifacts: {
    listForProject: (projectId: string, type?: ArtifactType) => {
      const query = type ? `?type=${type}` : '';
      return request<{ artifacts: Artifact[]; count: number }>(`/projects/${projectId}/artifacts${query}`);
    },
    listForTask: (taskId: string, type?: ArtifactType) => {
      const query = type ? `?type=${type}` : '';
      return request<{ artifacts: Artifact[]; count: number }>(`/tasks/${taskId}/artifacts${query}`);
    },
    get: (id: string) => request<{ artifact: Artifact }>(`/artifacts/${id}`),
    create: (taskId: string, data: Partial<Artifact>) =>
      request<{ success: boolean; artifact: Artifact }>(`/tasks/${taskId}/artifacts`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Artifact>) =>
      request<{ success: boolean; artifact: Artifact }>(`/artifacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => request<{ success: boolean }>(`/artifacts/${id}`, { method: 'DELETE' }),
  },

  // Configuration
  config: {
    getDefaults: (path?: string) => {
      const query = path ? `?path=${path}` : '';
      return request<{ config?: unknown; path?: string; value?: unknown }>(`/config/defaults${query}`);
    },
    get: (projectId: string, path?: string, sessionId?: string) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      if (sessionId) params.set('sessionId', sessionId);
      const query = params.toString();
      return request<{ projectId: string; config?: unknown; path?: string; value?: unknown }>(
        `/projects/${projectId}/config${query ? `?${query}` : ''}`
      );
    },
    update: (projectId: string, data: { path?: string; value?: unknown; updates?: unknown; reason?: string }) =>
      request<{ success: boolean; projectId: string; path?: string; value?: unknown; config?: unknown }>(
        `/projects/${projectId}/config`,
        { method: 'PATCH', body: JSON.stringify(data) }
      ),
    reset: (projectId: string, reason?: string) =>
      request<{ success: boolean; message: string }>(
        `/projects/${projectId}/config/reset`,
        { method: 'POST', body: JSON.stringify({ reason }) }
      ),
    sync: (projectId: string, filePath?: string) =>
      request<{ success: boolean; fileHash?: string; errors?: string[]; warnings?: string[] }>(
        `/projects/${projectId}/config/sync`,
        { method: 'POST', body: JSON.stringify({ filePath }) }
      ),
    validate: (projectId: string) =>
      request<{ valid: boolean; issues: ConfigValidationIssue[] }>(
        `/projects/${projectId}/config/validate`,
        { method: 'POST' }
      ),
    getHistory: (projectId: string, limit?: number, offset?: number) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (offset) params.set('offset', String(offset));
      const query = params.toString();
      return request<{ projectId: string; history: ConfigHistoryEntry[] }>(
        `/projects/${projectId}/config/history${query ? `?${query}` : ''}`
      );
    },
    getPhases: (projectId: string) =>
      request<{ projectId: string; phases: PhaseDefinition[] }>(`/projects/${projectId}/config/phases`),
    updatePhases: (projectId: string, phases: PhaseDefinition[]) =>
      request<{ success: boolean; projectId: string; path: string; value: PhaseDefinition[] }>(
        `/projects/${projectId}/config`,
        { method: 'PATCH', body: JSON.stringify({ path: 'workflow.phases.definitions', value: phases }) }
      ),
    getQuality: (projectId: string) =>
      request<{ projectId: string; quality: { gates: QualityGatesConfig } }>(`/projects/${projectId}/config/quality`),
    updateQualityGates: (projectId: string, gates: QualityGatesConfig) =>
      request<{ success: boolean; projectId: string; path: string; value: QualityGatesConfig }>(
        `/projects/${projectId}/config`,
        { method: 'PATCH', body: JSON.stringify({ path: 'quality.gates', value: gates }) }
      ),
    getGit: (projectId: string) =>
      request<{ projectId: string; git: unknown }>(`/projects/${projectId}/config/git`),
    getSessions: (projectId: string) =>
      request<{ projectId: string; sessions: unknown }>(`/projects/${projectId}/config/sessions`),
    getIntegrations: (projectId: string) =>
      request<{ projectId: string; integrations: IntegrationsConfig }>(`/projects/${projectId}/config/integrations`),
    updateIntegrations: (projectId: string, integrations: IntegrationsConfig) =>
      request<{ success: boolean; projectId: string; path: string; value: IntegrationsConfig }>(
        `/projects/${projectId}/config`,
        { method: 'PATCH', body: JSON.stringify({ path: 'integrations', value: integrations }) }
      ),
    testIntegration: (projectId: string, integration: string) =>
      request<IntegrationTestResult>(
        `/projects/${projectId}/integrations/${integration}/test`,
        { method: 'POST' }
      ),
    getContext: (projectId: string) =>
      request<{ projectId: string; context: ContextConfig }>(`/projects/${projectId}/config/context`),
    updateContext: (projectId: string, context: ContextConfig) =>
      request<{ success: boolean; projectId: string; path: string; value: ContextConfig }>(
        `/projects/${projectId}/config`,
        { method: 'PATCH', body: JSON.stringify({ path: 'context', value: context }) }
      ),
  },

  // Wheelhaus - Real-time Control Room
  wheelhaus: {
    getSnapshot: () => request<WheelhausSnapshot>('/wheelhaus'),
    getSessions: () => request<{ sessions: ActiveSessionView[] }>('/wheelhaus/sessions'),
    getDecisions: (limit?: number) => request<{ decisions: DecisionStreamItem[] }>(
      `/wheelhaus/decisions${limit ? `?limit=${limit}` : ''}`
    ),
    getTasks: () => request<{ tasks: TaskGraphNode[] }>('/wheelhaus/tasks'),
    getHealth: () => request<{ health: ContextHealthMetrics }>('/wheelhaus/health'),
    getWsStats: () => request<{ clientCount: number; clients: { id: string; connectedAt: string; subscriptions: string[] }[] }>('/wheelhaus/ws/stats'),
    getSummary: (refresh?: boolean) => request<AISummaryResponse>(
      `/wheelhaus/summary${refresh ? '?refresh=true' : ''}`
    ),
    chat: (message: string) => request<ChatResponse>('/wheelhaus/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  },
};

// Wheelhaus Types
export interface ActiveSessionView {
  sessionId: string;
  agentId: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  lastHeartbeat: string;
  durationSeconds: number;
  currentPhase?: string;
  phaseNumber?: number;
}

export interface DecisionStreamItem {
  id: string;
  decision: string;
  rationale: string;
  category?: string;
  taskId?: string;
  timestamp: string;
  agentId?: string;
}

export interface TaskGraphNode {
  id: string;
  title: string;
  status: Task['status'];
  priority: Task['priority'];
  assignedTo?: string;
  blockedBy: string[];
  blocks: string[];
  currentPhase?: string;
  phaseNumber?: number;
  lastUpdated: string;
}

export interface ContextHealthMetrics {
  activeSessions: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksReady: number;
  decisionsLast24h: number;
  qualityGatesPassed: number;
  qualityGatesFailed: number;
  avgSessionDurationMinutes: number;
  lastEventAt: string | null;
  eventRate: number;
}

export interface WheelhausSnapshot {
  sessions: ActiveSessionView[];
  decisions: DecisionStreamItem[];
  tasks: TaskGraphNode[];
  health: ContextHealthMetrics;
  lastMaterializedAt: string;
}

export interface AISummaryResponse {
  summary: string;
  generatedAt: string;
  cached: boolean;
}

export interface ChatResponse {
  message: string;
  data?: unknown;
  timestamp: string;
}
