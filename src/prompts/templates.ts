/**
 * Enginehaus Prompt Templates
 *
 * Battle-tested prompt templates for Enginehaus workflow.
 * These templates enforce proper tool usage, decision logging,
 * and quality gate validation.
 *
 * IMPORTANT: These prompts are designed specifically for the Enginehaus
 * multi-agent coordination workflow. They reference MCP tools directly.
 */

export type TemplateCategory =
  | 'start-session'
  | 'continue-task'
  | 'handoff-task'
  | 'complete-task'
  | 'log-decision'
  | 'bug-fix'
  | 'feature-implementation';

export interface PromptTemplate {
  id: TemplateCategory;
  name: string;
  description: string;
  contextRequired: string[];
  qualityChecklist: string[];
  template: string;
}

// Shared workflow expectations that appear in all templates
const WORKFLOW_EXPECTATIONS = `
## Workflow Expectations
**CRITICAL RULES - Follow these during your session:**

1. **NEVER access SQLite directly** - Always use Enginehaus MCP tools:
   - \`start_work\` not \`SELECT * FROM unified_tasks\`
   - \`add_task\` not \`INSERT INTO unified_tasks\`
   - \`complete_task_smart\` not \`UPDATE unified_tasks SET status\`

2. **Log architectural decisions** - Use \`log_decision\` when you:
   - Choose between approaches
   - Make a tradeoff
   - Select a dependency
   - Design an API

3. **Validate quality gates before completing** - Run these commands:
   - \`npm test\` - All tests pass
   - \`npm run build\` - No TypeScript errors
   - \`npm run lint\` (if available) - No linting errors

`.trim();

