/**
 * Enginehaus Configuration Types
 * 
 * Comprehensive configuration schema supporting:
 * - Inheritance: Organization → Team → Project → User → Session
 * - Stakeholder personas with role-specific defaults
 * - All previously hardcoded values now configurable
 */

// ============================================================================
// Configuration Hierarchy
// ============================================================================

export type ConfigScope = 'organization' | 'team' | 'project' | 'user' | 'session';
export type ConfigSource = 'file' | 'database' | 'api' | 'default';

export interface ConfigMetadata {
  scope: ConfigScope;
  source: ConfigSource;
  version: string;
  lastModified: Date;
  modifiedBy?: string;
  fileHash?: string;
  inheritedFrom?: string[];
}

// ============================================================================
// Root Configuration
// ============================================================================

export interface DecisionConfig {
  categories?: string[];
}

export interface ProfileQualityGate {
  name: string;
  description: string;
  command?: string;
  manual?: boolean;
}

export interface EnginehausConfig {
  $schema?: string;
  version: string;

  project: ProjectConfigSection;
  organization?: OrganizationReference;
  team?: TeamReference;

  workflow: WorkflowConfig;
  quality: QualityConfig;
  git: GitConfig;
  context: ContextConfig;
  stakeholders: StakeholdersConfig;
  integrations: IntegrationsConfig;
  notifications: NotificationsConfig;
  ui: UIConfig;
  experimental: ExperimentalConfig;
  decisions?: DecisionConfig;
}

// ============================================================================
// Project Configuration
// ============================================================================

export interface ProjectConfigSection {
  name: string;
  slug: string;
  domain: ProjectDomain;
  techStack: string[];
  rootPath: string;
  description?: string;
}

export type ProjectDomain = 'web' | 'mobile' | 'api' | 'infrastructure' | 'ml' | 'other';

export interface OrganizationReference {
  id: string;
  name: string;
  inherit: boolean;
}

export interface TeamReference {
  id: string;
  name: string;
  inherit: boolean;
}

// ============================================================================
// Workflow Configuration
// ============================================================================

export interface WorkflowConfig {
  phases: PhaseWorkflowConfig;
  sessions: SessionConfig;
  tasks: TaskConfig;
}

export interface PhaseWorkflowConfig {
  enabled: boolean;
  definition: 'default' | 'custom';
  custom?: CustomPhaseDefinition;
  enforcement: 'strict' | 'flexible' | 'disabled';
}

export interface CustomPhaseDefinition {
  name: string;
  description: string;
  phases: PhaseDefinition[];
}

/**
 * PhaseRole - Roles that can be assigned to work on a phase.
 * Mirrors AgentRole from coordination/types.ts but defined locally to avoid circular deps.
 */
export type PhaseRole = 'pm' | 'ux' | 'tech-lead' | 'developer' | 'qa' | 'human';

export interface PhaseDefinition {
  id: number;
  name: string;
  shortName: string;
  description?: string;
  commitPrefix: string;
  requiredOutputs?: string[];
  canSkip: boolean;
  /**
   * Role set for this phase - which roles are responsible for work in this phase.
   * Enables choreographed handoffs: e.g., Phase 1 has ['pm', 'ux'], Phase 2 has ['tech-lead', 'developer'].
   * If empty/undefined, all roles can work on this phase.
   */
  roleSet?: PhaseRole[];
  /**
   * Primary role for this phase - the lead role if multiple roles are assigned.
   * Used for routing decisions and accountability.
   */
  primaryRole?: PhaseRole;
}

export interface SessionConfig {
  heartbeatIntervalSeconds: number;
  expiryMinutes: number;
  defaultAgentCapacity: number;
  allowMultipleAgents: boolean;
  autoClaimOnStart: boolean;
  preserveContextOnExpiry: boolean;
}

export interface TaskConfig {
  requireDescription: boolean;
  requireFiles: boolean;
  defaultPriority: TaskPriority;
  autoAssignPhases: boolean;
  autoDetectType: boolean;
  allowedPriorities?: TaskPriority[];
  /** Require clean git working directory (no uncommitted changes) to complete tasks */
  requireCommitOnCompletion: boolean;
  /** Require commits to be pushed to remote before completing tasks */
  requirePushOnCompletion: boolean;
  /** Auto-create pending outcome records when tasks are completed */
  requireOutcomeTracking: boolean;
  /** Checkpoint protocol: 'git' requires commit SHA on phase advance, 'manual' uses timestamps */
  checkpointProtocol?: 'git' | 'manual';
  /** Use git worktrees for task isolation — each claimed task gets its own working directory */
  useWorktree?: boolean;
  /** Auto-delete the task's feature branch (local + remote) on completion. Default: true */
  cleanupBranchOnCompletion?: boolean;
}

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

