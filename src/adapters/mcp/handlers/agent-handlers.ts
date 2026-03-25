/**
 * Agent Registry Tool Handlers
 *
 * Handlers for agent registration and lookup MCP tools.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { AgentProfile, AgentCapability, AgentType } from '../../../coordination/types.js';

export async function handleRegisterAgent(
  service: CoordinationService,
  args: {
    id: string;
    name: string;
    agentType: AgentType;
    agentVersion?: string;
    capabilities: AgentCapability[];
    strengths?: string[];
    limitations?: string[];
    maxConcurrentTasks?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const now = new Date();
  const agent: AgentProfile = {
    id: args.id,
    name: args.name,
    agentType: args.agentType,
    agentVersion: args.agentVersion,
    capabilities: args.capabilities,
    strengths: args.strengths,
    limitations: args.limitations,
    maxConcurrentTasks: args.maxConcurrentTasks ?? 1,
    status: 'active',
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await service.registerAgent(agent);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        agentId: agent.id,
        name: agent.name,
        agentType: agent.agentType,
        capabilities: agent.capabilities,
        message: `Agent "${agent.name}" registered successfully`,
      }, null, 2),
    }],
  };
}

export async function handleListAgents(
  service: CoordinationService,
  args: {
    status?: 'active' | 'inactive' | 'busy';
    agentType?: string;
    capability?: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const agents = await service.listAgents(args);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        count: agents.length,
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          agentType: a.agentType,
          agentVersion: a.agentVersion,
          capabilities: a.capabilities,
          strengths: a.strengths,
          status: a.status,
          lastSeenAt: a.lastSeenAt,
        })),
      }, null, 2),
    }],
  };
}

export async function handleGetAgent(
  service: CoordinationService,
  args: { agentId: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const agent = await service.getAgent(args.agentId);

  if (!agent) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          message: `Agent "${args.agentId}" not found. Use register_agent to add it.`,
        }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        agent,
      }, null, 2),
    }],
  };
}

export async function handleUpdateAgent(
  service: CoordinationService,
  args: {
    agentId: string;
    name?: string;
    capabilities?: AgentCapability[];
    strengths?: string[];
    limitations?: string[];
    status?: 'active' | 'inactive' | 'busy';
    maxConcurrentTasks?: number;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const existing = await service.getAgent(args.agentId);
  if (!existing) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          message: `Agent "${args.agentId}" not found`,
        }, null, 2),
      }],
    };
  }

  const { agentId, ...updates } = args;
  await service.updateAgent(agentId, updates);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        message: `Agent "${agentId}" updated`,
      }, null, 2),
    }],
  };
}
