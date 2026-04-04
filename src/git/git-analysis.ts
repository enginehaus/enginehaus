import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if a directory is inside a git repository.
 * Walks up from the given path looking for a .git directory/file.
 */
export function isGitRepository(dir: string): boolean {
  let current = dir;
  while (true) {
    try {
      const gitPath = path.join(current, '.git');
      if (fs.existsSync(gitPath)) return true;
    } catch {
      return false;
    }
    const parent = path.dirname(current);
    if (parent === current) return false; // reached filesystem root
    current = parent;
  }
}

/**
 * Check for uncommitted changes in a git repository
 */
export async function hasUncommittedChanges(repoPath: string): Promise<{
  hasChanges: boolean;
  modifiedFiles: string[];
  untrackedFiles: string[];
  stagedFiles: string[];
}> {
  const options: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
  };

  const git: SimpleGit = simpleGit(options);
  const status = await git.status();

  return {
    hasChanges: !status.isClean(),
    modifiedFiles: status.modified,
    untrackedFiles: status.not_added,
    stagedFiles: status.staged,
  };
}

/**
 * Check for unpushed commits on the current branch
 */
export async function hasUnpushedCommits(repoPath: string): Promise<{
  hasRemote: boolean;
  remoteName?: string;
  branch?: string;
  unpushedCount: number;
}> {
  const options: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
  };

  const git: SimpleGit = simpleGit(options);

  try {
    // Get current branch name
    const branchResult = await git.branch();
    const currentBranch = branchResult.current;

    if (!currentBranch) {
      return { hasRemote: false, unpushedCount: 0 };
    }

    // Check if a remote tracking branch is configured
    let remoteName: string;
    try {
      remoteName = (await git.raw(['config', '--get', `branch.${currentBranch}.remote`])).trim();
    } catch {
      // No remote configured for this branch
      return { hasRemote: false, unpushedCount: 0 };
    }

    if (!remoteName) {
      return { hasRemote: false, unpushedCount: 0 };
    }

    // Count unpushed commits: commits in HEAD that aren't in the remote tracking branch
    const trackingBranch = `${remoteName}/${currentBranch}`;
    try {
      const log = await git.log([`${trackingBranch}..HEAD`]);
      return {
        hasRemote: true,
        remoteName,
        branch: currentBranch,
        unpushedCount: log.all.length,
      };
    } catch {
      // Tracking branch may not exist on remote yet (e.g., new branch never pushed)
      // Count all commits on this branch as unpushed
      try {
        const log = await git.log();
        return {
          hasRemote: true,
          remoteName,
          branch: currentBranch,
          unpushedCount: log.all.length,
        };
      } catch {
        return { hasRemote: true, remoteName, branch: currentBranch, unpushedCount: 0 };
      }
    }
  } catch {
    // Not a git repo or other error — skip gracefully
    return { hasRemote: false, unpushedCount: 0 };
  }
}

export interface GitAnalysis {
  filesChanged: string[];
  commitMessages: string[];
  linesAdded: number;
  linesRemoved: number;
  authors: string[];
  commitCount: number;
}

/**
 * Analyze git history since a given date, scoped to the current branch.
 * When on a feature branch, uses merge-base with baseBranch to count only
 * commits specific to this branch (not commits already on main).
 */
