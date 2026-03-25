import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Entity Hierarchy System', () => {
  let storage: SQLiteStorageService;
  let service: CoordinationService;
  let events: EventOrchestrator;
  let testDir: string;
  let projectId: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-hierarchy-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    // Create a test project using the service
    const project = await service.createProject({
      name: 'Hierarchy Test Project',
      slug: 'hierarchy-test',
      rootPath: testDir,
      domain: 'api',
    });
    projectId = project.id;
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Hierarchy Definition', () => {
    it('should create a hierarchy definition with levels', async () => {
      const definition = await storage.createHierarchyDefinition({
        projectId,
        name: 'Mobile App Structure',
        description: 'Standard mobile app hierarchy',
        levels: [
          { id: 'app', name: 'App', pluralName: 'Apps', order: 0 },
          { id: 'module', name: 'Module', pluralName: 'Modules', order: 1 },
          { id: 'screen', name: 'Screen', pluralName: 'Screens', order: 2 },
          { id: 'component', name: 'Component', pluralName: 'Components', order: 3 },
        ],
      });

      expect(definition.id).toBeDefined();
      expect(definition.name).toBe('Mobile App Structure');
      expect(definition.levels.length).toBe(4);
      expect(definition.levels[0].name).toBe('App');
      expect(definition.levels[3].name).toBe('Component');
    });

    it('should retrieve hierarchy definitions for a project', async () => {
      await storage.createHierarchyDefinition({
        projectId,
        name: 'API Structure',
        levels: [
          { id: 'service', name: 'Service', pluralName: 'Services', order: 0 },
          { id: 'domain', name: 'Domain', pluralName: 'Domains', order: 1 },
        ],
      });

      const definitions = await storage.getHierarchyDefinitions(projectId);
      expect(definitions.length).toBe(1);
      expect(definitions[0].name).toBe('API Structure');
    });

    it('should get a specific hierarchy definition by ID', async () => {
      const created = await storage.createHierarchyDefinition({
        projectId,
        name: 'Test Hierarchy',
        levels: [{ id: 'root', name: 'Root', pluralName: 'Roots', order: 0 }],
      });

      const retrieved = await storage.getHierarchyDefinition(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Hierarchy');
    });
  });

  describe('Hierarchy Nodes', () => {
    let hierarchyId: string;

    beforeEach(async () => {
      const definition = await storage.createHierarchyDefinition({
        projectId,
        name: 'Test Structure',
        levels: [
          { id: 'app', name: 'App', pluralName: 'Apps', order: 0 },
          { id: 'module', name: 'Module', pluralName: 'Modules', order: 1 },
          { id: 'screen', name: 'Screen', pluralName: 'Screens', order: 2 },
        ],
      });
      hierarchyId = definition.id;
    });

    it('should create hierarchy nodes', async () => {
      const node = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'main-app',
        name: 'Main Application',
      });

      expect(node.id).toBeDefined();
      expect(node.name).toBe('Main Application');
      expect(node.levelId).toBe('app');
    });

    it('should create nested hierarchy nodes', async () => {
      // Create parent (App)
      const appNode = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'main-app',
        name: 'Main App',
      });

      // Create child (Module)
      const moduleNode = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: appNode.id,
        entityType: 'virtual',
        entityId: 'auth-module',
        name: 'Auth Module',
      });

      expect(moduleNode.parentNodeId).toBe(appNode.id);
    });

    it('should get ancestors of a node', async () => {
      // Create hierarchy: App > Module > Screen
      const app = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'app',
        name: 'App',
      });

      const module = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module',
        name: 'Module',
      });

      const screen = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'screen',
        parentNodeId: module.id,
        entityType: 'task',
        entityId: 'task-123',
        name: 'Login Screen',
      });

      const ancestors = await storage.getAncestors(screen.id);
      expect(ancestors.length).toBe(2);
      expect(ancestors[0].name).toBe('Module');
      expect(ancestors[1].name).toBe('App');
    });

    it('should get descendants of a node', async () => {
      // Create hierarchy: App > 2 Modules > 2 Screens each
      const app = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'app',
        name: 'App',
      });

      const module1 = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module-1',
        name: 'Auth Module',
      });

      const module2 = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module-2',
        name: 'Dashboard Module',
      });

      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'screen',
        parentNodeId: module1.id,
        entityType: 'virtual',
        entityId: 'screen-1',
        name: 'Login Screen',
      });

      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'screen',
        parentNodeId: module2.id,
        entityType: 'virtual',
        entityId: 'screen-2',
        name: 'Home Screen',
      });

      const descendants = await storage.getDescendants(app.id);
      expect(descendants.length).toBe(4); // 2 modules + 2 screens
    });

    it('should get siblings of a node', async () => {
      const app = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'app',
        name: 'App',
      });

      const module1 = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module-1',
        name: 'Auth Module',
      });

      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module-2',
        name: 'Dashboard Module',
      });

      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module-3',
        name: 'Settings Module',
      });

      const siblings = await storage.getSiblings(module1.id);
      expect(siblings.length).toBe(2);
    });

    it('should get all nodes at a specific level', async () => {
      const app = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'app',
        name: 'App',
      });

      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module-1',
        name: 'Module 1',
      });

      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module-2',
        name: 'Module 2',
      });

      const modules = await storage.getNodesAtLevel(hierarchyId, 'module');
      expect(modules.length).toBe(2);
    });

    it('should get hierarchy node for an entity', async () => {
      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'screen',
        entityType: 'task',
        entityId: 'task-abc',
        name: 'Login Screen Task',
      });

      const node = await storage.getHierarchyNodeForEntity('task', 'task-abc');
      expect(node).toBeDefined();
      expect(node?.name).toBe('Login Screen Task');
    });

    it('should delete hierarchy node', async () => {
      const node = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'app',
        name: 'App',
      });

      const deleted = await storage.deleteHierarchyNode(node.id);
      expect(deleted).toBe(true);

      const retrieved = await storage.getHierarchyNode(node.id);
      expect(retrieved).toBeNull();
    });

    it('should delete hierarchy node with descendants', async () => {
      const app = await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'app',
        entityType: 'virtual',
        entityId: 'app',
        name: 'App',
      });

      await storage.createHierarchyNode({
        hierarchyId,
        levelId: 'module',
        parentNodeId: app.id,
        entityType: 'virtual',
        entityId: 'module',
        name: 'Module',
      });

      await storage.deleteHierarchyNode(app.id, true);

      const modules = await storage.getNodesAtLevel(hierarchyId, 'module');
      expect(modules.length).toBe(0);
    });
  });
});
