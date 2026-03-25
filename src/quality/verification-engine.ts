/**
 * Verification Engine
 *
 * Synthesizes quality gate signals, structural checks, and optional LLM judgment
 * into a single confidence verdict. Designed to be harness-agnostic and extensible —
 * new verification primitives (gates) plug in without framework changes.
 *
 * The output is a "sniff test" card: one-glance confidence for any completed work.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface VerificationCheck {
  name: string;
  passed: boolean;
  severity: 'blocking' | 'advisory';
  message: string;
  /** Category for grouping: structural, semantic, security, custom */
  category: 'structural' | 'semantic' | 'security' | 'custom';
}

export interface VerificationVerdict {
  confidence: ConfidenceLevel;
  score: number; // 0-100
  checks: VerificationCheck[];
  summary: string;
  /** Intent alignment assessment (from LLM judge, if available) */
  intentAlignment?: {
    aligned: boolean;
    reasoning: string;
    scopeMatch: 'full' | 'partial' | 'mismatch';
  };
  /** Formatted card for terminal display */
  card: string;
}

export interface VerificationInput {
  taskTitle: string;
  taskDescription?: string;
  summary: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  commitMessages: string[];
  commitCount: number;
  decisionsLogged: number;
  decisionSummaries: string[];
  hasTests: boolean;
  testsPassing: boolean;
  securityFindings: number;
  privacyFindings: number;
  qualityGaps: string[];
  workflowWarnings: string[];
}

export interface LLMJudgeConfig {
  enabled: boolean;
  command?: string; // e.g. 'claude', 'gemini'
  timeoutMs: number;
}

// ============================================================================
// LLM CLI Agent Detection
// ============================================================================

/**
 * Known CLI agents that can serve as LLM judges.
 * Extensible — add new agents as they emerge. The judge can be any
 * participating or connected agent, not just these built-in ones.
 */
const KNOWN_CLI_AGENTS = [
  { command: 'claude', flag: '-p', name: 'Claude Code' },
  { command: 'gemini', flag: '', name: 'Gemini CLI' },
  { command: 'aider', flag: '--message', name: 'Aider' },
  { command: 'codex', flag: '--prompt', name: 'Codex CLI' },
] as const;

async function detectCLIAgent(
  preferredCommand?: string
): Promise<{ command: string; flag: string } | null> {
  // If user specified a command, try it first
  if (preferredCommand) {
    try {
      await execAsync(`which ${preferredCommand}`);
      // Find the flag for this agent, or default to -p
      const known = KNOWN_CLI_AGENTS.find(a => a.command === preferredCommand);
      return { command: preferredCommand, flag: known?.flag || '-p' };
    } catch {
      // Fall through to auto-detect
    }
  }

  for (const agent of KNOWN_CLI_AGENTS) {
    try {
      await execAsync(`which ${agent.command}`);
      return { command: agent.command, flag: agent.flag };
    } catch {
      // Not installed
    }
  }
  return null;
}

// ============================================================================
// Verification Engine
// ============================================================================

export class VerificationEngine {

