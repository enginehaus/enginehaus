/**
 * AI Task Suggestions Service
 *
 * Provides intelligent next-task recommendations based on:
 * - Task dependencies and blockers
 * - Developer context (recent work, expertise areas)
 * - Project momentum (what's hot, what's stale)
 * - Strategic priorities
 * - Time-based factors (end of day, start of week, etc.)
 */

import { UnifiedTask, TaskPriority, TaskStatus } from '../coordination/types.js';

export interface TaskSuggestion {
  task: UnifiedTask;
  score: number;
  reasons: string[];
  category: SuggestionCategory;
}

export type SuggestionCategory =
  | 'urgent'           // Critical blockers or deadlines
  | 'momentum'         // Continue recent work
  | 'unblock'          // Will unblock other tasks
  | 'quick-win'        // Easy to complete, builds momentum
  | 'strategic'        // High business impact
  | 'maintenance'      // Technical debt, cleanup
  | 'exploration';     // New areas, learning opportunities

export interface DeveloperContext {
  recentTaskIds: string[];        // Tasks worked on recently
  recentFiles: string[];          // Files touched recently
  expertiseAreas: string[];       // Tech/domain expertise
  preferredTaskSize?: 'small' | 'medium' | 'large';
  availableTimeMinutes?: number;  // How much time available
}

export interface SuggestionOptions {
  limit?: number;
  categories?: SuggestionCategory[];
  excludeTaskIds?: string[];
  developerContext?: DeveloperContext;
  includeBlocked?: boolean;
}

/**
 * Score weights for different factors
 */
const WEIGHTS = {
  priority: {
    critical: 100,
    high: 60,
    medium: 30,
    low: 10,
  },
  unblocksPotential: 25,      // Per task that would be unblocked
  continuesMomentum: 40,      // Same files/area as recent work
  quickWin: 35,               // Small tasks that can be done quickly
  staleTask: 20,              // Tasks that have been ready for a long time
  strategicContext: 30,       // Has strategic business context
  expertiseMatch: 25,         // Matches developer expertise
  dependencyFree: 15,         // No blockers
};

/**
 * Calculate suggestion score for a task
 */
export function calculateTaskScore(
  task: UnifiedTask,
  allTasks: UnifiedTask[],
  context?: DeveloperContext
): { score: number; reasons: string[]; category: SuggestionCategory } {
  let score = 0;
  const reasons: string[] = [];
  let category: SuggestionCategory = 'maintenance';

  // 1. Priority scoring
  const priorityScore = WEIGHTS.priority[task.priority];
  score += priorityScore;
  if (task.priority === 'critical') {
    reasons.push('Critical priority');
    category = 'urgent';
  } else if (task.priority === 'high') {
    reasons.push('High priority');
  }

  // 2. Unblocking potential - how many tasks would this unblock?
  const wouldUnblock = allTasks.filter(t =>
    t.blockedBy?.includes(task.id) && t.status === 'blocked'
  );
  if (wouldUnblock.length > 0) {
    const unblockScore = wouldUnblock.length * WEIGHTS.unblocksPotential;
    score += unblockScore;
    reasons.push(`Unblocks ${wouldUnblock.length} task${wouldUnblock.length > 1 ? 's' : ''}`);
    if (category !== 'urgent') {
      category = 'unblock';
    }
  }

  // 3. No blockers bonus
  if (!task.blockedBy || task.blockedBy.length === 0) {
    score += WEIGHTS.dependencyFree;
    reasons.push('No dependencies');
  }

  // 4. Strategic context bonus
  if (task.strategicContext?.businessRationale) {
    score += WEIGHTS.strategicContext;
    reasons.push('Has strategic context');
    if (category === 'maintenance') {
      category = 'strategic';
    }
  }

  // 5. Quick win detection (small tasks based on description length and no complex context)
  const isQuickWin =
    task.description.length < 200 &&
    (!task.files || task.files.length <= 2) &&
    !task.technicalContext?.architecture;

  if (isQuickWin) {
    score += WEIGHTS.quickWin;
    reasons.push('Quick win opportunity');
    if (category === 'maintenance') {
      category = 'quick-win';
    }
  }

  // 6. Staleness - tasks that have been ready for a while
  const ageInDays = (Date.now() - task.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageInDays > 7 && task.status === 'ready') {
    score += Math.min(WEIGHTS.staleTask, ageInDays * 2);
    reasons.push(`Ready for ${Math.floor(ageInDays)} days`);
  }

  // 7. Developer context matching
  if (context) {
    // Recent files overlap
    if (context.recentFiles.length > 0 && task.files) {
      const fileOverlap = task.files.filter(f =>
        context.recentFiles.some(rf => rf.includes(f) || f.includes(rf))
      );
      if (fileOverlap.length > 0) {
        score += WEIGHTS.continuesMomentum;
        reasons.push('Continues recent work');
        if (category === 'maintenance') {
          category = 'momentum';
        }
      }
    }

    // Expertise match
    if (context.expertiseAreas.length > 0) {
      const taskText = `${task.title} ${task.description}`.toLowerCase();
      const expertiseMatch = context.expertiseAreas.some(exp =>
        taskText.includes(exp.toLowerCase())
      );
      if (expertiseMatch) {
        score += WEIGHTS.expertiseMatch;
        reasons.push('Matches your expertise');
      }
    }

    // Time availability
    if (context.availableTimeMinutes && context.availableTimeMinutes < 60) {
      // Prefer quick wins when time is limited
      if (isQuickWin) {
        score += 20;
        reasons.push('Fits available time');
      }
    }
  }

  return { score, reasons, category };
}

