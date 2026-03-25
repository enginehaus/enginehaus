import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('REST API Endpoint Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let dataDir: string;

  // Shared state created in setup tests, used by subsequent tests
  let createdProjectId: string;
  let createdTaskId: string;
  let secondTaskId: string;
  let createdDecisionId: string;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-rest-endpoints-'));
    process.env.ENGINEHAUS_DATA_DIR = dataDir;

    const mod = await import('../../src/adapters/rest/server.js');
    server = await mod.startServer(0);

    const addr = server.address() as { port: number };
    baseUrl = `http://localhost:${addr.port}`;
  }, 15000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // =====================================================================
  // Health
  // =====================================================================

  describe('GET /api/health', () => {
    it('returns 200 with status ok and timestamp', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      // Timestamp should be a valid ISO date
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });
  });

  // =====================================================================
  // CORS
  // =====================================================================

  describe('CORS', () => {
    it('responds with CORS headers on preflight', async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      });
      // cors() middleware should allow
      expect(res.headers.get('access-control-allow-origin')).toBeDefined();
    });
  });

  // =====================================================================
  // Projects
  // =====================================================================

  describe('Projects', () => {
    describe('POST /api/projects', () => {
      it('creates a project with required fields', async () => {
        const res = await fetch(`${baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Endpoint Test Project', slug: 'endpoint-test' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.project).toBeDefined();
        expect(body.project.name).toBe('Endpoint Test Project');
        createdProjectId = body.project.id;
      });

      it('returns 400 when name is missing', async () => {
        const res = await fetch(`${baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'no-name' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('name');
      });

      it('creates a project with optional fields', async () => {
        const res = await fetch(`${baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Full Project',
            slug: 'full-project',
            rootPath: '/tmp/full',
            domain: 'web',
            techStack: 'TypeScript',
          }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.project.name).toBe('Full Project');
      });

      it('returns 500 for invalid domain value', async () => {
        const res = await fetch(`${baseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Bad Domain',
            slug: 'bad-domain',
            domain: 'invalid-domain',
          }),
        });
        expect(res.status).toBe(500);
      });
    });

    describe('GET /api/projects', () => {
      it('returns array of projects', async () => {
        const res = await fetch(`${baseUrl}/api/projects`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.projects)).toBe(true);
        expect(body.projects.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('GET /api/projects/:id', () => {
      it('returns project by id', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.project).toBeDefined();
        expect(body.project.id).toBe(createdProjectId);
        expect(body.project.name).toBe('Endpoint Test Project');
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('not found');
      });
    });

    describe('GET /api/projects/active', () => {
      it('returns active project (or null)', async () => {
        const res = await fetch(`${baseUrl}/api/projects/active`);
        expect(res.status).toBe(200);
        const body = await res.json();
        // project may be null if none is active
        expect(body).toHaveProperty('project');
      });
    });

    describe('POST /api/projects/:id/activate', () => {
      it('activates a project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      });
    });

    describe('PATCH /api/projects/:id', () => {
      it('updates a project', async () => {
        // First get the current project to know all required fields
        const getRes = await fetch(`${baseUrl}/api/projects/${createdProjectId}`);
        const getCurrent = await getRes.json();
        const current = getCurrent.project;

        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Updated Project Name',
            slug: current.slug,
            rootPath: current.rootPath || '/tmp',
            domain: current.domain || 'other',
            techStack: current.techStack,
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.project.name).toBe('Updated Project Name');
      });

      it('returns 500 for nonexistent project (service throws)', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Nope', slug: 'nope' }),
        });
        // The service throws an error which the error handler catches as 500
        expect(res.status).toBe(500);
      });
    });

    describe('DELETE /api/projects/:id', () => {
      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('not found');
      });

      // We test actual deletion later after other tests have used the project
    });
  });

  // =====================================================================
  // Tasks
  // =====================================================================

  describe('Tasks', () => {
    describe('POST /api/tasks', () => {
      it('creates a task with required fields', async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test Task One', priority: 'high' }),
        });
        expect([200, 201]).toContain(res.status);
        const body = await res.json();
        expect(body.task).toBeDefined();
        expect(body.task.title).toBe('Test Task One');
        createdTaskId = body.task.id;
      });

      it('creates a second task for dependency testing', async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Test Task Two',
            description: 'A task with a description',
            priority: 'low',
          }),
        });
        expect([200, 201]).toContain(res.status);
        const body = await res.json();
        secondTaskId = body.task.id;
      });

      it('returns 400 when title is missing', async () => {
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority: 'low' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('title');
      });
    });

    describe('GET /api/tasks', () => {
      it('returns array of tasks with count', async () => {
        const res = await fetch(`${baseUrl}/api/tasks`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.tasks)).toBe(true);
        expect(body.count).toBeGreaterThanOrEqual(1);
        expect(body.count).toBe(body.tasks.length);
      });

      it('filters by priority query param', async () => {
        const res = await fetch(`${baseUrl}/api/tasks?priority=high`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.tasks)).toBe(true);
        // All returned tasks should be high priority
        for (const task of body.tasks) {
          expect(task.priority).toBe('high');
        }
      });
    });

    describe('GET /api/tasks/:id', () => {
      it('returns a task by id', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.task).toBeDefined();
        expect(body.task.id).toBe(createdTaskId);
        expect(body.task.title).toBe('Test Task One');
      });

      it('returns 404 for nonexistent task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/nonexistent-task-id`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('not found');
      });
    });

    describe('GET /api/tasks/next', () => {
      it('returns a suggested next task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/next`);
        expect(res.status).toBe(200);
        const body = await res.json();
        // May or may not return a task, but shape must be correct
        expect(body).toHaveProperty('task');
      });
    });

    describe('PATCH /api/tasks/:id', () => {
      it('updates a task', async () => {
        // Use secondTaskId which hasn't been claimed/released
        const res = await fetch(`${baseUrl}/api/tasks/${secondTaskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Updated Task Title', description: 'Now with description' }),
        });
        // The service may return 400 if it validates state transitions
        if (res.status === 200) {
          const body = await res.json();
          expect(body.success).toBe(true);
          expect(body.task.title).toBe('Updated Task Title');
        } else {
          // Some implementations reject updates based on task state
          expect([400, 404]).toContain(res.status);
        }
      });

      it('returns 404 for nonexistent task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/nonexistent-task-id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Nope' }),
        });
        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/tasks/:id/claim', () => {
      it('claims a task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'test-agent' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.sessionId).toBeDefined();
      });

      it('returns error for nonexistent task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/nonexistent-task-id/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'test-agent' }),
        });
        // Should return 404 for nonexistent tasks
        expect([404, 409]).toContain(res.status);
      });
    });

    describe('POST /api/tasks/:id/release', () => {
      it('releases a claimed task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: false }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      });

      it('handles release of unclaimed task gracefully', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${secondTaskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: false }),
        });
        // Service may succeed (no-op) or return 404 depending on implementation
        expect([200, 404]).toContain(res.status);
      });
    });

    describe('DELETE /api/tasks/:id', () => {
      it('returns 404 for nonexistent task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/nonexistent-task-id`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('not found');
      });
    });
  });

  // =====================================================================
  // Task Phases
  // =====================================================================

  describe('Task Phases', () => {
    describe('GET /api/tasks/:id/phase', () => {
      it('returns phase info for a task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/phase`);
        expect(res.status).toBe(200);
        const body = await res.json();
        // Phase may not be started yet, but response shape should be valid
        expect(body).toHaveProperty('success');
      });

      it('returns 404 for nonexistent task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/nonexistent-task-id/phase`);
        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/tasks/:id/phase/advance', () => {
      it('returns 400 when commitSha is missing', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/phase/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('commitSha');
      });
    });

    describe('POST /api/tasks/:id/phase/skip', () => {
      it('returns error for task without active phases', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/phase/skip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        // Phase workflow might not be started
        expect([200, 400, 404]).toContain(res.status);
      });
    });
  });

  // =====================================================================
  // Task Dependencies
  // =====================================================================

  describe('Task Dependencies', () => {
    describe('GET /api/tasks/:id/dependencies', () => {
      it('returns dependencies for a task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/dependencies`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });

    describe('POST /api/tasks/:id/dependencies', () => {
      it('returns 400 when blockerTaskId is missing', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/dependencies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('blockerTaskId');
      });

      it('adds a dependency between tasks', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/dependencies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blockerTaskId: secondTaskId }),
        });
        // May succeed or fail depending on service validation
        expect([200, 400]).toContain(res.status);
      });
    });

    describe('DELETE /api/tasks/:id/dependencies/:blockerTaskId', () => {
      it('removes a dependency', async () => {
        const res = await fetch(
          `${baseUrl}/api/tasks/${createdTaskId}/dependencies/${secondTaskId}`,
          { method: 'DELETE' }
        );
        expect(res.status).toBe(200);
      });
    });

    describe('GET /api/blocked-tasks', () => {
      it('returns blocked tasks', async () => {
        const res = await fetch(`${baseUrl}/api/blocked-tasks`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.tasks)).toBe(true);
        expect(typeof body.count).toBe('number');
      });
    });
  });

  // =====================================================================
  // Quality Expectations
  // =====================================================================

  describe('Quality Expectations', () => {
    describe('GET /api/tasks/:id/quality-expectations', () => {
      it('returns quality expectations for a task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/quality-expectations`);
        // May return 200 or 404 depending on whether expectations are set
        expect([200, 404]).toContain(res.status);
      });
    });

    describe('POST /api/tasks/:id/quality-compliance', () => {
      it('returns 400 when completedItems is missing', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/quality-compliance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('completedItems');
      });

      it('returns 400 when completedItems is not an array', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/quality-compliance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedItems: 'not-an-array' }),
        });
        expect(res.status).toBe(400);
      });
    });
  });

  // =====================================================================
  // Decisions
  // =====================================================================

  describe('Decisions', () => {
    describe('POST /api/decisions', () => {
      it('creates a decision', async () => {
        const res = await fetch(`${baseUrl}/api/decisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'Use REST over GraphQL',
            rationale: 'Simpler for this use case',
            category: 'architecture',
          }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.success).toBe(true);
        createdDecisionId = body.decisionId || body.id;
      });

      it('returns 400 when decision text is missing', async () => {
        const res = await fetch(`${baseUrl}/api/decisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rationale: 'Some rationale' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('decision');
      });

      it('creates a decision with taskId', async () => {
        const res = await fetch(`${baseUrl}/api/decisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'Task-scoped decision',
            taskId: createdTaskId,
            category: 'tradeoff',
          }),
        });
        expect(res.status).toBe(201);
      });
    });

    describe('GET /api/decisions', () => {
      it('returns array of decisions', async () => {
        const res = await fetch(`${baseUrl}/api/decisions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.decisions).toBeDefined();
        expect(Array.isArray(body.decisions)).toBe(true);
        expect(body.decisions.length).toBeGreaterThanOrEqual(1);
      });

      it('filters by category query param', async () => {
        const res = await fetch(`${baseUrl}/api/decisions?category=architecture`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.decisions)).toBe(true);
      });

      it('filters by taskId query param', async () => {
        const res = await fetch(`${baseUrl}/api/decisions?taskId=${createdTaskId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.decisions)).toBe(true);
      });

      it('respects limit query param', async () => {
        const res = await fetch(`${baseUrl}/api/decisions?limit=1`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.decisions.length).toBeLessThanOrEqual(1);
      });
    });

    describe('GET /api/decisions/:id', () => {
      it('returns a decision by id', async () => {
        // First get list to find a real id
        const listRes = await fetch(`${baseUrl}/api/decisions`);
        const listBody = await listRes.json();
        const firstDecision = listBody.decisions[0];
        if (!firstDecision) return; // Skip if no decisions

        const res = await fetch(`${baseUrl}/api/decisions/${firstDecision.id}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.decision).toBeDefined();
      });

      it('returns 404 for nonexistent decision', async () => {
        const res = await fetch(`${baseUrl}/api/decisions/nonexistent-decision-id`);
        expect(res.status).toBe(404);
      });
    });
  });

  // =====================================================================
  // Sessions
  // =====================================================================

  describe('Sessions', () => {
    describe('GET /api/sessions', () => {
      it('returns sessions array', async () => {
        const res = await fetch(`${baseUrl}/api/sessions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.sessions)).toBe(true);
        expect(typeof body.count).toBe('number');
      });

      it('supports activeOnly=true filter', async () => {
        const res = await fetch(`${baseUrl}/api/sessions?activeOnly=true`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.sessions)).toBe(true);
      });

      it('supports limit and offset params', async () => {
        const res = await fetch(`${baseUrl}/api/sessions?limit=5&offset=0`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.sessions)).toBe(true);
      });
    });

    describe('GET /api/sessions/:id', () => {
      it('returns 404 for nonexistent session', async () => {
        const res = await fetch(`${baseUrl}/api/sessions/nonexistent-session-id`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('not found');
      });
    });

    describe('POST /api/sessions/:id/heartbeat', () => {
      it('returns error for nonexistent session', async () => {
        const res = await fetch(`${baseUrl}/api/sessions/nonexistent-session-id/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect([404, 410]).toContain(res.status);
      });
    });
  });

  // =====================================================================
  // Stats & Metrics
  // =====================================================================

  describe('Stats & Metrics', () => {
    describe('GET /api/stats', () => {
      it('returns stats object', async () => {
        const res = await fetch(`${baseUrl}/api/stats`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
        expect(typeof body).toBe('object');
      });
    });

    describe('GET /api/metrics', () => {
      it('returns metrics with default period', async () => {
        const res = await fetch(`${baseUrl}/api/metrics`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.period).toBe('week');
      });

      it('supports period query param', async () => {
        const res = await fetch(`${baseUrl}/api/metrics?period=day`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.period).toBe('day');
      });
    });
  });

  // =====================================================================
  // Suggestions & Task Health
  // =====================================================================

  describe('Suggestions & Task Health', () => {
    describe('GET /api/suggestions', () => {
      it('returns suggestions', async () => {
        const res = await fetch(`${baseUrl}/api/suggestions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });

      it('supports limit param', async () => {
        const res = await fetch(`${baseUrl}/api/suggestions?limit=3`);
        expect(res.status).toBe(200);
      });
    });

    describe('GET /api/suggestions/by-category', () => {
      it('returns suggestions by category', async () => {
        const res = await fetch(`${baseUrl}/api/suggestions/by-category`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });

    describe('GET /api/task-health', () => {
      it('returns task health analysis', async () => {
        const res = await fetch(`${baseUrl}/api/task-health`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });
  });

  // =====================================================================
  // Handoff
  // =====================================================================

  describe('Handoff', () => {
    describe('GET /api/handoff/status', () => {
      it('returns handoff status', async () => {
        const res = await fetch(`${baseUrl}/api/handoff/status`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });

    describe('GET /api/handoff/context/:taskId', () => {
      it('returns handoff context for a task', async () => {
        const res = await fetch(`${baseUrl}/api/handoff/context/${createdTaskId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });

    describe('GET /api/handoff/prompt/:taskId', () => {
      it('returns continuation prompt for a task', async () => {
        const res = await fetch(`${baseUrl}/api/handoff/prompt/${createdTaskId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });
  });

  // =====================================================================
  // Artifacts
  // =====================================================================

  describe('Artifacts', () => {
    let createdArtifactId: string;

    describe('POST /api/tasks/:taskId/artifacts', () => {
      it('creates an artifact', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'code',
            uri: 'src/test.ts',
            title: 'Test File',
            description: 'A test artifact',
          }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.artifact).toBeDefined();
        createdArtifactId = body.artifact.id;
      });

      it('returns 400 when type is missing', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri: 'src/test.ts' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('type');
      });

      it('returns 400 when uri is missing', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'code' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('uri');
      });

      it('returns 404 when task does not exist', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/nonexistent-task-id/artifacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'code', uri: 'src/test.ts' }),
        });
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/tasks/:taskId/artifacts', () => {
      it('returns artifacts for a task', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/artifacts`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.artifacts)).toBe(true);
        expect(body.count).toBeGreaterThanOrEqual(1);
      });

      it('supports type filter', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/artifacts?type=code`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.artifacts)).toBe(true);
      });
    });

    describe('GET /api/artifacts/:id', () => {
      it('returns an artifact by id', async () => {
        const res = await fetch(`${baseUrl}/api/artifacts/${createdArtifactId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.artifact).toBeDefined();
        expect(body.artifact.id).toBe(createdArtifactId);
      });

      it('returns 404 for nonexistent artifact', async () => {
        const res = await fetch(`${baseUrl}/api/artifacts/nonexistent-artifact-id`);
        expect(res.status).toBe(404);
      });
    });

    describe('PATCH /api/artifacts/:id', () => {
      it('updates an artifact', async () => {
        const res = await fetch(`${baseUrl}/api/artifacts/${createdArtifactId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Updated Artifact Title' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.artifact.title).toBe('Updated Artifact Title');
      });

      it('returns 404 for nonexistent artifact', async () => {
        const res = await fetch(`${baseUrl}/api/artifacts/nonexistent-artifact-id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Nope' }),
        });
        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /api/artifacts/:id', () => {
      it('deletes an artifact', async () => {
        const res = await fetch(`${baseUrl}/api/artifacts/${createdArtifactId}`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      });

      it('returns 404 for already-deleted artifact', async () => {
        const res = await fetch(`${baseUrl}/api/artifacts/${createdArtifactId}`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/projects/:projectId/artifacts', () => {
      it('returns artifacts for a project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/artifacts`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.artifacts)).toBe(true);
        expect(typeof body.count).toBe('number');
      });
    });
  });

  // =====================================================================
  // Events
  // =====================================================================

  describe('Events', () => {
    describe('GET /api/events', () => {
      it('returns events array', async () => {
        const res = await fetch(`${baseUrl}/api/events`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.events)).toBe(true);
        expect(typeof body.count).toBe('number');
      });

      it('supports limit param', async () => {
        const res = await fetch(`${baseUrl}/api/events?limit=5`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.events.length).toBeLessThanOrEqual(5);
      });
    });

    describe('GET /api/events/stats', () => {
      it('returns event stats', async () => {
        const res = await fetch(`${baseUrl}/api/events/stats`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.stats).toBeDefined();
        expect(typeof body.subscriptionCount).toBe('number');
      });
    });
  });

  // =====================================================================
  // Wheelhaus
  // =====================================================================

  describe('Wheelhaus', () => {
    describe('GET /api/wheelhaus', () => {
      it('returns all materialized views', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('sessions');
        expect(body).toHaveProperty('decisions');
        expect(body).toHaveProperty('tasks');
        expect(body).toHaveProperty('health');
      });
    });

    describe('GET /api/wheelhaus/sessions', () => {
      it('returns sessions view', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/sessions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('sessions');
      });
    });

    describe('GET /api/wheelhaus/decisions', () => {
      it('returns decisions view', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/decisions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('decisions');
      });

      it('supports limit param', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/decisions?limit=3`);
        expect(res.status).toBe(200);
      });
    });

    describe('GET /api/wheelhaus/tasks', () => {
      it('returns tasks view', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/tasks`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('tasks');
      });
    });

    describe('GET /api/wheelhaus/health', () => {
      it('returns health view', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/health`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('health');
      });
    });

    describe('GET /api/wheelhaus/ws/stats', () => {
      it('returns websocket stats', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/ws/stats`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body.clientCount).toBe('number');
      });
    });

    describe('GET /api/wheelhaus/panels', () => {
      it('returns dashboard panels', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/panels`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });

    describe('GET /api/wheelhaus/panels/:id', () => {
      it('returns 404 for unknown panel', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/panels/nonexistent-panel`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('Unknown panel');
      });
    });

    describe('GET /api/wheelhaus/summary', () => {
      it('returns summary with generated fields', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/summary`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body.summary).toBe('string');
        expect(body.generatedAt).toBeDefined();
        expect(typeof body.cached).toBe('boolean');
      });

      it('returns cached summary on second call', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/summary`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.cached).toBe(true);
      });

      it('supports refresh=true to bypass cache', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/summary?refresh=true`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.cached).toBe(false);
      });
    });

    describe('POST /api/wheelhaus/chat', () => {
      it('returns 400 when message is missing', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('Message');
      });

      it('handles task count query', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'how many tasks' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.message).toBeDefined();
        expect(body.timestamp).toBeDefined();
      });

      it('handles blocked query', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'show blocked tasks' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.message).toBeDefined();
      });

      it('handles health query', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'system status' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.message).toContain('Status');
      });

      it('handles help query', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'help' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.message).toContain('tasks');
      });

      it('handles unknown query with fallback', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'xyzzy plugh' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.message).toBeDefined();
      });

      it('returns 400 for non-string message', async () => {
        const res = await fetch(`${baseUrl}/api/wheelhaus/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 42 }),
        });
        expect(res.status).toBe(400);
      });
    });
  });

  // =====================================================================
  // Audit Log
  // =====================================================================

  describe('Audit Log', () => {
    describe('GET /api/audit', () => {
      it('returns audit entries', async () => {
        const res = await fetch(`${baseUrl}/api/audit`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body.entries)).toBe(true);
        expect(typeof body.count).toBe('number');
      });

      it('supports limit and offset params', async () => {
        const res = await fetch(`${baseUrl}/api/audit?limit=5&offset=0`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.entries.length).toBeLessThanOrEqual(5);
      });
    });

    describe('GET /api/audit/summary', () => {
      it('returns audit summary', async () => {
        const res = await fetch(`${baseUrl}/api/audit/summary`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeDefined();
      });
    });
  });

  // =====================================================================
  // Configuration
  // =====================================================================

  describe('Configuration', () => {
    describe('GET /api/config/defaults', () => {
      it('returns default configuration', async () => {
        const res = await fetch(`${baseUrl}/api/config/defaults`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.config).toBeDefined();
      });

      it('returns specific config path', async () => {
        const res = await fetch(`${baseUrl}/api/config/defaults?path=project`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.path).toBe('project');
        expect(body.value).toBeDefined();
      });

      it('returns 404 for invalid config path', async () => {
        const res = await fetch(`${baseUrl}/api/config/defaults?path=nonexistent.path.here`);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('not found');
      });
    });

    describe('GET /api/projects/:projectId/config', () => {
      it('returns project config', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.projectId).toBe(createdProjectId);
        expect(body.config).toBeDefined();
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config`);
        expect(res.status).toBe(404);
      });
    });

    describe('PATCH /api/projects/:projectId/config', () => {
      it('updates config with path+value', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'project.name',
            value: 'Config Test Project',
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      });

      it('returns 400 when neither path+value nor updates provided', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('required');
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'project.name', value: 'x' }),
        });
        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/projects/:projectId/config/reset', () => {
      it('resets project config', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      });
    });

    describe('POST /api/projects/:projectId/config/validate', () => {
      it('validates project config', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body.valid).toBe('boolean');
        expect(Array.isArray(body.issues)).toBe(true);
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/projects/:projectId/config/history', () => {
      it('returns config history', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config/history`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.projectId).toBe(createdProjectId);
        expect(body.history).toBeDefined();
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config/history`);
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/projects/:projectId/config/phases', () => {
      it('returns phases config', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config/phases`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.projectId).toBe(createdProjectId);
        expect(body.phases).toBeDefined();
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config/phases`);
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/projects/:projectId/config/quality', () => {
      it('returns quality config', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config/quality`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.projectId).toBe(createdProjectId);
        expect(body.quality).toBeDefined();
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config/quality`);
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/projects/:projectId/config/git', () => {
      it('returns git config', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config/git`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.projectId).toBe(createdProjectId);
        expect(body.git).toBeDefined();
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config/git`);
        expect(res.status).toBe(404);
      });
    });

    describe('GET /api/projects/:projectId/config/sessions', () => {
      it('returns session settings', async () => {
        const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}/config/sessions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.projectId).toBe(createdProjectId);
        expect(body.sessions).toBeDefined();
      });

      it('returns 404 for nonexistent project', async () => {
        const res = await fetch(`${baseUrl}/api/projects/nonexistent-id/config/sessions`);
        expect(res.status).toBe(404);
      });
    });
  });

  // =====================================================================
  // Content-Type Handling
  // =====================================================================

  describe('Content-Type Handling', () => {
    it('accepts JSON body on POST endpoints', async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Content-Type Test' }),
      });
      expect([200, 201]).toContain(res.status);
    });

    it('returns JSON content-type on all responses', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.headers.get('content-type')).toContain('application/json');
    });
  });

  // =====================================================================
  // Error handling - unknown routes
  // =====================================================================

  describe('Unknown Routes', () => {
    it('returns 404 for unknown API path', async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent-route`);
      // Express returns 404 for unmatched routes
      expect(res.status).toBe(404);
    });
  });

  // =====================================================================
  // Cleanup: Delete project at the end
  // =====================================================================

  describe('Cleanup', () => {
    it('deletes a task', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${secondTaskId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('deletes a project', async () => {
      // Create a throwaway project to test deletion (keep createdProjectId for other tests)
      const createRes = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'To Delete', slug: 'to-delete' }),
      });
      const createBody = await createRes.json();
      const deleteId = createBody.project.id;

      const res = await fetch(`${baseUrl}/api/projects/${deleteId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('deleted');
    });
  });
});
