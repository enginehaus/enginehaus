// ============================================================================
// Core Coordination Types for Enginehaus
// ============================================================================

// ============================================================================
// Project Management
// ============================================================================

export type ProjectStatus = 'active' | 'archived' | 'paused';

/**
 * Project
 *
 * Top-level entity that groups all coordination artifacts (tasks, decisions, etc.)
 * Enables multi-project support within a single Enginehaus instance.
 */
export interface Project {
  id: string;
  name: string;
  slug: string; // 'actual', 'shima', 'enginehaus' - unique identifier for CLI/API
  description?: string;
  status: ProjectStatus;
  rootPath: string;
  domain: ProjectDomain;
  techStack?: string[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Task Management
// ============================================================================

export type TaskStatus = 'ready' | 'in-progress' | 'blocked' | 'awaiting-human' | 'completed';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskType = 'code' | 'docs' | 'infra' | 'test' | 'other';
export type TaskMode = 'exclusive' | 'collaborative';
export type ProjectDomain = 'web' | 'mobile' | 'api' | 'infrastructure' | 'ml' | 'other';

/**
 * AgentRole - Declared role when making updates or advancing phases.
 * Makes role structural rather than contextual - forces agents to consider
 * "what hat am I wearing?" at the moment of action.
 *
 * Standard roles:
 * - pm: Product Manager - strategic decisions, business rationale
 * - ux: UX Director - user experience, design patterns
 * - tech-lead: Technical Lead - architecture, implementation strategy
 * - developer: Developer - code implementation, testing
 * - qa: QA Engineer - testing, validation, quality gates
 * - human: Human reviewer/stakeholder
 */
export type AgentRole = 'pm' | 'ux' | 'tech-lead' | 'developer' | 'qa' | 'human';
export type ContributionType = 'opinion' | 'analysis' | 'review' | 'suggestion' | 'decision' | 'other';
export type ArtifactType = 'design' | 'doc' | 'code' | 'test' | 'screenshot' | 'url' | 'reference' | 'other';
export type ArtifactContentType = 'text/plain' | 'text/markdown' | 'application/json' | 'image/png' | 'image/jpeg' | 'image/svg+xml' | 'application/octet-stream';

// ============================================================================
// Actor Attribution
// ============================================================================

export type ActorType = 'human' | 'agent' | 'system';

/**
 * Actor - Who performed an action.
 *
 * Stored as JSON string in existing TEXT columns (created_by, assigned_to).
 * Plain string values are treated as legacy `{ type: 'agent', id: <value> }`.
 */
export interface Actor {
  type: ActorType;
  id: string;         // 'trevor', 'claude-code', 'claude-desktop'
  name?: string;      // Display name
  instanceId?: string; // For federation - which local instance
}

/**
 * Parse an actor value from storage. Handles both:
 * - New JSON format: '{"type":"agent","id":"claude-code"}'
 * - Legacy plain string: 'claude-code' → { type: 'agent', id: 'claude-code' }
 */
export function parseActor(value: string | undefined | null): Actor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.type === 'string' && typeof parsed.id === 'string') {
      return parsed as Actor;
    }
  } catch {
    // Not JSON — treat as legacy plain string
  }
  return { type: 'agent', id: value };
}

/**
 * Serialize an actor for storage. Returns JSON string.
 */
export function serializeActor(actor: Actor): string {
  return JSON.stringify({ type: actor.type, id: actor.id, ...(actor.name && { name: actor.name }), ...(actor.instanceId && { instanceId: actor.instanceId }) });
}

/**
 * Create an Actor from an agentId string (convenience for MCP handlers).
 */
export function agentActor(agentId: string): Actor {
  return { type: 'agent', id: agentId };
}

// ============================================================================
// Task Relationships (semantic links beyond blocking dependencies)
// ============================================================================

export type TaskRelationshipType = 'related_to' | 'part_of' | 'informed_by' | 'supersedes' | 'similar_to' | 'duplicates';
export type TaskRelationshipSource = 'manual' | 'inferred' | 'file_overlap' | 'embedding';

