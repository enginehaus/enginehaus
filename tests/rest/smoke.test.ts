import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('REST API Smoke Tests', () => {
  let server: http.Server;
  let baseUrl: string;
  let dataDir: string;

  beforeAll(async () => {
    // Isolate from real data
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-rest-test-'));
    process.env.ENGINEHAUS_DATA_DIR = dataDir;

    // Dynamic import after env is set (module-level initialization uses getDataDir())
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

  it('GET /api/health returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('GET /api/projects returns array', async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toBeDefined();
    expect(Array.isArray(body.projects)).toBe(true);
  });

  it('POST /api/projects creates project', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Project', slug: 'test-project' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project?.name || body.name).toBe('Test Project');
  });

  it('GET /api/tasks returns array', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toBeDefined();
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it('POST /api/tasks creates task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'REST Test Task', priority: 'medium' }),
    });
    expect([200, 201]).toContain(res.status);
    const body = await res.json();
    expect(body.task?.title || body.title).toBe('REST Test Task');
  });

  it('GET /api/decisions returns array', async () => {
    const res = await fetch(`${baseUrl}/api/decisions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions).toBeDefined();
    expect(Array.isArray(body.decisions)).toBe(true);
  });

  it('GET /api/stats returns stats', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
