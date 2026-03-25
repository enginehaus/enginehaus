/**
 * Events Module Index
 *
 * Export all event-related types and services.
 */

export {
  EventOrchestrator,
  eventOrchestrator,
  // Event Types
  EventCategory,
  TaskEventType,
  SessionEventType,
  ProjectEventType,
  DecisionEventType,
  QualityEventType,
  PhaseEventType,
  HandoffEventType,
  EnginehausEventType,
  // Payloads
  BaseEventPayload,
  TaskEventPayload,
  SessionEventPayload,
  ProjectEventPayload,
  DecisionEventPayload,
  QualityEventPayload,
  PhaseEventPayload,
  HandoffEventPayload,
  EnginehausEventPayload,
  // Listeners
  EventListener,
  EventSubscription,
  EventFilter,
} from './event-orchestrator.js';

// Note: Webhook system intentionally removed in platform health remediation.
// Will be reimplemented with proper persistence when actual need emerges.
