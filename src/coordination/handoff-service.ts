/**
 * Session Handoff Service
 *
 * Enables seamless coordination continuity across agent boundaries.
 * Captures: what was accomplished, decisions made, current state, next steps.
 */

import type { StorageAdapter } from '../storage/storage-adapter.js';
import { UnifiedTask, CoordinationSession, SessionStatus } from './types.js';

export interface HandoffContext {
  // What agent is handing off
  fromAgent: string;
  // Target agent receiving the handoff
  toAgent: string;
  // Timestamp of handoff
  timestamp: Date;

  // Task context
  task: {
    id: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    files: string[];
  };

  // What was accomplished
  accomplishments: string[];

  // Decisions made and why
  decisions: Array<{
    decision: string;
    rationale?: string;
    impact?: string;
    category?: string;
  }>;

  // Current state summary
  currentState: {
    summary: string;
    blockers: string[];
    openQuestions: string[];
  };

  // What needs to happen next
  nextSteps: string[];

  // Session metrics
  sessionMetrics?: {
    duration: string;
    filesModified: number;
    contextExpansions: number;
  };
}

export interface ContinuationPrompt {
  prompt: string;
  metadata: {
    taskId: string;
    fromAgent: string;
    toAgent: string;
    generatedAt: Date;
  };
}

export interface CompressedSessionState {
  sessionId: string;
  taskId: string;
  agentId: string;
  startTime: Date;
  summary: string;
  keyDecisions: string[];
  filesWorkedOn: string[];
  status: SessionStatus;
}

export class HandoffService {
  constructor(private storage: StorageAdapter) {}

  /**
   * Generate handoff context for transferring work to another agent
   */
  async getHandoffContext(options: {
    fromAgent: string;
    toAgent: string;
    taskId: string;
    sessionId?: string;
  }): Promise<HandoffContext> {
    const { fromAgent, toAgent, taskId, sessionId } = options;

    // Get task details
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Get decisions for this task
    const decisions = await this.storage.getDecisionsForTask(taskId);

    // Get session if provided, otherwise get active session for task
    let session: CoordinationSession | null = null;
    if (sessionId) {
      session = await this.storage.getSession(sessionId);
    } else {
      const sessions = await this.storage.getSessionsForTask(taskId);
      session = sessions.find(s => s.status === 'active') || sessions[0] || null;
    }

    // Analyze what was accomplished from task progress
    const accomplishments = this.extractAccomplishments(task, session);

    // Determine current state
    const currentState = this.analyzeCurrentState(task, session);

    // Determine next steps
    const nextSteps = this.determineNextSteps(task, session);

    // Calculate session metrics if we have a session
    const sessionMetrics = session ? this.calculateSessionMetrics(session) : undefined;

    return {
      fromAgent,
      toAgent,
      timestamp: new Date(),
      task: {
        id: task.id,
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        status: task.status,
        files: task.files || [],
      },
      accomplishments,
      decisions: decisions.map(d => ({
        decision: d.decision,
        rationale: d.rationale,
        impact: d.impact,
        category: d.category,
      })),
      currentState,
      nextSteps,
      sessionMetrics,
    };
  }

  /**
   * Generate a continuation prompt for the target agent
   */
  async generateContinuationPrompt(options: {
    taskId: string;
    targetAgent: string;
    fromAgent?: string;
    includeFiles?: boolean;
  }): Promise<ContinuationPrompt> {
    const { taskId, targetAgent, fromAgent = 'previous-agent', includeFiles = true } = options;

    const context = await this.getHandoffContext({
      fromAgent,
      toAgent: targetAgent,
      taskId,
    });

    const prompt = this.formatContinuationPrompt(context, includeFiles);

    return {
      prompt,
      metadata: {
        taskId,
        fromAgent,
        toAgent: targetAgent,
        generatedAt: new Date(),
      },
    };
  }