// ============================================================================
// Quality Configuration
// ============================================================================

export interface QualityConfig {
  coverage: CoverageConfig;
  testRequirements: TestRequirementsConfig;
  gates: QualityGatesConfig;
  healthCheck: HealthCheckConfig;
  /** Whether to enforce quality gates on task completion (block if gates fail) */
  enforceOnCompletion: boolean;
  /** Semantic validation of completed work against task requirements */
  completionValidation: CompletionValidationConfig;
  /** Thresholds for when decisions/tests are blocking vs advisory.
   *  Changes below these thresholds produce warnings instead of quality gaps. */
  substantialChangeThreshold?: {
    /** Minimum code files changed to require decisions/tests (default: 4) */
    minCodeFiles?: number;
    /** Minimum total lines changed to require decisions/tests (default: 200) */
    minLinesDelta?: number;
  };
  /** Profile-defined quality gates (replaces default test-file heuristic when set) */
  profileGates?: ProfileQualityGate[];
}

export interface CompletionValidationConfig {
  /** Enable semantic validation on task completion */
  enabled: boolean;
  /** Use LLM for validation via CLI agent (e.g. 'claude', 'gemini') */
  useLLM: boolean;
  /** CLI command for LLM judge (default: auto-detect from installed agents) */
  llmCommand?: string;
  /** Maximum validation time in milliseconds */
  timeoutMs: number;
  /** Skip validation for changes with fewer than this many files (0 = validate all) */
  skipForSmallChanges: number;
}

export interface CoverageConfig {
  minimum: number;
  recommended: number;
  excellent: number;
  enforcement: 'block' | 'warn' | 'info' | 'disabled';
}

export interface TestRequirementsConfig {
  critical: TestRequirementLevel;
  high: TestRequirementLevel;
  medium: TestRequirementLevel;
  low: TestRequirementLevel;
}

export interface TestRequirementLevel {
  unit: boolean;
  integration: boolean;
  e2e: boolean;
}

export interface QualityGatesConfig {
  compilation: QualityGateConfig;
  linting: QualityGateConfig;
  tests: QualityGateConfig;
  coverage: QualityGateConfig;
  custom?: CustomQualityGate[];
}

export interface QualityGateConfig {
  required: boolean;
  blocking: boolean;
  command?: string;
  timeoutSeconds?: number;
}

export type CustomGateFailOn = 'exit-code' | 'stdout-match' | 'stderr-match';
export type CustomGateSeverity = 'error' | 'warning';

export interface CustomQualityGate {
  name: string;
  command: string;
  required: boolean;
  blocking: boolean;
  timeoutSeconds?: number;
  /** Description of what this gate checks */
  description?: string;
  /** How to determine failure (default: 'exit-code') */
  failOn?: CustomGateFailOn;
  /** Regex pattern for stdout-match or stderr-match strategies */
  pattern?: string;
  /** Severity level: 'error' blocks, 'warning' advises (default: 'error') */
  severity?: CustomGateSeverity;
  /** Glob patterns this gate applies to. If omitted, applies to all files. */
  files?: string[];
}

export interface HealthCheckConfig {
  intervalMinutes: number;
  failOnIssues: boolean;
  checks: HealthCheckType[];
}

export type HealthCheckType = 
  | 'stale-sessions'
  | 'blocked-tasks'
  | 'quality-gate-failures'
  | 'orphaned-branches';

// ============================================================================
// Git Configuration
// ============================================================================

export interface GitConfig {
  autoCreateBranches: boolean;
  branchNaming: BranchNamingConfig;
  commits: CommitConfig;
  pullRequests: PullRequestConfig;
  protectedBranches: string[];
}

export interface BranchNamingConfig {
  pattern: string;
  types: Record<string, string>;
  titleMaxLength: number;
  sanitization: 'kebab-case' | 'snake_case' | 'camelCase';
}

export interface CommitConfig {
  autoCommitOnPhase: boolean;
  messageTemplate: string;
  conventionalCommits: boolean;
  signCommits: boolean;
  includeCoAuthor: boolean;
}