/**
 * TaskRelationship
 *
 * Semantic link between tasks beyond simple blocking dependencies.
 * Enables cluster visualization, context enrichment, and "see also" suggestions.
 */
export interface TaskRelationship {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationshipType: TaskRelationshipType;
  description?: string;
  /** Confidence score 0.0-1.0 (manual links = 1.0, inferred may be lower) */
  confidence: number;
  /** How this relationship was created */
  source?: TaskRelationshipSource;
  createdAt: Date;
  createdBy?: string;
}

/**
 * Evolution entry tracking how an artifact has changed over time
 */
export interface ArtifactEvolution {
  artifactId: string;         // ID of the artifact at that point
  timestamp: Date;            // When this evolution occurred
  action: 'created' | 'refined' | 'merged' | 'forked';
  fromChatUri?: string;       // Chat that triggered this evolution
  summary?: string;           // Brief description of what changed
}

/**
 * Artifact
 *
 * Links external resources OR stores content directly for cross-agent handoff.
 * Supports knowledge flywheel: Flow → Crystallize → Retrieve → Evolve → Flow
 */
export interface Artifact {
  id: string;
  taskId: string;
  projectId: string;
  type: ArtifactType;
  /** URI reference (for external artifacts) - can be empty if content is stored inline */
  uri: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  createdBy?: string;

  // Content storage fields (for inline content, not just URI references)
  /** Actual content stored inline (text, markdown, JSON, or base64-encoded binary) */
  content?: string;
  /** MIME type of the content (e.g., 'text/markdown', 'image/png') */
  contentType?: ArtifactContentType;
  /** Size of content in bytes */
  contentSize?: number;

  // Knowledge lineage fields
  /** Chain of evolution showing how this artifact developed over time */
  evolutionHistory?: ArtifactEvolution[];
  /** ID of the parent artifact this was derived from (for forked/refined artifacts) */
  parentArtifactId?: string;
}

/**
 * External reference attached to a task or decision.
 * Links to design docs, PRs, specs, Figma files, etc.
 */
export type ReferenceType = 'design' | 'spec' | 'pr' | 'doc' | 'external';

export interface TaskReference {
  url: string;
  label?: string;
  type?: ReferenceType | (string & {});  // Known types + extensible
}

/**
 * UnifiedTask
 *
 * The central task representation that carries context from all roles:
 * - Strategic (Product Manager): business goals, revenue impact
 * - UX (UX Director): user experience requirements, design patterns
 * - Technical (Technical Lead): implementation approach, architecture
 */
export interface UnifiedTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  type?: TaskType;  // Task type for quality gate variance (docs/infra/test skip test requirements)
  mode?: TaskMode;  // exclusive (default): single agent claim. collaborative: multiple agents contribute.

  // Lightweight categorization
  tags?: string[];

  // File targets
  files?: string[];

  // Multi-dimensional context (the key innovation)
  strategicContext?: StrategicContext;
  uxContext?: UXContext;
  technicalContext?: TechnicalContext;

  // Quality requirements
  qualityRequirements?: string[];

  // Implementation tracking
  implementation?: ImplementationTracking;

  // External references (design docs, PRs, specs, etc.)
  references?: TaskReference[];

  // Task dependencies
  blockedBy?: string[];  // Task IDs that block this task
  blocks?: string[];     // Task IDs that this task blocks

  // Human checkpoint configuration
  checkpointPhases?: number[];        // Phase numbers requiring human approval
  activeCheckpoint?: HumanCheckpoint; // Current pending checkpoint (if any)

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  assignedTo?: string;
  lastModifiedBy?: string;

  // Optimistic locking — auto-managed by storage layer, incremented on every update
  version?: number;
}

// ============================================================================
// Collaborative Task Contributions
// ============================================================================