export async function analyzeGitHistory(
  repoPath: string,
  since?: Date,
  baseBranch?: string,
): Promise<GitAnalysis> {
  const options: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
    maxConcurrentProcesses: 6,
  };

  const git: SimpleGit = simpleGit(options);

  try {
    // Determine commit range: prefer branch-scoped analysis over time-based
    let logOptions: Record<string, any>;

    const currentBranch = (await git.branch()).current;
    const effectiveBase = baseBranch || 'main';
    let useBranchScope = false;

    if (currentBranch && currentBranch !== effectiveBase) {
      // On a feature branch — scope to commits since merge-base
      try {
        const mergeBase = (await git.raw(['merge-base', effectiveBase, 'HEAD'])).trim();
        if (mergeBase) {
          logOptions = { from: mergeBase, to: 'HEAD' };
          useBranchScope = true;
        }
      } catch {
        // merge-base failed (e.g., no common ancestor) — fall through to time-based
      }
    }

    if (!useBranchScope) {
      // Fallback: time-based analysis (on main, or merge-base failed)
      const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000);
      logOptions = { '--since': sinceDate.toISOString() };
    }

    // Get commits
    const log = await git.log(logOptions!);

    const commitMessages = log.all.map(c => c.message);
    const authors = [...new Set(log.all.map(c => c.author_name))];

    // Get diff stats
    let linesAdded = 0;
    let linesRemoved = 0;
    const filesChanged = new Set<string>();

    // Get file changes from each commit
    for (const commit of log.all) {
      try {
        const diffSummary = await git.diffSummary([`${commit.hash}^`, commit.hash]);
        linesAdded += diffSummary.insertions;
        linesRemoved += diffSummary.deletions;
        diffSummary.files.forEach(f => filesChanged.add(f.file));
      } catch (error) {
        // First commit or other issue - try without parent
        try {
          const diffSummary = await git.diffSummary([commit.hash]);
          linesAdded += diffSummary.insertions;
          linesRemoved += diffSummary.deletions;
          diffSummary.files.forEach(f => filesChanged.add(f.file));
        } catch {
          // Skip this commit
        }
      }
    }

    return {
      filesChanged: Array.from(filesChanged),
      commitMessages,
      linesAdded,
      linesRemoved,
      authors,
      commitCount: log.all.length,
    };
  } catch (error) {
    // Handle non-git directories gracefully (no shame)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNotGitRepo = errorMessage.includes('not a git repository');

    if (!isNotGitRepo) {
      // Only log unexpected errors, not "not a git repo"
      console.error('Git analysis:', errorMessage.split('\n')[0]);
    }

    // Return empty analysis - works without git
    return {
      filesChanged: [],
      commitMessages: [],
      linesAdded: 0,
      linesRemoved: 0,
      authors: [],
      commitCount: 0,
    };
  }
}

/**
 * Result structure for recent commits analysis
 */
export interface FileCommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: Date;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface RecentCommitsResult {
  files: string[];
  commits: FileCommitInfo[];
  summary: {
    totalCommits: number;
    uniqueAuthors: string[];
    lastTouched?: Date;
    pattern: string; // e.g., "3 commits in last week by 2 authors"
  };
}

/**
 * Get recent commits for specific files.
 * Useful for understanding the recent trajectory of files before working on them.
 */
export async function getRecentCommitsForFiles(
  repoPath: string,
  files: string[],
  options: { maxCommits?: number; sinceDays?: number } = {}
): Promise<RecentCommitsResult> {
  const { maxCommits = 10, sinceDays = 14 } = options;

  const gitOptions: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
  };

  const git: SimpleGit = simpleGit(gitOptions);

  // Calculate since date
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const sinceStr = sinceDate.toISOString();

  try {
    // Get commits touching these files
    // simple-git's log() has specific options
    const log = await git.log({
      '--since': sinceStr,
      maxCount: maxCommits,
      file: files.length === 1 ? files[0] : files,
    });

    const commits: FileCommitInfo[] = [];
    const authorsSet = new Set<string>();
    let lastTouched: Date | undefined;

    for (const commit of log.all) {
      const commitDate = new Date(commit.date);
      if (!lastTouched || commitDate > lastTouched) {
        lastTouched = commitDate;
      }

      authorsSet.add(commit.author_name);

      // Get line stats for this commit on these files
      let linesAdded = 0;
      let linesRemoved = 0;
      try {
        const diffSummary = await git.diffSummary([`${commit.hash}^`, commit.hash, '--', ...files]);
        linesAdded = diffSummary.insertions;
        linesRemoved = diffSummary.deletions;
      } catch {
        // Ignore diff errors (first commit, etc.)
      }

      commits.push({
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 8),
        message: commit.message.split('\n')[0], // First line only
        author: commit.author_name,
        date: commitDate,
        linesAdded,
        linesRemoved,
      });
    }

    // Build summary pattern
    const uniqueAuthors = Array.from(authorsSet);
    let pattern = '';
    if (commits.length === 0) {
      pattern = `No commits in last ${sinceDays} days`;
    } else {
      const authorStr = uniqueAuthors.length === 1
        ? uniqueAuthors[0]
        : `${uniqueAuthors.length} authors`;

      if (commits.length === 1) {
        pattern = `1 commit in last ${sinceDays} days by ${authorStr}`;
      } else {
        pattern = `${commits.length} commits in last ${sinceDays} days by ${authorStr}`;
      }

      // Add recency hint
      if (lastTouched) {
        const daysSinceTouch = Math.floor((Date.now() - lastTouched.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceTouch === 0) {
          pattern += ' (touched today)';
        } else if (daysSinceTouch === 1) {
          pattern += ' (touched yesterday)';
        } else if (daysSinceTouch <= 7) {
          pattern += ` (last touch ${daysSinceTouch} days ago)`;
        }
      }
    }

    return {
      files,
      commits,
      summary: {
        totalCommits: commits.length,
        uniqueAuthors,
        lastTouched,
        pattern,
      },
    };
  } catch (error) {
    console.error('Error getting recent commits for files:', error);
    return {
      files,
      commits: [],
      summary: {
        totalCommits: 0,
        uniqueAuthors: [],
        pattern: 'Unable to analyze git history',
      },
    };
  }
}

