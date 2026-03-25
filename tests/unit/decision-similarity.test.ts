import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Decision similarity detection', () => {
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let testDir: string;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-sim-test-'));
    storage = new SQLiteStorageService(testDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);

    const project = await service.createProject({ name: 'Similarity Test' });
    await service.setActiveProject(project.id);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('detects similar decisions', async () => {
    // Use decisions with high keyword overlap to exceed 50% Jaccard threshold
    // Jaccard index = intersection / union of keyword sets (stop words removed)
    await service.logDecision({
      decision: 'SQLite database for persistent local data storage',
      rationale: 'Embedded database simplifies operations',
      category: 'architecture',
    });

    const result = await service.logDecision({
      decision: 'SQLite database persistent local data storage solution',
      rationale: 'Embedded database approach simplifies things',
      category: 'architecture',
    });

    expect(result.success).toBe(true);
    expect(result.similarity).toBeDefined();
    expect(result.similarity!.hasSimilar).toBe(true);
    expect(result.similarity!.similarDecisions.length).toBeGreaterThan(0);
    expect(result.similarity!.highestScore).toBeGreaterThan(0.5);
  });

  it('does not flag unrelated decisions', async () => {
    await service.logDecision({
      decision: 'Use React for frontend rendering',
      rationale: 'Team familiarity with React ecosystem',
      category: 'architecture',
    });

    const result = await service.logDecision({
      decision: 'Deploy on Kubernetes cluster',
      rationale: 'Scalable container orchestration',
      category: 'architecture',
    });

    expect(result.success).toBe(true);
    expect(result.similarity).toBeDefined();
    expect(result.similarity!.similarDecisions.length).toBe(0);
  });

  it('respects the 50% similarity threshold', async () => {
    // Log a decision with specific keywords
    await service.logDecision({
      decision: 'PostgreSQL database for production workloads',
      rationale: 'Strong consistency guarantees needed',
      category: 'architecture',
    });

    // Log a decision that shares some keywords but not enough (< 50% Jaccard)
    const result = await service.logDecision({
      decision: 'Redis cache for session management tokens',
      rationale: 'Fast ephemeral data access patterns required',
      category: 'architecture',
    });

    expect(result.similarity!.similarDecisions.length).toBe(0);
  });

  it('returns at most top 3 similar decisions', async () => {
    // Log 5 similar decisions about TypeScript
    const baseDecisions = [
      'TypeScript strict mode for type safety',
      'TypeScript interfaces for API contracts',
      'TypeScript generics for reusable components',
      'TypeScript enums for status constants',
      'TypeScript decorators for metadata',
    ];

    for (const decision of baseDecisions) {
      await service.logDecision({
        decision,
        rationale: 'TypeScript features for better development',
        category: 'pattern',
      });
    }

    // Log another TypeScript decision
    const result = await service.logDecision({
      decision: 'TypeScript strict checks for runtime safety',
      rationale: 'TypeScript compiler catches errors early',
      category: 'pattern',
    });

    expect(result.similarity).toBeDefined();
    // Should return at most 3 even though more may be similar
    expect(result.similarity!.similarDecisions.length).toBeLessThanOrEqual(3);
    // And they should be sorted by score descending
    const scores = result.similarity!.similarDecisions.map(d => d.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});