export interface Contribution {
  id: string;
  taskId: string;
  projectId: string;
  agentId: string;
  role: AgentRole;
  type: ContributionType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// Dispatch Queue Types
// ============================================================================

export type DispatchStatus = 'pending' | 'claimed' | 'recalled' | 'expired';

export interface Dispatch {
  id: string;
  projectId: string;
  taskId: string;
  targetAgent: string;         // Agent ID to dispatch to (e.g., 'claude-code', 'cursor')
  dispatchedBy: string;        // Who queued this (e.g., 'trevor', 'wheelhaus')
  priorityOverride?: TaskPriority;  // Override task's natural priority
  context?: string;            // Human-provided context or instructions
  status: DispatchStatus;
  claimedAt?: Date;
  createdAt: Date;
  expiresAt?: Date;            // Auto-expire if not picked up
}

// ============================================================================
// Human Checkpoint Types
// ============================================================================

export type CheckpointType = 'phase-gate' | 'decision-required' | 'review-required' | 'approval-required';
export type CheckpointStatus = 'pending' | 'approved' | 'rejected' | 'timed-out';

/**
 * HumanCheckpoint
 *
 * Represents a point in the workflow where human input/approval is required.
 * This is the core type for pause-for-input workflow gates.
 */
export interface HumanCheckpoint {
  id: string;
  taskId: string;
  projectId: string;
  type: CheckpointType;
  status: CheckpointStatus;

  // Context for the checkpoint
  phase?: number;                    // Phase number that triggered the checkpoint
  reason: string;                    // Why human input is needed
  question?: string;                 // Specific question for the human
  options?: CheckpointOption[];      // Predefined options to choose from
  context?: string;                  // Additional context/summary

  // Request details
  requestedBy: string;               // Agent ID that requested the checkpoint
  requestedAt: Date;

  // Response details (filled when human responds)
  respondedBy?: string;              // User ID who responded
  respondedAt?: Date;
  response?: string;                 // Free-form response text
  selectedOption?: string;           // ID of selected option
  decision?: 'approve' | 'reject' | 'redirect';

  // Escalation/timeout config
  timeoutMinutes?: number;           // Auto-timeout after this many minutes
  escalateTo?: string;               // User/role to escalate to on timeout
  escalatedAt?: Date;
}

/**
 * CheckpointOption
 *
 * Predefined option for human to select from at a checkpoint
 */
export interface CheckpointOption {
  id: string;
  label: string;
  description?: string;
  action?: 'approve' | 'reject' | 'redirect';
}

/**
 * CheckpointHistory
 *
 * Record of a completed checkpoint for audit trail
 */
export interface CheckpointHistory {
  checkpoint: HumanCheckpoint;
  completedAt: Date;
  duration: number;  // milliseconds from request to response
}

export interface StrategicContext {
  businessRationale: string;
  competitiveAdvantage?: string;
  revenueImpact?: string;
  timeline: string;
}

export interface UXContext {
  userExperience: string;
  designPattern: string;
  progressiveDisclosure?: string;
  technicalConstraints?: string;
}

export interface TechnicalContext {
  implementation: string;
  architecture?: string;
  estimatedEffort?: string;
  qualityGates?: string[];
}

export interface ImplementationTracking {
  sessionId?: string;
  gitBranch?: string;
  /** Absolute path to the git worktree created for this task (when useWorktree is enabled) */
  worktreePath?: string;
  startedAt?: Date;
  completedAt?: Date;
  implementationSummary?: string;
  qualityMetrics?: QualityMetrics;
  architectureDecisions?: ArchitectureDecision[];
  nextSteps?: string[];
  handoffNotes?: string;
  // Phase-based workflow tracking
  phaseProgress?: PhaseProgress;
}

/**
 * Phase progress tracking for 8-phase workflow
 */
export interface PhaseProgress {
  currentPhase: number;
  completedPhases: number[];
  skippedPhases: number[];
  phaseNotes: Record<number, string>;
  phaseStartTimes: Record<number, Date>;
  phaseEndTimes: Record<number, Date>;
  /** Commit SHA recorded at each phase completion - links phases to specific commits */
  phaseCommits: Record<number, string>;
}

export interface QualityMetrics {
  testCoverage?: string;
  performanceBenchmarks?: string;
  securityValidation?: string;
  documentationComplete?: boolean;
}

export interface ArchitectureDecision {
  decision: string;
  rationale: string;
  impact: string;
}

// ============================================================================
// Task Outcome Tracking
// ============================================================================

/**
 * Real-world outcome status for completed tasks.
 * Tracks what happened AFTER completion - did the work actually ship?
 */
export type OutcomeStatus =
  | 'pending'      // Outcome not yet determined (PR still open, etc.)
  | 'shipped'      // Work merged and/or deployed successfully
  | 'rejected'     // PR rejected or work reverted
  | 'rework'       // Required significant rework after completion
  | 'abandoned';   // Work was completed but never shipped

/**
 * TaskOutcome
 *
 * Tracks the real-world result of completed work.
 * This is separate from task completion because outcomes happen later
 * (after PR review, CI runs, deployment, user feedback).
 */
export interface TaskOutcome {
  id: string;
  taskId: string;
  projectId: string;

