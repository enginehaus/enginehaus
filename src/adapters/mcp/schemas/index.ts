/**
 * MCP Schema Index
 *
 * Re-exports all schema definitions for MCP tools.
 */

export * from './git-schemas.js';
export * from './decision-schemas.js';
export * from './phase-schemas.js';
export * from './checkpoint-schemas.js';
export * from './file-lock-schemas.js';
export * from './quality-schemas.js';
export * from './metrics-schemas.js';
export * from './outcome-schemas.js';
export * from './initiative-schemas.js';
export * from './task-schemas.js';
export * from './session-schemas.js';
export * from './coordination-schemas.js';
export * from './artifact-schemas.js';
export * from './dependency-schemas.js';
export * from './project-schemas.js';
export * from './prompt-schemas.js';
export * from './telemetry-schemas.js';
export * from './product-role-schemas.js';
export * from './validation-schemas.js';
export * from './wheelhaus-schemas.js';

// Combined array of all schemas for convenience
import { gitSchemas } from './git-schemas.js';
import { decisionSchemas } from './decision-schemas.js';
import { phaseSchemas } from './phase-schemas.js';
import { checkpointSchemas } from './checkpoint-schemas.js';
import { fileLockSchemas } from './file-lock-schemas.js';
import { qualitySchemas } from './quality-schemas.js';
import { metricsSchemas } from './metrics-schemas.js';
import { outcomeSchemas } from './outcome-schemas.js';
import { initiativeSchemas } from './initiative-schemas.js';
import { taskSchemas } from './task-schemas.js';
import { sessionSchemas } from './session-schemas.js';
import { coordinationSchemas } from './coordination-schemas.js';
import { artifactSchemas } from './artifact-schemas.js';
import { dependencySchemas } from './dependency-schemas.js';
import { projectSchemas } from './project-schemas.js';
import { promptSchemas } from './prompt-schemas.js';
import { telemetrySchemas } from './telemetry-schemas.js';
import { productRoleSchemas } from './product-role-schemas.js';
import { validationSchemas } from './validation-schemas.js';
import { wheelhausSchemas } from './wheelhaus-schemas.js';

export const allSchemas = [
  ...gitSchemas,
  ...decisionSchemas,
  ...phaseSchemas,
  ...checkpointSchemas,
  ...fileLockSchemas,
  ...qualitySchemas,
  ...metricsSchemas,
  ...outcomeSchemas,
  ...initiativeSchemas,
  ...taskSchemas,
  ...sessionSchemas,
  ...coordinationSchemas,
  ...artifactSchemas,
  ...dependencySchemas,
  ...projectSchemas,
  ...promptSchemas,
  ...telemetrySchemas,
  ...productRoleSchemas,
  ...validationSchemas,
  ...wheelhausSchemas,
];