/**
 * Get intelligent task suggestions
 */
export function getTaskSuggestions(
  tasks: UnifiedTask[],
  options: SuggestionOptions = {}
): TaskSuggestion[] {
  const {
    limit = 5,
    categories,
    excludeTaskIds = [],
    developerContext,
    includeBlocked = false,
  } = options;

  // Filter to ready tasks (or include blocked if requested)
  const eligibleTasks = tasks.filter(t => {
    if (excludeTaskIds.includes(t.id)) return false;
    if (t.status === 'completed') return false;
    if (t.status === 'in-progress') return false;
    if (!includeBlocked && t.status === 'blocked') return false;
    return true;
  });

  // Score each task
  const suggestions: TaskSuggestion[] = eligibleTasks.map(task => {
    const { score, reasons, category } = calculateTaskScore(task, tasks, developerContext);
    return { task, score, reasons, category };
  });

  // Filter by categories if specified
  let filtered = suggestions;
  if (categories && categories.length > 0) {
    filtered = suggestions.filter(s => categories.includes(s.category));
  }

  // Sort by score descending
  filtered.sort((a, b) => b.score - a.score);

  // Return top N
  return filtered.slice(0, limit);
}

/**
 * Get a single best next task suggestion
 */
export function getBestNextTask(
  tasks: UnifiedTask[],
  developerContext?: DeveloperContext
): TaskSuggestion | null {
  const suggestions = getTaskSuggestions(tasks, {
    limit: 1,
    developerContext,
  });
  return suggestions[0] || null;
}

/**
 * Get suggestions grouped by category
 */
export function getSuggestionsByCategory(
  tasks: UnifiedTask[],
  developerContext?: DeveloperContext
): Record<SuggestionCategory, TaskSuggestion[]> {
  const allSuggestions = getTaskSuggestions(tasks, {
    limit: 100,
    developerContext,
  });

  const grouped: Record<SuggestionCategory, TaskSuggestion[]> = {
    urgent: [],
    momentum: [],
    unblock: [],
    'quick-win': [],
    strategic: [],
    maintenance: [],
    exploration: [],
  };

  for (const suggestion of allSuggestions) {
    grouped[suggestion.category].push(suggestion);
  }

  // Sort each category by score
  for (const category of Object.keys(grouped) as SuggestionCategory[]) {
    grouped[category].sort((a, b) => b.score - a.score);
  }

  return grouped;
}

/**
 * Format suggestion for display
 */
