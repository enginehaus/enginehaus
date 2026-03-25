/**
 * SessionService — extracted from CoordinationService
 *
 * Session lifecycle: claim, release, heartbeat, active sessions, cleanup.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  UnifiedTask,
  CoordinationSession,
} from '../../coordination/types.js';
import {
  createPhaseProgress,
  getPhase,
  PHASES,
} from '../../coordination/phases.js';
import type { ServiceContext } from './service-context.js';
import { audit } from './service-context.js';
import type { AbandonmentReason } from '../../analytics/types.js';

export interface ClaimResult {
  success: boolean;
  sessionId?: string;
  conflict?: {
    sessionId: string;
    agentId: string;
    startTime: Date;
  };
  fileConflicts?: Array<{
    taskId: string;
    taskTitle: string;
    agentId: string;
    overlappingFiles: string[];
  }>;
  capacityExceeded?: {
    currentTasks: Array<{ taskId: string; taskTitle: string; sessionId: string }>;
    capacity: number;
  };
  dependencyBlock?: {
    blockedBy: Array<{ taskId: string; taskTitle: string; status: string }>;
  };
}

export class SessionService {
  constructor(private ctx: ServiceContext) {}

  async claimTask(
    taskId: string,
    agentId: string,
    options: { force?: boolean; capacity?: number } = {}
  ): Promise<ClaimResult> {
    const { force = false, capacity = 1 } = options;

    // Expire stale sessions first
    await this.ctx.storage.expireStaleSessions();

    const task = await this.ctx.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Quick check: if same agent already has a session on THIS task, just refresh
    const existingOwnSession = await this.ctx.storage.getActiveSessionForTask(taskId);
    if (existingOwnSession && existingOwnSession.agentId === agentId) {
      await this.ctx.storage.updateSessionHeartbeat(existingOwnSession.id);
      // Ensure task is in-progress — it may have been reset by expireStaleSessions
      // or manually while the session was still active
      if (task.status !== 'in-progress') {
        await this.ctx.storage.updateTask(taskId, {
          status: 'in-progress',
          implementation: {
            ...task.implementation,
            sessionId: existingOwnSession.id,
            startedAt: task.implementation?.startedAt || new Date(),
            phaseProgress: task.implementation?.phaseProgress || createPhaseProgress(),
          },
        });
      }
      return { success: true, sessionId: existingOwnSession.id };
    }

    // Check capacity — scoped to same project to prevent cross-project blocking
    if (!force && capacity > 0) {
      const allAgentSessions = await this.ctx.storage.getActiveSessionsForAgent(agentId);
      const agentSessions = allAgentSessions.filter(s => s.projectId === task.projectId);
      if (agentSessions.length >= capacity) {
        const currentTasks = await Promise.all(
          agentSessions.map(async (s) => {
            const t = await this.ctx.storage.getTask(s.taskId);
            return { taskId: s.taskId, taskTitle: t?.title || 'Unknown', sessionId: s.id };
          })
        );
        if (this.ctx.events) {
          await this.ctx.events.emitTaskClaimRejected(task, agentId, 'capacity_exceeded',
            `Agent has ${agentSessions.length}/${capacity} concurrent tasks in project`, 'internal');
        }
        return { success: false, capacityExceeded: { currentTasks, capacity } };
      }
    }

    // Check file conflicts
    const fileConflicts = await this.ctx.storage.findFileConflicts(taskId, agentId);
    if (fileConflicts.length > 0 && !force) {
      if (this.ctx.events) {
        const overlapping = fileConflicts.flatMap(fc => fc.overlappingFiles);
        await this.ctx.events.emitTaskClaimRejected(task, agentId, 'file_conflict',
          `Files overlap with active sessions: ${overlapping.join(', ')}`, 'internal');
      }
      return {
        success: false,
        fileConflicts: fileConflicts.map(fc => ({
          taskId: fc.task.id,
          taskTitle: fc.task.title,
          agentId: fc.session.agentId,
          overlappingFiles: fc.overlappingFiles,
        })),
      };
    }

    // Check dependency blocking - task must not be in 'blocked' status
    if (task.status === 'blocked' && !force) {
      const blockerIds = this.ctx.storage.getBlockingTasks(taskId);
      const blockerDetails = await Promise.all(
        blockerIds.map(async (id) => {
          const t = await this.ctx.storage.getTask(id);
          return { taskId: id, taskTitle: t?.title || 'Unknown', status: t?.status || 'unknown' };
        })
      );
      const incompleteBlockers = blockerDetails.filter(b => b.status !== 'completed');
      if (this.ctx.events) {
        await this.ctx.events.emitTaskClaimRejected(task, agentId, 'dependency_block',
          `Blocked by: ${incompleteBlockers.map(b => b.taskTitle).join(', ')}`, 'internal');
      }
      return {
        success: false,
        dependencyBlock: {
          blockedBy: incompleteBlockers,
        },
      };
    }

    // Create session — atomic transaction prevents race conditions
    const sessionId = uuidv4();
    const now = new Date();

    const session: CoordinationSession = {
      id: sessionId,
      projectId: task.projectId,
      taskId,
      agentId,
      status: 'active',
      startTime: now,
      lastHeartbeat: now,
      context: {
        role: agentId,
        currentTask: task,
        recentDecisions: [],
        recentUXRequirements: [],
        recentTechnicalPlans: [],
        activeTasks: [task],
        readyTasks: [],
        projectContext: {},
      },
    };

    if (force) {
      // Force claim — close any existing session first, then save
      const existingSession = await this.ctx.storage.getActiveSessionForTask(taskId);
      if (existingSession) {
        await this.ctx.storage.completeSession(existingSession.id);
      }
      await this.ctx.storage.saveSession(session);
    } else if (task.mode === 'collaborative') {
      // Collaborative mode — multiple agents can have concurrent sessions.
      // Still check for same-agent re-claim via claimSessionAtomic, but
      // treat conflicts from OTHER agents as non-blocking: save session directly.
      const result = this.ctx.storage.claimSessionAtomic(session);
      if (result.conflict) {
        // Different agent already has a session — that's fine in collaborative mode.
        // Save our session alongside theirs.
        await this.ctx.storage.saveSession(session);
      }
    } else {
      // Normal exclusive claim — use atomic check-and-create
      const result = this.ctx.storage.claimSessionAtomic(session);
      if (result.conflict) {
        if (this.ctx.events) {
          await this.ctx.events.emitTaskClaimRejected(task, agentId, 'session_conflict',
            `Already claimed by ${result.conflict.agentId}`, 'internal');
        }
        return {
          success: false,
          conflict: {
            sessionId: result.conflict.id,
            agentId: result.conflict.agentId,
            startTime: result.conflict.startTime,
          },
        };
      }
      // Same agent already had a session — ensure task is in-progress and return
      if (result.existingSessionId) {
        if (task.status !== 'in-progress') {
          await this.ctx.storage.updateTask(taskId, {
            status: 'in-progress',
            implementation: {
              ...task.implementation,
              sessionId: result.existingSessionId,
              startedAt: task.implementation?.startedAt || now,
              phaseProgress: task.implementation?.phaseProgress || createPhaseProgress(),
            },
          });
        }
        return { success: true, sessionId: result.existingSessionId };
      }
    }

    // Update task status to in-progress and auto-initialize phases
    await this.ctx.storage.updateTask(taskId, {
      status: 'in-progress',
      implementation: {
        ...task.implementation,
        sessionId,
        startedAt: now,
        // Auto-initialize phase workflow if not already started
        phaseProgress: task.implementation?.phaseProgress || createPhaseProgress(),
      },
    });

    // Log metrics at service layer (all adapters benefit)
    await this.ctx.storage.logMetric({
      eventType: 'task_claimed',
      projectId: task.projectId,
      taskId,
      sessionId,
      metadata: { agentId },
    });
    await this.ctx.storage.logMetric({
      eventType: 'session_started',
      projectId: task.projectId,
      taskId,
      sessionId,
      metadata: { agentId },
    });

    // Audit event
    await audit(this.ctx.storage, 'task.claimed', task.projectId, 'task', taskId, `Task claimed: ${task.title}`, { actorId: agentId, metadata: { sessionId, agentId } });

    // Emit events
    if (this.ctx.events) {
      await this.ctx.events.emitSessionStarted(session, 'internal');
      await this.ctx.events.emitTaskClaimed(task, sessionId, agentId, 'internal');
    }

    return { success: true, sessionId };
  }

  /**
   * Claim task with structured response for MCP/REST/CLI adapters
   */
  async claimTaskWithResponse(
    taskId: string,
    agentId: string,
    options: { force?: boolean; capacity?: number } = {}
  ): Promise<{
    success: boolean;
    sessionId?: string;
    message?: string;
    phaseWorkflow?: {
      initialized: boolean;
      currentPhase: string;
      phaseNumber: number;
      completedPhases?: number;
      totalPhases: number;
      message: string;
    };
    conflictType?: 'task' | 'file' | 'capacity';
    conflict?: {
      message: string;
      existingSessionId?: string;
      existingAgentId?: string;
      lastHeartbeat?: Date;
      startTime?: Date;
    };
    fileConflicts?: Array<{
      task: string;
      taskId: string;
      agent: string;
      files: string[];
    }>;
    capacityExceeded?: {
      currentTasks: Array<{ taskId: string; taskTitle: string; sessionId: string }>;
      capacity: number;
      message: string;
    };
    hint?: string;
  }> {
    const result = await this.claimTask(taskId, agentId, options);

    // Handle conflict
    if (!result.success && result.conflict) {
      return {
        success: false,
        conflictType: 'task',
        conflict: {
          message: `Task is already claimed by ${result.conflict.agentId}`,
          existingSessionId: result.conflict.sessionId,
          existingAgentId: result.conflict.agentId,
          startTime: result.conflict.startTime,
        },
        hint: 'Use force: true to override the existing claim',
      };
    }

    // Handle file conflicts
    if (!result.success && result.fileConflicts) {
      const totalFiles = result.fileConflicts.reduce((sum, fc) => sum + fc.overlappingFiles.length, 0);
      return {
        success: false,
        conflictType: 'file',
        message: `Cannot claim task: ${totalFiles} file(s) are being edited by other agents`,
        fileConflicts: result.fileConflicts.map(fc => ({
          task: fc.taskTitle,
          taskId: fc.taskId,
          agent: fc.agentId,
          files: fc.overlappingFiles,
        })),
        hint: 'Wait for the other task to complete, or use force: true to override',
      };
    }

    // Handle capacity exceeded
    if (!result.success && result.capacityExceeded) {
      return {
        success: false,
        conflictType: 'capacity',
        capacityExceeded: {
          currentTasks: result.capacityExceeded.currentTasks,
          capacity: result.capacityExceeded.capacity,
          message: `Agent capacity exceeded: ${result.capacityExceeded.currentTasks.length}/${result.capacityExceeded.capacity} tasks in progress`,
        },
        hint: 'Complete or release a task before claiming another, or use force: true to override',
      };
    }

    if (!result.success) {
      return { success: false, message: 'Failed to claim task' };
    }

    // Metrics are logged in claimTask() - just get phase info here
    const updatedTask = await this.ctx.storage.getTask(taskId);
    let phaseWorkflow: {
      initialized: boolean;
      currentPhase: string;
      phaseNumber: number;
      completedPhases?: number;
      totalPhases: number;
      message: string;
    } | undefined = undefined;
    if (updatedTask?.implementation?.phaseProgress) {
      const progress = updatedTask.implementation.phaseProgress;
      const currentPhase = getPhase(progress.currentPhase);
      phaseWorkflow = {
        initialized: progress.completedPhases.length === 0,
        currentPhase: currentPhase?.name || 'Unknown',
        phaseNumber: progress.currentPhase,
        completedPhases: progress.completedPhases.length,
        totalPhases: PHASES.length,
        message: progress.completedPhases.length === 0
          ? 'Phase workflow auto-initialized. Use advance_phase to progress.'
          : 'Resuming existing phase workflow.',
      };
    }

    return {
      success: true,
      sessionId: result.sessionId,
      message: `Task claimed successfully. Session ID: ${result.sessionId}`,
      phaseWorkflow,
    };
  }

  async releaseTask(
    sessionId: string,
    completed: boolean = false,
    options: {
      reason?: AbandonmentReason;
      notes?: string;
      agentId?: string;
    } = {}
  ): Promise<void> {
    const session = await this.ctx.storage.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Check agent ownership — only the claiming agent can release a task.
    // Prevents one agent from releasing another agent's in-progress work
    // (e.g., to bypass capacity limits and claim a different task).
    if (options.agentId && session.agentId !== options.agentId) {
      throw new Error(
        `Task is owned by agent "${session.agentId}" — only the claiming agent can release it.\n` +
        `  Your agent ID: ${options.agentId}\n` +
        `  Owning agent: ${session.agentId}`
      );
    }

    const task = await this.ctx.storage.getTask(session.taskId);

    await this.ctx.storage.completeSession(sessionId);

    if (!completed) {
      if (task && task.status === 'in-progress') {
        await this.ctx.storage.updateTask(session.taskId, { status: 'ready' });
      }
    }

    // Emit events
    if (this.ctx.events && task) {
      await this.ctx.events.emitSessionCompleted(session, 'internal');
      await this.ctx.events.emitTaskReleased(task, sessionId, session.agentId, 'internal');
    }
  }

  /**
   * Release task with structured response for MCP/REST/CLI adapters
   */
  async releaseTaskWithResponse(
    sessionId: string,
    completed: boolean = false,
    options: {
      reason?: AbandonmentReason;
      notes?: string;
      agentId?: string;
    } = {}
  ): Promise<{
    success: boolean;
    message: string;
    ownershipConflict?: { claimingAgent: string; callingAgent: string; sessionId: string };
  }> {
    // Get session info before releasing for metrics
    const session = await this.ctx.storage.getSession(sessionId);
    const task = session ? await this.ctx.storage.getTask(session.taskId) : null;

    // Check ownership before releasing — return structured error instead of throwing
    if (options.agentId && session && session.agentId !== options.agentId) {
      return {
        success: false,
        message: `Task is owned by agent "${session.agentId}" — only the claiming agent can release it. Let the owning agent manage its own task lifecycle.`,
        ownershipConflict: {
          claimingAgent: session.agentId,
          callingAgent: options.agentId,
          sessionId: session.id,
        },
      };
    }

    await this.releaseTask(sessionId, completed, options);

    // Log metrics with abandonment reason
    if (session) {
      const eventType = completed ? 'task_completed' : 'task_abandoned';
      const metadata: Record<string, unknown> = { agentId: session.agentId };

      // Include abandonment reason and notes if provided (only for abandonments)
      if (!completed) {
        if (options.reason) metadata.reason = options.reason;
        if (options.notes) metadata.notes = options.notes;
        if (task) metadata.taskTitle = task.title;
      }

      await this.ctx.storage.logMetric({
        eventType,
        projectId: session.projectId,
        taskId: session.taskId,
        sessionId,
        metadata,
      });
      await this.ctx.storage.logMetric({
        eventType: 'session_ended',
        projectId: session.projectId,
        taskId: session.taskId,
        sessionId,
        metadata: { agentId: session.agentId, completed },
      });
    }

    return {
      success: true,
      message: completed
        ? 'Session completed successfully'
        : 'Session released (task returned to ready state)',
    };
  }

  async sessionHeartbeat(sessionId: string): Promise<{ success: boolean; expired: boolean }> {
    const session = await this.ctx.storage.getSession(sessionId);
    if (!session) {
      return { success: false, expired: true };
    }

    if (session.status !== 'active') {
      return { success: false, expired: true };
    }

    await this.ctx.storage.updateSessionHeartbeat(sessionId);
    return { success: true, expired: false };
  }

  async getSession(id: string): Promise<CoordinationSession | null> {
    return this.ctx.storage.getSession(id);
  }

  async getActiveSessions(projectId?: string): Promise<CoordinationSession[]> {
    return this.ctx.storage.getActiveSessions(projectId);
  }

  async getSessionFeedback(options: { projectId?: string; since?: Date; until?: Date } = {}): Promise<Array<{
    id: string; sessionId: string; projectId: string; taskId?: string;
    productivityRating?: number; frictionTags: string[]; notes?: string; createdAt: Date;
  }>> {
    return this.ctx.storage.getSessionFeedback(options);
  }

  async getActiveSessionForTask(taskId: string): Promise<CoordinationSession | null> {
    return this.ctx.storage.getActiveSessionForTask(taskId);
  }

  /**
   * Clean up dangling sessions (active sessions for completed tasks).
   * Returns the number of sessions cleaned up.
   */
  async cleanupDanglingSessions(): Promise<number> {
    return this.ctx.storage.expireStaleSessions();
  }

  /**
   * Get all sessions (including completed/expired) with optional filters.
   */
  async getAllSessions(options: {
    projectId?: string;
    status?: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<CoordinationSession[]> {
    return this.ctx.storage.getAllSessions(options);
  }
}
