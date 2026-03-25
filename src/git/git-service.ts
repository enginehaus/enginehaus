import { UnifiedTask, GitCommit, PullRequest } from '../coordination/types.js';
import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import path from 'path';

/**
 * GitService
 * 
 * Handles all git operations for Enginehaus:
 * - Automatic branch creation for tasks
 * - Phase-based commits
 * - Final task commits and push
 * - PR generation
 */
export class GitService {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    
    const options: Partial<SimpleGitOptions> = {
      baseDir: repoPath,
      binary: 'git',
      maxConcurrentProcesses: 6,
    };

    this.git = simpleGit(options);
  }

  // ========================================================================
  // Branch Management
  // ========================================================================

  async createTaskBranch(task: UnifiedTask): Promise<string> {
    // Generate branch name: feature/task-{id}-{sanitized-title}
    const sanitizedTitle = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    const branchName = `feature/task-${task.id.substring(0, 8)}-${sanitizedTitle}`;

    // Ensure we're on main/master and up to date
    const currentBranch = await this.getCurrentBranch();
    const mainBranch = await this.getMainBranch();

    if (currentBranch !== mainBranch) {
      await this.git.checkout(mainBranch);
    }

    // Pull latest
    try {
      await this.git.pull('origin', mainBranch);
    } catch (error) {
      console.warn('Could not pull from origin:', error);
    }

    // Create and checkout new branch
    await this.git.checkoutLocalBranch(branchName);

    return branchName;
  }

  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.branch();
    return branch.current;
  }

  async getMainBranch(): Promise<string> {
    const branches = await this.git.branch();
    
    // Check for common main branch names
    if (branches.all.includes('main')) return 'main';
    if (branches.all.includes('master')) return 'master';
    
    // Default to main
    return 'main';
  }

  // ========================================================================
  // Commit Operations
  // ========================================================================

  async commitPhase(
    branchName: string,
    phaseNumber: number,
    phaseDescription: string,
    files: string[]
  ): Promise<GitCommit> {
    // Ensure we're on the correct branch
    const currentBranch = await this.getCurrentBranch();
    if (currentBranch !== branchName) {
      await this.git.checkout(branchName);
    }

    // Stage files
    if (files.length > 0) {
      await this.git.add(files);
    } else {
      await this.git.add('.');
    }

    // Create commit message
    const commitMessage = `Phase ${phaseNumber}: ${phaseDescription}

Auto-committed by Enginehaus coordination system.

Files modified:
${files.map(f => `  - ${f}`).join('\n')}`;

    await this.git.commit(commitMessage);

    // Get commit info
    const log = await this.git.log({ maxCount: 1 });
    const latestCommit = log.latest;

    if (!latestCommit) {
      throw new Error('Failed to retrieve commit information');
    }

    return {
      hash: latestCommit.hash,
      message: latestCommit.message,
      author: latestCommit.author_name,
      timestamp: new Date(latestCommit.date),
      files,
    };
  }

  async finalizeTask(
    branchName: string,
    implementationSummary: string,
    files: string[]
  ): Promise<GitCommit> {
    // Ensure we're on the correct branch
    const currentBranch = await this.getCurrentBranch();
    if (currentBranch !== branchName) {
      await this.git.checkout(branchName);
    }

    // Stage any remaining files
    await this.git.add('.');

    // Check if there are changes to commit
    const status = await this.git.status();
    let commit: GitCommit | null = null;

    if (!status.isClean()) {
      // Create final commit
      const commitMessage = `feat: ${implementationSummary}

Task implementation completed.

${files.length > 0 ? `Files modified:\n${files.map(f => `  - ${f}`).join('\n')}` : ''}

Coordinated by Enginehaus.`;

      await this.git.commit(commitMessage);

      // Get commit info
      const log = await this.git.log({ maxCount: 1 });
      const latestCommit = log.latest;

      if (latestCommit) {
        commit = {
          hash: latestCommit.hash,
          message: latestCommit.message,
          author: latestCommit.author_name,
          timestamp: new Date(latestCommit.date),
          files,
        };
      }
    }

    // Push to remote
    try {
      await this.git.push('origin', branchName, ['--set-upstream']);
    } catch (error) {
      console.warn('Could not push to origin:', error);
      // Continue anyway - local commits are still valid
    }

    // If no new commit was created, get the latest commit
    if (!commit) {
      const log = await this.git.log({ maxCount: 1 });
      const latestCommit = log.latest;
      
      if (!latestCommit) {
        throw new Error('No commits found in branch');
      }

      commit = {
        hash: latestCommit.hash,
        message: latestCommit.message,
        author: latestCommit.author_name,
        timestamp: new Date(latestCommit.date),
        files,
      };
    }

    return commit;
  }

  // ========================================================================
  // Pull Request Generation
  // ========================================================================

  async createPullRequest(task: UnifiedTask): Promise<{
    url: string;
    title: string;
    description: string;
  }> {
    if (!task.implementation?.gitBranch) {
      throw new Error('Task has no git branch');
    }

    const branchName = task.implementation.gitBranch;
    const mainBranch = await this.getMainBranch();

    // Generate PR title
    const title = `${task.title}`;

    // Generate PR description
    const description = this.generatePRDescription(task);

    // Note: Actual PR creation would require GitHub/GitLab API integration
    // For now, we return the information needed to create a PR
    const githubUrl = await this.getRemoteUrl();
    const prUrl = githubUrl
      ? `${githubUrl}/compare/${mainBranch}...${branchName}?expand=1`
      : '#';

    return {
      url: prUrl,
      title,
      description,
    };
  }

  private generatePRDescription(task: UnifiedTask): string {
    const sections: string[] = [];

    // Overview
    sections.push('## Overview');
    sections.push(task.description);
    sections.push('');

    // Strategic Context
    if (task.strategicContext) {
      sections.push('## Strategic Context');
      sections.push(`**Business Rationale:** ${task.strategicContext.businessRationale}`);
      if (task.strategicContext.competitiveAdvantage) {
        sections.push(`**Competitive Advantage:** ${task.strategicContext.competitiveAdvantage}`);
      }
      if (task.strategicContext.revenueImpact) {
        sections.push(`**Revenue Impact:** ${task.strategicContext.revenueImpact}`);
      }
      sections.push('');
    }

    // UX Context
    if (task.uxContext) {
      sections.push('## UX Design');
      sections.push(`**User Experience:** ${task.uxContext.userExperience}`);
      sections.push(`**Design Pattern:** ${task.uxContext.designPattern}`);
      sections.push('');
    }

    // Technical Implementation
    if (task.technicalContext) {
      sections.push('## Technical Implementation');
      sections.push(`**Approach:** ${task.technicalContext.implementation}`);
      if (task.technicalContext.architecture) {
        sections.push(`**Architecture:** ${task.technicalContext.architecture}`);
      }
      sections.push('');
    }

    // Implementation Summary
    if (task.implementation?.implementationSummary) {
      sections.push('## Implementation Summary');
      sections.push(task.implementation.implementationSummary);
      sections.push('');
    }

    // Files Modified
    if (task.files && task.files.length > 0) {
      sections.push('## Files Modified');
      sections.push(task.files.map(f => `- \`${f}\``).join('\n'));
      sections.push('');
    }

    // Quality Metrics
    if (task.implementation?.qualityMetrics) {
      sections.push('## Quality Metrics');
      const qm = task.implementation.qualityMetrics;
      if (qm.testCoverage) sections.push(`- **Test Coverage:** ${qm.testCoverage}`);
      if (qm.performanceBenchmarks) sections.push(`- **Performance:** ${qm.performanceBenchmarks}`);
      if (qm.securityValidation) sections.push(`- **Security:** ${qm.securityValidation}`);
      if (qm.documentationComplete) sections.push(`- **Documentation:** Complete`);
      sections.push('');
    }

    // Architecture Decisions
    if (task.implementation?.architectureDecisions && task.implementation.architectureDecisions.length > 0) {
      sections.push('## Architecture Decisions');
      task.implementation.architectureDecisions.forEach((ad, idx) => {
        sections.push(`### ${idx + 1}. ${ad.decision}`);
        sections.push(`**Rationale:** ${ad.rationale}`);
        sections.push(`**Impact:** ${ad.impact}`);
        sections.push('');
      });
    }

    // Next Steps
    if (task.implementation?.nextSteps && task.implementation.nextSteps.length > 0) {
      sections.push('## Next Steps');
      sections.push(task.implementation.nextSteps.map(s => `- ${s}`).join('\n'));
      sections.push('');
    }

    // Footer
    sections.push('---');
    sections.push('*Coordinated by Enginehaus*');

    return sections.join('\n');
  }

  private async getRemoteUrl(): Promise<string | null> {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      
      if (!origin?.refs?.push) {
        return null;
      }

      // Convert git URL to HTTPS URL
      let url = origin.refs.push;
      
      // Handle git@github.com:user/repo.git format
      if (url.startsWith('git@')) {
        url = url.replace('git@', 'https://').replace('.com:', '.com/');
      }
      
      // Remove .git suffix
      url = url.replace(/\.git$/, '');
      
      return url;
    } catch (error) {
      console.warn('Could not get remote URL:', error);
      return null;
    }
  }

  // ========================================================================
  // Status & Information
  // ========================================================================

  async getStatus(): Promise<{
    currentBranch: string;
    hasUncommittedChanges: boolean;
    activeBranches: string[];
  }> {
    const branch = await this.git.branch();
    const status = await this.git.status();

    return {
      currentBranch: branch.current,
      hasUncommittedChanges: !status.isClean(),
      activeBranches: branch.all.filter(b => b.startsWith('feature/')),
    };
  }

  async getCommitHistory(branchName: string, maxCount: number = 10): Promise<GitCommit[]> {
    const currentBranch = await this.getCurrentBranch();
    
    // Temporarily switch to the branch if needed
    if (currentBranch !== branchName) {
      await this.git.checkout(branchName);
    }

    const log = await this.git.log({ maxCount });

    // Switch back if needed
    if (currentBranch !== branchName) {
      await this.git.checkout(currentBranch);
    }

    return log.all.map(commit => ({
      hash: commit.hash,
      message: commit.message,
      author: commit.author_name,
      timestamp: new Date(commit.date),
      files: [], // Would need additional call to get files per commit
    }));
  }
}