  /**
   * Produce a confidence verdict from verification inputs.
   * This is the core synthesis — turns raw signals into a sniff test.
   */
  async verify(
    input: VerificationInput,
    llmConfig?: LLMJudgeConfig
  ): Promise<VerificationVerdict> {
    const checks: VerificationCheck[] = [];

    // -- Structural checks --

    // Scope relevance
    const codeFiles = input.filesChanged.filter(f =>
      /\.(ts|tsx|js|jsx|py|rb|go|java|rs)$/.test(f)
    );
    checks.push({
      name: 'Code changes',
      passed: codeFiles.length > 0 || input.filesChanged.length > 0,
      severity: 'advisory',
      message: `${codeFiles.length} code file(s), ${input.filesChanged.length} total`,
      category: 'structural',
    });

    // Decisions
    checks.push({
      name: 'Decisions logged',
      passed: input.decisionsLogged > 0,
      severity: codeFiles.length > 3 ? 'blocking' : 'advisory',
      message: input.decisionsLogged > 0
        ? `${input.decisionsLogged} decision(s): ${input.decisionSummaries.slice(0, 2).join('; ')}`
        : 'No decisions captured',
      category: 'structural',
    });

    // Tests
    checks.push({
      name: 'Tests',
      passed: input.hasTests,
      severity: codeFiles.length > 3 ? 'blocking' : 'advisory',
      message: input.hasTests
        ? (input.testsPassing ? 'Tests present and passing' : 'Tests present but status unknown')
        : 'No test changes detected',
      category: 'structural',
    });

    // Commit hygiene
    checks.push({
      name: 'Commit hygiene',
      passed: input.commitCount > 0,
      severity: 'blocking',
      message: `${input.commitCount} commit(s), ${input.linesAdded}+ / ${input.linesRemoved}- lines`,
      category: 'structural',
    });

    // -- Security checks --

    checks.push({
      name: 'Security scan',
      passed: input.securityFindings === 0,
      severity: 'advisory',
      message: input.securityFindings === 0
        ? 'No security concerns'
        : `${input.securityFindings} finding(s) — review recommended`,
      category: 'security',
    });

    checks.push({
      name: 'Privacy scan',
      passed: input.privacyFindings === 0,
      severity: 'advisory',
      message: input.privacyFindings === 0
        ? 'No privacy concerns'
        : `${input.privacyFindings} finding(s) — review recommended`,
      category: 'security',
    });

    // -- Semantic check (LLM judge) --
    let intentAlignment: VerificationVerdict['intentAlignment'] | undefined;

    if (llmConfig?.enabled) {
      intentAlignment = await this.runLLMJudge(input, llmConfig);
      if (intentAlignment) {
        checks.push({
          name: 'Intent alignment',
          passed: intentAlignment.aligned,
          severity: 'advisory',
          message: intentAlignment.reasoning,
          category: 'semantic',
        });
      }
    }

    // -- Scope match (structural, no LLM) --
    const scopeCheck = this.checkScopeMatch(input);
    checks.push(scopeCheck);

    // -- Synthesize confidence --
    const score = this.calculateScore(checks);
    const confidence = this.scoreToConfidence(score);
    const summary = this.buildSummary(input, checks, confidence);
    const card = this.formatCard(input, checks, confidence, score, intentAlignment);

    return { confidence, score, checks, summary, intentAlignment, card };
  }

  /**
   * Structural scope match — do the files changed relate to the task?
   */
  private checkScopeMatch(input: VerificationInput): VerificationCheck {
    if (!input.taskTitle && !input.taskDescription) {
      return {
        name: 'Scope match',
        passed: true,
        severity: 'advisory',
        message: 'No task description to compare against',
        category: 'structural',
      };
    }

    const taskWords = new Set(
      `${input.taskTitle} ${input.taskDescription || ''}`
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
    );

    // Check if file paths/names overlap with task keywords
    const fileWords = new Set(
      input.filesChanged
        .join(' ')
        .replace(/[^a-z0-9\s]/gi, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3)
    );

    // Check if commit messages overlap with task keywords
    const commitWords = new Set(
      input.commitMessages
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
    );

    const allWorkWords = new Set([...fileWords, ...commitWords]);
    const overlap = [...taskWords].filter(w => allWorkWords.has(w));
    const overlapRatio = taskWords.size > 0 ? overlap.length / taskWords.size : 0;

    return {
      name: 'Scope match',
      passed: overlapRatio > 0.15,
      severity: 'advisory',
      message: overlapRatio > 0.4
        ? 'Changes align well with task description'
        : overlapRatio > 0.15
          ? 'Partial alignment with task description'
          : 'Low keyword overlap — verify changes match intent',
      category: 'structural',
    };
  }

