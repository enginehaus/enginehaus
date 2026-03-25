import { describe, it, expect } from 'vitest';
import { VerificationEngine, VerificationInput } from '../../src/quality/verification-engine.js';

function makeInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    taskTitle: 'Implement auth system',
    taskDescription: 'Add JWT authentication with refresh tokens',
    summary: 'Implemented JWT auth with refresh token rotation',
    filesChanged: ['src/auth/jwt.ts', 'src/auth/refresh.ts', 'tests/auth.test.ts'],
    linesAdded: 180,
    linesRemoved: 22,
    commitMessages: ['feat: add JWT auth', 'test: add auth tests'],
    commitCount: 2,
    decisionsLogged: 2,
    decisionSummaries: ['JWT with refresh tokens', 'bcrypt over argon2'],
    hasTests: true,
    testsPassing: true,
    securityFindings: 0,
    privacyFindings: 0,
    qualityGaps: [],
    workflowWarnings: [],
    ...overrides,
  };
}

describe('VerificationEngine', () => {
  const engine = new VerificationEngine();

  describe('verify', () => {
    it('returns high confidence for clean completion', async () => {
      const result = await engine.verify(makeInput());

      expect(result.confidence).toBe('high');
      expect(result.score).toBeGreaterThanOrEqual(75);
      expect(result.checks.every(c => c.passed)).toBe(true);
      expect(result.card).toContain('HIGH');
      expect(result.card).toContain('auth system');
    });

    it('returns medium confidence when decisions missing on large change', async () => {
      const result = await engine.verify(makeInput({
        decisionsLogged: 0,
        decisionSummaries: [],
        filesChanged: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      }));

      expect(result.confidence).toBe('medium');
      const decisionCheck = result.checks.find(c => c.name === 'Decisions logged');
      expect(decisionCheck?.passed).toBe(false);
    });

    it('returns low confidence when multiple blocking checks fail', async () => {
      const result = await engine.verify(makeInput({
        decisionsLogged: 0,
        decisionSummaries: [],
        hasTests: false,
        commitCount: 0,
        filesChanged: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      }));

      expect(result.confidence).toBe('low');
      expect(result.score).toBeLessThan(45);
    });

    it('includes security findings in checks', async () => {
      const result = await engine.verify(makeInput({
        securityFindings: 3,
      }));

      const securityCheck = result.checks.find(c => c.name === 'Security scan');
      expect(securityCheck?.passed).toBe(false);
      expect(securityCheck?.message).toContain('3');
    });

    it('includes scope match check', async () => {
      const result = await engine.verify(makeInput());

      const scopeCheck = result.checks.find(c => c.name === 'Scope match');
      expect(scopeCheck).toBeDefined();
      // 'auth' appears in both task title and file paths
      expect(scopeCheck?.passed).toBe(true);
    });

    it('flags scope mismatch when files unrelated to task', async () => {
      const result = await engine.verify(makeInput({
        taskTitle: 'Fix payment processing',
        taskDescription: 'Stripe webhook handling is broken',
        filesChanged: ['src/ui/header.css', 'src/ui/footer.css'],
        commitMessages: ['style: update layout'],
      }));

      const scopeCheck = result.checks.find(c => c.name === 'Scope match');
      expect(scopeCheck?.passed).toBe(false);
    });
  });

  describe('formatCard', () => {
    it('produces a formatted card with box drawing characters', async () => {
      const result = await engine.verify(makeInput());

      expect(result.card).toContain('┌');
      expect(result.card).toContain('└');
      expect(result.card).toContain('Confidence:');
      expect(result.card).toContain('Changed:');
    });

    it('includes decision summary in card', async () => {
      const result = await engine.verify(makeInput());

      expect(result.card).toContain('JWT with refresh tokens');
    });
  });

  describe('without LLM judge', () => {
    it('does not include intent alignment when LLM disabled', async () => {
      const result = await engine.verify(makeInput(), { enabled: false, timeoutMs: 5000 });

      expect(result.intentAlignment).toBeUndefined();
    });
  });
});
