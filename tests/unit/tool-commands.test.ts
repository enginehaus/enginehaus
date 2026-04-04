import { describe, it, expect } from 'vitest';
import { parseToolArgs } from '../../src/bin/commands/tool-commands.js';
import { registry } from '../../src/adapters/mcp/tool-registry.js';

// Trigger tool self-registration
import '../../src/adapters/mcp/tools/index.js';

describe('tool-commands', () => {
  describe('parseToolArgs', () => {
    it('parses --key value pairs', () => {
      const result = parseToolArgs(['--taskId', 'abc123', '--type', 'design']);
      expect(result).toEqual({ taskId: 'abc123', type: 'design' });
    });

    it('parses --key=value syntax', () => {
      const result = parseToolArgs(['--taskId=abc123', '--type=design']);
      expect(result).toEqual({ taskId: 'abc123', type: 'design' });
    });

    it('parses boolean flags', () => {
      const result = parseToolArgs(['--enforceQuality', '--taskId', 'abc']);
      expect(result).toEqual({ enforceQuality: true, taskId: 'abc' });
    });

    it('skips --json flag (reserved for output formatting)', () => {
      const result = parseToolArgs(['--json', '--taskId', 'abc']);
      expect(result).toEqual({ taskId: 'abc' });
    });

    it('handles mixed formats', () => {
      const result = parseToolArgs(['--taskId=abc', '--verbose', '--limit', '10']);
      expect(result).toEqual({ taskId: 'abc', verbose: true, limit: '10' });
    });

    it('handles empty args', () => {
      expect(parseToolArgs([])).toEqual({});
    });

    it('ignores non-flag args', () => {
      const result = parseToolArgs(['positional', '--key', 'value']);
      expect(result).toEqual({ key: 'value' });
    });
  });

  describe('registry integration', () => {
    it('has tools registered', () => {
      expect(registry.size).toBeGreaterThan(100);
    });

    it('resolves known tools', () => {
      const def = registry.resolve('store_artifact');
      expect(def).toBeDefined();
      expect(def!.name).toBe('store_artifact');
      expect(def!.inputSchema).toBeDefined();
    });

    it('returns undefined for unknown tools', () => {
      expect(registry.resolve('nonexistent_tool')).toBeUndefined();
    });

    it('searches by keyword', () => {
      const results = registry.search('artifact');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name === 'store_artifact')).toBe(true);
    });

    it('lists by domain', () => {
      const domains = registry.listByDomain();
      expect(Object.keys(domains).length).toBeGreaterThan(0);
      expect(domains['artifact']).toBeDefined();
    });
  });
});