/**
 * Convert file changes to deliverable format
 */
export function generateDeliverables(
  analysis: GitAnalysis
): Array<{ file: string; status: string; description: string }> {
  return analysis.filesChanged.map(file => {
    // Infer status from file extension/path
    let description = 'Modified as part of implementation';

    if (file.endsWith('.test.ts') || file.endsWith('.spec.ts') || file.includes('__tests__')) {
      description = 'Test file added/updated';
    } else if (file.endsWith('.md')) {
      description = 'Documentation updated';
    } else if (file.includes('types') || file.endsWith('.d.ts')) {
      description = 'Type definitions updated';
    } else if (file.includes('config') || file.endsWith('.json')) {
      description = 'Configuration updated';
    }

    return {
      file,
      status: 'completed',
      description,
    };
  });
}

/**
 * Extract architecture decisions from commit messages
 */
export function inferArchitectureDecisions(
  commitMessages: string[]
): Array<{ decision: string; rationale: string; impact: string }> {
  const decisions: Array<{ decision: string; rationale: string; impact: string }> = [];

  // Keywords that suggest architecture decisions
  const architectureKeywords = [
    'refactor',
    'architecture',
    'restructure',
    'migrate',
    'replace',
    'upgrade',
    'add support',
    'implement',
    'introduce',
  ];

  // Decision-making patterns (explicit choices)
  const decisionPatterns = [
    'chose',
    'decided',
    'instead of',
    'rather than',
    'tradeoff',
    'trade-off',
    'prefer',
    'selected',
    'opted for',
    'went with',
  ];

  for (const message of commitMessages) {
    const lowerMessage = message.toLowerCase();

    // Check if commit mentions architecture-related changes
    const isArchitectural = architectureKeywords.some(keyword =>
      lowerMessage.includes(keyword)
    );

    // Check for explicit decision-making patterns
    const isDecision = decisionPatterns.some(pattern =>
      lowerMessage.includes(pattern)
    );

    if (isArchitectural || isDecision) {
      // Extract first line as decision
      const firstLine = message.split('\n')[0];

      decisions.push({
        decision: firstLine,
        rationale: 'Inferred from git commit history',
        impact: 'See commit for details',
      });
    }
  }

  // Limit to top 5 decisions
  return decisions.slice(0, 5);
}

/**
 * Generate quality metrics summary from analysis
 */
export function generateQualityMetrics(analysis: GitAnalysis): {
  testCoverage?: string;
  performanceBenchmarks?: string;
  documentationComplete?: boolean;
} {
  const hasTests = analysis.filesChanged.some(
    f => f.includes('test') || f.includes('spec')
  );
  const hasDocs = analysis.filesChanged.some(
    f => f.endsWith('.md') || f.includes('doc')
  );

  return {
    testCoverage: hasTests ? 'Tests included in changes' : 'No test changes detected',
    documentationComplete: hasDocs,
  };
}

