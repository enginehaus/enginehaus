/**
 * Core Services Index
 *
 * Export all core business logic services.
 * These are protocol-agnostic and can be used by any adapter.
 */

export { CoordinationService, ClaimResult, TaskFilter } from './coordination-service.js';
export { ProjectService } from './project-service.js';
export { DecisionService } from './decision-service.js';
export { PhaseService } from './phase-service.js';
export { TaskService } from './task-service.js';
export { SessionService } from './session-service.js';
export { CompletionService } from './completion-service.js';
export { AnalyticsService } from './analytics-service.js';
export { ArtifactService } from './artifact-service.js';
export { CheckpointService } from './checkpoint-service.js';
export { HandoffServiceAdapter } from './handoff-service-adapter.js';
export { InitiativeService } from './initiative-service.js';
export type { ServiceContext } from './service-context.js';
