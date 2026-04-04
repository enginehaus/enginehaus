/**
 * Workflow Configuration Handlers
 *
 * Handles configure_workflow and get_workflow_config tool calls.
 * Validates input, computes diffs, persists to config, and logs as a decision.
 */

import type { CoordinationService } from '../../../core/services/coordination-service.js';
import type { ToolResult } from '../tool-registry.js';
import type {
  BranchStrategy,
  SessionOwnership,
  CommitTarget,
  ReleaseFrequency,
} from '../../../config/types.js';

export interface ConfigureWorkflowParams {
  branchStrategy?: BranchStrategy;
  sessionOwnership?: SessionOwnership;
  commitTarget?: CommitTarget;
  releaseFrequency?: ReleaseFrequency;
  driverRotation?: boolean;
  qualityGates?: string[];
}

interface WorkflowConfigContext {
  service: CoordinationService;
  resolvedAgentId: string;
  getProjectContext: () => Promise<{ projectId: string; projectName: string; projectSlug: string } | null>;
}

export async function handleConfigureWorkflow(
  ctx: WorkflowConfigContext,
  args: ConfigureWorkflowParams,
): Promise<ToolResult> {
  const projectCtx = await ctx.getProjectContext();
  if (!projectCtx) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No active project. Run `enginehaus init` first.' }) }],
      isError: true,
    };
  }

  // Check that at least one field is provided
  const fields: (keyof ConfigureWorkflowParams)[] = [
    'branchStrategy', 'sessionOwnership', 'commitTarget',
    'releaseFrequency', 'driverRotation', 'qualityGates',
  ];
  const provided = fields.filter(f => args[f] !== undefined);
  if (provided.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        success: false,
        error: 'No workflow fields provided. Specify at least one of: branchStrategy, sessionOwnership, commitTarget, releaseFrequency, driverRotation, qualityGates',
      }) }],
      isError: true,
    };
  }

  const configManager = ctx.service.getConfigManager();
  const config = await configManager.getEffectiveConfig(projectCtx.projectId);
  const currentWorkflow = config.workflow;

  // Build the diff
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  const updates: Record<string, unknown> = {};

  if (args.branchStrategy !== undefined && args.branchStrategy !== currentWorkflow.branchStrategy) {
    changes.push({ field: 'branchStrategy', from: currentWorkflow.branchStrategy ?? 'feature', to: args.branchStrategy });
    updates['workflow.branchStrategy'] = args.branchStrategy;

    // Auto-derive related settings
    if (args.branchStrategy === 'trunk') {
      if (args.commitTarget === undefined) {
        changes.push({ field: 'commitTarget', from: currentWorkflow.commitTarget ?? 'branch', to: 'main' });
        updates['workflow.commitTarget'] = 'main';
      }
      if (config.git.autoCreateBranches !== false) {
        changes.push({ field: 'git.autoCreateBranches', from: true, to: false });
        updates['git.autoCreateBranches'] = false;
      }
    }
  }

  if (args.sessionOwnership !== undefined && args.sessionOwnership !== currentWorkflow.sessionOwnership) {
    changes.push({ field: 'sessionOwnership', from: currentWorkflow.sessionOwnership ?? 'individual', to: args.sessionOwnership });
    updates['workflow.sessionOwnership'] = args.sessionOwnership;

    // Auto-derive for collective
    if (args.sessionOwnership === 'collective' && config.workflow.sessions.allowMultipleAgents !== true) {
      changes.push({ field: 'sessions.allowMultipleAgents', from: config.workflow.sessions.allowMultipleAgents, to: true });
      updates['workflow.sessions.allowMultipleAgents'] = true;
    }
  }

  if (args.commitTarget !== undefined && args.commitTarget !== currentWorkflow.commitTarget) {
    changes.push({ field: 'commitTarget', from: currentWorkflow.commitTarget ?? 'branch', to: args.commitTarget });
    updates['workflow.commitTarget'] = args.commitTarget;
  }

  if (args.releaseFrequency !== undefined && args.releaseFrequency !== currentWorkflow.releaseFrequency) {
    changes.push({ field: 'releaseFrequency', from: currentWorkflow.releaseFrequency ?? undefined, to: args.releaseFrequency });
    updates['workflow.releaseFrequency'] = args.releaseFrequency;
  }

  if (args.driverRotation !== undefined && args.driverRotation !== currentWorkflow.driverRotation) {
    changes.push({ field: 'driverRotation', from: currentWorkflow.driverRotation ?? false, to: args.driverRotation });
    updates['workflow.driverRotation'] = args.driverRotation;
  }

  if (args.qualityGates !== undefined) {
    const currentGates = currentWorkflow.qualityGates;
    const gatesChanged = JSON.stringify(currentGates) !== JSON.stringify(args.qualityGates);
    if (gatesChanged) {
      changes.push({ field: 'qualityGates', from: currentGates ?? '(default heuristics)', to: args.qualityGates });
      updates['workflow.qualityGates'] = args.qualityGates;
    }
  }

  if (changes.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        success: true,
        message: 'No changes needed — configuration already matches.',
        current: {
          branchStrategy: currentWorkflow.branchStrategy ?? 'feature',
          sessionOwnership: currentWorkflow.sessionOwnership ?? 'individual',
          commitTarget: currentWorkflow.commitTarget ?? 'branch',
          releaseFrequency: currentWorkflow.releaseFrequency,
          driverRotation: currentWorkflow.driverRotation ?? false,
          qualityGates: currentWorkflow.qualityGates ?? '(default heuristics)',
        },
      }, null, 2) }],
    };
  }

  // Apply all updates
  for (const [path, value] of Object.entries(updates)) {
    await configManager.setConfigValue(projectCtx.projectId, path, value, {
      changedBy: ctx.resolvedAgentId,
      reason: 'Workflow configuration via configure_workflow',
    });
  }

  // Log as a decision for traceability
  try {
    const changesSummary = changes.map(c => `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('; ');
    await ctx.service.logDecision({
      decision: `Workflow configured: ${changesSummary}`,
      rationale: 'User-defined workflow preferences applied via configure_workflow',
      category: 'pattern',
      metadata: { source: 'configure_workflow', changes },
    });
  } catch {
    // Non-critical — config was saved even if decision logging fails
  }

  // Re-read config to get effective values (includes auto-derived settings)
  const updatedConfig = await configManager.getEffectiveConfig(projectCtx.projectId, { forceRefresh: true });
  const uw = updatedConfig.workflow;

  return {
    content: [{ type: 'text', text: JSON.stringify({
      success: true,
      message: `Workflow updated: ${changes.length} change(s) applied.`,
      changes,
      effective: {
        branchStrategy: uw.branchStrategy ?? 'feature',
        sessionOwnership: uw.sessionOwnership ?? 'individual',
        commitTarget: uw.commitTarget ?? 'branch',
        releaseFrequency: uw.releaseFrequency,
        driverRotation: uw.driverRotation ?? false,
        qualityGates: uw.qualityGates ?? '(default heuristics)',
      },
    }, null, 2) }],
  };
}

export async function handleGetWorkflowConfig(
  ctx: WorkflowConfigContext,
): Promise<ToolResult> {
  const projectCtx = await ctx.getProjectContext();
  if (!projectCtx) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No active project.' }) }],
      isError: true,
    };
  }

  const configManager = ctx.service.getConfigManager();
  const config = await configManager.getEffectiveConfig(projectCtx.projectId);
  const w = config.workflow;

  return {
    content: [{ type: 'text', text: JSON.stringify({
      branchStrategy: w.branchStrategy ?? 'feature',
      sessionOwnership: w.sessionOwnership ?? 'individual',
      commitTarget: w.commitTarget ?? 'branch',
      releaseFrequency: w.releaseFrequency ?? undefined,
      driverRotation: w.driverRotation ?? false,
      qualityGates: w.qualityGates ?? '(default heuristics — tests detected, decisions logged)',
      phases: {
        enabled: w.phases.enabled,
        definition: w.phases.definition,
        enforcement: w.phases.enforcement,
      },
      tasks: {
        requireCommitOnCompletion: w.tasks.requireCommitOnCompletion,
        requirePushOnCompletion: w.tasks.requirePushOnCompletion,
        cleanupBranchOnCompletion: w.tasks.cleanupBranchOnCompletion,
      },
    }, null, 2) }],
  };
}