/**
 * Check whether the current branch is merged into a target branch (default: main).
 * "Merged" means all commits on the current branch are reachable from the target.
 */
export async function isBranchMergedToMain(repoPath: string, targetBranch?: string): Promise<{
  currentBranch: string;
  targetBranch: string;
  isMainBranch: boolean;
  isMerged: boolean;
}> {
  const target = targetBranch || 'main';
  const git: SimpleGit = simpleGit({ baseDir: repoPath, binary: 'git' });

  try {
    const branchResult = await git.branch();
    const currentBranch = branchResult.current;

    if (!currentBranch) {
      return { currentBranch: '', targetBranch: target, isMainBranch: false, isMerged: false };
    }

    // If we're on the target branch, no merge needed
    if (currentBranch === target) {
      return { currentBranch, targetBranch: target, isMainBranch: true, isMerged: true };
    }

    // Check if current branch is in the list of branches merged into target
    try {
      const merged = await git.branch(['--merged', target]);
      const isMerged = merged.all.some(name => name.trim() === currentBranch);
      return { currentBranch, targetBranch: target, isMainBranch: false, isMerged };
    } catch {
      // Target branch may not exist — can't verify merge
      return { currentBranch, targetBranch: target, isMainBranch: false, isMerged: false };
    }
  } catch {
    // Not a git repo or other error
    return { currentBranch: '', targetBranch: target, isMainBranch: false, isMerged: false };
  }
}

// ============================================================================
// Branch Lifecycle
// ============================================================================

export interface StaleBranch {
  name: string;
  lastCommitDate: Date;
  lastCommitMessage: string;
  daysSinceLastCommit: number;
  isMerged: boolean;
  taskId?: string; // Extracted from branch name if follows convention
}

/**
 * Find stale feature branches — branches with no commits in `staleDays` days.
 * Only considers branches matching the `feature/task-*` convention.
 */
export async function findStaleBranches(repoPath: string, options?: {
  staleDays?: number;
  includeRemote?: boolean;
}): Promise<StaleBranch[]> {
  const staleDays = options?.staleDays ?? 14;
  const cutoffDate = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

  const git = simpleGit(repoPath);
  const stale: StaleBranch[] = [];

  try {
    // Get local branches
    const branchSummary = await git.branch(['-v', '--no-abbrev']);
    const mergedBranches = new Set<string>();
    try {
      const merged = await git.branch(['--merged', 'main']);
      for (const name of merged.all) {
        mergedBranches.add(name.trim());
      }
    } catch {
      // main might not exist — skip merged check
    }

    for (const [name, data] of Object.entries(branchSummary.branches)) {
      // Only look at feature/ branches (both feature/task-XXX and feature/XXX- patterns)
      if (!name.startsWith('feature/')) continue;
      if (name === branchSummary.current) continue; // Don't suggest deleting current branch

      try {
        const log = await git.log({ maxCount: 1, from: name });
        const lastCommit = log.latest;
        if (!lastCommit) continue;

        const commitDate = new Date(lastCommit.date);
        if (commitDate < cutoffDate) {
          // Extract task ID from branch name:
          // feature/task-XXXXXXXX-... OR feature/XXXXXXXX-...
          const taskIdMatch = name.match(/^feature\/(?:task-)?([a-f0-9]{8})/);

          stale.push({
            name,
            lastCommitDate: commitDate,
            lastCommitMessage: lastCommit.message,
            daysSinceLastCommit: Math.floor((Date.now() - commitDate.getTime()) / (24 * 60 * 60 * 1000)),
            isMerged: mergedBranches.has(name),
            taskId: taskIdMatch?.[1],
          });
        }
      } catch {
        // Skip branches we can't inspect
      }
    }

    // Sort by staleness (oldest first)
    stale.sort((a, b) => a.lastCommitDate.getTime() - b.lastCommitDate.getTime());
    return stale;
  } catch {
    return []; // Not a git repo or git error
  }
}