export const PROMPT_TEMPLATES: Record<TemplateCategory, PromptTemplate> = {
  'start-session': {
    id: 'start-session',
    name: 'Start Session',
    description: 'Begin a new coding session with proper project context and task selection',
    contextRequired: [
      'Project slug or ID',
      'Optional: specific task to work on',
    ],
    qualityChecklist: [
      'Active project is set',
      'Task is claimed and in-progress',
      'Git branch created for the task',
      'Workflow expectations understood',
    ],
    template: `I'm starting a new coding session.

## Setup Steps
1. First, set the active project:
   \`\`\`
   set_active_project({ slug: "{{PROJECT_SLUG}}" })
   \`\`\`

2. Get context on project health:
   \`\`\`
   get_briefing()
   \`\`\`

3. Get the next available task (auto-claims and returns full context):
   \`\`\`
   start_work()  // Claims task and returns full context
   \`\`\`

4. Review the task details:
   - Read the task description carefully
   - Check strategicContext and technicalContext
   - Identify files that will be affected

${WORKFLOW_EXPECTATIONS}

## Starting Work
Once you have a task:
1. Read all files listed in the task's \`files\` array
2. Understand existing patterns in the codebase
3. Plan your implementation approach
4. If you make any architectural choices, log them with \`log_decision\`
5. Make incremental changes, testing as you go
6. Complete with \`complete_task_smart\` when finished`,
  },

  'continue-task': {
    id: 'continue-task',
    name: 'Continue Task',
    description: 'Pick up an in-progress task from a previous session or handoff',
    contextRequired: [
      'Task ID or partial ID',
      'Previous session context (if available)',
    ],
    qualityChecklist: [
      'Previous progress understood',
      'Uncommitted changes reviewed',
      'Session heartbeat active',
      'Ready to continue from where we left off',
    ],
    template: `I'm continuing work on an existing task.

## Recovery Steps
1. Get full task context:
   \`\`\`
   get_task({ taskId: "{{TASK_ID}}", includeContext: true })
   \`\`\`

2. Check for any handoff notes from previous session:
   \`\`\`
   Use MCP tool: continue_session with taskId "{{TASK_ID}}"
   \`\`\`

3. Review current git state:
   \`\`\`bash
   git status
   git diff
   git log --oneline -5
   \`\`\`

4. Send a heartbeat to claim the session:
   \`\`\`
   Use MCP tool: session_heartbeat with taskId "{{TASK_ID}}"
   \`\`\`

## Understanding Previous Work
- Read the task's \`implementation.phaseProgress\` to see completed phases
- Check \`implementation.currentPhase\` for where to resume
- Review any decisions logged with \`list_decisions\`
- Look at git commits on this branch for progress

${WORKFLOW_EXPECTATIONS}

## Continuing Work
1. Pick up from the current phase
2. If phase is unclear, run \`get_task_phase\` for status
3. Make changes incrementally
4. Log any new decisions with \`log_decision\`
5. Advance phases with \`advance_phase\` as you complete them
6. Complete with \`complete_task_smart\` when all phases done`,
  },

  'handoff-task': {
    id: 'handoff-task',
    name: 'Handoff Task',
    description: 'Transfer a task to another agent with preserved state and context',
    contextRequired: [
      'Task ID being handed off',
      'Current progress summary',
      'Next steps',
      'Blockers (if any)',
    ],
    qualityChecklist: [
      'Progress clearly documented',
      'Uncommitted changes committed or stashed',
      'Blockers identified and communicated',
      'Handoff context persisted',
    ],
    template: `I need to hand off this task to another agent.

## Before Handoff
1. Commit or stash all current changes:
   \`\`\`bash
   git add -A
   git commit -m "WIP: {{PROGRESS_SUMMARY}}"
   \`\`\`

2. Document current state for the next agent:
   \`\`\`
   Use MCP tool: prepare_handoff with:
   - taskId: "{{TASK_ID}}"
   - progressSummary: "{{PROGRESS_SUMMARY}}"
   - nextSteps: [{{NEXT_STEPS}}]
   - blockers: [{{BLOCKERS}}]
   \`\`\`

3. End your session cleanly:
   \`\`\`
   Use MCP tool: end_session with sessionId "{{SESSION_ID}}"
   \`\`\`

## What Gets Preserved
The handoff captures:
- Current phase progress
- Uncommitted file changes (if any)
- What you were working on
- What needs to happen next
- Any blockers or concerns

## For the Next Agent
The receiving agent should use:
\`\`\`
Use MCP tool: continue_session with taskId "{{TASK_ID}}"
\`\`\`

This will provide them with:
- Full task context
- Your handoff notes
- Decisions made so far
- Current branch and commit state

${WORKFLOW_EXPECTATIONS}`,
  },

  'complete-task': {
    id: 'complete-task',
    name: 'Complete Task',
    description: 'Validate quality gates and close out a task properly',
    contextRequired: [
      'Task ID to complete',
      'Completion summary',
      'Quality validation results',
    ],
    qualityChecklist: [
      'All tests pass',
      'Build succeeds',
      'No linting errors',
      'Decisions were logged',
      'Changes committed with descriptive message',
    ],
    template: `I'm ready to complete this task.

## Pre-Completion Checklist
Before calling \`complete_task_smart\`, verify:

### 1. Quality Gates
\`\`\`bash
# Run tests
npm test

# Build to check for TypeScript errors
npm run build

# Run linter if available
npm run lint
\`\`\`

### 2. Decision Logging
Check that you logged important decisions:
\`\`\`
Use MCP tool: list_decisions with taskId "{{TASK_ID}}"
\`\`\`

If you made architectural choices but didn't log them, do it now:
\`\`\`
Use MCP tool: log_decision with:
- decision: "What you decided"
- rationale: "Why you chose this approach"
- category: "architecture" | "tradeoff" | "dependency" | "pattern"
\`\`\`

### 3. Git State
\`\`\`bash
# Ensure all changes are committed
git status

# Review your commits
git log --oneline -5
\`\`\`

## Completing the Task
\`\`\`
Use MCP tool: complete_task_smart with:
- taskId: "{{TASK_ID}}"
- summary: "{{COMPLETION_SUMMARY}}"
- qualityEvidence: {
    testsPass: true,
    buildSucceeds: true,
    lintClean: true
  }
\`\`\`

## What Happens
\`complete_task_smart\` will:
1. Check for workflow gaps (missing decisions, quality evidence)
2. Return warnings if anything looks incomplete
3. Mark the task as completed
4. End the active session
5. Track completion in the audit log

${WORKFLOW_EXPECTATIONS}`,
  },

  'log-decision': {
    id: 'log-decision',
    name: 'Log Decision',
    description: 'Capture an architectural or design decision with context',
    contextRequired: [
      'What was decided',
      'Why this approach was chosen',
      'What alternatives were considered',
    ],
    qualityChecklist: [
      'Decision is clearly stated',
      'Rationale explains the "why"',
      'Alternatives documented',
      'Impact understood',
    ],
    template: `I need to log an important decision.

## When to Log Decisions
Log a decision whenever you:
- Choose between multiple valid approaches
- Make a tradeoff (performance vs. readability, etc.)
- Select a library or dependency
- Design an API or data structure
- Deviate from existing patterns
- Make assumptions about requirements

## Decision Details
**Decision**: {{DECISION}}
**Category**: {{CATEGORY}} (architecture | tradeoff | dependency | pattern | other)
**Rationale**: {{RATIONALE}}
**Alternatives Considered**: {{ALTERNATIVES}}
**Impact**: {{IMPACT}}

## Logging the Decision
\`\`\`
Use MCP tool: log_decision with:
- decision: "{{DECISION}}"
- rationale: "{{RATIONALE}}"
- impact: "{{IMPACT}}"
- category: "{{CATEGORY}}"
- taskId: "{{TASK_ID}}" (optional, links to current task)
\`\`\`

## Examples of Good Decisions to Log

### Architecture
"Using repository pattern for data access to enable future database migration"

### Tradeoff
"Chose SQLite over PostgreSQL for simplicity, accepting single-writer limitation"

### Dependency
"Selected zod for validation over joi due to better TypeScript inference"

### Pattern
"Using factory functions instead of classes for stateless utilities"

## Why This Matters
- Future agents can understand past choices
- Prevents re-litigating settled decisions
- Creates institutional knowledge
- Supports audit and compliance requirements

${WORKFLOW_EXPECTATIONS}`,
  },

  'bug-fix': {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: 'Investigate and fix a bug using Enginehaus workflow',
    contextRequired: [
      'Bug description',
      'Reproduction steps',
      'Expected vs actual behavior',
    ],
    qualityChecklist: [
      'Root cause identified',
      'Fix addresses root cause (not symptoms)',
      'Regression test added',
      'Similar patterns checked',
      'Decisions logged if applicable',
    ],
    template: `I need to fix a bug.

## Step 1: Find or Create a Task
First, check if a task exists for this bug:
\`\`\`
list_tasks({ status: "ready" })
\`\`\`

If no task exists, create one:
\`\`\`
Use MCP tool: add_task with:
- title: "Fix: {{BUG_TITLE}}"
- description: "{{BUG_DESCRIPTION}}"
- priority: "{{PRIORITY}}"
- files: [affected files]
\`\`\`

## Step 2: Claim the Task
\`\`\`
Use MCP tool: get_next_task with sessionId "{{SESSION_ID}}"
(or claim specific task with claim_task)
\`\`\`

## Step 3: Investigate
1. **Understand the bug**:
   - What is the expected behavior?
   - What is the actual behavior?
   - When did it start happening?

2. **Reproduce the issue**:
   - Follow the reproduction steps
   - Verify you can see the problem

3. **Find the root cause**:
   - Read the affected code
   - Add logging if needed
   - Trace the data flow

## Bug Details
**Description**: {{BUG_DESCRIPTION}}
**Reproduction**: {{REPRODUCTION_STEPS}}
**Expected**: {{EXPECTED_BEHAVIOR}}
**Actual**: {{ACTUAL_BEHAVIOR}}

## Step 4: Fix and Verify
1. Make the minimal fix that addresses the root cause
2. Add a test that would catch this bug
3. Run all tests: \`npm test\`
4. Build to check types: \`npm run build\`

## Step 5: Log Decision (if applicable)
If you chose between fix approaches:
\`\`\`
Use MCP tool: log_decision with:
- decision: "Fix approach for {{BUG_TITLE}}"
- rationale: "Why this fix was chosen"
- category: "tradeoff"
\`\`\`

## Step 6: Complete the Task
\`\`\`
Use MCP tool: complete_task_smart with:
- taskId: "{{TASK_ID}}"
- summary: "Fixed: {{BUG_TITLE}}. Root cause was..."
- qualityEvidence: { testsPass: true, buildSucceeds: true }
\`\`\`

${WORKFLOW_EXPECTATIONS}`,
  },

  'feature-implementation': {
    id: 'feature-implementation',
    name: 'Feature Implementation',
    description: 'Implement a new feature using the full Enginehaus workflow',
    contextRequired: [
      'Feature description',
      'Requirements',
      'Technical constraints',
      'Files to modify',
    ],
    qualityChecklist: [
      'Task exists and is claimed',
      'Phases tracked with advance_phase',
      'Decisions logged for design choices',
      'Tests written for new functionality',
      'Quality gates validated',
    ],
    template: `I need to implement a new feature.

## Step 1: Get or Create a Task
Check if a task exists:
\`\`\`
list_tasks({ status: "ready" })
\`\`\`

If no task exists, create one:
\`\`\`
Use MCP tool: add_task with:
- title: "{{FEATURE_TITLE}}"
- description: "{{FEATURE_DESCRIPTION}}"
- priority: "{{PRIORITY}}"
- files: [files to modify]
- strategicContext: { businessRationale: "Why this feature" }
- technicalContext: { architecture: "How it fits" }
\`\`\`

## Step 2: Claim and Initialize Phases
\`\`\`
Use MCP tool: get_next_task with sessionId "{{SESSION_ID}}"
Use MCP tool: advance_phase with taskId "{{TASK_ID}}"
\`\`\`

## Feature Details
**Title**: {{FEATURE_TITLE}}
**Description**: {{FEATURE_DESCRIPTION}}
**Requirements**: {{REQUIREMENTS}}
**Constraints**: {{CONSTRAINTS}}
**Files**: {{FILES}}

## Step 3: Work Through Phases

### Phase 1: Context & Planning
- Read existing code in affected files
- Understand current patterns
- Plan the implementation
\`\`\`
Use MCP tool: advance_phase with taskId "{{TASK_ID}}"
\`\`\`

### Phase 2: Architecture (if complex)
- Design the solution
- Log design decisions
\`\`\`
Use MCP tool: log_decision with:
- decision: "Design approach for {{FEATURE_TITLE}}"
- rationale: "Why this design"
- category: "architecture"

Use MCP tool: advance_phase with taskId "{{TASK_ID}}"
\`\`\`

### Phase 3: Core Implementation
- Write the main functionality
- Keep changes minimal and focused
\`\`\`
Use MCP tool: advance_phase with taskId "{{TASK_ID}}"
\`\`\`

### Phase 4: Integration
- Wire up the new code
- Update imports/exports
\`\`\`
Use MCP tool: advance_phase with taskId "{{TASK_ID}}"
\`\`\`

### Phase 5: Testing
- Add unit tests
- Add integration tests if needed
\`\`\`bash
npm test
\`\`\`
\`\`\`
Use MCP tool: advance_phase with taskId "{{TASK_ID}}"
\`\`\`

### Phase 6: Documentation (if needed)
- Update README or docs
- Add JSDoc comments
\`\`\`
Use MCP tool: advance_phase with taskId "{{TASK_ID}}"
\`\`\`

### Phase 7: Review
- Run all quality checks
- Review your own changes
\`\`\`bash
npm test
npm run build
\`\`\`

### Phase 8: Complete
\`\`\`
Use MCP tool: complete_task_smart with:
- taskId: "{{TASK_ID}}"
- summary: "Implemented {{FEATURE_TITLE}}"
- qualityEvidence: { testsPass: true, buildSucceeds: true }
\`\`\`

${WORKFLOW_EXPECTATIONS}`,
  },
};

/**
 * Get all available templates
 */
export function listTemplates(): PromptTemplate[] {
  return Object.values(PROMPT_TEMPLATES);
}

/**
 * Get a specific template by ID
 */
export function getTemplate(id: TemplateCategory): PromptTemplate | undefined {
  return PROMPT_TEMPLATES[id];
}

/**
 * Fill a template with provided values
 */
export function fillTemplate(
  id: TemplateCategory,
  values: Record<string, string>
): string | undefined {
  const template = PROMPT_TEMPLATES[id];
  if (!template) return undefined;

  let filled = template.template;
  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{{${key.toUpperCase()}}}`;
    filled = filled.replace(new RegExp(placeholder, 'g'), value);
  }

  return filled;
}

/**
 * Get template categories grouped by workflow stage
 */
export function getTemplatesByType(): Record<string, TemplateCategory[]> {
  return {
    'Session Management': ['start-session', 'continue-task', 'handoff-task', 'complete-task'],
    'Development': ['feature-implementation', 'bug-fix'],
    'Documentation': ['log-decision'],
  };
}

/**
 * Get the shared workflow expectations that all agents should follow
 */
export function getWorkflowExpectations(): string {
  return WORKFLOW_EXPECTATIONS;
}
