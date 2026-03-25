import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAgentIdentity } from '../../src/utils/agent-identity.js';
import { parseActor, serializeActor, agentActor, type Actor } from '../../src/coordination/types.js';

describe('resolveAgentIdentity', () => {
  const originalEnv = process.env.ENGINEHAUS_AGENT_ID;

  beforeEach(() => {
    delete process.env.ENGINEHAUS_AGENT_ID;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENGINEHAUS_AGENT_ID = originalEnv;
    } else {
      delete process.env.ENGINEHAUS_AGENT_ID;
    }
  });

  it('returns default claude-code when no sources provided', () => {
    const result = resolveAgentIdentity({});
    expect(result).toEqual({
      agentId: 'claude-code',
      source: 'default',
      mismatch: false,
    });
  });

  it('resolves from MCP client name (highest priority)', () => {
    const result = resolveAgentIdentity({
      mcpClientName: 'Claude Code',
      paramAgentId: 'custom-agent',
      envAgentId: 'env-agent',
    });
    expect(result.agentId).toBe('claude-code');
    expect(result.source).toBe('mcp-client');
    expect(result.mismatch).toBe(true); // param differs from MCP
  });

  it('resolves from environment variable when no MCP client', () => {
    process.env.ENGINEHAUS_AGENT_ID = 'my-agent';
    const result = resolveAgentIdentity({});
    expect(result.agentId).toBe('my-agent');
    expect(result.source).toBe('environment');
  });

  it('resolves from explicit envAgentId over process.env', () => {
    process.env.ENGINEHAUS_AGENT_ID = 'from-process';
    const result = resolveAgentIdentity({ envAgentId: 'from-param' });
    expect(result.agentId).toBe('from-param');
    expect(result.source).toBe('environment');
  });

  it('resolves from parameter when no MCP or env', () => {
    const result = resolveAgentIdentity({ paramAgentId: 'cursor-ai' });
    expect(result.agentId).toBe('cursor-ai');
    expect(result.source).toBe('parameter');
    expect(result.mismatch).toBe(false);
  });

  it('normalizes known client names', () => {
    const cases = [
      { input: 'Claude Code', expected: 'claude-code' },
      { input: 'Claude Desktop', expected: 'claude-desktop' },
      { input: 'Cursor', expected: 'cursor' },
      { input: 'Continue Dev', expected: 'continue' },
      { input: 'ChatGPT Plugin', expected: 'chatgpt' },
      { input: 'Gemini Pro', expected: 'gemini' },
    ];

    for (const { input, expected } of cases) {
      const result = resolveAgentIdentity({ mcpClientName: input });
      expect(result.agentId).toBe(expected);
      expect(result.source).toBe('mcp-client');
    }
  });

  it('kebab-cases unknown client names', () => {
    const result = resolveAgentIdentity({ mcpClientName: 'My Custom Agent' });
    expect(result.agentId).toBe('my-custom-agent');
  });

  it('reports no mismatch when param matches MCP', () => {
    const result = resolveAgentIdentity({
      mcpClientName: 'Cursor',
      paramAgentId: 'cursor',
    });
    expect(result.mismatch).toBe(false);
  });

  it('handles empty string mcpClientName', () => {
    const result = resolveAgentIdentity({ mcpClientName: '' });
    // Empty string is falsy, falls through to default
    expect(result.agentId).toBe('claude-code');
    expect(result.source).toBe('default');
  });

  it('handles whitespace-only client name as fallthrough', () => {
    const result = resolveAgentIdentity({ mcpClientName: '  ' });
    // Whitespace normalizes to empty string (falsy), falls through to default
    expect(result.source).toBe('default');
    expect(result.agentId).toBe('claude-code');
  });

  it('strips special characters from unknown client names', () => {
    const result = resolveAgentIdentity({ mcpClientName: 'My Agent! @v2.0' });
    expect(result.agentId).toBe('my-agent-v20');
  });

  it('handles Mistral client name', () => {
    const result = resolveAgentIdentity({ mcpClientName: 'Mistral IDE' });
    expect(result.agentId).toBe('mistral');
  });

  it('handles claude.ai variant', () => {
    const result = resolveAgentIdentity({ mcpClientName: 'claude.ai' });
    expect(result.agentId).toBe('claude');
  });
});

describe('parseActor', () => {
  it('returns undefined for null/undefined/empty', () => {
    expect(parseActor(null)).toBeUndefined();
    expect(parseActor(undefined)).toBeUndefined();
    expect(parseActor('')).toBeUndefined();
  });

  it('parses JSON Actor format', () => {
    const json = '{"type":"agent","id":"claude-code"}';
    const actor = parseActor(json);
    expect(actor).toEqual({ type: 'agent', id: 'claude-code' });
  });

  it('parses JSON Actor with optional fields', () => {
    const json = '{"type":"human","id":"trevor","name":"Trevor","instanceId":"laptop-1"}';
    const actor = parseActor(json);
    expect(actor).toEqual({ type: 'human', id: 'trevor', name: 'Trevor', instanceId: 'laptop-1' });
  });

  it('treats plain string as legacy agent', () => {
    const actor = parseActor('claude-desktop');
    expect(actor).toEqual({ type: 'agent', id: 'claude-desktop' });
  });

  it('treats invalid JSON as legacy string', () => {
    const actor = parseActor('not-json');
    expect(actor).toEqual({ type: 'agent', id: 'not-json' });
  });

  it('treats JSON without type/id as legacy string', () => {
    const actor = parseActor('{"foo":"bar"}');
    expect(actor).toEqual({ type: 'agent', id: '{"foo":"bar"}' });
  });

  it('handles cli-user legacy string', () => {
    const actor = parseActor('cli-user');
    expect(actor).toEqual({ type: 'agent', id: 'cli-user' });
  });
});

describe('serializeActor', () => {
  it('serializes basic actor', () => {
    const actor: Actor = { type: 'agent', id: 'claude-code' };
    const json = serializeActor(actor);
    expect(JSON.parse(json)).toEqual({ type: 'agent', id: 'claude-code' });
  });

  it('includes name when present', () => {
    const actor: Actor = { type: 'human', id: 'trevor', name: 'Trevor' };
    const json = serializeActor(actor);
    expect(JSON.parse(json)).toEqual({ type: 'human', id: 'trevor', name: 'Trevor' });
  });

  it('includes instanceId when present', () => {
    const actor: Actor = { type: 'agent', id: 'claude-code', instanceId: 'laptop-1' };
    const json = serializeActor(actor);
    expect(JSON.parse(json)).toEqual({ type: 'agent', id: 'claude-code', instanceId: 'laptop-1' });
  });

  it('omits undefined optional fields', () => {
    const actor: Actor = { type: 'system', id: 'system' };
    const json = serializeActor(actor);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ type: 'system', id: 'system' });
    expect(parsed.name).toBeUndefined();
    expect(parsed.instanceId).toBeUndefined();
  });

  it('round-trips through parseActor', () => {
    const original: Actor = { type: 'human', id: 'trevor', name: 'Trevor W' };
    const serialized = serializeActor(original);
    const parsed = parseActor(serialized);
    expect(parsed?.type).toBe(original.type);
    expect(parsed?.id).toBe(original.id);
    expect(parsed?.name).toBe(original.name);
  });
});

describe('agentActor', () => {
  it('creates agent actor from id string', () => {
    const actor = agentActor('claude-desktop');
    expect(actor).toEqual({ type: 'agent', id: 'claude-desktop' });
  });
});
