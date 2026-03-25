import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LearningEngine } from '../../src/analysis/learning-engine.js';
import { CoordinationService } from '../../src/core/services/coordination-service.js';
import { SQLiteStorageService } from '../../src/storage/sqlite-storage-service.js';
import { EventOrchestrator } from '../../src/events/event-orchestrator.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('LearningEngine', () => {
  let engine: LearningEngine;
  let service: CoordinationService;
  let storage: SQLiteStorageService;
  let events: EventOrchestrator;
  let dbDir: string;

  beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enginehaus-learning-'));
    storage = new SQLiteStorageService(dbDir);
    await storage.initialize();
    events = new EventOrchestrator();
    service = new CoordinationService(storage, events);
    engine = new LearningEngine(storage);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  describe('analyzeDecisionPatterns', () => {
    it('returns empty array when no decisions exist', async () => {
      const patterns = await engine.analyzeDecisionPatterns();
      expect(patterns).toEqual([]);
    });

    it('groups decisions by category across projects', async () => {
      // Create two projects
      const p1 = await service.createProject({ name: 'Project A', slug: 'proj-a', rootPath: '/tmp/a' });
      const p2 = await service.createProject({ name: 'Project B', slug: 'proj-b', rootPath: '/tmp/b' });

      // Log decisions in each
      await service.setActiveProject(p1.id);
      await service.logDecision({ decision: 'Use TypeScript', rationale: 'Type safety', category: 'architecture' });
      await service.logDecision({ decision: 'Use Vitest', rationale: 'Fast', category: 'pattern' });

      await service.setActiveProject(p2.id);
      await service.logDecision({ decision: 'Use TypeScript strict', rationale: 'Stronger guarantees', category: 'architecture' });

      const patterns = await engine.analyzeDecisionPatterns();

      // architecture should appear across 2 projects
      const archPattern = patterns.find(p => p.category === 'architecture');
      expect(archPattern).toBeDefined();
      expect(archPattern!.count).toBe(2);
      expect(archPattern!.projects.length).toBe(2);

      const patternPattern = patterns.find(p => p.category === 'pattern');
      expect(patternPattern).toBeDefined();
      expect(patternPattern!.count).toBe(1);
    });

    it('detects workaround signals in decision text', async () => {
      const p1 = await service.createProject({ name: 'Project C', slug: 'proj-c', rootPath: '/tmp/c' });
      await service.setActiveProject(p1.id);

      await service.logDecision({
        decision: 'Workaround: bypass auth for local dev',
        rationale: 'Had to work around the OAuth flow',
        category: 'architecture',
      });
      await service.logDecision({
        decision: 'Use standard auth flow',
        rationale: 'Clean implementation',
        category: 'architecture',
      });

      const patterns = await engine.analyzeDecisionPatterns();
      const archPattern = patterns.find(p => p.category === 'architecture');
      expect(archPattern!.workaroundSignals).toBe(1);
    });
  });

  describe('analyzeFrictionPatterns', () => {
    it('returns empty analysis when no feedback exists', async () => {
      const friction = await engine.analyzeFrictionPatterns();
      expect(friction.totalFeedback).toBe(0);
      expect(friction.avgProductivityRating).toBeNull();
      expect(friction.topFriction).toEqual([]);
    });
  });

  describe('analyzeQualityTrends', () => {
    it('returns zero rates when no gate events exist', async () => {
      const quality = await engine.analyzeQualityTrends();
      expect(quality.gatePassRate).toBe(0);
      expect(quality.totalGateEvents).toBe(0);
    });

    it('calculates gate pass rate from metrics', async () => {
      const p1 = await service.createProject({ name: 'Quality Project', slug: 'quality', rootPath: '/tmp/q' });
      await service.setActiveProject(p1.id);

      // Log quality gate metrics directly
      await storage.logMetric({ eventType: 'quality_gate_passed', projectId: p1.id, metadata: {} });
      await storage.logMetric({ eventType: 'quality_gate_passed', projectId: p1.id, metadata: {} });
      await storage.logMetric({ eventType: 'quality_gate_failed', projectId: p1.id, metadata: {} });

      const quality = await engine.analyzeQualityTrends();
      expect(quality.totalGateEvents).toBe(3);
      // 2 passed out of 3 total
      expect(quality.gatePassRate).toBeCloseTo(2 / 3, 2);
    });

    it('includes failure breakdown from metadata', async () => {
      const p1 = await service.createProject({ name: 'Breakdown Project', slug: 'breakdown', rootPath: '/tmp/bd' });
      await service.setActiveProject(p1.id);

      await storage.logMetric({
        eventType: 'quality_gate_failed', projectId: p1.id,
        metadata: { gapReasons: ['no-decisions', 'no-tests'] },
      });
      await storage.logMetric({
        eventType: 'quality_gate_failed', projectId: p1.id,
        metadata: { gapReasons: ['no-decisions'] },
      });
      await storage.logMetric({
        eventType: 'quality_gate_passed', projectId: p1.id,
        metadata: {},
      });

      const quality = await engine.analyzeQualityTrends();
      expect(quality.failureBreakdown['no-decisions']).toBe(2);
      expect(quality.failureBreakdown['no-tests']).toBe(1);
    });
  });

  describe('analyzeInitiativeOutcomes', () => {
    it('returns zero totals when no initiatives exist', async () => {
      const learnings = await engine.analyzeInitiativeOutcomes();
      expect(learnings.totalInitiatives).toBe(0);
      expect(learnings.successRate).toBe(0);
      expect(learnings.succeeded).toEqual([]);
      expect(learnings.failed).toEqual([]);
    });
  });

  describe('generateRecommendations', () => {
    it('returns empty recommendations for clean data', async () => {
      const recs = await engine.generateRecommendations();
      // May have recommendations depending on state, but should not error
      expect(Array.isArray(recs)).toBe(true);
    });

    it('generates workaround recommendations when signals are high', async () => {
      const p1 = await service.createProject({ name: 'Workaround Project', slug: 'workaround', rootPath: '/tmp/w' });
      await service.setActiveProject(p1.id);

      // Create 3+ workaround decisions in one category
      for (let i = 0; i < 4; i++) {
        await service.logDecision({
          decision: `Had to work around limitation ${i}`,
          rationale: 'Temporary hack until fixed',
          category: 'architecture',
        });
      }

      const recs = await engine.generateRecommendations();
      const workaroundRec = recs.find(r =>
        r.type === 'structural_check' && r.title.includes('Workaround')
      );
      expect(workaroundRec).toBeDefined();
    });
  });

  describe('generateWorldview', () => {
    it('produces a complete worldview even with empty data', async () => {
      const worldview = await engine.generateWorldview();
      expect(worldview.generatedAt).toBeInstanceOf(Date);
      expect(worldview.health).toBeDefined();
      expect(worldview.healthReasons.length).toBeGreaterThan(0);
      expect(worldview.decisionPatterns).toEqual([]);
      expect(worldview.recommendations).toBeDefined();
    });

    it('reports healthy status when no issues found', async () => {
      const worldview = await engine.generateWorldview();
      // Empty data = no problems detected = healthy
      expect(worldview.health).toBe('healthy');
      expect(worldview.healthReasons).toContain('No significant issues detected');
    });
  });
});
