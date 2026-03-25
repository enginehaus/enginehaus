import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Artifact operations', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;
  let taskId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-art-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Artifact Test' });
    await service.setActiveProject(project.id);
    const task = await service.createTask({ title: 'Artifact task' });
    taskId = task.id;
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('storeArtifact saves content', async () => {
    const result = await service.storeArtifact({
      taskId,
      type: 'doc',
      content: '# Design Doc\nThis is the design.',
      contentType: 'text/markdown',
      title: 'Architecture Design',
    });

    expect(result.success).toBe(true);
    expect(result.artifactId).toBeDefined();
    expect(result.type).toBe('doc');
  });

  it('getArtifact retrieves stored content', async () => {
    const stored = await service.storeArtifact({
      taskId,
      type: 'code',
      content: 'export const x = 1;',
      contentType: 'text/typescript',
      title: 'Code snippet',
    });

    const result = await service.getArtifact(stored.artifactId!);

    expect(result.success).toBe(true);
    expect(result.artifact).toBeDefined();
    expect(result.artifact!.content).toBe('export const x = 1;');
    expect(result.artifact!.title).toBe('Code snippet');
  });

  it('listArtifacts returns task artifacts', async () => {
    await service.storeArtifact({
      taskId,
      type: 'doc',
      content: 'Doc 1',
      contentType: 'text/plain',
    });
    await service.storeArtifact({
      taskId,
      type: 'code',
      content: 'Code 1',
      contentType: 'text/typescript',
    });

    const result = await service.listArtifacts({ taskId });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.artifacts.length).toBe(2);
  });

  it('removeArtifact deletes artifact', async () => {
    const stored = await service.storeArtifact({
      taskId,
      type: 'doc',
      content: 'To be removed',
      contentType: 'text/plain',
    });

    const removeResult = await service.removeArtifact(stored.artifactId!);
    expect(removeResult.success).toBe(true);

    const getResult = await service.getArtifact(stored.artifactId!);
    expect(getResult.success).toBe(false);
  });

  it('getArtifactLineage traces parent chain', async () => {
    const parent = await service.storeArtifact({
      taskId,
      type: 'doc',
      content: 'Version 1',
      contentType: 'text/plain',
      title: 'Original',
    });

    const child = await service.storeArtifact({
      taskId,
      type: 'doc',
      content: 'Version 2 - revised',
      contentType: 'text/plain',
      title: 'Revision',
      parentArtifactId: parent.artifactId!,
    });

    const lineage = await service.getArtifactLineage(child.artifactId!);

    expect(lineage.success).toBe(true);
    expect(lineage.artifact).toBeDefined();
    expect(lineage.artifact!.parentArtifactId).toBe(parent.artifactId);
  });

  it('searchArtifacts finds by content', async () => {
    await service.storeArtifact({
      taskId,
      type: 'doc',
      content: 'Authentication flow uses JWT tokens for session management',
      contentType: 'text/plain',
      title: 'Auth design',
    });

    const result = await service.searchArtifacts({ query: 'JWT tokens' });

    expect(result.success).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0].snippet).toContain('JWT');
  });

  it('captureInsight creates artifact', async () => {
    const result = await service.captureInsight({
      taskId,
      content: 'Rate limiting should use sliding window algorithm',
      type: 'rationale',
      title: 'Rate limiting approach',
    });

    expect(result.success).toBe(true);
    expect(result.artifactId).toBeDefined();
  });

  it('captureInsight with type=decision also creates decision', async () => {
    const result = await service.captureInsight({
      taskId,
      content: 'Use Redis for caching layer',
      type: 'decision',
      title: 'Cache technology choice',
    });

    expect(result.success).toBe(true);
    expect(result.decisionId).toBeDefined();
    expect(result.artifactId).toBeDefined();
  });
});
