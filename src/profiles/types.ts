/**
 * Domain Profile Types
 *
 * A DomainProfile is a JSON config bundle that sets phases, decision categories,
 * quality gates, task types, and checkpoint protocol. Applied at `enginehaus init --profile <name>`,
 * values are written to project config. The profile is not a runtime dependency — config drives behavior.
 */

export interface DomainProfile {
  name: string;
  label: string;
  experimental?: boolean;

  phases: Array<{
    name: string;
    description: string;
    canSkip: boolean;
    requiredOutputs?: string[];
  }>;

  decisionCategories: string[];
  taskTypes: string[];

  qualityGates: Array<{
    name: string;
    description: string;
    command?: string;
    manual?: boolean;
  }>;

  checkpointProtocol: 'git' | 'manual';

  contextLabels?: {
    strategic?: string;
    ux?: string;
    technical?: string;
  };
}

/**
 * Convert profile phases to PhaseDefinition format.
 * Auto-generates id, shortName, and commitPrefix from phase name.
 */
export function profilePhasesToDefinitions(
  phases: DomainProfile['phases']
): Array<{
  id: number;
  name: string;
  shortName: string;
  description: string;
  commitPrefix: string;
  canSkip: boolean;
  requiredOutputs?: string[];
}> {
  return phases.map((phase, index) => ({
    id: index + 1,
    name: phase.name,
    shortName: phase.name.toLowerCase().split(/\s+/).map(w => w[0]).join(''),
    description: phase.description,
    commitPrefix: phase.name.toLowerCase().replace(/\s+/g, '-'),
    canSkip: phase.canSkip,
    requiredOutputs: phase.requiredOutputs,
  }));
}
