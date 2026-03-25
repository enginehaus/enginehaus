/**
 * Instructions Version Constant
 *
 * Tracks the version of project instructions for agents.
 * Bump this version whenever CLAUDE.md, project instructions templates,
 * or agent workflow documentation changes significantly.
 *
 * This enables detection of outdated agent instructions by comparing
 * the version agents report with the current version.
 */

/**
 * Current instructions version.
 * Format: MAJOR.MINOR
 * - Bump MINOR for workflow clarifications, new tool docs
 * - Bump MAJOR for breaking changes to workflow or required tools
 */
export const INSTRUCTIONS_VERSION = '2.1';

/**
 * Date when instructions were last updated.
 * Used for display in version health messages.
 */
export const INSTRUCTIONS_UPDATED = '2026-01-21';

/**
 * Instructions health status types
 */
export type InstructionsHealthStatus = 'current' | 'outdated' | 'unknown';

/**
 * Instructions health information returned by MCP tools
 */
export interface InstructionsHealth {
  /** Current status of agent's instructions */
  status: InstructionsHealthStatus;
  /** Version reported by the agent (null if not provided) */
  agentVersion: string | null;
  /** Current instructions version */
  currentVersion: string;
  /** Human-readable message about version status */
  message?: string;
  /** Command to update instructions */
  updateCommand?: string;
}

/**
 * Check instructions health based on agent-reported version
 * @param agentVersion - Version reported by agent, or null if not provided
 * @returns Instructions health information
 */
export function checkInstructionsHealth(agentVersion: string | null | undefined): InstructionsHealth {
  if (!agentVersion) {
    return {
      status: 'unknown',
      agentVersion: null,
      currentVersion: INSTRUCTIONS_VERSION,
      message: `Unable to verify instructions version. Current version is ${INSTRUCTIONS_VERSION}. Consider adding INSTRUCTIONS_VERSION to your project instructions.`,
      updateCommand: 'enginehaus instructions desktop',
    };
  }

  // Parse versions for comparison (handle both "2.1" and "2.1.0" formats)
  const agentParts = agentVersion.split('.').map(Number);
  const currentParts = INSTRUCTIONS_VERSION.split('.').map(Number);

  // Compare major.minor
  const agentMajor = agentParts[0] || 0;
  const agentMinor = agentParts[1] || 0;
  const currentMajor = currentParts[0] || 0;
  const currentMinor = currentParts[1] || 0;

  const isOutdated = agentMajor < currentMajor ||
    (agentMajor === currentMajor && agentMinor < currentMinor);

  if (isOutdated) {
    return {
      status: 'outdated',
      agentVersion,
      currentVersion: INSTRUCTIONS_VERSION,
      message: `Your instructions are v${agentVersion}, current is v${INSTRUCTIONS_VERSION} (updated ${INSTRUCTIONS_UPDATED}). Run \`enginehaus instructions desktop\` to get updated instructions.`,
      updateCommand: 'enginehaus instructions desktop',
    };
  }

  return {
    status: 'current',
    agentVersion,
    currentVersion: INSTRUCTIONS_VERSION,
    message: `Instructions are current (v${INSTRUCTIONS_VERSION}).`,
  };
}