export interface PullRequestConfig {
  autoGenerate: boolean;
  templatePath?: string;
  requireReview: boolean;
  reviewers: string[];
  labels: string[];
  assignees: string[];
}

// ============================================================================
// Context Assembly Configuration
// ============================================================================

export interface ContextConfig {
  assembly: ContextAssemblyConfig;
  limits: ContextLimitsConfig;
  tokenBudgets: TokenBudgetsConfig;
  /** Custom labels for context sections (set by domain profiles) */
  labels?: {
    strategic?: string;
    ux?: string;
    technical?: string;
  };
}

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

// ============================================================================
// Stakeholder Configuration
// ============================================================================

export interface StakeholdersConfig {
  roles: Record<string, StakeholderRole>;
  custom: CustomStakeholder[];
}

export interface StakeholderRole {
  displayName: string;
  description?: string;
  defaultViews: string[];
  permissions: StakeholderPermission[];
  notifications: Record<string, boolean>;
  contextPreferences?: ContextPreferences;
}

export type StakeholderPermission =
  | 'view-all'
  | 'create-tasks'
  | 'claim-tasks'
  | 'update-progress'
  | 'complete-tasks'
  | 'create-decisions'
  | 'create-ux-requirements'
  | 'create-technical-plans'
  | 'approve-tasks'
  | 'approve-architecture'
  | 'set-priorities'
  | 'set-quality-gates'
  | 'assign-tasks'
  | 'manage-team'
  | 'manage-config'
  | 'export-reports'
  | 'delete-tasks';

export interface ContextPreferences {
  defaultDetailLevel: 'minimal' | 'standard' | 'full';
  includeStrategicContext: boolean;
  includeUxContext: boolean;
  includeTechnicalContext: boolean;
  includeFilePreview: boolean;
}

export interface CustomStakeholder {
  id: string;
  name: string;
  email?: string;
  role: string;
  customPermissions?: StakeholderPermission[];
  notificationOverrides?: Record<string, boolean>;
}

// ============================================================================
// Integration Configuration
// ============================================================================

export interface IntegrationsConfig {
  linear?: LinearIntegrationConfig;
  jira?: JiraIntegrationConfig;
  github?: GitHubIntegrationConfig;
  slack?: SlackIntegrationConfig;
  webhook?: WebhookIntegrationConfig;
}

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

// ============================================================================
// Notification Configuration
// ============================================================================

export interface NotificationsConfig {
  channels: NotificationChannelsConfig;
  frequency: NotificationFrequency;
  quietHours?: QuietHoursConfig;
  filters?: NotificationFiltersConfig;
}

export interface NotificationChannelsConfig {
  inApp: boolean;
  email: boolean;
  slack: boolean;
  webhook: boolean;
}

export type NotificationFrequency = 'realtime' | 'batched' | 'daily' | 'disabled';

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
  exceptUrgent: boolean;
}

export interface NotificationFiltersConfig {
  minPriority?: TaskPriority;
  includeTypes?: string[];
  excludeTypes?: string[];
}

// ============================================================================
// UI Configuration
// ============================================================================

export interface UIConfig {
  theme: 'light' | 'dark' | 'system';
  defaultDashboard: string;
  taskListView: 'list' | 'kanban' | 'timeline';
  showPhaseProgress: boolean;
  showQualityIndicators: boolean;
  compactMode: boolean;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  locale: string;
}

// ============================================================================
// Experimental Features
// ============================================================================

export interface ExperimentalConfig {
  ambientCrystallization: boolean;
  aiSuggestions: boolean;
  predictiveContext: boolean;
  voiceNotes: boolean;
  multiProjectDeps: boolean;
  smartMergeDetection: boolean;
}

// ============================================================================
// Resolved Configuration (after inheritance)
// ============================================================================

export interface ResolvedConfig extends EnginehausConfig {
  _metadata: ResolvedConfigMetadata;
}

export interface ResolvedConfigMetadata {
  projectId: string;
  resolvedAt: Date;
  inheritanceChain: string[];
  overrides: ConfigOverride[];
  effectiveScope: ConfigScope;
}

export interface ConfigOverride {
  path: string;
  value: unknown;
  source: ConfigSource;
  scope: ConfigScope;
  appliedAt: Date;
}