  /**
   * Generate a "start fresh session" prompt for a project
   */
  async generateStartSessionPrompt(projectSlug: string): Promise<string> {
    const project = await this.storage.getProjectBySlug(projectSlug);
    if (!project) {
      throw new Error(`Project not found: ${projectSlug}`);
    }

    const tasks = await this.storage.getTasks({ status: 'ready', projectId: project.id });
    const inProgressTasks = await this.storage.getTasks({ status: 'in-progress', projectId: project.id });

    const lines: string[] = [];

    lines.push(`# Start Session: ${project.name}`);
    lines.push('');
    lines.push(this.getWorkflowExpectations());
    lines.push('');
    lines.push('## Project Context');
    lines.push(`- **Name:** ${project.name}`);
    lines.push(`- **Path:** ${project.rootPath}`);
    if (project.domain) lines.push(`- **Domain:** ${project.domain}`);
    if (project.techStack && project.techStack.length > 0) {
      lines.push(`- **Tech Stack:** ${project.techStack.join(', ')}`);
    }
    lines.push('');

    if (inProgressTasks.length > 0) {
      lines.push('## In-Progress Tasks (Resume These First)');
      inProgressTasks.slice(0, 5).forEach(t => {
        lines.push(`- **${t.title}** (${t.priority}) - ID: ${t.id.substring(0, 8)}`);
      });
      lines.push('');
      lines.push('> Run `get_next_task` to continue the first in-progress task.');
      lines.push('');
    }

    if (tasks.length > 0) {
      lines.push('## Ready Tasks');
      tasks.slice(0, 5).forEach(t => {
        lines.push(`- **${t.title}** (${t.priority}) - ID: ${t.id.substring(0, 8)}`);
      });
      if (tasks.length > 5) {
        lines.push(`- ... and ${tasks.length - 5} more`);
      }
      lines.push('');
    }

    lines.push('## Quick Start');
    lines.push('```json');
    lines.push('// Get next task with full context');
    lines.push('start_work()');
    lines.push('');
    lines.push('// Or list all tasks');
    lines.push('list_tasks()');
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Generate a "review and close out" prompt for completing a task
   */
  async generateReviewPrompt(taskId: string): Promise<string> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const decisions = await this.storage.getDecisionsForTask(taskId);

    const lines: string[] = [];

    lines.push('# Task Review & Close-Out');
    lines.push('');
    lines.push(`## Task: ${task.title}`);
    lines.push(`Status: ${task.status} | Priority: ${task.priority}`);
    lines.push('');

    lines.push('## Pre-Completion Checklist');
    lines.push('');
    lines.push('Before marking this task complete, verify:');
    lines.push('');
    lines.push('- [ ] **Tests pass** - `npm test` or equivalent');
    lines.push('- [ ] **Build compiles** - `npm run build` or equivalent');
    lines.push('- [ ] **Linting passes** - No new warnings/errors');
    lines.push('- [ ] **Decisions documented** - Used `log_decision` for architectural choices');
    lines.push('');

    if (decisions.length === 0) {
      lines.push('> **Warning:** No decisions logged for this task. Consider documenting any architectural choices.');
      lines.push('');
    } else {
      lines.push(`### ${decisions.length} Decision(s) Logged`);
      decisions.forEach(d => {
        lines.push(`- ${d.decision}`);
      });
      lines.push('');
    }

    lines.push('## Complete the Task');
    lines.push('```json');
    lines.push(`finish_work({ summary: "Your summary here" })`);
    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Get workflow expectations as a reusable string
   */
  private getWorkflowExpectations(): string {
    const lines: string[] = [];

    lines.push('## Workflow Expectations');
    lines.push('');
    lines.push('**IMPORTANT - Follow these rules during this session:**');
    lines.push('');
    lines.push('1. **DO NOT access SQLite directly** - Always use Enginehaus MCP tools');
    lines.push('2. **Log architectural decisions** - Use `log_decision` for non-trivial choices');
    lines.push('3. **Validate quality gates** - Run tests, build, lint before completing');

    return lines.join('\n');
  }

  /**
   * Compress session state into minimal summary
   */
  async compressSessionState(sessionId: string): Promise<CompressedSessionState> {
    const session = await this.storage.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const task = await this.storage.getTask(session.taskId);
    const decisions = await this.storage.getDecisionsForTask(session.taskId);

    // Generate summary
    const summary = this.generateSessionSummary(session, task, decisions);

    // Extract key decisions (most impactful)
    const keyDecisions = decisions
      .filter(d => d.category === 'architecture' || d.category === 'tradeoff')
      .slice(0, 5)
      .map(d => d.decision);

    return {
      sessionId: session.id,
      taskId: session.taskId,
      agentId: session.agentId,
      startTime: session.startTime,
      summary,
      keyDecisions,
      filesWorkedOn: task?.files || [],
      status: session.status,
    };
  }

  /**
   * Get handoff status for current session
   */
  async getHandoffStatus(options: {
    taskId?: string;
    sessionId?: string;
    projectId?: string;
  }): Promise<{
    activeSessions: Array<{
      sessionId: string;
      taskId: string;
      taskTitle: string;
      agentId: string;
      startTime: Date;
      durationMinutes: number;
    }>;
    recentDecisions: Array<{
      decision: string;
      taskId: string;
      createdAt: Date;
    }>;
    pendingHandoffs: number;
  }> {
    const projectId = options.projectId || await this.storage.getActiveProjectId();

    // Get active sessions
    const sessions = await this.storage.getActiveSessions(projectId || undefined);

    const activeSessions = await Promise.all(
      sessions.map(async (s) => {
        const task = await this.storage.getTask(s.taskId);
        const durationMs = Date.now() - new Date(s.startTime).getTime();
        return {
          sessionId: s.id,
          taskId: s.taskId,
          taskTitle: task?.title || 'Unknown Task',
          agentId: s.agentId,
          startTime: s.startTime,
          durationMinutes: Math.round(durationMs / 60000),
        };
      })
    );

    // Get recent decisions
    const decisions = await this.storage.getDecisions({
      projectId: projectId || undefined,
      limit: 10,
    });

    const recentDecisions = decisions.map(d => ({
      decision: d.decision,
      taskId: d.taskId || '',
      createdAt: d.createdAt,
    }));

    return {
      activeSessions,
      recentDecisions,
      pendingHandoffs: 0, // Could track explicit handoff requests in future
    };
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private extractAccomplishments(task: UnifiedTask, session: CoordinationSession | null): string[] {
    const accomplishments: string[] = [];

    // Check file targets as basic indicator
    if (task.files && task.files.length > 0) {
      accomplishments.push(`Working on ${task.files.length} file(s): ${task.files.slice(0, 3).join(', ')}${task.files.length > 3 ? '...' : ''}`);
    }

    // Default based on status
    if (accomplishments.length === 0) {
      if (task.status === 'completed') {
        accomplishments.push('Task completed');
      } else if (task.status === 'in-progress') {
        accomplishments.push('Work in progress');
      } else if (task.status === 'ready') {
        accomplishments.push('Task ready to begin');
      }
    }

    return accomplishments;
  }

  private analyzeCurrentState(task: UnifiedTask, session: CoordinationSession | null): {
    summary: string;
    blockers: string[];
    openQuestions: string[];
  } {
    const blockers: string[] = [];
    const openQuestions: string[] = [];

    // Check for blockers
    if (task.blockedBy && task.blockedBy.length > 0) {
      blockers.push(`Blocked by ${task.blockedBy.length} task(s)`);
    }

    // Generate summary based on status
    let summary = '';
    switch (task.status) {
      case 'ready':
        summary = 'Task is ready to begin. No work has been started yet.';
        break;
      case 'in-progress':
        summary = 'Task is in progress.';
        if (session) {
          summary += ` Active session started at ${new Date(session.startTime).toLocaleString()}.`;
        }
        break;
      case 'blocked':
        summary = 'Task is currently blocked and waiting for dependencies.';
        break;
      case 'completed':
        summary = 'Task has been completed.';
        break;
      default:
        summary = `Task status: ${task.status}`;
    }

    return { summary, blockers, openQuestions };
  }

  private determineNextSteps(task: UnifiedTask, session: CoordinationSession | null): string[] {
    const nextSteps: string[] = [];

    // Check if there are files to work on
    if (task.files && task.files.length > 0) {
      nextSteps.push(`Review/modify files: ${task.files.slice(0, 3).join(', ')}${task.files.length > 3 ? '...' : ''}`);
    }

    // Default next steps based on status
    if (nextSteps.length === 0) {
      switch (task.status) {
        case 'ready':
          nextSteps.push('Begin implementation');
          nextSteps.push('Review task requirements');
          break;
        case 'in-progress':
          nextSteps.push('Continue implementation');
          nextSteps.push('Run tests to verify changes');
          break;
        case 'blocked':
          nextSteps.push('Resolve blockers before continuing');
          break;
        case 'completed':
          nextSteps.push('Task is complete - no further action needed');
          break;
      }
    }

    return nextSteps;
  }

  private calculateSessionMetrics(session: CoordinationSession): {
    duration: string;
    filesModified: number;
    contextExpansions: number;
  } {
    const startTime = new Date(session.startTime).getTime();
    const endTime = session.endTime ? new Date(session.endTime).getTime() : Date.now();
    const durationMs = endTime - startTime;

    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return {
      duration,
      filesModified: 0, // Would need to track this in session
      contextExpansions: 0, // Would need to track this in session
    };
  }

  private generateSessionSummary(
    session: CoordinationSession,
    task: UnifiedTask | null,
    decisions: Array<{ decision: string }>
  ): string {
    const parts: string[] = [];

    if (task) {
      parts.push(`Working on: ${task.title}`);
      parts.push(`Status: ${task.status}`);
    }

    if (decisions.length > 0) {
      parts.push(`Made ${decisions.length} decision(s)`);
    }

    const durationMs = (session.endTime ? new Date(session.endTime).getTime() : Date.now()) - new Date(session.startTime).getTime();
    const minutes = Math.round(durationMs / 60000);
    parts.push(`Duration: ${minutes} minutes`);

    return parts.join('. ');
  }

  private formatContinuationPrompt(context: HandoffContext, includeFiles: boolean): string {
    const lines: string[] = [];

    lines.push('# Session Handoff');
    lines.push('');
    lines.push(`You are continuing work on a task that was previously being handled by another agent.`);
    lines.push('');

    // Workflow expectations section (critical nudges)
    lines.push('## Workflow Expectations');
    lines.push('');
    lines.push('**IMPORTANT - Follow these rules during this session:**');
    lines.push('');
    lines.push('1. **DO NOT access SQLite directly** - Always use Enginehaus MCP tools:');
    lines.push('   - `list_tasks` instead of `SELECT * FROM tasks`');
    lines.push('   - `complete_task` instead of `UPDATE tasks SET status=...`');
    lines.push('   - `log_decision` instead of `INSERT INTO decisions`');
    lines.push('');
    lines.push('2. **Log architectural decisions** - Use `log_decision` for any non-trivial choices:');
    lines.push('   - Library/framework selections');
    lines.push('   - Design pattern choices');
    lines.push('   - Trade-off decisions');
    lines.push('');
    lines.push('3. **Validate quality gates** - Before completing, run `validate_quality_gates` or verify:');
    lines.push('   - Tests pass');
    lines.push('   - Build compiles');
    lines.push('   - Linting passes');
    lines.push('');
    lines.push('4. **Use CLI for quick operations**:');
    lines.push('   - `enginehaus task list` - View tasks');
    lines.push('   - `enginehaus task next` - Get next task');
    lines.push('   - `enginehaus status` - Current context');
    lines.push('');

    // Task info
    lines.push('## Task');
    lines.push(`**${context.task.title}** (${context.task.priority} priority)`);
    lines.push('');
    if (context.task.description) {
      lines.push(context.task.description);
      lines.push('');
    }
    lines.push(`Status: ${context.task.status}`);
    lines.push('');

    // Files
    if (includeFiles && context.task.files.length > 0) {
      lines.push('## Relevant Files');
      context.task.files.forEach(f => lines.push(`- ${f}`));
      lines.push('');
    }

    // What was accomplished
    if (context.accomplishments.length > 0) {
      lines.push('## What Was Accomplished');
      context.accomplishments.forEach(a => lines.push(`- ${a}`));
      lines.push('');
    }

    // Decisions made
    if (context.decisions.length > 0) {
      lines.push('## Decisions Made');
      context.decisions.forEach(d => {
        lines.push(`- **${d.decision}**`);
        if (d.rationale) lines.push(`  - Rationale: ${d.rationale}`);
        if (d.impact) lines.push(`  - Impact: ${d.impact}`);
      });
      lines.push('');
    }

    // Current state
    lines.push('## Current State');
    lines.push(context.currentState.summary);
    if (context.currentState.blockers.length > 0) {
      lines.push('');
      lines.push('**Blockers:**');
      context.currentState.blockers.forEach(b => lines.push(`- ${b}`));
    }
    lines.push('');

    // Next steps
    if (context.nextSteps.length > 0) {
      lines.push('## Next Steps');
      context.nextSteps.forEach(s => lines.push(`- ${s}`));
      lines.push('');
    }

    // Session metrics
    if (context.sessionMetrics) {
      lines.push('## Previous Session');
      lines.push(`Duration: ${context.sessionMetrics.duration}`);
      lines.push('');
    }

    lines.push('---');
    lines.push(`Handoff generated at ${context.timestamp.toISOString()}`);

    return lines.join('\n');
  }
}
