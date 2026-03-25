/**
 * Completion Validator
 *
 * Lightweight semantic validation at task completion. Checks whether
 * the completed work matches the task description and acceptance criteria.
 *
 * IMPORTANT: This is SEMANTIC validation only (did you complete the right task?).
 * Quality gate enforcement (tests, decisions) is handled separately in
 * completeTaskSmart with enforceOnCompletion config. Quality gates DO block
 * by default. This semantic validator is advisory.
 *
 * Design Principles:
 * - Cheap and fast - single short prompt, not full review
 * - Advisory (this validator) - warns about semantic mismatches, doesn't block
 * - Quality gates (separate) - block completion by default unless bypassed
 * - Catches "oops wrong task" and "forgot half the requirements"
 * - Doesn't duplicate what gates already catch (tests, lint, build)
 */

import { UnifiedTask } from '../coordination/types.js';
import { GitAnalysis } from '../git/git-analysis.js';

export interface ValidationResult {
  /** Whether the work appears to match the task */
  valid: boolean;
  /** Confidence score 0.0 to 1.0 */
  confidence: number;
  /** Brief explanation of the validation result */
  rationale: string;
  /** Specific concerns if any */
  concerns?: string[];
  /** Suggestions for improvement */
  suggestions?: string[];
  /** Time taken in milliseconds */
  validationTimeMs: number;
  /** Which validation method was used */
  method: 'llm' | 'heuristic' | 'skipped';
}

export interface CompletionValidatorConfig {
  /** Whether validation is enabled */
  enabled: boolean;
  /** Use LLM for validation (requires API key) */
  useLLM: boolean;
  /** Model to use for validation */
  model?: string;
  /** Maximum time for validation in ms (default: 5000) */
  timeoutMs?: number;
  /** Skip validation for trivial changes (< N files) */
  skipForSmallChanges?: number;
  /** API key for LLM provider (if not using env var) */
  apiKey?: string;
}

export const DEFAULT_VALIDATOR_CONFIG: CompletionValidatorConfig = {
  enabled: true,
  useLLM: false, // Default to heuristic until LLM is configured
  timeoutMs: 5000,
  skipForSmallChanges: 0, // Validate all changes by default
};

/**
 * Validate that completed work matches task requirements
 */
export async function validateCompletion(
  task: UnifiedTask,
  gitAnalysis: GitAnalysis,
  summary: string,
  config: CompletionValidatorConfig = DEFAULT_VALIDATOR_CONFIG
): Promise<ValidationResult> {
  const startTime = Date.now();

  // Skip if disabled
  if (!config.enabled) {
    return {
      valid: true,
      confidence: 1.0,
      rationale: 'Validation disabled',
      validationTimeMs: Date.now() - startTime,
      method: 'skipped',
    };
  }

  // Skip for small changes if configured
  if (config.skipForSmallChanges && gitAnalysis.filesChanged.length < config.skipForSmallChanges) {
    return {
      valid: true,
      confidence: 0.8,
      rationale: `Skipped validation for small change (${gitAnalysis.filesChanged.length} files)`,
      validationTimeMs: Date.now() - startTime,
      method: 'skipped',
    };
  }

  // Use LLM if configured and available
  if (config.useLLM && config.apiKey) {
    try {
      return await validateWithLLM(task, gitAnalysis, summary, config, startTime);
    } catch (error) {
      // Fall back to heuristic on LLM failure
      console.warn('LLM validation failed, falling back to heuristic:', error);
    }
  }

  // Use heuristic validation
  return validateWithHeuristics(task, gitAnalysis, summary, startTime);
}

/**
 * Heuristic validation using keyword matching and file analysis
 */