// ============================================================================
// Configuration Defaults
// ============================================================================

export const DEFAULT_CONFIG: EnginehausConfig = {
  version: '1.0',
  
  project: {
    name: 'Unnamed Project',
    slug: 'unnamed',
    domain: 'other',
    techStack: [],
    rootPath: './',
  },

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
      requireCommitOnCompletion: true, // Structure > Instruction: enforce commits before completion
      requirePushOnCompletion: true,   // Structure > Instruction: enforce push before completion
      requireOutcomeTracking: true,    // Structure > Instruction: auto-create pending outcomes on completion
      checkpointProtocol: 'git' as const,
      useWorktree: false,              // Opt-in: isolate each task in its own git worktree
      cleanupBranchOnCompletion: true, // Auto-delete task branch (local + remote) on completion
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
    enforceOnCompletion: true, // Default: blocking mode (Structure > Instruction)
    completionValidation: {
      enabled: true,          // Validate by default (advisory only)
      useLLM: false,          // Use heuristics until LLM is configured
      timeoutMs: 5000,        // 5 second timeout
      skipForSmallChanges: 0, // Validate all changes
    },
  },

  git: {
    autoCreateBranches: true,
    branchNaming: {
      pattern: '{{type}}/{{taskId}}-{{title}}',
      types: {
        feature: 'feature',
        bugfix: 'fix',
        refactor: 'refactor',
        docs: 'docs',
        test: 'test',
      },
      titleMaxLength: 50,
      sanitization: 'kebab-case',
    },
    commits: {
      autoCommitOnPhase: true,
      messageTemplate: '{{prefix}}({{scope}}): {{message}}',
      conventionalCommits: true,
      signCommits: false,
      includeCoAuthor: false,
    },
    pullRequests: {
      autoGenerate: false,
      requireReview: true,
      reviewers: [],
      labels: ['enginehaus'],
      assignees: [],
    },
    protectedBranches: ['main', 'master', 'develop'],
  },

  context: {
    assembly: {
      maxFileSizeKb: 100,
      maxLinesPerFile: 100,
      includeHiddenFiles: false,
      binaryExtensions: [
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
        '.woff', '.woff2', '.ttf', '.eot', '.otf',
        '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
        '.exe', '.dll', '.so', '.dylib',
        '.mp3', '.mp4', '.avi', '.mov', '.wav',
        '.db', '.sqlite', '.sqlite3',
        '.lock', '.bin',
      ],
      excludePatterns: ['node_modules', '.git', 'dist', 'build', 'coverage'],
    },
    limits: {
      recentDecisions: 10,
      recentUxRequirements: 10,
      recentTechnicalPlans: 10,
      readyTasksPreview: 5,
      sessionHistoryDepth: 10,
    },
    tokenBudgets: {
      minimal: 400,
      standard: 2000,
      full: 8000,
    },
  },

  stakeholders: {
    roles: {
      'product-manager': {
        displayName: 'Product Manager',
        defaultViews: ['strategic-decisions', 'roadmap', 'dependencies'],
        permissions: ['create-decisions', 'approve-tasks', 'set-priorities', 'view-all'],
        notifications: {
          taskBlocked: true,
          milestoneReached: true,
          riskIdentified: true,
        },
      },
      'ux-director': {
        displayName: 'UX Director',
        defaultViews: ['ux-requirements', 'design-decisions', 'accessibility'],
        permissions: ['create-ux-requirements', 'view-all'],
        notifications: {
          uxRequirementAdded: true,
          designDecisionNeeded: true,
        },
      },
      'technical-lead': {
        displayName: 'Technical Lead',
        defaultViews: ['technical-plans', 'architecture', 'quality-metrics'],
        permissions: ['create-technical-plans', 'approve-architecture', 'set-quality-gates', 'view-all'],
        notifications: {
          qualityGateFailed: true,
          architectureDecisionNeeded: true,
          technicalDebtIdentified: true,
        },
      },
      'engineering-manager': {
        displayName: 'Engineering Manager',
        defaultViews: ['team-health', 'velocity', 'blockers', 'capacity'],
        permissions: ['assign-tasks', 'manage-team', 'view-all'],
        notifications: {
          taskBlocked: true,
          capacityExceeded: true,
          velocityDropped: true,
        },
      },
      'developer': {
        displayName: 'Developer',
        defaultViews: ['current-task', 'quality-checklist', 'phase-progress'],
        permissions: ['claim-tasks', 'update-progress', 'complete-tasks', 'create-tasks'],
        notifications: {
          taskAssigned: true,
          reviewRequested: true,
          blockerResolved: true,
        },
        contextPreferences: {
          defaultDetailLevel: 'standard',
          includeStrategicContext: false,
          includeUxContext: false,
          includeTechnicalContext: true,
          includeFilePreview: true,
        },
      },
      'executive': {
        displayName: 'Executive',
        defaultViews: ['summary-dashboard', 'risks', 'milestones'],
        permissions: ['view-all', 'export-reports'],
        notifications: {
          milestoneReached: true,
          majorRiskIdentified: true,
        },
      },
    },
    custom: [],
  },

  integrations: {
    github: {
      enabled: false,
      token: '${GITHUB_TOKEN}',
      autoCreatePRs: false,
      prLabels: ['enginehaus'],
    },
  },

  notifications: {
    channels: {
      inApp: true,
      email: false,
      slack: false,
      webhook: false,
    },
    frequency: 'realtime',
  },

  ui: {
    theme: 'system',
    defaultDashboard: 'developer',
    taskListView: 'kanban',
    showPhaseProgress: true,
    showQualityIndicators: true,
    compactMode: false,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    locale: 'en-CA',
  },

  decisions: {
    categories: ['architecture', 'tradeoff', 'dependency', 'pattern', 'other'],
  },

  experimental: {
    ambientCrystallization: false,
    aiSuggestions: true,
    predictiveContext: false,
    voiceNotes: false,
    multiProjectDeps: false,
    smartMergeDetection: false,
  },
};