export function formatSuggestion(suggestion: TaskSuggestion): string {
  const { task, score, reasons, category } = suggestion;
  const categoryLabel = category.toUpperCase().replace('-', ' ');
  const reasonsText = reasons.join(', ');

  return `[${categoryLabel}] ${task.title} (score: ${score})
  Priority: ${task.priority}
  Reasons: ${reasonsText}
  ID: ${task.id.slice(0, 8)}...`;
}

/**
 * Get task suggestion explanation
 */
export function explainSuggestion(suggestion: TaskSuggestion): string {
  const { task, reasons, category } = suggestion;

  const explanations: Record<SuggestionCategory, string> = {
    urgent: 'This task is urgent and should be addressed immediately.',
    momentum: 'This task continues your recent work and maintains flow.',
    unblock: 'Completing this task will unblock other waiting tasks.',
    'quick-win': 'This is a quick task that can be completed easily.',
    strategic: 'This task has high strategic importance for the project.',
    maintenance: 'This is routine maintenance or technical debt work.',
    exploration: 'This task explores new areas or learning opportunities.',
  };

  return `**${task.title}**

Category: ${category}
${explanations[category]}

Why this task?
${reasons.map(r => `- ${r}`).join('\n')}`;
}

/**
 * Analyze task distribution for project health
 * NOTE: Task IDs are included for agent reliability (AX "Structure > Instruction" principle)
 */
export function analyzeTaskHealth(tasks: UnifiedTask[]): {
  urgentCount: number;
  blockedCount: number;
  staleCount: number;
  averageAge: number;
  priorityDistribution: Record<TaskPriority, number>;
  statusDistribution: Record<TaskStatus, number>;
  recommendations: string[];
  urgentTaskIds: string[];
  blockedTaskIds: string[];
  staleTaskIds: string[];
} {
  const readyTasks = tasks.filter(t => t.status === 'ready');
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  const criticalTasks = tasks.filter(t => t.priority === 'critical' && t.status !== 'completed');
  const now = Date.now();

  // Calculate ages
  const ages = readyTasks.map(t => (now - t.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const averageAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  const staleTasks = readyTasks.filter(t =>
    (now - t.createdAt.getTime()) / (1000 * 60 * 60 * 24) > 14
  );

  // Priority distribution
  const priorityDistribution: Record<TaskPriority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const task of tasks) {
    priorityDistribution[task.priority]++;
  }

  // Status distribution
  const statusDistribution: Record<TaskStatus, number> = {
    ready: 0,
    'in-progress': 0,
    blocked: 0,
    'awaiting-human': 0,
    completed: 0,
  };
  for (const task of tasks) {
    statusDistribution[task.status]++;
  }

  // Generate recommendations - include task IDs for agent reliability
  const recommendations: string[] = [];

  if (priorityDistribution.critical > 0) {
    const ids = criticalTasks.slice(0, 3).map(t => t.id).join(', ');
    recommendations.push(`Address ${priorityDistribution.critical} critical task(s) immediately: ${ids}`);
  }

  if (blockedTasks.length > 3) {
    const ids = blockedTasks.slice(0, 3).map(t => t.id).join(', ');
    recommendations.push(`High blocked count (${blockedTasks.length}) - review dependencies: ${ids}`);
  }

  if (staleTasks.length > 0) {
    const ids = staleTasks.slice(0, 3).map(t => t.id).join(', ');
    recommendations.push(`${staleTasks.length} task(s) have been ready for 2+ weeks: ${ids}`);
  }

  if (averageAge > 7) {
    recommendations.push('Average task age is high - consider prioritizing older tasks');
  }

  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  if (inProgressTasks.length > 3) {
    const ids = inProgressTasks.slice(0, 3).map(t => t.id).join(', ');
    recommendations.push(`Too many in-progress tasks (${inProgressTasks.length}) - focus on completing: ${ids}`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Project task health looks good!');
  }

  return {
    urgentCount: priorityDistribution.critical,
    blockedCount: blockedTasks.length,
    staleCount: staleTasks.length,
    averageAge: Math.round(averageAge * 10) / 10,
    priorityDistribution,
    statusDistribution,
    recommendations,
    urgentTaskIds: criticalTasks.map(t => t.id),
    blockedTaskIds: blockedTasks.map(t => t.id),
    staleTaskIds: staleTasks.map(t => t.id),
  };
}
