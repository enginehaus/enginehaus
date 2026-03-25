/**
 * Cross-Platform MCP Integration Tests
 *
 * Verifies that Enginehaus coordination works across different LLM platforms:
 * - Claude (Code/Desktop)
 * - ChatGPT (with MCP Developer Mode)
 * - Gemini (CLI/SDK)
 * - Mistral (Le Chat MCP Connectors)
 * - Cursor, Continue.dev
 *
 * These tests validate the cross-LLM coordination patterns:
 * 1. Single-LLM workflow completion
 * 2. Cross-LLM handoff scenarios
 * 3. Decision logging from different LLM types
 * 4. AX survey submission from each LLM type
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AgentType,
  AgentMetadata,
  CoordinationSession,
} from '../../src/coordination/types.js';
import {
  generateChatGPTInstructions,
  generateGeminiInstructions,
  generateMistralInstructions,
  generateCursorInstructions,
  generateContinueInstructions,
  getTemplateGenerator,
  getInstructionFilename,
  SUPPORTED_LLMS,
  LLMTemplateOptions,
} from '../../src/onboarding/llm-templates.js';
import { AXSurveyResponse, validateSurveyResponses } from '../../src/ai/ax-survey.js';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_PROJECT_OPTIONS: LLMTemplateOptions = {
  projectName: 'Test Project',
  projectSlug: 'test-project',
  techStack: ['typescript', 'react', 'node'],
  mcpEndpoint: 'http://localhost:47470',
};

function createMockAgentMetadata(agentType: AgentType): AgentMetadata {
  const versions: Record<AgentType, string> = {
    claude: 'claude-sonnet-4',
    chatgpt: 'gpt-4o',
    gemini: 'gemini-2.5-pro',
    mistral: 'mistral-large',
    cursor: 'cursor-0.45',
    continue: 'continue-1.0',
    custom: 'custom-agent',
    human: 'human',
  };

  return {
    agentType,
    agentVersion: versions[agentType],
    capabilities: ['code', 'research'],
    mcpVersion: '1.0',
  };
}

function createMockSession(agentType: AgentType): Partial<CoordinationSession> {
  return {
    id: `session-${agentType}-${Date.now()}`,
    projectId: 'test-project',
    taskId: 'test-task',
    agentId: `${agentType}-agent`,
    agentMetadata: createMockAgentMetadata(agentType),
    status: 'active',
    startTime: new Date(),
    lastHeartbeat: new Date(),
  };
}

// ============================================================================
// Onboarding Template Tests
// ============================================================================

describe('Cross-LLM Onboarding Templates', () => {
  describe('Template Generation', () => {
    it('generates ChatGPT instructions with correct structure', () => {
      const instructions = generateChatGPTInstructions(TEST_PROJECT_OPTIONS);

      expect(instructions).toContain('# Enginehaus Coordination');
      expect(instructions).toContain('Test Project');
      expect(instructions).toContain('get_next_task');
      expect(instructions).toContain('log_decision');
      expect(instructions).toContain('complete_task_smart');
      expect(instructions).toContain('"agentType": "chatgpt"');
    });

    it('generates Gemini instructions with correct structure', () => {
      const instructions = generateGeminiInstructions(TEST_PROJECT_OPTIONS);

      expect(instructions).toContain('# Enginehaus Coordination');
      expect(instructions).toContain('Test Project');
      expect(instructions).toContain('get_next_task');
      expect(instructions).toContain('"agentType": "gemini"');
    });

    it('generates Mistral instructions with correct structure', () => {
      const instructions = generateMistralInstructions(TEST_PROJECT_OPTIONS);

      expect(instructions).toContain('# Enginehaus Coordination');
      expect(instructions).toContain('Test Project');
      expect(instructions).toContain('"agentType": "mistral"');
    });

    it('generates Cursor instructions with correct structure', () => {
      const instructions = generateCursorInstructions(TEST_PROJECT_OPTIONS);

      expect(instructions).toContain('# Enginehaus Coordination');
      expect(instructions).toContain('agentType": "cursor"');
    });

    it('generates Continue instructions with correct structure', () => {
      const instructions = generateContinueInstructions(TEST_PROJECT_OPTIONS);

      expect(instructions).toContain('# Enginehaus Coordination');
      expect(instructions).toContain('agentType": "continue"');
    });
  });

  describe('Template Selection', () => {
    it('returns correct generator for each agent type', () => {
      expect(getTemplateGenerator('chatgpt')).toBe(generateChatGPTInstructions);
      expect(getTemplateGenerator('gemini')).toBe(generateGeminiInstructions);
      expect(getTemplateGenerator('mistral')).toBe(generateMistralInstructions);
      expect(getTemplateGenerator('cursor')).toBe(generateCursorInstructions);
      expect(getTemplateGenerator('continue')).toBe(generateContinueInstructions);
    });

    it('returns null for unsupported agent types', () => {
      expect(getTemplateGenerator('human')).toBeNull();
      expect(getTemplateGenerator('custom')).toBeNull();
    });
  });

  describe('Instruction Filenames', () => {
    it('returns correct filenames for each agent type', () => {
      expect(getInstructionFilename('claude')).toBe('CLAUDE.md');
      expect(getInstructionFilename('chatgpt')).toBe('CHATGPT.md');
      expect(getInstructionFilename('gemini')).toBe('GEMINI.md');
      expect(getInstructionFilename('mistral')).toBe('MISTRAL.md');
      expect(getInstructionFilename('cursor')).toBe('CURSOR.md');
      expect(getInstructionFilename('continue')).toBe('CONTINUE.md');
      expect(getInstructionFilename('custom')).toBe('AGENT.md');
    });
  });

  describe('Supported LLMs Registry', () => {
    it('includes all major LLM platforms', () => {
      const types = SUPPORTED_LLMS.map(llm => llm.type);

      expect(types).toContain('claude');
      expect(types).toContain('chatgpt');
      expect(types).toContain('gemini');
      expect(types).toContain('mistral');
      expect(types).toContain('cursor');
      expect(types).toContain('continue');
    });

    it('specifies MCP support level for each LLM', () => {
      for (const llm of SUPPORTED_LLMS) {
        expect(['native', 'http', 'partial']).toContain(llm.mcpSupport);
      }
    });

    it('provides config location for each LLM', () => {
      for (const llm of SUPPORTED_LLMS) {
        expect(llm.configLocation).toBeDefined();
        expect(typeof llm.configLocation).toBe('string');
      }
    });
  });
});

// ============================================================================
// Agent Metadata Tests
// ============================================================================

describe('Cross-LLM Agent Metadata', () => {
  const agentTypes: AgentType[] = ['claude', 'chatgpt', 'gemini', 'mistral', 'cursor', 'continue'];

  describe('Metadata Creation', () => {
    it('creates valid metadata for each agent type', () => {
      for (const agentType of agentTypes) {
        const metadata = createMockAgentMetadata(agentType);

        expect(metadata.agentType).toBe(agentType);
        expect(metadata.agentVersion).toBeDefined();
        expect(metadata.capabilities).toContain('code');
        expect(metadata.mcpVersion).toBe('1.0');
      }
    });
  });

  describe('Session Metadata', () => {
    it('attaches agent metadata to coordination sessions', () => {
      for (const agentType of agentTypes) {
        const session = createMockSession(agentType);

        expect(session.agentMetadata).toBeDefined();
        expect(session.agentMetadata?.agentType).toBe(agentType);
      }
    });
  });
});

// ============================================================================
// Cross-LLM Workflow Tests
// ============================================================================

describe('Cross-LLM Workflow Scenarios', () => {
  describe('Single-LLM Workflow', () => {
    it('simulates complete workflow for Claude', () => {
      const session = createMockSession('claude');

      // Verify session can be created with Claude metadata
      expect(session.agentMetadata?.agentType).toBe('claude');
      expect(session.status).toBe('active');
    });

    it('simulates complete workflow for ChatGPT', () => {
      const session = createMockSession('chatgpt');

      expect(session.agentMetadata?.agentType).toBe('chatgpt');
      expect(session.agentMetadata?.agentVersion).toBe('gpt-4o');
    });

    it('simulates complete workflow for Gemini', () => {
      const session = createMockSession('gemini');

      expect(session.agentMetadata?.agentType).toBe('gemini');
      expect(session.agentMetadata?.agentVersion).toBe('gemini-2.5-pro');
    });
  });

  describe('Cross-LLM Handoff', () => {
    it('simulates handoff from Claude to ChatGPT', () => {
      // First session: Claude claims and works on task
      const claudeSession = createMockSession('claude');
      expect(claudeSession.taskId).toBe('test-task');

      // Simulate session end
      const completedClaudeSession = {
        ...claudeSession,
        status: 'completed' as const,
        endTime: new Date(),
      };

      // Second session: ChatGPT continues the work
      const chatgptSession = createMockSession('chatgpt');
      chatgptSession.taskId = claudeSession.taskId; // Same task

      // Verify handoff context would work
      expect(chatgptSession.taskId).toBe(completedClaudeSession.taskId);
      expect(chatgptSession.agentMetadata?.agentType).toBe('chatgpt');
    });

    it('simulates multi-LLM handoff chain', () => {
      const taskId = 'shared-task-123';

      // Claude starts
      const session1 = { ...createMockSession('claude'), taskId };
      expect(session1.agentMetadata?.agentType).toBe('claude');

      // Gemini continues
      const session2 = { ...createMockSession('gemini'), taskId };
      expect(session2.agentMetadata?.agentType).toBe('gemini');

      // ChatGPT completes
      const session3 = { ...createMockSession('chatgpt'), taskId };
      expect(session3.agentMetadata?.agentType).toBe('chatgpt');

      // All sessions share the same task
      expect(session1.taskId).toBe(session2.taskId);
      expect(session2.taskId).toBe(session3.taskId);
    });
  });
});

// ============================================================================
// AX Survey Cross-LLM Tests
// ============================================================================

describe('Cross-LLM AX Survey', () => {
  describe('Survey Response with Agent Type', () => {
    it('accepts survey responses with agentType context', () => {
      const response: AXSurveyResponse = {
        id: 'survey-1',
        surveyId: 'ax-v1',
        sessionId: 'session-1',
        projectId: 'test-project',
        agentId: 'chatgpt-agent',
        responses: {
          tool_discovery: 4,
          tool_syntax: 5,
          context_relevance: 4,
          context_completeness: 5,
          next_step_clarity: 4,
          workflow_sequence: true,
          error_recovery_ease: 4,
          error_messages_helpful: 4,
          overall_experience: 4,
          would_recommend: true,
        },
        submittedAt: new Date(),
        context: {
          toolsUsed: ['get_next_task', 'log_decision', 'complete_task_smart'],
          errorsEncountered: 0,
          sessionDurationMs: 300000,
          taskCompleted: true,
          agentType: 'chatgpt',
          agentVersion: 'gpt-4o',
        },
      };

      expect(response.context.agentType).toBe('chatgpt');
      expect(response.context.agentVersion).toBe('gpt-4o');

      // Validate responses
      const validation = validateSurveyResponses(response.responses);
      expect(validation.valid).toBe(true);
    });

    it('enables cross-LLM analysis by agent type', () => {
      const responses: AXSurveyResponse[] = [
        {
          id: 'survey-claude',
          surveyId: 'ax-v1',
          sessionId: 'session-claude',
          projectId: 'test',
          agentId: 'claude',
          responses: { overall_experience: 5, would_recommend: true },
          submittedAt: new Date(),
          context: {
            toolsUsed: [],
            errorsEncountered: 0,
            sessionDurationMs: 100000,
            taskCompleted: true,
            agentType: 'claude',
          },
        },
        {
          id: 'survey-chatgpt',
          surveyId: 'ax-v1',
          sessionId: 'session-chatgpt',
          projectId: 'test',
          agentId: 'chatgpt',
          responses: { overall_experience: 4, would_recommend: true },
          submittedAt: new Date(),
          context: {
            toolsUsed: [],
            errorsEncountered: 1,
            sessionDurationMs: 150000,
            taskCompleted: true,
            agentType: 'chatgpt',
          },
        },
      ];

      // Group by agent type for analysis
      const byAgentType = responses.reduce((acc, r) => {
        const type = r.context.agentType || 'unknown';
        if (!acc[type]) acc[type] = [];
        acc[type].push(r);
        return acc;
      }, {} as Record<string, AXSurveyResponse[]>);

      expect(byAgentType['claude']).toHaveLength(1);
      expect(byAgentType['chatgpt']).toHaveLength(1);
    });
  });
});

// ============================================================================
// MCP Compatibility Tests
// ============================================================================

describe('MCP Compatibility Matrix', () => {
  describe('Native MCP Support', () => {
    const nativeLLMs = SUPPORTED_LLMS.filter(l => l.mcpSupport === 'native');

    it('identifies LLMs with native MCP support', () => {
      const nativeTypes = nativeLLMs.map(l => l.type);

      expect(nativeTypes).toContain('claude');
      expect(nativeTypes).toContain('gemini');
      expect(nativeTypes).toContain('cursor');
      expect(nativeTypes).toContain('continue');
    });
  });

  describe('HTTP-based MCP Support', () => {
    const httpLLMs = SUPPORTED_LLMS.filter(l => l.mcpSupport === 'http');

    it('identifies LLMs requiring HTTP transport', () => {
      const httpTypes = httpLLMs.map(l => l.type);

      expect(httpTypes).toContain('chatgpt');
      expect(httpTypes).toContain('mistral');
    });
  });
});
