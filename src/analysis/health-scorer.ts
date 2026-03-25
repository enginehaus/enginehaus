/**
 * Component Health Scoring
 *
 * Computes a composite health score (0.0 - 1.0) for each component based on:
 * - Churn rate (high churn = potential instability)
 * - Test coverage indicators (has associated test suite?)
 * - Decision density (architectural decisions documented?)
 * - Recent error/warning events
 * - Author concentration (bus factor)
 *
 * Lower scores = needs attention. This drives the "problematic component"
 * highlighting in the architecture view.
 */

import type { StorageAdapter } from '../storage/storage-adapter.js';

export interface ComponentHealthReport {
  componentId: string;
  componentName: string;
  projectId: string;
  healthScore: number;
  factors: HealthFactor[];
  status: 'healthy' | 'warning' | 'critical';
  recommendation?: string;
}

export interface HealthFactor {
  name: string;
  score: number;     // 0.0 - 1.0
  weight: number;    // How much this factor contributes
  detail: string;
}

export class HealthScorer {
  constructor(private storage: StorageAdapter) {}

  /**
   * Score all components for a project and update their health_score.
   */
  async scoreProject(projectId: string): Promise<ComponentHealthReport[]> {
    const components = await this.storage.getComponents({ projectId });
    const reports: ComponentHealthReport[] = [];

    // Get all relationships for dependency analysis
    const allRelationships: Array<{ sourceId: string; targetId: string; type: string }> = [];
    for (const comp of components) {
      const rels = await this.storage.getComponentRelationships(comp.id);
      allRelationships.push(...rels);
    }

    for (const comp of components) {
      const factors: HealthFactor[] = [];

      // Factor 1: Test coverage (does this component have a test suite?)
      const hasTestRelation = allRelationships.some(
        r => r.targetId === comp.id && r.type === 'tests'
      );
      const isTestSuite = comp.type === 'test-suite';
      if (!isTestSuite) {
        factors.push({
          name: 'test_coverage',
          score: hasTestRelation ? 1.0 : 0.3,
          weight: 0.25,
          detail: hasTestRelation ? 'Has associated test suite' : 'No test suite detected',
        });
      }

      // Factor 2: Decision documentation
      const decisions = await this.storage.getComponentDecisions(comp.id);
      const decisionScore = Math.min(1.0, decisions.length / 2); // 2+ decisions = full score
      factors.push({
        name: 'decision_density',
        score: decisionScore,
        weight: 0.15,
        detail: `${decisions.length} decision(s) documented`,
      });

      // Factor 3: Recent health events (warnings/errors are bad)
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const events = await this.storage.getComponentHealthEvents(comp.id, { since });
      const errorCount = events.filter(e => e.severity === 'error').length;
      const warningCount = events.filter(e => e.severity === 'warning').length;
      const eventScore = Math.max(0, 1.0 - (errorCount * 0.3) - (warningCount * 0.1));
      factors.push({
        name: 'health_events',
        score: eventScore,
        weight: 0.20,
        detail: errorCount > 0
          ? `${errorCount} error(s), ${warningCount} warning(s)`
          : warningCount > 0
            ? `${warningCount} warning(s)`
            : 'No issues detected',
      });

      // Factor 4: Churn (from metadata git activity)
      const gitActivity = (comp.metadata as any)?.gitActivity;
      let churnScore = 0.8; // Default: moderate (no data = neutral)
      if (gitActivity) {
        const fileCount = (comp.metadata as any)?.fileCount || 1;
        const commitsPerFile = gitActivity.totalCommits / fileCount;
        // High churn (>5 commits/file in 30 days) suggests instability
        if (commitsPerFile > 10) churnScore = 0.3;
        else if (commitsPerFile > 5) churnScore = 0.5;
        else if (commitsPerFile > 2) churnScore = 0.7;
        else churnScore = 1.0;
      }
      factors.push({
        name: 'churn_rate',
        score: churnScore,
        weight: 0.20,
        detail: gitActivity
          ? `${gitActivity.totalCommits} commits across ${(comp.metadata as any)?.fileCount || '?'} files`
          : 'No git activity data',
      });

      // Factor 5: Bus factor (author concentration)
      let busFactor = 0.8;
      if (gitActivity?.uniqueAuthors !== undefined) {
        if (gitActivity.uniqueAuthors >= 3) busFactor = 1.0;
        else if (gitActivity.uniqueAuthors === 2) busFactor = 0.7;
        else if (gitActivity.uniqueAuthors === 1) busFactor = 0.5;
        else busFactor = 0.3; // No recent authors
      }
      factors.push({
        name: 'bus_factor',
        score: busFactor,
        weight: 0.20,
        detail: gitActivity
          ? `${gitActivity.uniqueAuthors} author(s) in last 30 days`
          : 'No author data',
      });

      // Compute weighted composite score
      const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
      const healthScore = totalWeight > 0
        ? factors.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight
        : 0.5;

      // Determine status
      const status: ComponentHealthReport['status'] =
        healthScore >= 0.7 ? 'healthy' :
        healthScore >= 0.4 ? 'warning' :
        'critical';

      // Generate recommendation
      let recommendation: string | undefined;
      const worstFactor = factors.reduce((worst, f) =>
        f.score < worst.score ? f : worst
      );
      if (worstFactor.score < 0.5) {
        const recMap: Record<string, string> = {
          test_coverage: 'Add tests for this component',
          decision_density: 'Document architectural decisions with log_decision',
          health_events: 'Review and address recent health issues',
          churn_rate: 'High churn detected — consider stabilizing or refactoring',
          bus_factor: 'Only one contributor — consider knowledge sharing',
        };
        recommendation = recMap[worstFactor.name] || `Address ${worstFactor.name}`;
      }

      // Update the stored health score
      await this.storage.saveComponent({
        ...comp,
        id: comp.id,
        projectId: comp.projectId,
        healthScore,
      });

      reports.push({
        componentId: comp.id,
        componentName: comp.name,
        projectId: comp.projectId,
        healthScore,
        factors,
        status,
        recommendation,
      });
    }

    // Sort: critical first, then warning, then healthy
    const statusOrder = { critical: 0, warning: 1, healthy: 2 };
    reports.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    return reports;
  }
}
