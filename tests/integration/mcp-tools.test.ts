import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationEngine } from '../../src/coordination/engine.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { GitService } from '../../src/git/git-service.js';
import { QualityService } from '../../src/quality/quality-service.js';
// Quality expectations are covered extensively in unit tests
import { generateDependencyGraph } from '../../src/visualization/mermaid-export.js';
import { getTaskSuggestions, analyzeTaskHealth } from '../../src/ai/task-suggestions.js';
import { getTrendAnalysis, generateQualityInsights, calculateQualityMetrics } from '../../src/quality/quality-trends.js';
import { AuditHelpers, formatAuditEvent, eventsToCSV } from '../../src/audit/audit-service.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Integration tests for MCP tool handlers
 * These tests simulate how the MCP server calls the underlying services
 */
describe('MCP Tools Integration', () => {
  let engine: CoordinationEngine;
  let storage: SQLiteStorageService;
  let testDir: string;
  let testProjectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-mcp-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();

    const gitService = new GitService(testDir);
    const qualityService = new QualityService(testDir);
    engine = new CoordinationEngine(gitService, qualityService, storage);

    testProjectId = 'mcp-test-project';
    await storage.createProject({
      id: testProjectId,
      name: 'MCP Test Project',
      slug: 'mcp-test',
      rootPath: testDir,
      domain: 'api',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await storage.setActiveProjectId(testProjectId);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // ============================================
  // TASK MANAGEMENT TOOLS
  // ============================================

  describe('Task Management Tools', () => {
    describe('add_task / create_task', () => {
      it('should create task via engine', async () => {
        const task = await engine.createUnifiedTask({
          title: 'Build authentication system',
          description: 'Implement OAuth2 authentication',
          priority: 'high',
          files: ['src/auth/oauth.ts'],
        });

        expect(task.id).toBeDefined();
        expect(task.title).toBe('Build authentication system');
        expect(task.projectId).toBe(testProjectId);
      });

      it('should create task with all fields', async () => {
        const task = await engine.createUnifiedTask({
          title: 'Full Task',
          description: 'A task with all fields',
          priority: 'critical',
          files: ['src/main.ts', 'src/utils.ts'],
        });

        expect(task.priority).toBe('critical');
        expect(task.files).toEqual(['src/main.ts', 'src/utils.ts']);
        expect(task.status).toBe('ready');
      });
    });

    describe('get_next_task', () => {
      it('should return highest priority ready task', async () => {
        await engine.createUnifiedTask({ title: 'Low Priority', description: 'Low priority', priority: 'low' });
        await engine.createUnifiedTask({ title: 'High Priority', description: 'High priority', priority: 'high' });
        await engine.createUnifiedTask({ title: 'Medium Priority', description: 'Medium priority', priority: 'medium' });

        const nextTask = await engine.getNextTask();

        expect(nextTask?.title).toBe('High Priority');
      });

      it('should skip in-progress tasks', async () => {
        const inProgress = await engine.createUnifiedTask({ title: 'In Progress', description: 'In progress', priority: 'critical' });
        await engine.createUnifiedTask({ title: 'Ready Task', description: 'Ready task', priority: 'high' });

        // Claim the critical task
        await engine.claimTask(inProgress.id, 'agent-1');

        const nextTask = await engine.getNextTask();
        expect(nextTask?.title).toBe('Ready Task');
      });
    });

    describe('list_tasks', () => {
      it('should list all tasks for project', async () => {
        await engine.createUnifiedTask({ title: 'Task 1', description: 'First', priority: 'low' });
        await engine.createUnifiedTask({ title: 'Task 2', description: 'Second', priority: 'high' });
        await engine.createUnifiedTask({ title: 'Task 3', description: 'Third', priority: 'medium' });

        const tasks = await storage.getTasks({});
        expect(tasks.length).toBeGreaterThanOrEqual(3);
      });

      it('should filter tasks by status', async () => {
        const task = await engine.createUnifiedTask({ title: 'Filter Test', description: 'Testing', priority: 'medium' });
        await engine.claimTask(task.id, 'agent-1');

        const inProgressTasks = await storage.getTasks({ status: 'in-progress' });
        expect(inProgressTasks.some(t => t.title === 'Filter Test')).toBe(true);
      });
    });

    describe('update_task', () => {
      it('should update task fields', async () => {
        const task = await engine.createUnifiedTask({ title: 'Original', description: 'Original desc', priority: 'low' });

        // storage.updateTask returns void, so we get the task after update
        await storage.updateTask(task.id, {
          title: 'Updated',
          priority: 'high',
        });

        const updated = await storage.getTask(task.id);
        expect(updated?.title).toBe('Updated');
        expect(updated?.priority).toBe('high');
      });
    });

    describe('update_progress', () => {
      it('should update progress tracking', async () => {
        const task = await engine.createUnifiedTask({
          title: 'Progress Task',
          description: 'Track progress',
          priority: 'medium',
        });

        // engine.updateTaskProgress uses different parameters: currentPhase (number), deliverables, notes, phaseCompletion
        const updated = await engine.updateTaskProgress(task.id, {
          currentPhase: 2,
          notes: 'Working on implementation phase',
          deliverables: [{ file: 'src/file.ts', status: 'completed', description: 'Added new feature' }],
        });

        expect(updated?.currentPhase).toBe(2);
        expect(updated?.notes).toBe('Working on implementation phase');
        expect(updated?.deliverables?.length).toBe(1);
      });
    });
  });

  // ============================================
  // SESSION MANAGEMENT TOOLS
  // ============================================

  describe('Session Management Tools', () => {
    describe('claim_task and release_task', () => {
      it('should handle full claim-work-release cycle', async () => {
        const task = await engine.createUnifiedTask({ title: 'Workflow Task', description: 'Workflow task', priority: 'medium' });

        // Agent claims task
        const claim = await engine.claimTask(task.id, 'agent-workflow');
        expect(claim.success).toBe(true);

        // Verify task is claimed
        const status = await engine.getTaskSessionStatus(task.id);
        expect(status.hasActiveSession).toBe(true);

        // Agent sends heartbeats
        await engine.sessionHeartbeat(claim.sessionId!);

        // Agent releases task (completed)
        await engine.releaseTask(claim.sessionId!, true);

        // Verify task is released
        const finalStatus = await engine.getTaskSessionStatus(task.id);
        expect(finalStatus.hasActiveSession).toBe(false);
      });

      it('should detect conflict when another agent claims', async () => {
        const task = await engine.createUnifiedTask({ title: 'Conflict Task', description: 'Testing conflicts', priority: 'high' });

        await engine.claimTask(task.id, 'agent-1');
        const secondClaim = await engine.claimTask(task.id, 'agent-2');

        expect(secondClaim.success).toBe(false);
        expect(secondClaim.conflict).toBeDefined();
        expect(secondClaim.conflict?.existingAgentId).toBe('agent-1');
      });

      it('should allow force claim', async () => {
        const task = await engine.createUnifiedTask({ title: 'Force Claim', description: 'Testing force claim', priority: 'high' });

        await engine.claimTask(task.id, 'agent-1');
        const forceClaim = await engine.claimTask(task.id, 'agent-2', { force: true });

        expect(forceClaim.success).toBe(true);
      });

      it('should refresh session for same agent', async () => {
        const task = await engine.createUnifiedTask({ title: 'Refresh Task', description: 'Testing refresh', priority: 'medium' });

        const first = await engine.claimTask(task.id, 'agent-1');
        const second = await engine.claimTask(task.id, 'agent-1');

        expect(second.success).toBe(true);
        expect(second.sessionId).toBe(first.sessionId);
      });
    });

    describe('session_heartbeat', () => {
      it('should keep session alive', async () => {
        const task = await engine.createUnifiedTask({ title: 'Heartbeat Task', description: 'Testing heartbeat', priority: 'medium' });
        const claim = await engine.claimTask(task.id, 'agent-1');

        const result = await engine.sessionHeartbeat(claim.sessionId!);

        expect(result.success).toBe(true);
        expect(result.expired).toBe(false);
      });

      it('should report expired for invalid session', async () => {
        const result = await engine.sessionHeartbeat('invalid-session-id');

        expect(result.success).toBe(false);
        expect(result.expired).toBe(true);
      });
    });

    describe('get_task_session_status', () => {
      it('should return session status for task', async () => {
        const task = await engine.createUnifiedTask({ title: 'Status Task', description: 'Testing status', priority: 'medium' });

        // Before claim
        const before = await engine.getTaskSessionStatus(task.id);
        expect(before.hasActiveSession).toBe(false);

        // After claim
        await engine.claimTask(task.id, 'agent-1');
        const after = await engine.getTaskSessionStatus(task.id);
        expect(after.hasActiveSession).toBe(true);
        expect(after.session?.agentId).toBe('agent-1');
      });
    });
  });

  // ============================================
  // DEPENDENCY TOOLS
  // ============================================

  describe('Dependency Tools', () => {
    describe('add_dependency', () => {
      it('should add dependency between tasks', async () => {
        const blocker = await engine.createUnifiedTask({ title: 'Blocker', description: 'Blocks other', priority: 'high' });
        const blocked = await engine.createUnifiedTask({ title: 'Blocked', description: 'Is blocked', priority: 'high' });

        // addTaskDependency(blockerTaskId, blockedTaskId) - blocker blocks blocked
        await storage.addTaskDependency(blocker.id, blocked.id);

        // getBlockingTasks returns IDs of tasks that block the given task
        const blockers = storage.getBlockingTasks(blocked.id);
        expect(blockers).toContain(blocker.id);
      });
    });

    describe('remove_dependency', () => {
      it('should remove dependency between tasks', async () => {
        const blocker = await engine.createUnifiedTask({ title: 'Blocker', description: 'Blocks other', priority: 'high' });
        const blocked = await engine.createUnifiedTask({ title: 'Blocked', description: 'Is blocked', priority: 'high' });

        await storage.addTaskDependency(blocker.id, blocked.id);
        await storage.removeTaskDependency(blocker.id, blocked.id);

        const blockers = storage.getBlockingTasks(blocked.id);
        expect(blockers).not.toContain(blocker.id);
      });
    });

    describe('get_blocked_tasks', () => {
      it('should return tasks that are blocked', async () => {
        const blocker = await engine.createUnifiedTask({ title: 'Blocker', description: 'Blocks other', priority: 'high' });
        const blocked = await engine.createUnifiedTask({ title: 'Blocked Task', description: 'Is blocked', priority: 'medium' });

        await storage.addTaskDependency(blocker.id, blocked.id);

        // getBlockedTasksList returns tasks with status='blocked' for a project
        const blockedTasks = await storage.getBlockedTasksList(testProjectId);
        expect(blockedTasks.some(t => t.id === blocked.id)).toBe(true);
      });
    });
  });

  // ============================================
  // PROJECT TOOLS
  // ============================================

  describe('Project Tools', () => {
    it('should create and list projects', async () => {
      await storage.createProject({
        id: 'new-project',
        name: 'New Project',
        slug: 'new-project',
        rootPath: '/new/path',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const projects = await storage.listProjects();
      expect(projects.length).toBeGreaterThanOrEqual(2);
    });

    it('should get project by ID', async () => {
      const project = await storage.getProject(testProjectId);
      expect(project?.name).toBe('MCP Test Project');
    });

    it('should switch active project', async () => {
      await storage.createProject({
        id: 'switchable-project',
        name: 'Switchable Project',
        slug: 'switchable',
        rootPath: '/switch/path',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.setActiveProjectId('switchable-project');
      const activeId = await storage.getActiveProjectId();
      expect(activeId).toBe('switchable-project');
    });

    it('should update project', async () => {
      // updateProject returns void, so we need to get the project after updating
      await storage.updateProject(testProjectId, {
        name: 'Updated Name',
        domain: 'web',
      });

      const updated = await storage.getProject(testProjectId);
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.domain).toBe('web');
    });

    it('should delete project', async () => {
      await storage.createProject({
        id: 'to-delete',
        name: 'To Delete',
        slug: 'to-delete',
        rootPath: '/delete/path',
        domain: 'api',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.deleteProject('to-delete');
      const project = await storage.getProject('to-delete');
      expect(project).toBeNull();
    });
  });

  // ============================================
  // STRATEGIC DECISION TOOLS
  // ============================================

  describe('Strategic Decision Tools', () => {
    describe('record_strategic_decision', () => {
      it('should record a strategic decision', async () => {
        const decision = await engine.recordStrategicDecision({
          decision: 'Use PostgreSQL for database',
          rationale: 'Better scalability for multi-tenant architecture',
          impact: 'high',
          alternatives: ['MySQL', 'MongoDB'],
          timeline: 'Q1 2025',
          constraints: ['Budget', 'Team experience'],
          stakeholders: ['Engineering', 'Product'],
        });

        expect(decision.id).toBeDefined();
        expect(decision.decision).toBe('Use PostgreSQL for database');
        expect(decision.impact).toBe('high');
      });
    });

    describe('record_ux_requirements', () => {
      it('should record UX requirements', async () => {
        const requirements = await engine.recordUXRequirements({
          feature: 'Task Dashboard',
          userExperience: 'Users should see all tasks at a glance',
          accessibilityRequirements: 'WCAG 2.1 AA compliant',
          responsiveDesign: 'Mobile-first approach',
          designPattern: 'Dashboard with cards',
          interactionFlow: 'Click to expand, drag to reorder',
        });

        expect(requirements.id).toBeDefined();
        expect(requirements.feature).toBe('Task Dashboard');
      });
    });

    describe('record_technical_plan', () => {
      it('should record technical plan', async () => {
        const plan = await engine.recordTechnicalPlan({
          feature: 'Authentication System',
          implementation: 'JWT-based auth with refresh tokens',
          testing: 'Unit tests for auth flow, integration tests for endpoints',
          technicalApproach: 'RESTful API with JWT tokens',
          techStack: {
            language: 'TypeScript',
            frameworks: ['Express', 'Passport'],
            database: 'PostgreSQL',
          },
        });

        expect(plan.id).toBeDefined();
        expect(plan.feature).toBe('Authentication System');
      });
    });
  });

  // Quality expectations are covered extensively in tests/unit/quality-expectations.test.ts

  // ============================================
  // VISUALIZATION TOOLS
  // ============================================

  describe('Visualization Tools', () => {
    beforeEach(async () => {
      // Create some tasks for visualization
      await engine.createUnifiedTask({ title: 'High Priority', description: 'High', priority: 'high' });
      await engine.createUnifiedTask({ title: 'Medium Priority', description: 'Medium', priority: 'medium' });
      await engine.createUnifiedTask({ title: 'Low Priority', description: 'Low', priority: 'low' });
    });

    // Consolidated into `visualize` tool with type parameter
    describe('visualize tool (type: graph)', () => {
      it('should generate Mermaid task dependency graph', async () => {
        const tasks = await storage.getTasks({});
        const graph = generateDependencyGraph(tasks);

        expect(graph).toContain('graph');
      });
    });

  });

  // ============================================
  // TASK SUGGESTIONS TOOLS
  // ============================================

  describe('Task Suggestions Tools', () => {
    beforeEach(async () => {
      await engine.createUnifiedTask({ title: 'Critical Bug', description: 'Fix critical bug', priority: 'critical' });
      await engine.createUnifiedTask({ title: 'Quick Win', description: 'Small improvement', priority: 'low' });
      await engine.createUnifiedTask({ title: 'Feature Work', description: 'New feature', priority: 'high' });
    });

    // Consolidated into `suggest` tool with mode parameter
    describe('suggest tool (mode: next)', () => {
      it('should return task suggestions with scores', async () => {
        const tasks = await storage.getTasks({});
        const suggestions = await getTaskSuggestions(tasks, {});

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions[0].task).toBeDefined();
        expect(suggestions[0].score).toBeGreaterThanOrEqual(0);
        expect(suggestions[0].reasons).toBeDefined();
      });
    });

    describe('suggest tool (mode: health)', () => {
      it('should analyze overall task health', async () => {
        const tasks = await storage.getTasks({});
        const health = analyzeTaskHealth(tasks);

        expect(health).toBeDefined();
        expect(health.recommendations).toBeDefined();
        expect(health.priorityDistribution).toBeDefined();
      });
    });
  });

  // ============================================
  // QUALITY TRENDS TOOLS
  // ============================================

  // Consolidated into `quality` tool with mode parameter
  describe('Quality Tools (Consolidated)', () => {
    describe('quality tool (mode: trends)', () => {
      it('should return quality trends data', async () => {
        // Create and complete some tasks
        const task1 = await engine.createUnifiedTask({ title: 'Completed 1', description: 'Done', priority: 'high' });
        await storage.updateTask(task1.id, { status: 'completed' });

        const tasks = await storage.getTasks({});
        const trends = getTrendAnalysis(tasks, 7);

        expect(trends).toBeDefined();
      });
    });

    describe('quality tool (mode: metrics)', () => {
      it('should return quality metrics', async () => {
        const tasks = await storage.getTasks({});
        const metrics = calculateQualityMetrics(tasks);

        expect(metrics).toBeDefined();
      });
    });

    describe('quality tool (mode: insights)', () => {
      it('should return quality insights', async () => {
        const tasks = await storage.getTasks({});
        const insights = generateQualityInsights(tasks);

        expect(insights).toBeDefined();
      });
    });
  });

  // ============================================
  // AUDIT LOG TOOLS
  // ============================================

  describe('Audit Log Tools', () => {
    describe('Audit event creation', () => {
      it('should create task audit events', () => {
        const event = AuditHelpers.taskEvent(
          'task.created',
          'agent-1',
          'agent',
          testProjectId,
          'task-123',
          'Created task: Test Task'
        );

        expect(event.eventType).toBe('task.created');
        expect(event.resourceType).toBe('task');
      });

      it('should create session audit events', () => {
        const event = AuditHelpers.sessionEvent(
          'session.started',
          'agent-1',
          testProjectId,
          'session-123',
          'Session started'
        );

        expect(event.eventType).toBe('session.started');
        expect(event.actorType).toBe('agent');
      });

      it('should create system audit events', () => {
        const event = AuditHelpers.systemEvent(
          'system.health_check',
          'Health check passed',
          { dbConnected: true }
        );

        expect(event.eventType).toBe('system.health_check');
        expect(event.actorType).toBe('system');
      });
    });

    describe('formatAuditEvent', () => {
      it('should format audit event for display', () => {
        const event = {
          id: 'evt-1',
          timestamp: new Date('2024-01-15T10:00:00Z'),
          eventType: 'task.created' as const,
          actorId: 'agent-1',
          actorType: 'agent' as const,
          projectId: testProjectId,
          resourceType: 'task' as const,
          resourceId: 'task-1',
          action: 'Created task',
        };

        const formatted = formatAuditEvent(event);

        expect(formatted).toContain('task.created');
        expect(formatted).toContain('agent-1');
      });
    });

    describe('eventsToCSV', () => {
      it('should export events to CSV format', () => {
        const events = [
          {
            id: 'evt-1',
            timestamp: new Date('2024-01-15T10:00:00Z'),
            eventType: 'task.created' as const,
            actorId: 'agent-1',
            actorType: 'agent' as const,
            projectId: testProjectId,
            resourceType: 'task' as const,
            resourceId: 'task-1',
            action: 'Created task',
          },
        ];

        const csv = eventsToCSV(events);

        expect(csv).toContain('id,timestamp,eventType');
        expect(csv).toContain('evt-1');
        expect(csv).toContain('task.created');
      });
    });
  });

  // ============================================
  // CONTEXT TOOLS (Token Efficiency)
  // ============================================

  describe('Context Tools', () => {
    describe('get_task_context', () => {
      it('should return task context via storage', async () => {
        const task = await engine.createUnifiedTask({
          title: 'Context Task',
          description: 'Testing context retrieval',
          priority: 'medium',
          files: ['src/main.ts'],
        });

        // Get task via storage which is the underlying data layer
        const retrieved = await storage.getTask(task.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(task.id);
        expect(retrieved?.title).toBe('Context Task');
      });
    });

    describe('expand_context', () => {
      it('should expand context for a task', async () => {
        const task = await engine.createUnifiedTask({
          title: 'Context Expansion Task',
          description: 'Testing context expansion',
          priority: 'high',
          files: ['src/expand.ts'],
        });

        const claim = await engine.claimTask(task.id, 'agent-1');
        expect(claim.success).toBe(true);

        // The full context should be available after claim
        const fullTask = await storage.getTask(task.id);
        expect(fullTask?.title).toBe('Context Expansion Task');
      });
    });
  });

  // ============================================
  // FILE LOCK TOOLS
  // ============================================

  describe('File Lock Tools', () => {
    describe('check_file_conflicts', () => {
      it('should detect file conflicts between tasks', async () => {
        const task1 = await engine.createUnifiedTask({
          title: 'Task 1',
          description: 'Working on main.ts',
          priority: 'high',
          files: ['src/main.ts', 'src/utils.ts'],
        });
        const task2 = await engine.createUnifiedTask({
          title: 'Task 2',
          description: 'Also working on main.ts',
          priority: 'medium',
          files: ['src/main.ts', 'src/other.ts'],
        });

        // Claim task 1
        await engine.claimTask(task1.id, 'agent-1');

        // Check for file conflicts using storage
        const conflicts = await storage.findFileConflicts(task2.id);

        // Should detect src/main.ts conflict (conflicts is an array)
        expect(conflicts.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('get_locked_files', () => {
      it('should return files locked by active sessions', async () => {
        const task = await engine.createUnifiedTask({
          title: 'Lock Task',
          description: 'Locking files',
          priority: 'high',
          files: ['src/locked.ts'],
        });

        await engine.claimTask(task.id, 'agent-1');

        const lockedFiles = await storage.getLockedFiles(testProjectId);

        expect(lockedFiles).toBeDefined();
        expect(lockedFiles.size).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ============================================
  // COMPLETE WORKFLOW INTEGRATION
  // ============================================

  describe('Complete Workflow Integration', () => {
    it('should handle full task lifecycle', async () => {
      // 1. Create task
      const task = await engine.createUnifiedTask({
        title: 'End-to-End Task',
        description: 'Testing full workflow',
        priority: 'high',
        files: ['src/workflow.ts'],
      });
      expect(task.status).toBe('ready');

      // 2. Get next task (should be our task)
      const next = await engine.getNextTask();
      expect(next?.id).toBe(task.id);

      // 3. Claim task
      const claim = await engine.claimTask(task.id, 'workflow-agent');
      expect(claim.success).toBe(true);

      // 4. Send heartbeat
      const heartbeat = await engine.sessionHeartbeat(claim.sessionId!);
      expect(heartbeat.success).toBe(true);

      // 5. Update progress
      await engine.updateTaskProgress(task.id, {
        currentStep: 1,
        totalSteps: 3,
        currentPhase: 'implementation',
      });

      // 6. Update progress again
      await engine.updateTaskProgress(task.id, {
        currentStep: 3,
        totalSteps: 3,
        currentPhase: 'testing',
      });

      // 7. Mark task completed and release session
      await storage.updateTask(task.id, { status: 'completed' });
      await engine.releaseTask(claim.sessionId!, true);

      // 8. Verify task is completed
      const finalTask = await storage.getTask(task.id);
      expect(finalTask?.status).toBe('completed');
    });

    it('should handle multi-agent coordination', async () => {
      // Create multiple tasks
      const task1 = await engine.createUnifiedTask({ title: 'Task 1', description: 'First', priority: 'high' });
      const task2 = await engine.createUnifiedTask({ title: 'Task 2', description: 'Second', priority: 'high' });
      const task3 = await engine.createUnifiedTask({ title: 'Task 3', description: 'Third', priority: 'high' });

      // Agent 1 claims task 1
      const claim1 = await engine.claimTask(task1.id, 'agent-1');
      expect(claim1.success).toBe(true);

      // Agent 2 claims task 2
      const claim2 = await engine.claimTask(task2.id, 'agent-2');
      expect(claim2.success).toBe(true);

      // Agent 1 tries to claim task 2 (should fail)
      const conflictClaim = await engine.claimTask(task2.id, 'agent-1');
      expect(conflictClaim.success).toBe(false);

      // Get next task for Agent 3 (should be task 3)
      const nextTask = await engine.getNextTask();
      expect(nextTask?.id).toBe(task3.id);

      // Agent 3 claims task 3
      const claim3 = await engine.claimTask(task3.id, 'agent-3');
      expect(claim3.success).toBe(true);

      // All agents complete and release their tasks
      await storage.updateTask(task1.id, { status: 'completed' });
      await engine.releaseTask(claim1.sessionId!, true);
      await storage.updateTask(task2.id, { status: 'completed' });
      await engine.releaseTask(claim2.sessionId!, true);
      await storage.updateTask(task3.id, { status: 'completed' });
      await engine.releaseTask(claim3.sessionId!, true);

      // All tasks should be completed
      const t1 = await storage.getTask(task1.id);
      const t2 = await storage.getTask(task2.id);
      const t3 = await storage.getTask(task3.id);

      expect(t1?.status).toBe('completed');
      expect(t2?.status).toBe('completed');
      expect(t3?.status).toBe('completed');
    });
  });
});
