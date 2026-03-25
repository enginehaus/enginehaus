/**
 * Git Tool Handlers
 *
 * Handlers for git-related MCP tools.
 */

import type { CoordinationEngine } from '../../../coordination/engine.js';
import type { CoordinationService } from '../../../core/services/coordination-service.js';
import { GitHubService } from '../../../git/github-service.js';

/**
 * Context object for handlers that need access to shared services
 */
export interface GitHandlerContext {
  coordination: CoordinationEngine;
  service: CoordinationService;
}

export interface CreatePullRequestParams {
  taskId: string;
  baseBranch?: string;
}

export async function handleGetGitStatus(
  ctx: GitHandlerContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const status = await ctx.coordination.getGitStatus();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          ...status,
        }, null, 2),
      },
    ],
  };
}

export async function handleCreatePullRequest(
  ctx: GitHandlerContext,
  args: CreatePullRequestParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const task = await ctx.service.getTask(args.taskId);

  if (!task) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Task ${args.taskId} not found` }) }],
    };
  }

  if (!task.implementation?.gitBranch) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Task has no git branch' }) }],
    };
  }

  // Check if we have GitHub config from environment
  const githubToken = process.env.GITHUB_TOKEN;
  const githubOwner = process.env.GITHUB_OWNER;
  const githubRepo = process.env.GITHUB_REPO;

  if (githubToken && githubOwner && githubRepo) {
    // Use GitHub API to create actual PR
    try {
      const githubService = new GitHubService({
        token: githubToken,
        owner: githubOwner,
        repo: githubRepo,
        syncInterval: 0,
        bidirectionalSync: false,
      });

      const pr = await githubService.createPullRequestFromTask(
        task,
        args.baseBranch || 'main'
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              pullRequest: {
                number: pr.number,
                url: pr.htmlUrl,
                title: pr.title,
                state: pr.state,
                head: pr.head,
                base: pr.base,
              },
              message: `Pull request #${pr.number} created successfully`,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `GitHub API error: ${errorMsg}` }) }],
      };
    }
  } else {
    // Fall back to generating PR info without GitHub API
    const pr = await ctx.coordination.createPullRequest(args.taskId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            pullRequest: pr,
            message: 'Pull request information generated (GitHub API not configured - set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO env vars to create actual PRs)',
          }, null, 2),
        },
      ],
    };
  }
}
