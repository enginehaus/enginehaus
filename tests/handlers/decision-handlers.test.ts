import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleLogDecision,
  handleGetDecisions,
  handleGetDecision,
} from '../../src/adapters/mcp/handlers/decision-handlers.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('decision handlers', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-dh-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Decision Handler Test' });
    await service.setActiveProject(project.id);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('handleLogDecision stores decision with category', async () => {
    const result = await handleLogDecision(service, {
      decision: 'Use TypeScript strict mode',
      rationale: 'Catch errors at compile time',
      category: 'architecture',
    });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
    expect(body.decisionId).toBeDefined();
  });

  it('handleLogDecision stores decision with scope', async () => {
    const result = await handleLogDecision(service, {
      decision: 'Handler layer uses thin wrappers',
      rationale: 'Keep business logic in services',
      category: 'pattern',
      scope: {
        layers: ['handler'],
        patterns: ['src/adapters/**'],
      },
    });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
  });

  it('handleLogDecision returns similarity info', async () => {
    // Log first decision - keywords: sqlite, database, persistent, local, data, storage, embedded, simplifies, operations
    await handleLogDecision(service, {
      decision: 'SQLite database for persistent local data storage',
      rationale: 'Embedded database simplifies operations',
      category: 'architecture',
    });

    // Log similar decision - high keyword overlap to exceed 50% Jaccard threshold
    const result = await handleLogDecision(service, {
      decision: 'SQLite database persistent local data storage solution',
      rationale: 'Embedded database approach simplifies things',
      category: 'architecture',
    });

    const body = JSON.parse(result.content[0].text);
    expect(body.similarity).toBeDefined();
    expect(body.similarity.hasSimilar).toBe(true);
  });

  it('handleGetDecisions returns all decisions', async () => {
    await service.logDecision({ decision: 'Decision A', category: 'architecture' });
    await service.logDecision({ decision: 'Decision B', category: 'tradeoff' });

    const result = await handleGetDecisions(service, {});

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.decisions.length).toBeGreaterThanOrEqual(2);
  });

  it('handleGetDecisions filters by category', async () => {
    await service.logDecision({ decision: 'Arch decision', category: 'architecture' });
    await service.logDecision({ decision: 'Tradeoff decision', category: 'tradeoff' });

    const result = await handleGetDecisions(service, { category: 'architecture' });

    const body = JSON.parse(result.content[0].text);
    expect(body.decisions.every((d: any) => d.category === 'architecture')).toBe(true);
  });

  it('handleGetDecision retrieves single decision by ID', async () => {
    const logResult = await service.logDecision({
      decision: 'Specific decision',
      rationale: 'Test rationale',
      category: 'pattern',
    });

    const result = await handleGetDecision(service, { decisionId: logResult.decisionId });

    expect(result.content).toBeDefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.decision).toBe('Specific decision');
    expect(body.rationale).toBe('Test rationale');
  });
});
