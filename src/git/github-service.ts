/**
 * GitHub Service
 *
 * Handles GitHub API operations for Enginehaus:
 * - Create pull requests
 * - Get PR status
 * - Manage labels and reviewers
 */

import { UnifiedTask, GitHubConfig } from '../coordination/types.js';

export interface GitHubPullRequest {
  number: number;
  url: string;
  htmlUrl: string;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  head: string;
  base: string;
  createdAt: Date;
}

export interface CreatePROptions {
  title: string;
  body: string;
  head: string;  // Branch name
  base: string;  // Target branch (usually 'main')
  draft?: boolean;
}

export class GitHubService {
  private config: GitHubConfig;
  private baseUrl: string;

  constructor(config: GitHubConfig) {
    this.config = config;
    this.baseUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
  }

  /**
   * Create a pull request on GitHub
   */
  async createPullRequest(options: CreatePROptions): Promise<GitHubPullRequest> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/pulls`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
        draft: options.draft || false,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string; errors?: unknown };
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}` +
        (error.message ? ` - ${error.message}` : '') +
        (error.errors ? ` - ${JSON.stringify(error.errors)}` : '')
      );
    }

    const data = await response.json() as {
      number: number;
      url: string;
      html_url: string;
      title: string;
      body: string;
      state: 'open' | 'closed' | 'merged';
      head: { ref: string };
      base: { ref: string };
      created_at: string;
    };

    return {
      number: data.number,
      url: data.url,
      htmlUrl: data.html_url,
      title: data.title,
      body: data.body,
      state: data.state,
      head: data.head.ref,
      base: data.base.ref,
      createdAt: new Date(data.created_at),
    };
  }

  /**
   * Get an existing pull request by number
   */
  async getPullRequest(prNumber: number): Promise<GitHubPullRequest | null> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      number: number;
      url: string;
      html_url: string;
      title: string;
      body: string;
      state: 'open' | 'closed' | 'merged';
      head: { ref: string };
      base: { ref: string };
      created_at: string;
    };

    return {
      number: data.number,
      url: data.url,
      htmlUrl: data.html_url,
      title: data.title,
      body: data.body,
      state: data.state,
      head: data.head.ref,
      base: data.base.ref,
      createdAt: new Date(data.created_at),
    };
  }

  /**
   * List open pull requests for the repository
   */
  async listPullRequests(state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubPullRequest[]> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/pulls?state=${state}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Array<{
      number: number;
      url: string;
      html_url: string;
      title: string;
      body: string;
      state: 'open' | 'closed' | 'merged';
      head: { ref: string };
      base: { ref: string };
      created_at: string;
    }>;

    return data.map((pr) => ({
      number: pr.number,
      url: pr.url,
      htmlUrl: pr.html_url,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      head: pr.head.ref,
      base: pr.base.ref,
      createdAt: new Date(pr.created_at),
    }));
  }

  /**
   * Find an existing PR for a branch
   */
  async findPullRequestForBranch(branchName: string): Promise<GitHubPullRequest | null> {
    const prs = await this.listPullRequests('open');
    return prs.find(pr => pr.head === branchName) || null;
  }

  /**
   * Create a PR from a task with full context
   */
  async createPullRequestFromTask(
    task: UnifiedTask,
    baseBranch: string = 'main'
  ): Promise<GitHubPullRequest> {
    if (!task.implementation?.gitBranch) {
      throw new Error('Task has no git branch');
    }

    // Check if PR already exists
    const existingPR = await this.findPullRequestForBranch(task.implementation.gitBranch);
    if (existingPR) {
      return existingPR;
    }

    const title = task.title;
    const body = this.generatePRBody(task);

    return this.createPullRequest({
      title,
      body,
      head: task.implementation.gitBranch,
      base: baseBranch,
    });
  }

  /**
   * Generate comprehensive PR body from task context
   */
  private generatePRBody(task: UnifiedTask): string {
    const sections: string[] = [];

    // Summary
    sections.push('## Summary');
    sections.push(task.description || 'No description provided.');
    sections.push('');

    // Strategic Context
    if (task.strategicContext) {
      sections.push('## Strategic Context');
      if (task.strategicContext.businessRationale) {
        sections.push(`**Business Rationale:** ${task.strategicContext.businessRationale}`);
      }
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
      if (task.uxContext.userExperience) {
        sections.push(`**User Experience:** ${task.uxContext.userExperience}`);
      }
      if (task.uxContext.designPattern) {
        sections.push(`**Design Pattern:** ${task.uxContext.designPattern}`);
      }
      sections.push('');
    }

    // Technical Context
    if (task.technicalContext) {
      sections.push('## Technical Implementation');
      if (task.technicalContext.implementation) {
        sections.push(`**Approach:** ${task.technicalContext.implementation}`);
      }
      if (task.technicalContext.architecture) {
        sections.push(`**Architecture:** ${task.technicalContext.architecture}`);
      }
      sections.push('');
    }

    // Implementation Summary
    if (task.implementation?.implementationSummary) {
      sections.push('## What Changed');
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
      const qm = task.implementation.qualityMetrics;
      sections.push('## Quality Metrics');
      if (qm.testCoverage) sections.push(`- **Test Coverage:** ${qm.testCoverage}`);
      if (qm.performanceBenchmarks) sections.push(`- **Performance:** ${qm.performanceBenchmarks}`);
      if (qm.securityValidation) sections.push(`- **Security:** ${qm.securityValidation}`);
      if (qm.documentationComplete) sections.push(`- **Documentation:** Complete`);
      sections.push('');
    }

    // Architecture Decisions
    if (task.implementation?.architectureDecisions?.length) {
      sections.push('## Architecture Decisions');
      task.implementation.architectureDecisions.forEach((ad, idx) => {
        sections.push(`### ${idx + 1}. ${ad.decision}`);
        sections.push(`**Rationale:** ${ad.rationale}`);
        sections.push(`**Impact:** ${ad.impact}`);
        sections.push('');
      });
    }

    // Test Plan
    sections.push('## Test Plan');
    sections.push('- [ ] Unit tests pass');
    sections.push('- [ ] Integration tests pass');
    sections.push('- [ ] Manual testing completed');
    sections.push('');

    // Footer
    sections.push('---');
    sections.push(`*Task ID: ${task.id}*`);
    sections.push('*Coordinated by Enginehaus*');

    return sections.join('\n');
  }

  /**
   * Add labels to a pull request
   */
  async addLabels(prNumber: number, labels: string[]): Promise<void> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/issues/${prNumber}/labels`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ labels }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(`GitHub API error: ${response.status} - ${error.message || response.statusText}`);
    }
  }

  /**
   * Request reviewers for a pull request
   */
  async requestReviewers(prNumber: number, reviewers: string[]): Promise<void> {
    const url = `${this.baseUrl}/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}/requested_reviewers`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ reviewers }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(`GitHub API error: ${response.status} - ${error.message || response.statusText}`);
    }
  }
}