function validateWithHeuristics(
  task: UnifiedTask,
  gitAnalysis: GitAnalysis,
  summary: string,
  startTime: number
): ValidationResult {
  const concerns: string[] = [];
  const suggestions: string[] = [];
  let score = 1.0;

  // Extract keywords from task
  const taskText = `${task.title} ${task.description}`.toLowerCase();
  const summaryText = summary.toLowerCase();
  const commitMessages = gitAnalysis.commitMessages.join(' ').toLowerCase();
  const filesChanged = gitAnalysis.filesChanged.map(f => f.toLowerCase());

  // 1. Check if task mentions specific files and they were changed
  if (task.files && task.files.length > 0) {
    const mentionedFiles = task.files.map(f => f.toLowerCase());
    const touchedMentioned = mentionedFiles.filter(mf =>
      filesChanged.some(fc => fc.includes(mf) || mf.includes(fc))
    );

    if (touchedMentioned.length === 0) {
      concerns.push(`Task mentioned ${task.files.length} file(s) but none appear to be changed`);
      suggestions.push(`Review if changes were made to: ${task.files.slice(0, 3).join(', ')}`);
      score -= 0.3;
    } else if (touchedMentioned.length < mentionedFiles.length) {
      const missing = task.files.filter(f =>
        !filesChanged.some(fc => fc.includes(f.toLowerCase()))
      );
      concerns.push(`Only ${touchedMentioned.length}/${mentionedFiles.length} mentioned files were changed`);
      suggestions.push(`May need to review: ${missing.slice(0, 3).join(', ')}`);
      score -= 0.15;
    }
  }

  // 2. Check for keyword overlap between task and changes
  const taskKeywords = extractKeywords(taskText);
  const changeKeywords = extractKeywords(`${summaryText} ${commitMessages}`);

  const overlap = taskKeywords.filter(k => changeKeywords.includes(k));
  const overlapRatio = taskKeywords.length > 0 ? overlap.length / taskKeywords.length : 1;

  if (overlapRatio < 0.2 && taskKeywords.length > 3) {
    concerns.push('Low keyword match between task and changes');
    suggestions.push('Verify this is the correct task for these changes');
    score -= 0.25;
  }

  // 3. Check for common "forgot to do" patterns
  const actionWords = ['add', 'create', 'implement', 'fix', 'update', 'remove', 'delete', 'refactor'];
  const taskActions = actionWords.filter(a => taskText.includes(a));
  const changeActions = actionWords.filter(a =>
    summaryText.includes(a) || commitMessages.includes(a)
  );

  if (taskActions.length > 0 && changeActions.length === 0) {
    concerns.push(`Task mentions "${taskActions[0]}" but this action isn't reflected in changes`);
    score -= 0.1;
  }

  // 4. Check for test-related requirements
  if (taskText.includes('test') && !filesChanged.some(f => f.includes('test'))) {
    concerns.push('Task mentions testing but no test files were changed');
    suggestions.push('Consider adding tests if task requires them');
    score -= 0.1;
  }

  // 5. Check for empty or trivial changes
  if (gitAnalysis.linesAdded + gitAnalysis.linesRemoved < 5 && taskText.length > 200) {
    concerns.push('Very few lines changed for a substantial task description');
    suggestions.push('Verify all requirements have been addressed');
    score -= 0.2;
  }

  // Clamp score
  score = Math.max(0, Math.min(1, score));

  return {
    valid: score >= 0.5,
    confidence: score,
    rationale: generateRationale(score, concerns),
    concerns: concerns.length > 0 ? concerns : undefined,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    validationTimeMs: Date.now() - startTime,
    method: 'heuristic',
  };
}

/**
 * LLM-based validation (requires API key)
 */
async function validateWithLLM(
  task: UnifiedTask,
  gitAnalysis: GitAnalysis,
  summary: string,
  config: CompletionValidatorConfig,
  startTime: number
): Promise<ValidationResult> {
  // Build prompt
  const prompt = buildValidationPrompt(task, gitAnalysis, summary);

  // Note: This is a placeholder for actual LLM integration
  // In production, this would call Anthropic or other LLM API
  // For now, we throw to fall back to heuristics
  throw new Error('LLM validation not yet implemented - configure API integration');

  // Example of what the implementation would look like:
  // const response = await anthropic.messages.create({
  //   model: config.model || 'claude-3-haiku-20240307',
  //   max_tokens: 150,
  //   messages: [{ role: 'user', content: prompt }],
  // });
  // return parseValidationResponse(response, startTime);
}

/**
 * Build the validation prompt
 */
function buildValidationPrompt(
  task: UnifiedTask,
  gitAnalysis: GitAnalysis,
  summary: string
): string {
  const filesSummary = gitAnalysis.filesChanged.slice(0, 10).join('\n  - ');
  const commitsSummary = gitAnalysis.commitMessages.slice(0, 5).join('\n  - ');

  return `You are validating whether completed work matches a task. Answer YES or NO with one sentence rationale.

TASK:
Title: ${task.title}
Description: ${task.description.slice(0, 500)}
${task.files ? `Expected files: ${task.files.join(', ')}` : ''}

CHANGES:
Summary: ${summary}
Files changed (${gitAnalysis.filesChanged.length}):
  - ${filesSummary}
Commits (${gitAnalysis.commitCount}):
  - ${commitsSummary}
Lines: +${gitAnalysis.linesAdded} / -${gitAnalysis.linesRemoved}

Does this work accomplish the task? Reply: YES/NO - [one sentence rationale]`;
}

/**
 * Extract meaningful keywords from text
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'this', 'that', 'these',
    'those', 'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you',
    'your', 'i', 'me', 'my', 'he', 'she', 'him', 'her', 'his', 'hers',
  ]);

  return text
    .split(/\W+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 50);
}

/**
 * Generate human-readable rationale
 */
function generateRationale(score: number, concerns: string[]): string {
  if (score >= 0.8) {
    return 'Work appears to match task requirements';
  } else if (score >= 0.5) {
    return concerns.length > 0
      ? `Work likely matches but has concerns: ${concerns[0]}`
      : 'Work partially matches task requirements';
  } else {
    return concerns.length > 0
      ? `Potential mismatch: ${concerns[0]}`
      : 'Work may not match task requirements';
  }
}

/**
 * Format validation result for display
 */
export function formatValidationResult(result: ValidationResult): string {
  const status = result.valid ? '✓' : '⚠️';
  const confidence = Math.round(result.confidence * 100);

  let output = `${status} Completion validation: ${result.rationale} (${confidence}% confidence, ${result.validationTimeMs}ms)`;

  if (result.concerns && result.concerns.length > 0) {
    output += '\n   Concerns:';
    for (const concern of result.concerns) {
      output += `\n   - ${concern}`;
    }
  }

  if (result.suggestions && result.suggestions.length > 0) {
    output += '\n   Suggestions:';
    for (const suggestion of result.suggestions) {
      output += `\n   - ${suggestion}`;
    }
  }

  return output;
}