/**
 * Delete local feature branches that have been merged to main.
 * Returns the list of deleted branch names.
 */
export async function cleanupMergedBranches(repoPath: string): Promise<string[]> {
  const git = simpleGit(repoPath);
  const deleted: string[] = [];

  try {
    const merged = await git.branch(['--merged', 'main']);
    for (const name of merged.all) {
      const trimmed = name.trim();
      if (!trimmed.startsWith('feature/task-')) continue;
      if (trimmed === 'main') continue;

      try {
        await git.deleteLocalBranch(trimmed);
        deleted.push(trimmed);
      } catch {
        // Skip branches that can't be deleted (e.g., current branch)
      }
    }
  } catch {
    // Not a git repo or main doesn't exist
  }

  return deleted;
}

/**
 * Delete the feature branch for a completed task (local + remote).
 * Only deletes branches matching feature/task-{taskIdPrefix}*.
 * Switches to main first if currently on the target branch.
 */
export async function deleteTaskBranch(repoPath: string, taskIdPrefix: string): Promise<{
  deletedLocal: string[];
  deletedRemote: string[];
}> {
  const git = simpleGit(repoPath);
  const deletedLocal: string[] = [];
  const deletedRemote: string[] = [];
  const pattern = `feature/task-${taskIdPrefix}`;

  try {
    const branchSummary = await git.branch(['-a']);
    const currentBranch = branchSummary.current;

    // Find matching local branches
    const localMatches = branchSummary.all
      .filter(name => !name.startsWith('remotes/') && name.startsWith(pattern));

    // If we're on a branch we need to delete, switch to main first
    if (currentBranch.startsWith(pattern)) {
      try {
        await git.checkout('main');
      } catch {
        // Can't switch — skip local deletion
        return { deletedLocal, deletedRemote };
      }
    }

    // Delete local branches
    for (const name of localMatches) {
      try {
        await git.branch(['-D', name]);
        deletedLocal.push(name);
      } catch {
        // Skip if can't delete
      }
    }

    // Find and delete matching remote branches
    const remoteMatches = branchSummary.all
      .filter(name => name.startsWith('remotes/origin/') && name.replace('remotes/origin/', '').startsWith(pattern))
      .map(name => name.replace('remotes/origin/', ''));

    for (const name of remoteMatches) {
      try {
        await git.raw(['push', 'origin', '--delete', name]);
        deletedRemote.push(name);
      } catch {
        // Skip if can't delete (already deleted, permissions, etc.)
      }
    }
  } catch {
    // Not a git repo or other error
  }

  return { deletedLocal, deletedRemote };
}

// ============================================================================
// Post-Completion Branch Merge & Cleanup
// ============================================================================

export interface BranchMergeResult {
  branch: string;
  action: 'merged' | 'deleted' | 'skipped';
  reason?: string;
  commits?: number;
}

export interface MergeCleanupResult {
  branches: BranchMergeResult[];
  pushed: boolean;
  pushError?: string;
}

/**
 * Merge all feature branches into main (fast-forward only), delete them,
 * and push main. Used after task completion to keep main up-to-date.
 *
 * - Switches to main if not already on it
 * - Finds ALL local feature/ branches (not just the current task's)
 * - For each: ff-merge if ahead, delete if merged, skip if diverged
 * - Pushes main to origin if ahead
 */
