/**
 * REST API Adapter
 *
 * Thin HTTP layer that translates REST requests to CoordinationService calls.
 * No business logic here - just protocol translation and error handling.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { CoordinationService } from '../../core/services/index.js';
import { queryPanelJSON, queryDashboardJSON, getPanel } from '../../views/panels/index.js';
// eslint-disable-next-line no-restricted-imports -- Bootstrap: creates storage instance for CoordinationService
import { SQLiteStorageService } from '../../storage/sqlite-storage-service.js';
import { TaskPriority, TaskStatus, ArtifactType, Artifact } from '../../coordination/types.js';
import { EventOrchestrator, EnginehausEventType } from '../../events/index.js';
import { ConfigurationManager } from '../../config/configuration-manager.js';
import { DEFAULT_CONFIG } from '../../config/types.js';
import { getDataDir } from '../../config/paths.js';
import { getViewMaterializer, WheelhausWebSocket, ViewMaterializer, InitialDataLoader } from '../../views/index.js';
import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
const dataDir = getDataDir();
const storage = new SQLiteStorageService(dataDir);
const events = new EventOrchestrator();
const coordination = new CoordinationService(storage, events);
const configManager = new ConfigurationManager({ storage });

// Wheelhaus components (initialized on server start)
let viewMaterializer: ViewMaterializer | null = null;
let wheelhausWs: WheelhausWebSocket | null = null;

// Async handler wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============================================================================
// Health Check
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// Projects
// ============================================================================

app.get('/api/projects', asyncHandler(async (req, res) => {
  const projects = await coordination.listProjects();
  res.json({ projects });
}));

app.get('/api/projects/active', asyncHandler(async (req, res) => {
  const project = await coordination.getActiveProject();
  res.json({ project });
}));

app.get('/api/projects/:id', asyncHandler(async (req, res) => {
  const project = await coordination.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json({ project });
}));

app.post('/api/projects', asyncHandler(async (req, res) => {
  const { name, slug, rootPath, domain, techStack } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const project = await coordination.createProject({ name, slug, rootPath, domain, techStack });
  res.status(201).json({ success: true, project });
}));

app.patch('/api/projects/:id', asyncHandler(async (req, res) => {
  const { name, slug, rootPath, domain, techStack } = req.body;

  const project = await coordination.updateProject(req.params.id, {
    name, slug, rootPath, domain, techStack,
  });

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  res.json({ success: true, project });
}));

app.delete('/api/projects/:id', asyncHandler(async (req, res) => {
  const existing = await coordination.getProject(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Project not found' });
  }

  await coordination.deleteProject(req.params.id);
  res.json({ success: true, message: 'Project deleted' });
}));

app.post('/api/projects/:id/activate', asyncHandler(async (req, res) => {
  await coordination.setActiveProject(req.params.id);
  const project = await coordination.getActiveProject();
  res.json({ success: true, project });
}));

// ============================================================================
// Tasks
// ============================================================================

app.get('/api/tasks', asyncHandler(async (req, res) => {
  const { status, priority, projectId } = req.query;
  const activeProject = await coordination.getActiveProject();
  const resolvedProjectId = projectId as string || activeProject?.id;

  const tasks = await coordination.getTasks({
    projectId: resolvedProjectId || undefined,
    status: status as TaskStatus,
    priority: priority as TaskPriority,
  });

  res.json({ tasks, count: tasks.length });
}));

app.get('/api/tasks/next', asyncHandler(async (req, res) => {
  const { priority, projectId } = req.query;
  const activeProject = await coordination.getActiveProject();
  const resolvedProjectId = projectId as string || activeProject?.id;

  const task = await coordination.getNextTask({
    projectId: resolvedProjectId || undefined,
    priority: priority as TaskPriority,
  });

  res.json({ task });
}));

app.get('/api/tasks/:id', asyncHandler(async (req, res) => {
  const task = await coordination.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json({ task });
}));

app.post('/api/tasks', asyncHandler(async (req, res) => {
  const { title, description, priority, files, projectId } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  const task = await coordination.createTask({ title, description, priority, files, projectId });
  res.status(201).json({ success: true, task });
}));

app.patch('/api/tasks/:id', asyncHandler(async (req, res) => {
  const { title, description, priority, status, files, projectId } = req.body;

  try {
    const task = await coordination.updateTask(req.params.id, {
      title, description, priority, status, files, projectId,
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ success: true, task });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}));

app.delete('/api/tasks/:id', asyncHandler(async (req, res) => {
  const task = await coordination.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  await coordination.deleteTask(req.params.id);
  res.json({ success: true, message: 'Task deleted' });
}));

app.post('/api/tasks/:id/claim', asyncHandler(async (req, res) => {
  const { agentId, force, capacity } = req.body;

  try {
    const result = await coordination.claimTask(
      req.params.id,
      agentId || 'api-client',
      { force, capacity }
    );

    if (!result.success) {
      if (result.conflict) {
        return res.status(409).json({ error: 'Task already claimed', ...result });
      }
      if (result.fileConflicts) {
        return res.status(409).json({ error: 'File conflicts detected', ...result });
      }
      if (result.capacityExceeded) {
        return res.status(409).json({ error: 'Agent capacity exceeded', ...result });
      }
    }

    const task = await coordination.getTask(req.params.id);
    res.json({ success: true, sessionId: result.sessionId, task });
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
}));

app.post('/api/tasks/:id/release', asyncHandler(async (req, res) => {
  const { completed } = req.body;
  const result = await coordination.releaseTaskByTaskId(req.params.id, completed);

  if (!result.success) {
    return res.status(404).json({ error: result.error });
  }

  res.json({ success: true, task: result.task });
}));

app.post('/api/tasks/:id/complete', asyncHandler(async (req, res) => {
  const { summary, enforceQuality, role } = req.body;

  const result = await coordination.completeTaskSmart({
    taskId: req.params.id,
    summary: summary || 'Completed via REST API',
    defaultProjectRoot: process.cwd(),
    enforceQuality,
    role,
  });

  if (!result.success) {
    const status = result.uncommittedChanges ? 409 : 400;
    return res.status(status).json(result);
  }

  res.json(result);
}));

// ============================================================================
// Task Phases
// ============================================================================

app.get('/api/tasks/:id/phase', asyncHandler(async (req, res) => {
  const result = await coordination.getTaskPhase(req.params.id);
  if (!result.success) {
    return res.status(404).json({ error: result.message });
  }
  res.json(result);
}));

app.post('/api/tasks/:id/phase/start', asyncHandler(async (req, res) => {
  const result = await coordination.startTaskPhases(req.params.id);
  if (!result.success) {
    return res.status(result.message?.includes('not found') ? 404 : 400).json({ error: result.message });
  }
  res.json(result);
}));

app.post('/api/tasks/:id/phase/advance', asyncHandler(async (req, res) => {
  const { commitSha, note } = req.body;

  if (!commitSha) {
    return res.status(400).json({ error: 'commitSha is required' });
  }

  const result = await coordination.advanceTaskPhase(req.params.id, commitSha, note);
  if (!result.success) {
    return res.status(result.message?.includes('not found') ? 404 : 400).json({
      error: result.message,
      hint: result.hint,
    });
  }
  res.json(result);
}));

app.post('/api/tasks/:id/phase/skip', asyncHandler(async (req, res) => {
  const { force } = req.body;

  const result = await coordination.skipTaskPhase(req.params.id, force);
  if (!result.success) {
    return res.status(result.message?.includes('not found') ? 404 : 400).json({ error: result.message });
  }
  res.json(result);
}));

// ============================================================================
// Task Dependencies
// ============================================================================

app.get('/api/tasks/:id/dependencies', asyncHandler(async (req, res) => {
  const deps = await coordination.getTaskDependencies(req.params.id);
  res.json(deps);
}));

app.post('/api/tasks/:id/dependencies', asyncHandler(async (req, res) => {
  const { blockerTaskId } = req.body;

  if (!blockerTaskId) {
    return res.status(400).json({ error: 'blockerTaskId is required' });
  }

  const result = await coordination.addTaskDependency(blockerTaskId, req.params.id);
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
}));

app.delete('/api/tasks/:id/dependencies/:blockerTaskId', asyncHandler(async (req, res) => {
  const result = await coordination.removeTaskDependency(req.params.blockerTaskId, req.params.id);
  res.json(result);
}));

app.get('/api/blocked-tasks', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const tasks = await coordination.getBlockedTasks(projectId as string);
  res.json({ tasks, count: tasks.length });
}));

// ============================================================================
// Quality Expectations
// ============================================================================

app.get('/api/tasks/:id/quality-expectations', asyncHandler(async (req, res) => {
  const result = await coordination.getQualityExpectations(req.params.id);
  if (!result.success) {
    return res.status(404).json({ error: result.message });
  }
  res.json(result);
}));

app.post('/api/tasks/:id/quality-compliance', asyncHandler(async (req, res) => {
  const { completedItems } = req.body;
  if (!completedItems || !Array.isArray(completedItems)) {
    return res.status(400).json({ error: 'completedItems array is required' });
  }
  const result = await coordination.checkQualityCompliance(req.params.id, completedItems);
  if (!result.success) {
    return res.status(404).json({ error: result.message });
  }
  res.json(result);
}));

// ============================================================================
// Task Suggestions
// ============================================================================

app.get('/api/suggestions', asyncHandler(async (req, res) => {
  const { limit, categories, recentFiles, expertiseAreas, availableMinutes, projectId } = req.query;
  const result = await coordination.getTaskSuggestions({
    limit: limit ? parseInt(limit as string) : undefined,
    categories: categories ? (categories as string).split(',') as any : undefined,
    recentFiles: recentFiles ? (recentFiles as string).split(',') : undefined,
    expertiseAreas: expertiseAreas ? (expertiseAreas as string).split(',') : undefined,
    availableMinutes: availableMinutes ? parseInt(availableMinutes as string) : undefined,
    projectId: projectId as string,
  });
  res.json(result);
}));

app.get('/api/suggestions/by-category', asyncHandler(async (req, res) => {
  const { recentFiles, expertiseAreas, projectId } = req.query;
  const result = await coordination.getSuggestionsByCategory({
    recentFiles: recentFiles ? (recentFiles as string).split(',') : undefined,
    expertiseAreas: expertiseAreas ? (expertiseAreas as string).split(',') : undefined,
    projectId: projectId as string,
  });
  res.json(result);
}));

app.get('/api/task-health', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const result = await coordination.analyzeProjectTaskHealth(projectId as string);
  res.json(result);
}));

// ============================================================================
// Sessions
// ============================================================================

app.get('/api/sessions', asyncHandler(async (req, res) => {
  const { projectId, status, agentId, activeOnly, limit, offset } = req.query;

  // If activeOnly=true, use the old behavior (backwards compatible, filters by active project)
  if (activeOnly === 'true') {
    const activeProject = await coordination.getActiveProject();
    const resolvedProjectId = projectId as string || activeProject?.id;
    const sessions = await coordination.getActiveSessions(resolvedProjectId || undefined);
    res.json({ sessions, count: sessions.length });
    return;
  }

  // Otherwise, get all sessions with filters - show all projects by default
  const sessions = await coordination.getAllSessions({
    projectId: projectId as string || undefined,
    status: status as string,
    agentId: agentId as string,
    limit: limit ? parseInt(limit as string) : 50,
    offset: offset ? parseInt(offset as string) : 0,
  });
  res.json({ sessions, count: sessions.length });
}));

app.get('/api/sessions/:id', asyncHandler(async (req, res) => {
  const session = await coordination.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ session });
}));

app.post('/api/sessions/:id/heartbeat', asyncHandler(async (req, res) => {
  const result = await coordination.sessionHeartbeat(req.params.id);

  if (!result.success) {
    return res.status(result.expired ? 410 : 404).json({
      error: result.expired ? 'Session expired' : 'Session not found',
      expired: result.expired,
    });
  }

  res.json({ success: true, expired: false });
}));

// ============================================================================
// Decisions
// ============================================================================

app.get('/api/decisions', asyncHandler(async (req, res) => {
  const { taskId, category, limit, projectId } = req.query;
  const activeProject = await coordination.getActiveProject();
  const resolvedProjectId = projectId as string || activeProject?.id;

  const result = await coordination.getDecisions({
    projectId: resolvedProjectId || undefined,
    taskId: taskId as string,
    category: category as string | undefined,
    limit: limit ? parseInt(limit as string) : 50,
  });

  res.json(result);
}));

app.post('/api/decisions', asyncHandler(async (req, res) => {
  const { decision, rationale, impact, category, taskId, projectId } = req.body;

  if (!decision) {
    return res.status(400).json({ error: 'decision is required' });
  }

  const result = await coordination.logDecision({
    decision, rationale, impact, category, taskId, projectId,
  });

  res.status(201).json(result);
}));

app.get('/api/decisions/:id', asyncHandler(async (req, res) => {
  const result = await coordination.getDecision(req.params.id);
  if (!result.success) {
    return res.status(404).json({ error: result.error });
  }
  res.json({ decision: result.decision });
}));

// ============================================================================
// Metrics & Stats
// ============================================================================

app.get('/api/stats', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const stats = await coordination.getStats(projectId as string);
  res.json(stats);
}));

app.get('/api/metrics', asyncHandler(async (req, res) => {
  const { period, projectId } = req.query;
  const metrics = await coordination.getMetrics({
    projectId: projectId as string,
    period: period as 'day' | 'week' | 'month',
  });
  res.json({ metrics, period: period || 'week' });
}));

// ============================================================================
// Handoff
// ============================================================================

app.get('/api/handoff/status', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const status = await coordination.getHandoffStatus({ projectId: projectId as string });
  res.json(status);
}));

app.get('/api/handoff/context/:taskId', asyncHandler(async (req, res) => {
  const { fromAgent, toAgent } = req.query;

  const context = await coordination.getHandoffContext({
    taskId: req.params.taskId,
    fromAgent: (fromAgent as string) || 'api-client',
    toAgent: (toAgent as string) || 'next-agent',
  });

  res.json(context);
}));

app.get('/api/handoff/prompt/:taskId', asyncHandler(async (req, res) => {
  const { targetAgent, fromAgent, includeFiles } = req.query;

  const result = await coordination.generateContinuationPrompt({
    taskId: req.params.taskId,
    targetAgent: (targetAgent as string) || 'claude-code',
    fromAgent: fromAgent as string,
    includeFiles: includeFiles !== 'false',
  });

  res.json(result);
}));

// ============================================================================
// Artifacts
// ============================================================================

app.get('/api/tasks/:taskId/artifacts', asyncHandler(async (req, res) => {
  const { type } = req.query;
  const artifacts = await storage.getArtifactsForTask(
    req.params.taskId,
    type as ArtifactType | undefined
  );
  res.json({ artifacts, count: artifacts.length });
}));

app.post('/api/tasks/:taskId/artifacts', asyncHandler(async (req, res) => {
  const { type, uri, title, description, metadata } = req.body;

  if (!type || !uri) {
    return res.status(400).json({ error: 'type and uri are required' });
  }

  const task = await coordination.getTask(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const artifact: Artifact = {
    id: uuidv4(),
    taskId: req.params.taskId,
    projectId: task.projectId,
    type: type as ArtifactType,
    uri,
    title,
    description,
    metadata,
    createdAt: new Date(),
  };

  await storage.createArtifact(artifact);
  res.status(201).json({ success: true, artifact });
}));

app.get('/api/artifacts/:id', asyncHandler(async (req, res) => {
  const artifact = await storage.getArtifact(req.params.id);
  if (!artifact) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  res.json({ artifact });
}));

app.patch('/api/artifacts/:id', asyncHandler(async (req, res) => {
  const { type, uri, title, description, metadata } = req.body;

  const artifact = await storage.updateArtifact(req.params.id, {
    type, uri, title, description, metadata,
  });

  if (!artifact) {
    return res.status(404).json({ error: 'Artifact not found' });
  }

  res.json({ success: true, artifact });
}));

app.delete('/api/artifacts/:id', asyncHandler(async (req, res) => {
  const deleted = await storage.deleteArtifact(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Artifact not found' });
  }
  res.json({ success: true, message: 'Artifact deleted' });
}));

app.get('/api/projects/:projectId/artifacts', asyncHandler(async (req, res) => {
  const { type } = req.query;
  const artifacts = await storage.getArtifactsForProject(
    req.params.projectId,
    type as ArtifactType | undefined
  );
  res.json({ artifacts, count: artifacts.length });
}));

// ============================================================================
// Events (in-memory, real-time)
// ============================================================================

app.get('/api/events', asyncHandler(async (req, res) => {
  const { limit, eventTypes, since, projectId } = req.query;

  const recentEvents = events.getRecentEvents({
    limit: limit ? parseInt(limit as string) : 50,
    eventTypes: eventTypes ? (eventTypes as string).split(',') as EnginehausEventType[] : undefined,
    since: since ? new Date(since as string) : undefined,
    projectId: projectId as string,
  });

  res.json({ events: recentEvents, count: recentEvents.length });
}));

app.get('/api/events/stats', asyncHandler(async (req, res) => {
  const { since } = req.query;
  const stats = events.getEventStats(since ? new Date(since as string) : undefined);
  res.json({ stats, subscriptionCount: events.getSubscriptionCount() });
}));

// ============================================================================
// Wheelhaus - Real-time Control Room Views
// ============================================================================

// Get all materialized views (snapshot)
app.get('/api/wheelhaus', asyncHandler(async (req, res) => {
  const materializer = getViewMaterializer(events);
  res.json({
    sessions: materializer.getActiveSessions(),
    decisions: materializer.getDecisionStream(50),
    tasks: materializer.getTaskGraph(),
    health: materializer.getHealth(),
    lastMaterializedAt: materializer.getSnapshot().lastMaterializedAt,
  });
}));

// Get active sessions view
app.get('/api/wheelhaus/sessions', asyncHandler(async (req, res) => {
  const materializer = getViewMaterializer(events);
  res.json({ sessions: materializer.getActiveSessions() });
}));

// Get decision stream
app.get('/api/wheelhaus/decisions', asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const materializer = getViewMaterializer(events);
  res.json({
    decisions: materializer.getDecisionStream(limit ? parseInt(limit as string) : 50),
  });
}));

// Get task graph
app.get('/api/wheelhaus/tasks', asyncHandler(async (req, res) => {
  const materializer = getViewMaterializer(events);
  res.json({ tasks: materializer.getTaskGraph() });
}));

// Get context health metrics
app.get('/api/wheelhaus/health', asyncHandler(async (req, res) => {
  const materializer = getViewMaterializer(events);
  res.json({ health: materializer.getHealth() });
}));

// Get WebSocket connection stats
app.get('/api/wheelhaus/ws/stats', asyncHandler(async (req, res) => {
  if (wheelhausWs) {
    res.json(wheelhausWs.getStats());
  } else {
    res.json({ clientCount: 0, clients: [], message: 'WebSocket not initialized' });
  }
}));

// ============================================================================
// Wheelhaus Panels — DB-backed, structured JSON
// ============================================================================

// Full dashboard snapshot via panels (DB-backed, fresh per request)
app.get('/api/wheelhaus/panels', asyncHandler(async (_req, res) => {
  const result = await queryDashboardJSON(coordination);
  res.json(result);
}));

// Single panel by id
app.get('/api/wheelhaus/panels/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const panel = getPanel(id);
  if (!panel) {
    return res.status(404).json({ error: `Unknown panel: ${id}` });
  }
  const result = await queryPanelJSON(id, coordination);
  res.json(result);
}));

// AI-generated status summary
// Cache for summary to avoid excessive regeneration
let summaryCache: { summary: string; generatedAt: string; expiresAt: number } | null = null;
const SUMMARY_CACHE_TTL_MS = 30000; // 30 seconds

function generateAISummary(
  sessions: ReturnType<ViewMaterializer['getActiveSessions']>,
  decisions: ReturnType<ViewMaterializer['getDecisionStream']>,
  tasks: ReturnType<ViewMaterializer['getTaskGraph']>,
  health: ReturnType<ViewMaterializer['getHealth']>
): string {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const twoHoursAgo = now - 7200000;

  // Analyze current state
  const activeAgentCount = sessions.length;
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  const readyTasks = tasks.filter(t => t.status === 'ready');

  // Recent decisions (last hour)
  const recentDecisions = decisions.filter(d =>
    new Date(d.timestamp).getTime() > oneHourAgo
  );

  // Check for quiet period
  const lastEventTime = health.lastEventAt ? new Date(health.lastEventAt).getTime() : 0;
  const isQuiet = lastEventTime < twoHoursAgo;

  // Build summary based on state analysis
  const parts: string[] = [];

  // Activity level
  if (isQuiet && activeAgentCount === 0) {
    const lastEventDate = health.lastEventAt ? new Date(health.lastEventAt) : null;
    if (lastEventDate) {
      const hours = Math.floor((now - lastEventDate.getTime()) / 3600000);
      const timeStr = lastEventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `Quiet period: No activity in ${hours}+ hours. Last event at ${timeStr}.`;
    }
    return 'Quiet: No recent activity or active sessions.';
  }

  // Active agents
  if (activeAgentCount > 0) {
    parts.push(`${activeAgentCount} agent${activeAgentCount > 1 ? 's' : ''} active`);
  }

  // Task progress
  if (inProgressTasks.length > 0) {
    parts.push(`${inProgressTasks.length} task${inProgressTasks.length > 1 ? 's' : ''} in progress`);
  }

  // Blockers (most important to surface)
  if (blockedTasks.length > 0) {
    const blockerInfo = blockedTasks[0];
    if (blockedTasks.length === 1) {
      parts.push(`1 blocked (${blockerInfo.title.slice(0, 30)}${blockerInfo.title.length > 30 ? '...' : ''})`);
    } else {
      parts.push(`${blockedTasks.length} blocked`);
    }
  }

  // Decision activity (if notable)
  if (recentDecisions.length >= 3) {
    return `Busy: ${recentDecisions.length} decisions logged in last hour. ${parts.length > 0 ? parts.join(', ') + '.' : ''} Review recommended.`;
  }

  if (parts.length === 0) {
    // Ready tasks available
    if (readyTasks.length > 0) {
      return `${readyTasks.length} task${readyTasks.length > 1 ? 's' : ''} ready to start. No active sessions.`;
    }
    return 'All clear: No active work or blockers.';
  }

  return parts.join(', ') + '.';
}

app.get('/api/wheelhaus/summary', asyncHandler(async (req, res) => {
  const { refresh } = req.query;
  const now = Date.now();

  // Return cached summary if valid and not forcing refresh
  if (summaryCache && summaryCache.expiresAt > now && refresh !== 'true') {
    return res.json({
      summary: summaryCache.summary,
      generatedAt: summaryCache.generatedAt,
      cached: true,
    });
  }

  // Generate fresh summary
  const materializer = getViewMaterializer(events);
  const sessions = materializer.getActiveSessions();
  const decisions = materializer.getDecisionStream(50);
  const tasks = materializer.getTaskGraph();
  const health = materializer.getHealth();

  const summary = generateAISummary(sessions, decisions, tasks, health);
  const generatedAt = new Date().toISOString();

  // Cache the result
  summaryCache = {
    summary,
    generatedAt,
    expiresAt: now + SUMMARY_CACHE_TTL_MS,
  };

  res.json({
    summary,
    generatedAt,
    cached: false,
  });
}));

// Natural Language Chat endpoint
// Processes common queries about project state using pattern matching
app.post('/api/wheelhaus/chat', asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const materializer = getViewMaterializer(events);
  const query = message.toLowerCase().trim();

  // Process the query and generate response
  const response = processNLQuery(query, materializer);

  res.json({
    message: response.message,
    data: response.data,
    timestamp: new Date().toISOString(),
  });
}));

interface NLQueryResponse {
  message: string;
  data?: unknown;
}

function processNLQuery(query: string, materializer: ReturnType<typeof getViewMaterializer>): NLQueryResponse {
  const sessions = materializer.getActiveSessions();
  const decisions = materializer.getDecisionStream(50);
  const tasks = materializer.getTaskGraph();
  const health = materializer.getHealth();

  // Task queries
  if (query.match(/how many tasks|task count|total tasks/i)) {
    const byStatus = tasks.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      message: `There are ${tasks.length} tasks total: ${Object.entries(byStatus).map(([s, c]) => `${c} ${s}`).join(', ')}.`,
      data: { total: tasks.length, byStatus },
    };
  }

  if (query.match(/blocked|blockers|stuck/i)) {
    const blocked = tasks.filter(t => t.status === 'blocked');
    if (blocked.length === 0) {
      return { message: 'No blocked tasks. All work can proceed.' };
    }
    return {
      message: `${blocked.length} blocked task${blocked.length > 1 ? 's' : ''}: ${blocked.map(t => `"${t.title}"`).join(', ')}.`,
      data: { blocked },
    };
  }

  if (query.match(/what.*work on|next task|what should|priority|highest priority/i)) {
    const ready = tasks.filter(t => t.status === 'ready').sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority as keyof typeof priorityOrder] || 2) -
             (priorityOrder[b.priority as keyof typeof priorityOrder] || 2);
    });

    if (ready.length === 0) {
      const inProgress = tasks.filter(t => t.status === 'in-progress');
      if (inProgress.length > 0) {
        return { message: `No ready tasks. ${inProgress.length} task${inProgress.length > 1 ? 's are' : ' is'} already in progress.` };
      }
      return { message: 'No tasks ready to start. Add some tasks to get going.' };
    }

    const top = ready[0];
    return {
      message: `Top priority: "${top.title}" (${top.priority} priority). ${ready.length - 1} other tasks also ready.`,
      data: { next: top, readyCount: ready.length },
    };
  }

  if (query.match(/in progress|active tasks|being worked on|current work/i)) {
    const inProgress = tasks.filter(t => t.status === 'in-progress');
    if (inProgress.length === 0) {
      return { message: 'No tasks currently in progress.' };
    }
    return {
      message: `${inProgress.length} task${inProgress.length > 1 ? 's' : ''} in progress: ${inProgress.map(t => `"${t.title}"`).join(', ')}.`,
      data: { inProgress },
    };
  }

  if (query.match(/completed|done|finished/i)) {
    const completed = tasks.filter(t => t.status === 'completed');
    return {
      message: `${completed.length} completed task${completed.length !== 1 ? 's' : ''}.`,
      data: { count: completed.length },
    };
  }

  // Session queries
  if (query.match(/who.*working|active session|agents|sessions/i)) {
    if (sessions.length === 0) {
      return { message: 'No active sessions. The project is idle.' };
    }
    return {
      message: `${sessions.length} active session${sessions.length > 1 ? 's' : ''}: ${sessions.map(s => s.agentId).join(', ')}.`,
      data: { sessions },
    };
  }

  // Decision queries
  if (query.match(/recent decisions|latest decisions|decisions made/i)) {
    const recent = decisions.slice(0, 5);
    if (recent.length === 0) {
      return { message: 'No decisions logged yet.' };
    }
    return {
      message: `Recent decisions: ${recent.map(d => `"${d.decision}" (${d.category})`).join('; ')}.`,
      data: { decisions: recent },
    };
  }

  if (query.match(/decision.*(architecture|tradeoff|dependency|pattern)/i)) {
    const category = query.match(/(architecture|tradeoff|dependency|pattern)/i)?.[1].toLowerCase();
    const filtered = decisions.filter(d => d.category === category);
    if (filtered.length === 0) {
      return { message: `No ${category} decisions logged.` };
    }
    return {
      message: `${filtered.length} ${category} decision${filtered.length > 1 ? 's' : ''}: ${filtered.slice(0, 3).map(d => `"${d.decision}"`).join(', ')}.`,
      data: { decisions: filtered },
    };
  }

  // Health queries
  if (query.match(/health|status|how.*going|system status/i)) {
    const issues: string[] = [];
    if (health.tasksBlocked > 0) issues.push(`${health.tasksBlocked} blocked tasks`);
    if (health.qualityGatesFailed > 0) issues.push(`${health.qualityGatesFailed} quality gate failures`);

    const statusLevel = issues.length === 0 ? 'Good' :
                       issues.length === 1 ? 'Warning' : 'Needs attention';
    const issuesText = issues.length > 0 ? ` Issues: ${issues.join(', ')}.` : '';

    return {
      message: `Status: ${statusLevel}. Active sessions: ${health.activeSessions}, Tasks in progress: ${health.tasksInProgress}, Ready: ${health.tasksReady}.${issuesText}`,
      data: { health },
    };
  }

  // Help / unknown query
  if (query.match(/help|what can you|how do i|commands/i)) {
    return {
      message: 'I can answer questions about: tasks (blocked, ready, in progress, completed), sessions (who\'s working), decisions (recent, by category), and project health. Try "what should I work on?" or "show me blocked tasks".',
    };
  }

  // Fallback
  return {
    message: `I'm not sure how to answer that. Try asking about tasks, sessions, decisions, or project health. Type "help" for examples.`,
  };
}

// ============================================================================
// Audit Log (persisted in SQLite)
// ============================================================================

app.get('/api/audit', asyncHandler(async (req, res) => {
  const { eventTypes, actorId, projectId, resourceType, resourceId, since, until, limit, offset } = req.query;

  // Only filter by project if explicitly provided - show all audit entries by default
  const entries = await storage.queryAuditLog({
    eventTypes: eventTypes ? (eventTypes as string).split(',') : undefined,
    actorId: actorId as string,
    projectId: projectId as string || undefined,  // Don't default to active project
    resourceType: resourceType as string,
    resourceId: resourceId as string,
    startTime: since ? new Date(since as string) : undefined,
    endTime: until ? new Date(until as string) : undefined,
    limit: limit ? parseInt(limit as string) : 50,
    offset: offset ? parseInt(offset as string) : 0,
  });

  res.json({ entries, count: entries.length });
}));

app.get('/api/audit/summary', asyncHandler(async (req, res) => {
  const { projectId, since, until } = req.query;

  // Only filter by project if explicitly provided - show all by default
  const summary = await storage.getAuditSummary(
    projectId as string || undefined,
    since ? new Date(since as string) : undefined,
    until ? new Date(until as string) : undefined
  );

  res.json(summary);
}));

// ============================================================================
// Configuration
// ============================================================================

// Get default configuration
app.get('/api/config/defaults', asyncHandler(async (req, res) => {
  const { path } = req.query;

  if (path) {
    const parts = (path as string).split('.');
    let value: unknown = DEFAULT_CONFIG;
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return res.status(404).json({ error: `Path not found: ${path}` });
      }
    }
    res.json({ path, value });
  } else {
    res.json({ config: DEFAULT_CONFIG });
  }
}));

// Get project configuration
app.get('/api/projects/:projectId/config', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { path, sessionId } = req.query;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (path) {
    const value = await configManager.getConfigValue(projectId, path as string, {
      sessionId: sessionId as string,
    });
    if (value === undefined) {
      return res.status(404).json({ error: `Path not found: ${path}` });
    }
    res.json({ projectId, path, value });
  } else {
    const config = await configManager.getEffectiveConfig(projectId, {
      sessionId: sessionId as string,
    });
    res.json({ projectId, config });
  }
}));

// Update project configuration
app.patch('/api/projects/:projectId/config', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { path, value, updates, reason, changedBy } = req.body;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (path && value !== undefined) {
    // Update single value
    await configManager.setConfigValue(projectId, path, value, {
      changedBy: changedBy || 'api',
      reason,
    });
    res.json({ success: true, projectId, path, value });
  } else if (updates) {
    // Bulk update
    await configManager.updateProjectConfig(projectId, updates, {
      changedBy: changedBy || 'api',
      reason,
    });
    const newConfig = await configManager.getEffectiveConfig(projectId);
    res.json({ success: true, projectId, config: newConfig });
  } else {
    res.status(400).json({ error: 'Either path+value or updates is required' });
  }
}));

// Reset project configuration to defaults
app.post('/api/projects/:projectId/config/reset', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { reason, changedBy } = req.body;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  await configManager.resetProjectConfig(projectId, {
    changedBy: changedBy || 'api',
    reason: reason || 'Reset via API',
  });

  res.json({ success: true, message: 'Configuration reset to defaults' });
}));

// Sync configuration from file
app.post('/api/projects/:projectId/config/sync', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { filePath, changedBy } = req.body;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const result = await configManager.syncFromFile(projectId, filePath, {
    changedBy: changedBy || 'api',
  });

  if (result.success) {
    res.json({
      success: true,
      fileHash: result.fileHash,
      warnings: result.warnings,
    });
  } else {
    res.status(400).json({
      success: false,
      errors: result.errors,
      warnings: result.warnings,
    });
  }
}));

// Validate project configuration
app.post('/api/projects/:projectId/config/validate', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const config = await configManager.getEffectiveConfig(projectId);
  const issues: { level: 'error' | 'warning' | 'info'; path: string; message: string }[] = [];

  // Validate required fields
  if (!config.project.name || config.project.name === 'Unnamed Project') {
    issues.push({ level: 'warning', path: 'project.name', message: 'Project name should be set' });
  }

  // Validate quality thresholds
  if (config.quality.coverage.minimum > config.quality.coverage.recommended) {
    issues.push({ level: 'error', path: 'quality.coverage', message: 'minimum cannot be greater than recommended' });
  }
  if (config.quality.coverage.recommended > config.quality.coverage.excellent) {
    issues.push({ level: 'error', path: 'quality.coverage', message: 'recommended cannot be greater than excellent' });
  }

  // Validate session settings
  if (config.workflow.sessions.expiryMinutes < 1) {
    issues.push({ level: 'error', path: 'workflow.sessions.expiryMinutes', message: 'must be at least 1 minute' });
  }
  if (config.workflow.sessions.heartbeatIntervalSeconds > config.workflow.sessions.expiryMinutes * 60) {
    issues.push({ level: 'warning', path: 'workflow.sessions', message: 'heartbeat interval is longer than expiry time' });
  }

  // Validate git config
  if (config.git.autoCreateBranches && !config.git.branchNaming.pattern) {
    issues.push({ level: 'warning', path: 'git.branchNaming.pattern', message: 'should be set when autoCreateBranches is enabled' });
  }

  const valid = issues.filter(i => i.level === 'error').length === 0;
  res.json({ valid, issues });
}));

// Get configuration change history
app.get('/api/projects/:projectId/config/history', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { limit, offset } = req.query;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const history = await configManager.getConfigHistory({
    projectId,
    limit: limit ? parseInt(limit as string) : 50,
    offset: offset ? parseInt(offset as string) : 0,
  });

  res.json({ projectId, history });
}));

// Get phases configuration
app.get('/api/projects/:projectId/config/phases', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const phases = await configManager.getPhases(projectId);
  res.json({ projectId, phases });
}));

// Get quality configuration
app.get('/api/projects/:projectId/config/quality', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const quality = await configManager.getQualityConfig(projectId);
  res.json({ projectId, quality });
}));

// Get git configuration
app.get('/api/projects/:projectId/config/git', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const git = await configManager.getGitConfig(projectId);
  res.json({ projectId, git });
}));

// Get session settings
app.get('/api/projects/:projectId/config/sessions', asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await coordination.getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const sessions = await configManager.getSessionSettings(projectId);
  res.json({ projectId, sessions });
}));

// ============================================================================
// Error Handler
// ============================================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ============================================================================
// Server Startup
// ============================================================================

export async function startServer(port: number = 47470): Promise<http.Server> {
  await storage.initialize();

  // Initialize ViewMaterializer with data loader
  viewMaterializer = getViewMaterializer(events);

  // Provide data loader to populate initial state from database
  const dataLoader: InitialDataLoader = {
    getTasks: async () => {
      return coordination.getTasks({});
    },
    getActiveSessions: async () => {
      return coordination.getActiveSessions();
    },
    getDecisions: async (limit: number) => {
      const result = await coordination.getDecisions({ limit });
      return result.decisions;
    },
  };
  viewMaterializer.setDataLoader(dataLoader);

  await viewMaterializer.start();
  console.log('ViewMaterializer started');

  return new Promise((resolve) => {
    const server = http.createServer(app);

    // Initialize Wheelhaus WebSocket
    wheelhausWs = new WheelhausWebSocket(viewMaterializer!);
    wheelhausWs.attachToServer(server, '/ws/wheelhaus');
    console.log('Wheelhaus WebSocket attached at /ws/wheelhaus');

    server.listen(port, () => {
      console.log(`Enginehaus API server running on http://localhost:${port}`);
      console.log('Event orchestration enabled');
      console.log(`Wheelhaus control room available at http://localhost:${port}/wheelhaus`);
      resolve(server);
    });
  });
}

export { app, storage, coordination, events };

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '47470');
  startServer(port).catch(console.error);
}
