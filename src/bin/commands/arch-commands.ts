/**
 * Architecture CLI commands: scan, list, show, health, graph
 *
 * Browse and manage project architecture — components, relationships, health.
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import { CliContext } from '../cli-context.js';
import { expandPath } from '../../utils/paths.js';

export function registerArchCommands(program: Command, ctx: CliContext): void {
  const { coordination, resolveProject } = ctx;

  const arch = program
    .command('architecture')
    .alias('arch')
    .description('Browse and manage project architecture — components, relationships, health');

  arch
    .command('scan')
    .description('Scan a project to auto-detect components, relationships, and activity')
    .option('--clear', 'Clear existing components before scanning')
    .action(async (opts: { clear?: boolean }) => {
      await coordination.initialize();

      const project = await resolveProject();
      if (!project) {
        console.error('\n  No project found. Set an active project or run from a project directory.\n');
        process.exit(1);
      }

      const rootPath = project.rootPath ? expandPath(project.rootPath) : process.cwd();

      console.log(`\n  Scanning ${project.name} at ${rootPath}...`);
      const scanResult = await coordination.scanProjectArchitecture(project.id, rootPath, {
        clearExisting: opts.clear,
      });

      console.log(`  Saved: ${scanResult.components} components, ${scanResult.relationships} relationships (${scanResult.scanDuration}ms)`);

      const critical = scanResult.health.filter((r: any) => r.status === 'critical').length;
      const warning = scanResult.health.filter((r: any) => r.status === 'warning').length;
      const healthy = scanResult.health.filter((r: any) => r.status === 'healthy').length;

      console.log(`  Health: ${healthy} healthy, ${warning} warning, ${critical} critical\n`);

      if (critical > 0 || warning > 0) {
        console.log('  Components needing attention:');
        for (const r of scanResult.health.filter((r: any) => r.status !== 'healthy')) {
          const icon = r.status === 'critical' ? '🔴' : '🟡';
          console.log(`    ${icon} ${r.componentName} (${(r.healthScore * 100).toFixed(0)}%) — ${r.recommendation || 'Review needed'}`);
        }
        console.log('');
      }
    });

  arch
    .command('list')
    .description('List all components for the current project')
    .option('--layer <layer>', 'Filter by layer')
    .option('--type <type>', 'Filter by component type')
    .option('--json', 'Output as JSON')
    .action(async (opts: { layer?: string; type?: string; json?: boolean }) => {
      await coordination.initialize();

      const project = await resolveProject();
      if (!project) {
        console.error('\n  No project found.\n');
        process.exit(1);
      }

      const components = await coordination.getComponents({
        projectId: project.id,
        layer: opts.layer,
        type: opts.type,
      });

      if (opts.json) {
        console.log(JSON.stringify(components, null, 2));
        return;
      }

      if (components.length === 0) {
        console.log(`\n  No components found. Run 'enginehaus architecture scan' first.\n`);
        return;
      }

      console.log(`\n  Components for ${project.name} (${components.length}):\n`);

      // Group by layer
      const byLayer = new Map<string, typeof components>();
      for (const c of components) {
        const layer = c.layer || 'unknown';
        if (!byLayer.has(layer)) byLayer.set(layer, []);
        byLayer.get(layer)!.push(c);
      }

      for (const [layer, layerComponents] of byLayer) {
        console.log(`  [${layer.toUpperCase()}]`);
        for (const c of layerComponents) {
          const healthStr = c.healthScore !== undefined
            ? ` (${(c.healthScore * 100).toFixed(0)}%)`
            : '';
          const icon = c.healthScore !== undefined
            ? (c.healthScore >= 0.7 ? '🟢' : c.healthScore >= 0.4 ? '🟡' : '🔴')
            : '⚪';
          console.log(`    ${icon} ${c.name} [${c.type}]${healthStr} — ${c.filePatterns.length} pattern(s)`);
        }
        console.log('');
      }
    });

  arch
    .command('show <name>')
    .description('Show detailed view of a component')
    .action(async (name: string) => {
      await coordination.initialize();

      const project = await resolveProject();
      if (!project) {
        console.error('\n  No project found.\n');
        process.exit(1);
      }

      const components = await coordination.getComponents({ projectId: project.id });
      const component = components.find(c => c.name === name || c.id === name);

      if (!component) {
        console.error(`\n  Component not found: "${name}". Run 'enginehaus arch list' to see available components.\n`);
        process.exit(1);
      }

      console.log(`\n  Component: ${component.name}`);
      console.log(`  Type: ${component.type} | Layer: ${component.layer || 'unknown'}`);
      if (component.description) console.log(`  Description: ${component.description}`);
      if (component.entryPoint) console.log(`  Entry point: ${component.entryPoint}`);
      if (component.healthScore !== undefined) {
        const icon = component.healthScore >= 0.7 ? '🟢' : component.healthScore >= 0.4 ? '🟡' : '🔴';
        console.log(`  Health: ${icon} ${(component.healthScore * 100).toFixed(0)}%`);
      }
      console.log(`  Files: ${component.filePatterns.join(', ')}`);

      // Show relationships
      const rels = await coordination.getComponentRelationships(component.id);
      if (rels.length > 0) {
        console.log('\n  Relationships:');
        for (const rel of rels) {
          const isSource = rel.sourceId === component.id;
          const otherId = isSource ? rel.targetId : rel.sourceId;
          const other = components.find(c => c.id === otherId);
          const otherName = other?.name || otherId.slice(0, 8);
          const arrow = isSource ? `→ ${rel.type} → ${otherName}` : `← ${rel.type} ← ${otherName}`;
          console.log(`    ${arrow}`);
        }
      }

      // Show linked decisions
      const decisions = await coordination.getComponentDecisions(component.id);
      if (decisions.length > 0) {
        console.log('\n  Decisions:');
        for (const d of decisions.slice(0, 5)) {
          console.log(`    • [${d.category}] ${d.decision}`);
          if (d.rationale) console.log(`      → ${d.rationale}`);
        }
      }

      // Show recent health events
      const events = await coordination.getComponentHealthEvents(component.id, { limit: 5 });
      if (events.length > 0) {
        console.log('\n  Recent events:');
        for (const e of events) {
          const icon = e.severity === 'error' ? '🔴' : e.severity === 'warning' ? '🟡' : 'ℹ️';
          const date = e.createdAt.toISOString().slice(0, 10);
          console.log(`    ${icon} [${date}] ${e.eventType}: ${e.description || 'No description'}`);
        }
      }

      // Show git activity from metadata
      const gitActivity = (component.metadata as any)?.gitActivity;
      if (gitActivity) {
        console.log('\n  Git activity (30 days):');
        console.log(`    Commits: ${gitActivity.totalCommits}`);
        console.log(`    Authors: ${gitActivity.authors?.join(', ') || 'unknown'}`);
      }

      console.log('');
    });

  arch
    .command('health')
    .description('Show health report for all components')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      await coordination.initialize();

      const project = await resolveProject();
      if (!project) {
        console.error('\n  No project found.\n');
        process.exit(1);
      }

      const reports = await coordination.scoreProjectHealth(project.id);

      if (opts.json) {
        console.log(JSON.stringify(reports, null, 2));
        return;
      }

      if (reports.length === 0) {
        console.log(`\n  No components found. Run 'enginehaus architecture scan' first.\n`);
        return;
      }

      const critical = reports.filter(r => r.status === 'critical');
      const warning = reports.filter(r => r.status === 'warning');
      const healthy = reports.filter(r => r.status === 'healthy');

      console.log(`\n  Architecture Health: ${project.name}\n`);
      console.log(`  Summary: ${healthy.length} healthy, ${warning.length} warning, ${critical.length} critical\n`);

      for (const r of reports) {
        const icon = r.status === 'critical' ? '🔴' : r.status === 'warning' ? '🟡' : '🟢';
        console.log(`  ${icon} ${r.componentName.padEnd(30)} ${(r.healthScore * 100).toFixed(0).padStart(3)}%`);

        // Show factors for non-healthy components
        if (r.status !== 'healthy') {
          for (const f of r.factors.filter(f => f.score < 0.7)) {
            console.log(`      ↳ ${f.name}: ${f.detail}`);
          }
          if (r.recommendation) {
            console.log(`      → ${r.recommendation}`);
          }
        }
      }
      console.log('');
    });

  arch
    .command('graph')
    .description('Show component dependency graph')
    .action(async () => {
      await coordination.initialize();

      const project = await resolveProject();
      if (!project) {
        console.error('\n  No project found.\n');
        process.exit(1);
      }

      const components = await coordination.getComponents({ projectId: project.id });
      if (components.length === 0) {
        console.log(`\n  No components found. Run 'enginehaus architecture scan' first.\n`);
        return;
      }

      // Build adjacency representation
      const allRels: Array<{ sourceId: string; targetId: string; type: string }> = [];
      for (const comp of components) {
        const rels = await coordination.getComponentRelationships(comp.id);
        allRels.push(...rels);
      }

      const nameById = new Map(components.map(c => [c.id, c.name]));

      // Group by layer for visual structure
      const byLayer = new Map<string, typeof components>();
      for (const c of components) {
        const layer = c.layer || 'unknown';
        if (!byLayer.has(layer)) byLayer.set(layer, []);
        byLayer.get(layer)!.push(c);
      }

      console.log(`\n  Component Graph: ${project.name}\n`);

      // Layer order (top to bottom = outer to inner)
      const layerOrder = ['ui', 'api', 'adapter', 'core', 'storage', 'infrastructure', 'config', 'test', 'build', 'shared', 'unknown'];

      for (const layer of layerOrder) {
        const layerComps = byLayer.get(layer);
        if (!layerComps) continue;

        console.log(`  ┌─ ${layer.toUpperCase()} ${'─'.repeat(Math.max(1, 50 - layer.length))}┐`);
        for (const c of layerComps) {
          const icon = c.healthScore !== undefined
            ? (c.healthScore >= 0.7 ? '🟢' : c.healthScore >= 0.4 ? '🟡' : '🔴')
            : '⚪';
          const deps = allRels
            .filter(r => r.sourceId === c.id && r.type === 'depends-on')
            .map(r => nameById.get(r.targetId) || '?');
          const depStr = deps.length > 0 ? ` → ${deps.join(', ')}` : '';
          console.log(`  │ ${icon} ${c.name} [${c.type}]${depStr}`);
        }
        console.log(`  └${'─'.repeat(54)}┘`);
      }
      console.log('');
    });
}
