/**
 * Initiative Suggestions
 *
 * Analyzes existing tasks and decisions to propose initiative groupings.
 * Uses keyword clustering — no ML dependencies required.
 *
 * Two use cases:
 * 1. Mature projects: "You have 12 AX tasks, 8 launch tasks — create initiatives?"
 * 2. Briefing nudge: "No initiatives set. Based on recent work, consider: ..."
 */

import { UnifiedTask } from '../coordination/types.js';

export interface InitiativeSuggestion {
  title: string;
  description: string;
  taskIds: string[];
  taskCount: number;
  /** Keywords that formed this cluster */
  keywords: string[];
  /** Confidence: what fraction of tasks matched strongly */
  confidence: number;
}

// Stop words to filter out of keyword extraction
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'nor', 'so',
  'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it', 'its',
  'as', 'up', 'out', 'about', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'each', 'all', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'too', 'very', 'just', 'because', 'also', 'when', 'where', 'how',
  'what', 'which', 'who', 'whom', 'why', 'new', 'use', 'add', 'get',
  'set', 'make', 'show', 'list', 'create', 'update', 'delete', 'remove',
  'check', 'fix', 'implement', 'ensure', 'support', 'handle', 'based',
  // Domain-specific stop words (too generic in a task management context)
  'task', 'tasks', 'project', 'projects', 'feature', 'bug', 'issue',
  'change', 'changes', 'work', 'working', 'need', 'needs', 'using',
  'currently', 'existing', 'should', 'must', 'system', 'data', 'view',
  'mode', 'type', 'status', 'design', 'pattern', 'patterns',
  'enginehaus', 'agent', 'agents', 'context', 'decision', 'decisions',
  'initiative', 'initiatives', 'tool', 'tools', 'config', 'configuration',
  'session', 'sessions', 'prompt', 'response', 'error', 'errors',
  'test', 'tests', 'docs', 'document', 'documentation', 'file', 'files',
  'command', 'commands', 'service', 'services', 'handler', 'handlers',
  'add', 'added', 'adding', 'detect', 'detection', 'auto',
  'code', 'claude', 'api', 'app', 'web', 'log', 'track', 'tracking',
  'provide', 'surface', 'enable', 'improve', 'improvement', 'better',
  'current', 'first', 'next', 'last', 'specific', 'define', 'layer',
  'model', 'run', 'start', 'stop', 'capture', 'generate', 'output',
  'input', 'process', 'module', 'basic', 'full', 'real', 'time',
]);

// Known domain terms that should be kept as compound phrases
const COMPOUND_TERMS: Array<[RegExp, string]> = [
  [/\bagent\s*experience\b/i, 'agent-experience'],
  [/\bquality\s*gate/i, 'quality-gates'],
  [/\btool\s*discovery/i, 'tool-discovery'],
  [/\bcross[- ]project/i, 'cross-project'],
  [/\bmulti[- ]agent/i, 'multi-agent'],
  [/\blanding\s*page/i, 'landing-page'],
  [/\bstorage\s*adapter/i, 'storage-adapter'],
  [/\bmcp\s*(?:server|proxy|tool)/i, 'mcp-infrastructure'],
  [/\boss\s*launch/i, 'oss-launch'],
  [/\bcli\s*(?:command|ergonomic|improvement)/i, 'cli'],
  [/\bclaude\s*code/i, 'claude-code'],
  [/\bwheelhaus/i, 'wheelhaus'],
  [/\bhuman\s*checkpoint/i, 'human-checkpoints'],
  [/\bphase\s*workflow/i, 'phase-workflow'],
];

/**
 * Extract meaningful keywords from text, preserving compound terms.
 */
function extractKeywords(text: string): string[] {
  if (!text) return [];

  const keywords: string[] = [];

  // Extract compound terms first
  for (const [pattern, term] of COMPOUND_TERMS) {
    if (pattern.test(text)) {
      keywords.push(term);
    }
  }

  // Then extract single-word keywords
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  keywords.push(...words);
  return [...new Set(keywords)];
}

/**
 * Analyze tasks and suggest initiative groupings.
 *
 * Algorithm:
 * 1. Extract keywords from all non-completed tasks
 * 2. Count keyword frequency across tasks
 * 3. Find clusters: tasks sharing high-frequency keywords
 * 4. Rank clusters by size and coherence
 * 5. Generate initiative titles from cluster themes
 */