  // Core outcome
  status: OutcomeStatus;
  recordedAt: Date;

  // PR/Code Review
  prUrl?: string;
  prMerged?: boolean;
  prMergedAt?: Date;
  reviewFeedback?: string;

  // CI/Quality
  ciPassed?: boolean;
  ciFirstTryPass?: boolean;  // Did CI pass on first attempt?
  testFailures?: number;

  // Deployment
  deployed?: boolean;
  deployedAt?: Date;
  deployEnvironment?: string;  // e.g., 'production', 'staging'

  // Rework tracking
  reworkRequired?: boolean;
  reworkReason?: string;
  reworkTaskId?: string;  // ID of follow-up task if rework needed

  // Time tracking
  timeToMerge?: number;      // ms from completion to merge
  timeToProduction?: number; // ms from completion to production deploy

  // Feedback
  reviewerSatisfaction?: number;  // 1-5 scale
  notes?: string;
}

// ============================================================================
// Knowledge Entity System (Crystallization)
// ============================================================================

/**
 * Knowledge entity types form a hierarchy from abstract to concrete:
 * - principle: High-level guiding truth (e.g., "Prefer composition over inheritance")
 * - rationale: Reasoning behind a principle or pattern
 * - pattern: Reusable solution to a common problem
 * - practice: Specific way of doing something in this codebase
 * - example: Concrete code/config snippet demonstrating a practice
 */
export type KnowledgeEntityType = 'principle' | 'rationale' | 'pattern' | 'practice' | 'example';

/**
 * Disposition states for knowledge governance workflow:
 * - draft: Initial capture, not yet reviewed
 * - proposed: Submitted for team review
 * - approved: Accepted as canonical knowledge
 * - deferred: Valid but deprioritized
 * - declined: Reviewed and rejected
 * - superseded: Replaced by newer knowledge
 */
export type KnowledgeDisposition = 'draft' | 'proposed' | 'approved' | 'deferred' | 'declined' | 'superseded';

/**
 * KnowledgeEntity
 *
 * Crystallized knowledge extracted from the coordination flow.
 * Supports the knowledge flywheel: Flow → Crystallize → Retrieve → Evolve → Flow
 *
 * Hierarchy example:
 * - Principle: "Minimize token overhead in MCP responses"
 *   - Rationale: "Token costs scale linearly; efficient responses enable more tool calls"
 *     - Pattern: "Progressive disclosure for context"
 *       - Practice: "Use minimalContext flag in coordination tools"
 *         - Example: "get_next_task returns abbreviated response when minimalContext=true"
 */
export interface KnowledgeEntity {
  id: string;
  projectId: string;