export async function mergeAndCleanupBranches(repoPath: string): Promise<MergeCleanupResult> {
  const git = simpleGit(repoPath);
  const branches: BranchMergeResult[] = [];
  let pushed = false;
  let pushError: string | undefined;

  try {
    const branchSummary = await git.branch(['-a']);
    const currentBranch = branchSummary.current;

    // Switch to main if not already there
    if (currentBranch !== 'main') {
      try {
        await git.checkout('main');
      } catch {
        return { branches: [{ branch: currentBranch, action: 'skipped', reason: 'Cannot switch to main' }], pushed: false };
      }
    }

    // Find all local feature/ branches
    const featureBranches = branchSummary.all
      .filter(name => !name.startsWith('remotes/') && name.startsWith('feature/'));

    for (const branch of featureBranches) {
      try {
        // Count commits ahead of main
        const log = await git.log({ from: 'main', to: branch });
        const ahead = log.total;

        if (ahead > 0) {
          // Has unmerged commits — try fast-forward merge
          try {
            await git.merge([branch, '--ff-only']);
            // Merged successfully — delete the branch
            try {
              await git.branch(['-d', branch]);
            } catch {
              // Branch delete failed but merge succeeded
            }
            branches.push({ branch, action: 'merged', commits: ahead });
          } catch {
            // Can't fast-forward — diverged from main
            branches.push({ branch, action: 'skipped', reason: 'Cannot fast-forward (branch has diverged from main)' });
          }
        } else {
          // No commits ahead — already merged or empty, just delete
          try {
            await git.branch(['-d', branch]);
            branches.push({ branch, action: 'deleted', reason: 'Already merged or empty' });
          } catch {
            // Force-delete if -d fails (branch might not be fully merged from git's perspective)
            try {
              await git.branch(['-D', branch]);
              branches.push({ branch, action: 'deleted', reason: 'Already merged or empty' });
            } catch {
              branches.push({ branch, action: 'skipped', reason: 'Cannot delete branch' });
            }
          }
        }
      } catch {
        branches.push({ branch, action: 'skipped', reason: 'Error analyzing branch' });
      }
    }

    // Delete remote tracking branches for merged/deleted branches
    for (const result of branches) {
      if (result.action === 'merged' || result.action === 'deleted') {
        const remoteName = `remotes/origin/${result.branch}`;
        if (branchSummary.all.includes(remoteName)) {
          try {
            await git.raw(['push', 'origin', '--delete', result.branch]);
          } catch {
            // Non-critical — remote branch may already be gone
          }
        }
      }
    }

    // Push main to origin if ahead
    try {
      const status = await git.status();
      if (status.ahead > 0) {
        await git.push('origin', 'main');
        pushed = true;
      } else {
        // Check if remote exists but we're not tracking
        try {
          const log = await git.log({ from: 'origin/main', to: 'main' });
          if (log.total > 0) {
            await git.push('origin', 'main');
            pushed = true;
          }
        } catch {
          // No remote tracking — skip push
        }
      }
    } catch (err) {
      pushError = err instanceof Error ? err.message : String(err);
    }
  } catch {
    // Not a git repo or other fatal error
  }

  return { branches, pushed, pushError };
}

// ============================================================================
// Git Worktree Management
// ============================================================================

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

/**
 * Create a git worktree for isolated agent work.
 * Returns the absolute path to the new worktree directory.
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
): Promise<{ success: boolean; path: string; error?: string }> {
  const git = simpleGit(repoPath);

  try {
    // Check if branch already exists using branch list (show-ref --quiet
    // doesn't throw in simple-git even on failure)
    const branchSummary = await git.branch();
    const branchExists = branchSummary.all.includes(branchName);

    if (branchExists) {
      // Attach worktree to existing branch
      await git.raw(['worktree', 'add', worktreePath, branchName]);
    } else {
      // Create new branch in the worktree, based on HEAD
      await git.raw(['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);
    }

    return { success: true, path: worktreePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, path: worktreePath, error: msg };
  }
}

/**
 * Remove a git worktree and optionally delete the branch.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  options?: { deleteBranch?: boolean; branchName?: string },
): Promise<{ success: boolean; error?: string }> {
  const git = simpleGit(repoPath);

  try {
    await git.raw(['worktree', 'remove', worktreePath, '--force']);

    if (options?.deleteBranch && options?.branchName) {
      try {
        await git.deleteLocalBranch(options.branchName, true);
      } catch {
        // Branch might already be deleted or merged
      }
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * List all active worktrees for a repository.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const git = simpleGit(repoPath);

  try {
    const raw = await git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) worktrees.push(current as WorktreeInfo);
        current = { path: line.slice('worktree '.length), bare: false };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.bare = true;
      }
    }
    if (current.path) worktrees.push(current as WorktreeInfo);

    return worktrees;
  } catch {
    return [];
  }
}
