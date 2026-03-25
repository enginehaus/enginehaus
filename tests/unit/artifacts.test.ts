import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { Artifact } from '../../src/coordination/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Artifact Management', () => {
  let storage: SQLiteStorageService;
  let testDir: string;
  let testProjectId: string;
  let testTaskId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-artifact-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();

    // Create test project
    testProjectId = 'artifact-test-project';
    await storage.createProject({
      id: testProjectId,
      name: 'Artifact Test Project',
      slug: 'artifact-test',
      rootPath: testDir,
      domain: 'api',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create test task
    testTaskId = 'artifact-test-task';
    await storage.saveTask({
      id: testTaskId,
      projectId: testProjectId,
      title: 'Artifact Test Task',
      description: 'Test task for artifacts',
      priority: 'medium',
      status: 'ready',
      files: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Create Artifact', () => {
    it('should create an artifact with all fields', async () => {
      const artifact: Artifact = {
        id: 'artifact-1',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'design',
        uri: 'https://figma.com/design/123',
        title: 'Main Design',
        description: 'Primary design for the feature',
        metadata: { version: '1.0' },
        createdAt: new Date(),
        createdBy: 'user-1',
      };

      const created = await storage.createArtifact(artifact);

      expect(created.id).toBe('artifact-1');
      expect(created.type).toBe('design');
      expect(created.uri).toBe('https://figma.com/design/123');
    });

    it('should create artifact with minimal fields', async () => {
      const artifact: Artifact = {
        id: 'artifact-minimal',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'url',
        uri: 'https://example.com',
        createdAt: new Date(),
      };

      const created = await storage.createArtifact(artifact);

      expect(created.id).toBe('artifact-minimal');
      expect(created.title).toBeUndefined();
      expect(created.description).toBeUndefined();
    });

    it('should support all artifact types', async () => {
      const types = ['design', 'doc', 'code', 'test', 'screenshot', 'url', 'reference', 'other'] as const;

      for (const type of types) {
        const artifact: Artifact = {
          id: `artifact-${type}`,
          taskId: testTaskId,
          projectId: testProjectId,
          type,
          uri: `https://example.com/${type}`,
          createdAt: new Date(),
        };

        const created = await storage.createArtifact(artifact);
        expect(created.type).toBe(type);
      }
    });
  });

  describe('Get Artifact', () => {
    it('should retrieve artifact by ID', async () => {
      const artifact: Artifact = {
        id: 'get-artifact-test',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: 'https://docs.example.com',
        title: 'API Documentation',
        createdAt: new Date(),
      };

      await storage.createArtifact(artifact);

      const retrieved = await storage.getArtifact('get-artifact-test');

      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('API Documentation');
      expect(retrieved?.type).toBe('doc');
    });

    it('should return null for non-existent artifact', async () => {
      const retrieved = await storage.getArtifact('non-existent-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('Get Artifacts for Task', () => {
    beforeEach(async () => {
      // Add multiple artifacts
      await storage.createArtifact({
        id: 'task-artifact-1',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'design',
        uri: 'https://figma.com/1',
        createdAt: new Date(),
      });
      await storage.createArtifact({
        id: 'task-artifact-2',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: 'https://docs.com/1',
        createdAt: new Date(),
      });
      await storage.createArtifact({
        id: 'task-artifact-3',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'design',
        uri: 'https://figma.com/2',
        createdAt: new Date(),
      });
    });

    it('should retrieve all artifacts for a task', async () => {
      const artifacts = await storage.getArtifactsForTask(testTaskId);

      expect(artifacts.length).toBe(3);
    });

    it('should filter artifacts by type', async () => {
      const designArtifacts = await storage.getArtifactsForTask(testTaskId, 'design');

      expect(designArtifacts.length).toBe(2);
      expect(designArtifacts.every(a => a.type === 'design')).toBe(true);
    });

    it('should return empty array for task with no artifacts', async () => {
      const artifacts = await storage.getArtifactsForTask('non-existent-task');

      expect(artifacts).toEqual([]);
    });
  });

  describe('Get Artifacts for Project', () => {
    beforeEach(async () => {
      // Create another task
      const secondTaskId = 'second-task';
      await storage.saveTask({
        id: secondTaskId,
        projectId: testProjectId,
        title: 'Second Task',
        description: 'Another task',
        priority: 'low',
        status: 'ready',
        files: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Add artifacts to both tasks
      await storage.createArtifact({
        id: 'project-artifact-1',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'code',
        uri: 'file://src/main.ts',
        createdAt: new Date(),
      });
      await storage.createArtifact({
        id: 'project-artifact-2',
        taskId: secondTaskId,
        projectId: testProjectId,
        type: 'test',
        uri: 'file://src/main.test.ts',
        createdAt: new Date(),
      });
    });

    it('should retrieve all artifacts for a project', async () => {
      const artifacts = await storage.getArtifactsForProject(testProjectId);

      expect(artifacts.length).toBe(2);
    });

    it('should filter project artifacts by type', async () => {
      const codeArtifacts = await storage.getArtifactsForProject(testProjectId, 'code');

      expect(codeArtifacts.length).toBe(1);
      expect(codeArtifacts[0].type).toBe('code');
    });
  });

  describe('Update Artifact', () => {
    let artifactId: string;

    beforeEach(async () => {
      artifactId = 'update-test-artifact';
      await storage.createArtifact({
        id: artifactId,
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: 'https://original.com',
        title: 'Original Title',
        createdAt: new Date(),
      });
    });

    it('should update artifact title', async () => {
      const updated = await storage.updateArtifact(artifactId, {
        title: 'Updated Title',
      });

      expect(updated?.title).toBe('Updated Title');
    });

    it('should update artifact description', async () => {
      const updated = await storage.updateArtifact(artifactId, {
        description: 'New description',
      });

      expect(updated?.description).toBe('New description');
    });

    it('should update artifact URI', async () => {
      const updated = await storage.updateArtifact(artifactId, {
        uri: 'https://updated.com',
      });

      expect(updated?.uri).toBe('https://updated.com');
    });

    it('should update artifact metadata', async () => {
      const updated = await storage.updateArtifact(artifactId, {
        metadata: { key: 'value' },
      });

      expect(updated?.metadata).toEqual({ key: 'value' });
    });

    it('should return null for non-existent artifact', async () => {
      const updated = await storage.updateArtifact('non-existent', {
        title: 'New Title',
      });

      expect(updated).toBeNull();
    });
  });

  describe('Delete Artifact', () => {
    it('should delete an artifact', async () => {
      const artifactId = 'delete-test';
      await storage.createArtifact({
        id: artifactId,
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'url',
        uri: 'https://delete.me',
        createdAt: new Date(),
      });

      const deleted = await storage.deleteArtifact(artifactId);

      expect(deleted).toBe(true);

      const retrieved = await storage.getArtifact(artifactId);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent artifact', async () => {
      const deleted = await storage.deleteArtifact('non-existent');

      expect(deleted).toBe(false);
    });
  });

  describe('Delete Artifacts for Task', () => {
    it('should delete all artifacts for a task', async () => {
      // Create multiple artifacts
      await storage.createArtifact({
        id: 'bulk-delete-1',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: 'https://1.com',
        createdAt: new Date(),
      });
      await storage.createArtifact({
        id: 'bulk-delete-2',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: 'https://2.com',
        createdAt: new Date(),
      });

      const deletedCount = await storage.deleteArtifactsForTask(testTaskId);

      expect(deletedCount).toBe(2);

      const remaining = await storage.getArtifactsForTask(testTaskId);
      expect(remaining.length).toBe(0);
    });
  });

  describe('Artifact Content Storage', () => {
    it('should store inline content with contentType and contentSize', async () => {
      const content = '# Design Document\n\nThis is a test design doc.';
      const artifact: Artifact = {
        id: 'content-artifact-1',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '', // Empty URI for inline content
        title: 'Design Doc',
        content: content,
        contentType: 'text/markdown',
        contentSize: Buffer.byteLength(content, 'utf8'),
        createdAt: new Date(),
      };

      const created = await storage.createArtifact(artifact);

      expect(created.content).toBe(content);
      expect(created.contentType).toBe('text/markdown');
      expect(created.contentSize).toBe(Buffer.byteLength(content, 'utf8'));
    });

    it('should retrieve stored content', async () => {
      const content = '{"key": "value", "nested": {"a": 1}}';
      await storage.createArtifact({
        id: 'json-content-artifact',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'reference',
        uri: '',
        content: content,
        contentType: 'application/json',
        contentSize: Buffer.byteLength(content, 'utf8'),
        createdAt: new Date(),
      });

      const retrieved = await storage.getArtifact('json-content-artifact');

      expect(retrieved?.content).toBe(content);
      expect(retrieved?.contentType).toBe('application/json');
    });

    it('should update content via updateArtifact', async () => {
      const originalContent = 'Original content';
      await storage.createArtifact({
        id: 'update-content-artifact',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '',
        content: originalContent,
        contentType: 'text/plain',
        contentSize: Buffer.byteLength(originalContent, 'utf8'),
        createdAt: new Date(),
      });

      const newContent = 'Updated content with more text';
      const updated = await storage.updateArtifact('update-content-artifact', {
        content: newContent,
        contentSize: Buffer.byteLength(newContent, 'utf8'),
      });

      expect(updated?.content).toBe(newContent);
      expect(updated?.contentSize).toBe(Buffer.byteLength(newContent, 'utf8'));
    });

    it('should support all content types', async () => {
      const contentTypes = [
        'text/plain',
        'text/markdown',
        'application/json',
        'image/png',
        'image/jpeg',
        'image/svg+xml',
        'application/octet-stream',
      ] as const;

      for (const contentType of contentTypes) {
        const artifact: Artifact = {
          id: `content-type-${contentType.replace('/', '-')}`,
          taskId: testTaskId,
          projectId: testProjectId,
          type: 'reference',
          uri: '',
          content: 'test content',
          contentType: contentType,
          contentSize: 12,
          createdAt: new Date(),
        };

        const created = await storage.createArtifact(artifact);
        expect(created.contentType).toBe(contentType);
      }
    });
  });

  describe('Artifact Lineage', () => {
    it('should store parentArtifactId for derived artifacts', async () => {
      // Create parent artifact
      await storage.createArtifact({
        id: 'parent-artifact',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '',
        content: 'Original design',
        contentType: 'text/plain',
        createdAt: new Date(),
      });

      // Create child artifact
      const child: Artifact = {
        id: 'child-artifact',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '',
        content: 'Refined design based on feedback',
        contentType: 'text/plain',
        parentArtifactId: 'parent-artifact',
        createdAt: new Date(),
      };

      await storage.createArtifact(child);
      const retrieved = await storage.getArtifact('child-artifact');

      expect(retrieved?.parentArtifactId).toBe('parent-artifact');
    });

    it('should store and retrieve evolutionHistory', async () => {
      const evolutionHistory = [
        {
          artifactId: 'original-id',
          timestamp: new Date(),
          action: 'created' as const,
          fromChatUri: 'https://claude.ai/chat/abc',
          summary: 'Initial creation',
        },
        {
          artifactId: 'refined-id',
          timestamp: new Date(),
          action: 'refined' as const,
          fromChatUri: 'https://claude.ai/chat/def',
          summary: 'Added more detail',
        },
      ];

      const artifact: Artifact = {
        id: 'evolution-test',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '',
        content: 'Content with history',
        contentType: 'text/plain',
        evolutionHistory: evolutionHistory,
        createdAt: new Date(),
      };

      await storage.createArtifact(artifact);
      const retrieved = await storage.getArtifact('evolution-test');

      expect(retrieved?.evolutionHistory).toHaveLength(2);
      expect(retrieved?.evolutionHistory?.[0].action).toBe('created');
      expect(retrieved?.evolutionHistory?.[1].action).toBe('refined');
    });

    it('should get artifact children', async () => {
      // Create parent
      await storage.createArtifact({
        id: 'parent-for-children',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '',
        content: 'Parent content',
        contentType: 'text/plain',
        createdAt: new Date(),
      });

      // Create two children
      await storage.createArtifact({
        id: 'child-1',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '',
        content: 'Child 1',
        contentType: 'text/plain',
        parentArtifactId: 'parent-for-children',
        createdAt: new Date(),
      });

      await storage.createArtifact({
        id: 'child-2',
        taskId: testTaskId,
        projectId: testProjectId,
        type: 'doc',
        uri: '',
        content: 'Child 2',
        contentType: 'text/plain',
        parentArtifactId: 'parent-for-children',
        createdAt: new Date(),
      });

      const children = await storage.getArtifactChildren('parent-for-children');

      expect(children).toHaveLength(2);
      expect(children.map(c => c.id).sort()).toEqual(['child-1', 'child-2']);
    });
  });
});