  // Core identity
  type: KnowledgeEntityType;
  title: string;
  content: string;  // Markdown-formatted knowledge content
  summary?: string; // Brief one-liner for lists/searches

  // Hierarchy (self-referential)
  parentId?: string;        // Parent knowledge entity (e.g., practice → pattern → principle)
  childIds?: string[];      // Computed: direct children

  // Governance
  disposition: KnowledgeDisposition;
  proposedBy?: string;      // Agent/user who proposed
  proposedAt?: Date;
  approvedBy?: string[];    // Agents/users who approved
  approvedAt?: Date;
  reviewDueDate?: Date;     // For periodic review
  supersededById?: string;  // If superseded, link to replacement

  // Source lineage (where this knowledge came from)
  sourceDecisionIds?: string[];  // Decisions that informed this
  sourceArtifactIds?: string[];  // Artifacts referenced
  sourceTaskIds?: string[];      // Tasks where this was discovered
  sourceChatUris?: string[];     // Claude chat links

  // Discovery & retrieval
  tags?: string[];              // Semantic tags for search
  scope?: KnowledgeScope;       // Where this applies
  applicableFilePatterns?: string[];  // Glob patterns for file-based retrieval

  // Metrics
  usageCount?: number;          // Times retrieved in sessions
  lastUsedAt?: Date;
  effectivenessScore?: number;  // 0-1 based on outcome feedback

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  version?: number;             // For tracking revisions
}

/**
 * KnowledgeScope
 *
 * Defines where a knowledge entity applies.
 * Enables targeted retrieval during task context assembly.
 */
export interface KnowledgeScope {
  global?: boolean;           // Applies across all projects
  projectIds?: string[];      // Specific projects
  domains?: ProjectDomain[];  // Specific domains (web, api, etc.)
  techStack?: string[];       // Specific technologies (react, typescript, etc.)
  filePatterns?: string[];    // File path patterns where this applies
  taskTypes?: string[];       // Types of tasks (bug-fix, feature, refactor)
}

/**
 * KnowledgeRelationship
 *
 * Links between knowledge entities beyond parent-child hierarchy.
 * Enables "see also" connections and cluster discovery.
 */
export interface KnowledgeRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: KnowledgeRelationshipType;
  description?: string;
  confidence: number;  // 0-1, manual links = 1.0
  createdAt: Date;
  createdBy?: string;
}

export type KnowledgeRelationshipType =
  | 'supports'      // This knowledge supports/reinforces target
  | 'contradicts'   // This conflicts with target (needs resolution)
  | 'extends'       // This builds upon target
  | 'alternative'   // This is an alternative approach to target
  | 'related';      // General semantic relationship

/**
 * KnowledgeRetrievalContext
 *
 * Context for retrieving relevant knowledge during task work.
 * Used by coordination service to find applicable knowledge.
 */
export interface KnowledgeRetrievalContext {
  projectId: string;
  taskId?: string;
  files?: string[];
  tags?: string[];
  domain?: ProjectDomain;
  techStack?: string[];
  includeGlobal?: boolean;
  maxResults?: number;
  minEffectiveness?: number;
}

/**
 * KnowledgeRetrievalResult
 *
 * Result of knowledge retrieval query.
 */
export interface KnowledgeRetrievalResult {
  entity: KnowledgeEntity;
  relevanceScore: number;   // 0-1 how relevant to context
  matchedCriteria: string[]; // What matched (tag, file pattern, etc.)
  hierarchy?: KnowledgeEntity[];  // Ancestor chain to root principle
}

// ============================================================================
// Role-Specific Artifacts
// ============================================================================

/**
 * StrategicDecision (Product Manager)
 * 
 * High-level business decisions that drive feature development
 */
export interface StrategicDecision {
  id: string;
  projectId: string;
  taskId?: string;  // Optional link to a specific task
  decision: string;
  rationale: string;
  impact: string;
  timeline: string;
  stakeholders: string[];
  requirements?: {
    technical?: string;
    ux?: string;
    quality?: string;
  };
  createdAt: Date;
  createdBy?: string;
}

