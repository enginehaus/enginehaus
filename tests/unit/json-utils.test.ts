import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '../../src/utils/json.js';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
    expect(safeJsonParse('"hello"', '')).toBe('hello');
    expect(safeJsonParse('42', 0)).toBe(42);
  });

  it('returns fallback for null input', () => {
    expect(safeJsonParse(null, [])).toEqual([]);
    expect(safeJsonParse(null, {})).toEqual({});
    expect(safeJsonParse(null, undefined)).toBeUndefined();
  });

  it('returns fallback for undefined input', () => {
    expect(safeJsonParse(undefined, [])).toEqual([]);
    expect(safeJsonParse(undefined, 'default')).toBe('default');
  });

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', [])).toEqual([]);
    expect(safeJsonParse('', {})).toEqual({});
  });

  it('returns fallback for malformed JSON', () => {
    expect(safeJsonParse('{invalid', {})).toEqual({});
    expect(safeJsonParse('not json at all', [])).toEqual([]);
    expect(safeJsonParse('{unclosed', undefined)).toBeUndefined();
  });

  it('preserves type parameter', () => {
    const result = safeJsonParse<string[]>('["a","b"]', []);
    expect(result).toEqual(['a', 'b']);

    const fallback = safeJsonParse<string[]>('{bad', ['default']);
    expect(fallback).toEqual(['default']);
  });
});