// ============================================================================
// Default Phase Definitions
// ============================================================================

export const DEFAULT_PHASES: PhaseDefinition[] = [
  {
    id: 1,
    name: 'Context & Planning',
    shortName: 'PLAN',
    description: 'Understand requirements, gather context, plan approach',
    commitPrefix: 'plan',
    requiredOutputs: ['approach', 'files_identified'],
    canSkip: false,
    roleSet: ['pm', 'ux', 'tech-lead'],
    primaryRole: 'pm',
  },
  {
    id: 2,
    name: 'Architecture',
    shortName: 'ARCH',
    description: 'Design solution, make technical decisions',
    commitPrefix: 'arch',
    requiredOutputs: ['design_decision'],
    canSkip: true,
    roleSet: ['tech-lead', 'developer'],
    primaryRole: 'tech-lead',
  },
  {
    id: 3,
    name: 'Core Implementation',
    shortName: 'IMPL',
    description: 'Build primary functionality',
    commitPrefix: 'feat',
    requiredOutputs: ['code_changes'],
    canSkip: false,
    roleSet: ['developer'],
    primaryRole: 'developer',
  },
  {
    id: 4,
    name: 'Integration',
    shortName: 'INTEG',
    description: 'Connect components, wire dependencies',
    commitPrefix: 'feat',
    requiredOutputs: ['integration_verified'],
    canSkip: true,
    roleSet: ['developer'],
    primaryRole: 'developer',
  },
  {
    id: 5,
    name: 'Testing',
    shortName: 'TEST',
    description: 'Add tests, verify behavior',
    commitPrefix: 'test',
    requiredOutputs: ['tests_pass'],
    canSkip: false,
    roleSet: ['developer', 'qa'],
    primaryRole: 'developer',
  },
  {
    id: 6,
    name: 'Documentation',
    shortName: 'DOCS',
    description: 'Update docs, add comments',
    commitPrefix: 'docs',
    requiredOutputs: ['docs_updated'],
    canSkip: true,
    roleSet: ['developer'],
    primaryRole: 'developer',
  },
  {
    id: 7,
    name: 'Review',
    shortName: 'REVIEW',
    description: 'Self-review, address issues',
    commitPrefix: 'refactor',
    requiredOutputs: ['review_complete'],
    canSkip: true,
    roleSet: ['tech-lead', 'qa'],
    primaryRole: 'tech-lead',
  },
  {
    id: 8,
    name: 'Deployment',
    shortName: 'DEPLOY',
    description: 'Final checks, merge preparation',
    commitPrefix: 'chore',
    requiredOutputs: ['ready_to_merge'],
    canSkip: false,
    roleSet: ['developer', 'tech-lead'],
    primaryRole: 'developer',
  },
];