/**
 * DecisionScope
 *
 * Structured scope for in-flight decisions, enabling precise matching
 * of decisions to tasks based on architectural layers, glob patterns,
 * explicit file paths, or freeform tags.
 */
export type DecisionLayer = 'interface' | 'service' | 'storage' | 'handler' | 'cli' | 'rest' | 'mcp';

export interface DecisionScope {
  layers?: DecisionLayer[];
  patterns?: string[];   // glob patterns (e.g., "src/adapters/**")
  files?: string[];      // explicit file paths
  tags?: string[];       // freeform labels
}

/**
 * UXRequirements (UX Director)
 * 
 * User experience specifications and design guidance
 */
export interface UXRequirements {
  id: string;
  projectId: string;
  feature: string;
  userExperience: string;
  designPattern: string;
  progressiveDisclosure?: string;
  technicalConstraints?: string;
  responseTo?: string; // Links to strategic decision ID
  createdAt: Date;
  createdBy?: string;
}

/**
 * TechnicalPlan (Technical Lead)
 * 
 * Technical implementation strategy and task breakdown
 */
export interface TechnicalPlan {
  id: string;
  projectId: string;
  feature: string;
  strategicContext?: string;
  uxContext?: string;
  technicalApproach: string;
  architecture?: string;
  estimatedEffort?: string;
  files?: string[];
  qualityGates?: string[];
  unifiedTasks?: Array<{
    title: string;
    description: string;
    priority: TaskPriority;
    requirements?: string;
    files?: string[];
  }>;
  createdAt: Date;
  createdBy?: string;
}

// ============================================================================
// Coordination Sessions
// ============================================================================

export type SessionStatus = 'active' | 'completed' | 'expired';

// ============================================================================
// Cross-LLM Agent Metadata
// ============================================================================

/**
 * AgentType - Platform/LLM type for cross-LLM coordination.
 * All major MCP-supporting LLMs are first-class citizens.
 */
export type AgentType =
  | 'claude'    // Claude Code, Claude Desktop, claude.ai
  | 'chatgpt'   // ChatGPT with MCP Developer Mode
  | 'gemini'    // Gemini CLI or SDK
  | 'mistral'   // Mistral Le Chat with MCP Connectors
  | 'cursor'    // Cursor IDE
  | 'continue'  // Continue.dev
  | 'custom'    // Custom/unknown LLM integration
  | 'human';    // Human user (not an LLM)

/**
 * AgentCapability - What this agent can do.
 * Used for task routing and handoff decisions.
 */
export type AgentCapability =
  | 'code'       // Code implementation
  | 'research'   // Research and analysis
  | 'review'     // Code review
  | 'testing'    // Test writing
  | 'docs'       // Documentation
  | 'planning'   // Task planning and breakdown
  | 'debug';     // Debugging

/**
 * AgentMetadata
 *
 * Cross-LLM agent identification for coordination tracking.
 * Enables analysis of effectiveness across different LLM types.
 */
export interface AgentMetadata {
  /** LLM platform type */
  agentType: AgentType;
  /** Model version (e.g., 'claude-sonnet-4', 'gpt-4o', 'gemini-2.5-pro') */
  agentVersion?: string;
  /** What this agent can do */
  capabilities?: AgentCapability[];
  /** MCP protocol version supported */
  mcpVersion?: string;
  /** Client/IDE info (e.g., 'claude-code-1.0.0', 'cursor-0.45') */
  clientInfo?: string;
}

/**
 * AgentProfile — persistent registry entry for a known agent.
 * Tracks capabilities, strengths, limitations, and performance history.
 */
