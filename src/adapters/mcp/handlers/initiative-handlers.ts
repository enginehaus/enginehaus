/**
 * Initiative Tool Handlers
 *
 * Handlers for initiative/outcome tracking MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';

export interface CreateInitiativeParams {
  title: string;
  description?: string;
  successCriteria?: string;
  projectId?: string;
}

export interface GetInitiativeParams {
  initiativeId: string;
}

export interface ListInitiativesParams {
  projectId?: string;
  status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
  limit?: number;
}

export interface LinkTaskToInitiativeParams {
  taskId: string;
  initiativeId: string;
  contributionNotes?: string;
}

export interface RecordInitiativeOutcomeParams {
  initiativeId: string;
  status: 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
  outcomeNotes: string;
}

export interface UpdateInitiativeParams {
  initiativeId: string;
  title?: string;
  description?: string;
  successCriteria?: string;
  status?: 'active' | 'succeeded' | 'failed' | 'pivoted' | 'abandoned';
  outcomeNotes?: string;
  projectId?: string;
}

export interface GetInitiativeLearningsParams {
  projectId?: string;
}

export async function handleCreateInitiative(
  service: CoordinationService,
  args: CreateInitiativeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.createInitiative({
    title: args.title,
    description: args.description,
    successCriteria: args.successCriteria,
    projectId: args.projectId,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetInitiative(
  service: CoordinationService,
  args: GetInitiativeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getInitiative(args.initiativeId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleListInitiatives(
  service: CoordinationService,
  args: ListInitiativesParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.listInitiatives({
    projectId: args.projectId,
    status: args.status,
    limit: args.limit,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleLinkTaskToInitiative(
  service: CoordinationService,
  args: LinkTaskToInitiativeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.linkTaskToInitiative({
    taskId: args.taskId,
    initiativeId: args.initiativeId,
    contributionNotes: args.contributionNotes,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleRecordInitiativeOutcome(
  service: CoordinationService,
  args: RecordInitiativeOutcomeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.recordInitiativeOutcome({
    initiativeId: args.initiativeId,
    status: args.status,
    outcomeNotes: args.outcomeNotes,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleUpdateInitiative(
  service: CoordinationService,
  args: UpdateInitiativeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.updateInitiative({
    initiativeId: args.initiativeId,
    title: args.title,
    description: args.description,
    successCriteria: args.successCriteria,
    status: args.status,
    outcomeNotes: args.outcomeNotes,
    projectId: args.projectId,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

export async function handleGetInitiativeLearnings(
  service: CoordinationService,
  args: GetInitiativeLearningsParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.getInitiativeLearnings({
    projectId: args.projectId,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

// ── Initiative Discovery ──────────────────────────────────────────────

export interface SuggestInitiativesParams {
  projectId?: string;
  minClusterSize?: number;
  maxSuggestions?: number;
}

export async function handleSuggestInitiatives(
  service: CoordinationService,
  args: SuggestInitiativesParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.suggestInitiatives({
    projectId: args.projectId,
    minClusterSize: args.minClusterSize,
    maxSuggestions: args.maxSuggestions,
  });
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