  /**
   * LLM-as-judge via CLI shell call. Zero API cost — uses the user's installed agent.
   */
  private async runLLMJudge(
    input: VerificationInput,
    config: LLMJudgeConfig
  ): Promise<VerificationVerdict['intentAlignment'] | undefined> {
    try {
      const agent = await detectCLIAgent(config.command);

      if (!agent) return undefined;

      const diffSummary = input.filesChanged.slice(0, 20).join(', ');
      const decisions = input.decisionSummaries.slice(0, 3).join('; ');

      const prompt = [
        'You are a code review judge. Respond ONLY with valid JSON, no other text.',
        '',
        `Task: "${input.taskTitle}"`,
        input.taskDescription ? `Description: "${input.taskDescription}"` : '',
        `Agent summary: "${input.summary}"`,
        `Files changed: ${diffSummary}`,
        `Commits: ${input.commitMessages.slice(0, 5).join('; ')}`,
        decisions ? `Key decisions: ${decisions}` : '',
        '',
        'Assess whether the completed work aligns with the task intent.',
        'Respond with exactly this JSON structure:',
        '{"aligned": true/false, "reasoning": "one sentence", "scopeMatch": "full"/"partial"/"mismatch"}',
      ].filter(Boolean).join('\n');

      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      const cmd = `${agent.command} ${agent.flag} '${escapedPrompt}' --output-format json 2>/dev/null || ${agent.command} ${agent.flag} '${escapedPrompt}' 2>/dev/null`;

      const { stdout } = await execAsync(cmd, {
        timeout: config.timeoutMs,
      });

      // Extract JSON from response (agent may include extra text)
      const jsonMatch = stdout.match(/\{[^}]*"aligned"[^}]*\}/);
      if (!jsonMatch) return undefined;

      const result = JSON.parse(jsonMatch[0]);
      return {
        aligned: Boolean(result.aligned),
        reasoning: String(result.reasoning || 'No reasoning provided'),
        scopeMatch: ['full', 'partial', 'mismatch'].includes(result.scopeMatch)
          ? result.scopeMatch as 'full' | 'partial' | 'mismatch'
          : 'partial',
      };
    } catch {
      // LLM judge is best-effort — never blocks completion
      return undefined;
    }
  }

  /**
   * Calculate a 0-100 confidence score from checks.
   */
  private calculateScore(checks: VerificationCheck[]): number {
    let score = 100;

    for (const check of checks) {
      if (!check.passed) {
        score -= check.severity === 'blocking' ? 25 : 10;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  private scoreToConfidence(score: number): ConfidenceLevel {
    if (score >= 75) return 'high';
    if (score >= 45) return 'medium';
    return 'low';
  }

  private buildSummary(
    input: VerificationInput,
    checks: VerificationCheck[],
    confidence: ConfidenceLevel
  ): string {
    const passed = checks.filter(c => c.passed).length;
    const total = checks.length;
    return `${confidence.toUpperCase()} confidence — ${passed}/${total} checks passed (${input.filesChanged.length} files, ${input.commitCount} commits)`;
  }

  /**
   * Format the sniff test card for terminal display.
   */
  formatCard(
    input: VerificationInput,
    checks: VerificationCheck[],
    confidence: ConfidenceLevel,
    score: number,
    intentAlignment?: VerificationVerdict['intentAlignment']
  ): string {
    const icon = confidence === 'high' ? '🟢' : confidence === 'medium' ? '🟡' : '🔴';
    const lines: string[] = [];

    lines.push(`┌${'─'.repeat(54)}┐`);
    lines.push(`│  Task: ${this.truncate(input.taskTitle, 43).padEnd(44)}│`);
    lines.push(`│  Confidence: ${icon} ${confidence.toUpperCase()} (${score}/100)${' '.repeat(Math.max(0, 33 - confidence.length))}│`);
    lines.push(`│${'─'.repeat(54)}│`);

    for (const check of checks) {
      const mark = check.passed ? '✓' : (check.severity === 'blocking' ? '✗' : '⚠');
      const msg = this.truncate(check.message, 48);
      lines.push(`│  ${mark} ${msg.padEnd(50)}│`);
    }

    lines.push(`│${'─'.repeat(54)}│`);
    lines.push(`│  Changed: ${input.filesChanged.length} files, +${input.linesAdded} -${input.linesRemoved} lines${' '.repeat(Math.max(0, 25 - String(input.filesChanged.length).length - String(input.linesAdded).length - String(input.linesRemoved).length))}│`);

    if (input.decisionSummaries.length > 0) {
      lines.push(`│  Key: ${this.truncate(input.decisionSummaries[0], 46).padEnd(47)}│`);
    }

    if (intentAlignment) {
      const alignIcon = intentAlignment.aligned ? '✓' : '⚠';
      lines.push(`│  ${alignIcon} Intent: ${this.truncate(intentAlignment.reasoning, 42).padEnd(43)}│`);
    }

    lines.push(`└${'─'.repeat(54)}┘`);

    return lines.join('\n');
  }

  private truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
  }
}