export interface AgentProfile {
  /** Unique agent identifier (e.g., 'claude-code', 'cursor-ai', 'trevor') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Platform/LLM type */
  agentType: AgentType;
  /** Model version if applicable */
  agentVersion?: string;
  /** What this agent can do */
  capabilities: AgentCapability[];
  /** Task types this agent excels at (free-form) */
  strengths?: string[];
  /** Known limitations or things to avoid */
  limitations?: string[];
  /** MCP protocol version supported */
  mcpVersion?: string;
  /** Client/IDE info */
  clientInfo?: string;
  /** Max concurrent tasks this agent should handle */
  maxConcurrentTasks?: number;
  /** Whether agent is currently available for work */
  status: 'active' | 'inactive' | 'busy';
  /** Last time this agent was seen (claimed/completed a task) */
  lastSeenAt?: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoordinationSession {
  id: string;
  projectId: string;
  taskId: string;
  agentId: string; // e.g., 'claude-code', 'cursor-ai'
  /** Cross-LLM agent metadata for coordination tracking */
  agentMetadata?: AgentMetadata;
  status: SessionStatus;
  startTime: Date;
  endTime?: Date;
  lastHeartbeat: Date;
  currentPhase?: number;
  context: CoordinationContext;
}

export interface CoordinationContext {
  role: string;
  currentTask?: UnifiedTask | null;
  recentDecisions: StrategicDecision[];
  recentUXRequirements: UXRequirements[];
  recentTechnicalPlans: TechnicalPlan[];
  activeTasks: UnifiedTask[];
  readyTasks: UnifiedTask[];
  projectContext: Record<string, any>;
}

// ============================================================================
// Quality Gates
// ============================================================================

export interface QualityGate {
  name: string;
  type: 'compilation' | 'linting' | 'tests' | 'custom';
  command?: string;
  required: boolean;
  timeout?: number; // milliseconds
}

export interface QualityGateResult {
  gate: string;
  passed: boolean;
  details: string;
  timestamp: Date;
}

// ============================================================================
// Git Integration
// ============================================================================

export interface GitWorkflow {
  branchName: string;
  commits: GitCommit[];
  pullRequest?: PullRequest;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: Date;
  files: string[];
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  description: string;
  status: 'open' | 'merged' | 'closed';
  createdAt: Date;
}

// ============================================================================
// Coordination Events
// ============================================================================

export interface CoordinationEvent {
  id: string;
  type: EventType;
  projectId: string;
  taskId?: string;
  userId: string;
  agentId?: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export type EventType =
  | 'task-created'
  | 'task-updated'
  | 'task-started'
  | 'task-completed'
  | 'session-started'
  | 'session-heartbeat'
  | 'session-expired'
  | 'session-completed'
  | 'checkpoint-requested'
  | 'checkpoint-approved'
  | 'checkpoint-rejected'
  | 'checkpoint-timed-out'
  | 'checkpoint-escalated'
  | 'quality-gate-passed'
  | 'quality-gate-failed'
  | 'health-check-run'
  | 'git-commit'
  | 'git-push'
  | 'pr-created'
  | 'external-sync';

// ============================================================================
// Configuration
// ============================================================================

export interface EnginehausConfig {
  project: ProjectConfig;
  git: GitConfig;
  quality: QualityConfig;
  integrations: IntegrationsConfig;
}

export interface ProjectConfig {
  name: string;
  domain: ProjectDomain;
  rootPath: string;
  techStack: string[];
}

export interface GitConfig {
  autoCreateBranches: boolean;
  branchNamingPattern: string;
  commitMessageTemplate: string;
  autoCommitPhases: boolean;
}

export interface QualityConfig {
  requiredGates: string[];
  customGates?: CustomGateDefinition[];
  healthCheckInterval: number; // minutes
  failOnHealthCheckFailure: boolean;
}

export interface CustomGateDefinition {
  name: string;
  description?: string;
  command: string;
  failOn: 'exit-code' | 'stdout-match' | 'stderr-match';
  pattern?: string;  // regex pattern for stdout/stderr matching
  timeout?: number;  // ms, default 30000
  severity?: 'error' | 'warning';  // default 'error'
  files?: string[];  // glob patterns this gate applies to
}

export interface IntegrationsConfig {
  linear?: LinearConfig;
  jira?: JiraConfig;
  github?: GitHubConfig;
}

export interface LinearConfig {
  apiKey: string;
  teamId: string;
  projectId?: string;
  syncInterval: number; // minutes
  bidirectionalSync: boolean;
}

export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
  syncInterval: number;
  bidirectionalSync: boolean;
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  syncInterval: number;
  bidirectionalSync: boolean;
}

// ============================================================================
// Entity Hierarchy System (Wheelhaus foundation)
// ============================================================================

/**
 * HierarchyDefinition
 *
 * Defines a structural vocabulary for a project. Examples:
 * - Mobile app: App > Module > Screen > Component
 * - API: Service > Domain > Resource > Endpoint
 * - Monorepo: Package > Module > Class > Method
 *
 * The hierarchy is a grammar, not a fixed model. Projects define their own
 * levels and the system provides consistent traversal regardless of vocabulary.
 */
export interface HierarchyDefinition {
  id: string;
  projectId: string;
  name: string;          // "Mobile App Structure", "API Architecture"
  description?: string;
  levels: HierarchyLevel[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * HierarchyLevel
 *
 * A single level in the hierarchy. Order determines depth:
 * - order 0 = root (e.g., "App", "Service")
 * - higher order = deeper in hierarchy (e.g., "Component", "Endpoint")
 */
export interface HierarchyLevel {
  id: string;
  name: string;          // "Screen", "Component", "Endpoint"
  pluralName: string;    // "Screens", "Components", "Endpoints"
  order: number;         // 0 = root, higher = deeper
  description?: string;
  color?: string;        // For visualization
  icon?: string;         // For visualization
}

/**
 * HierarchyNode
 *
 * An instance of an entity at a specific level in the hierarchy.
 * Links an entity (task, artifact, decision) to its position in the project structure.
 */
export interface HierarchyNode {
  id: string;
  hierarchyId: string;   // Which hierarchy definition
  levelId: string;       // Which level in that hierarchy
  parentNodeId?: string; // Parent node (null for root nodes)
  entityType: HierarchyEntityType;
  entityId: string;      // ID of the task/artifact/decision
  name: string;          // Display name for this node
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type HierarchyEntityType =
  // Core coordination entities
  | 'task'
  | 'artifact'
  | 'decision'
  | 'virtual'
  // Source ingestion entities (from ingesters)
  | 'package'    // TypeScript/Node package
  | 'module'     // Code module/directory
  | 'file'       // Source file
  | 'export'     // Exported function/class/type
  | 'service'    // MCP server or API service
  | 'category'   // Tool/endpoint category
  | 'tool'       // MCP tool
  | 'resource'   // MCP resource or API resource
  | 'prompt'     // MCP prompt
  | 'api'        // REST API root
  | 'domain'     // API domain (from tags)
  | 'endpoint'   // API endpoint
  | 'schema'     // Data schema
  | 'app'        // Application root (React, Xcode)
  | 'feature'    // Feature module
  | 'page'       // Page/route component
  | 'component'  // UI component
  | 'hook'       // React hook
  | 'context'    // React context
  | 'target'     // Build target (Xcode)
  | 'group'      // File group (Xcode)
  | 'util';      // Utility file

/**
 * HierarchyTraversalResult
 *
 * Result of traversal queries (ancestors, descendants, siblings)
 */
export interface HierarchyTraversalResult {
  nodes: HierarchyNode[];
  levelInfo: HierarchyLevel[];
  path: string[];  // Human-readable path like ["App", "Auth Module", "Login Screen"]
}

/**
 * CrossLevelQuery
 *
 * Result of cross-cutting queries ("show all components and their usage across screens")
 */
export interface CrossLevelResult {
  level: HierarchyLevel;
  nodes: Array<{
    node: HierarchyNode;
    usedIn: HierarchyNode[];  // Parent contexts where this node appears
    usageCount: number;
  }>;
}