export function suggestInitiatives(
  tasks: UnifiedTask[],
  options: {
    minClusterSize?: number;
    maxSuggestions?: number;
    excludeCompleted?: boolean;
  } = {}
): InitiativeSuggestion[] {
  const {
    minClusterSize = 3,
    maxSuggestions = 5,
    excludeCompleted = true,
  } = options;

  // Filter to actionable tasks
  const candidateTasks = excludeCompleted
    ? tasks.filter(t => t.status !== 'completed')
    : tasks;

  if (candidateTasks.length < minClusterSize) return [];

  // Step 1: Extract keywords per task
  const taskKeywords = new Map<string, string[]>();
  for (const task of candidateTasks) {
    const text = `${task.title} ${task.description || ''}`;
    taskKeywords.set(task.id, extractKeywords(text));
  }

  // Step 2: Count keyword frequency
  const keywordCounts = new Map<string, number>();
  const keywordTasks = new Map<string, Set<string>>(); // keyword → taskIds
  for (const [taskId, keywords] of taskKeywords) {
    for (const kw of keywords) {
      keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1);
      if (!keywordTasks.has(kw)) keywordTasks.set(kw, new Set());
      keywordTasks.get(kw)!.add(taskId);
    }
  }

  // Step 3: Find significant keywords (appear in 3+ tasks but not in >60% of all tasks)
  const maxFrequency = candidateTasks.length * 0.6;
  const significantKeywords = [...keywordCounts.entries()]
    .filter(([, count]) => count >= minClusterSize && count <= maxFrequency)
    .sort((a, b) => b[1] - a[1]);

  // Step 4: Build clusters from significant keywords
  // Greedy: take the highest-frequency keyword, grab its tasks, remove them from pool
  const usedTasks = new Set<string>();
  const clusters: Array<{ keywords: string[]; taskIds: string[] }> = [];

  for (const [keyword] of significantKeywords) {
    if (clusters.length >= maxSuggestions) break;

    const clusterTasks = [...(keywordTasks.get(keyword) || [])]
      .filter(id => !usedTasks.has(id));

    if (clusterTasks.length < minClusterSize) continue;

    // Find co-occurring keywords in this cluster
    const coKeywords = new Map<string, number>();
    for (const taskId of clusterTasks) {
      for (const kw of taskKeywords.get(taskId) || []) {
        if (kw !== keyword) {
          coKeywords.set(kw, (coKeywords.get(kw) || 0) + 1);
        }
      }
    }

    // Top co-occurring keywords (appear in >50% of cluster tasks)
    const threshold = clusterTasks.length * 0.5;
    const clusterKeywords = [keyword, ...([...coKeywords.entries()]
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([kw]) => kw))];

    clusters.push({ keywords: clusterKeywords, taskIds: clusterTasks });
    for (const id of clusterTasks) usedTasks.add(id);
  }

  // Step 5: Generate initiative suggestions
  return clusters.map(cluster => {
    const clusterTaskObjects = cluster.taskIds
      .map(id => candidateTasks.find(t => t.id === id)!)
      .filter(Boolean);

    // Generate a readable title from keywords
    const title = generateInitiativeTitle(cluster.keywords, clusterTaskObjects);
    const description = generateInitiativeDescription(cluster.keywords, clusterTaskObjects);

    return {
      title,
      description,
      taskIds: cluster.taskIds,
      taskCount: cluster.taskIds.length,
      keywords: cluster.keywords,
      confidence: cluster.taskIds.length / candidateTasks.length,
    };
  });
}

/**
 * Generate a human-readable initiative title from cluster keywords and tasks.
 */
function generateInitiativeTitle(keywords: string[], tasks: UnifiedTask[]): string {
  // Prefer compound terms (hyphenated) as primary — they're more descriptive
  const compoundIdx = keywords.findIndex(k => k.includes('-'));
  const primaryRaw = compoundIdx >= 0 ? keywords[compoundIdx] : keywords[0];
  const primary = primaryRaw
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  // Use secondary keywords for richer titles, filtering out ones that overlap with primary
  const primaryLower = primary.toLowerCase();
  const secondary = keywords.slice(1, 3)
    .map(k => k.replace(/-/g, ' '))
    .filter(k => !primaryLower.includes(k.toLowerCase()) && !k.toLowerCase().includes(primaryLower))
    .join(' & ');

  // Check for common prefixes in task titles
  const prefixes = ['AX:', 'Fix:', 'Refactor:', 'CLI:', 'Wheelhaus:'];
  const commonPrefix = prefixes.find(p =>
    tasks.filter(t => t.title.startsWith(p)).length > tasks.length * 0.4
  );

  if (commonPrefix) {
    const area = commonPrefix.replace(':', '');
    // Avoid "Wheelhaus: Wheelhaus improvements"
    if (area.toLowerCase() === primary.toLowerCase()) {
      return secondary ? `${area}: ${secondary}` : `${area} improvements`;
    }
    return secondary
      ? `${area}: ${primary} — ${secondary}`
      : `${area}: ${primary} improvements`;
  }

  return secondary
    ? `${primary}: ${secondary}`
    : `${primary} initiative`;
}

/**
 * Generate a description summarizing the cluster.
 */
function generateInitiativeDescription(keywords: string[], tasks: UnifiedTask[]): string {
  const priorities = {
    critical: tasks.filter(t => t.priority === 'critical').length,
    high: tasks.filter(t => t.priority === 'high').length,
    medium: tasks.filter(t => t.priority === 'medium').length,
    low: tasks.filter(t => t.priority === 'low').length,
  };

  const topPriority = Object.entries(priorities)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])[0];

  const keywordList = keywords.slice(0, 3).map(k => k.replace(/-/g, ' ')).join(', ');

  return `${tasks.length} tasks related to ${keywordList}. ` +
    `${topPriority ? `Mostly ${topPriority[0]} priority. ` : ''}` +
    `Sample tasks: ${tasks.slice(0, 3).map(t => `"${t.title.slice(0, 40)}"`).join(', ')}.`;
}

/**
 * Generate a briefing nudge when no initiatives exist.
 * Returns a concise suggestion based on task analysis.
 */
export function generateInitiativeNudge(tasks: UnifiedTask[]): string | null {
  const suggestions = suggestInitiatives(tasks, { maxSuggestions: 2, minClusterSize: 3 });

  if (suggestions.length === 0) return null;

  const lines: string[] = [
    'No initiatives set. Consider creating one to focus your work:',
  ];

  for (const s of suggestions) {
    lines.push(`  → "${s.title}" (${s.taskCount} tasks: ${s.keywords.slice(0, 3).join(', ')})`);
  }

  lines.push('  Create with: create_initiative({ title: "...", successCriteria: "..." })');

  return lines.join('\n');
}
