/**
 * Tool Registration Index
 *
 * Imports all domain tool files to trigger self-registration.
 * Order matters: it determines the listing order in ListTools.
 *
 * The order below matches the original schema listing in index.ts:
 * workflowSchemas (PRIMARY), productRoleSchemas, taskSchemas,
 * coordinationSchemas, gitSchemas, validationSchemas, wheelhausSchemas,
 * projectSchemas, sessionSchemas, dependencySchemas, phaseSchemas,
 * checkpointSchemas, consolidated tools, fileLockSchemas, qualitySchemas,
 * metricsSchemas, outcomeSchemas, initiativeSchemas, agentSchemas,
 * contributionSchemas, dispatchSchemas, decisionSchemas, artifactSchemas,
 * promptSchemas, telemetrySchemas.
 */

import './meta-tools.js'; // discover_tools — tool orientation
import './workflow-tools.js';
import './workflow-config-tools.js';
import './product-role-tools.js';
import './task-tools.js';
import './coordination-tools.js';
import './git-tools.js';
import './validation-tools.js';
import './wheelhaus-tools.js';
import './project-tools.js';
import './session-tools.js';
import './artifact-tools.js'; // includes dependency tools
import './phase-tools.js';
import './checkpoint-tools.js';
import './consolidated-tools.js'; // audit, suggest, quality, visualize
import './file-lock-tools.js';
import './quality-tools.js';
import './metrics-tools.js';
import './outcome-tools.js';
import './initiative-tools.js';
import './agent-tools.js';
import './contribution-tools.js';
import './dispatch-tools.js';
import './decision-tools.js';
import './thought-tools.js';
import './prompt-tools.js';
import './telemetry-tools.js';
