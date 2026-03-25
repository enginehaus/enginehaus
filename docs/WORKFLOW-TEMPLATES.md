# Enginehaus Prompt Templates

Battle-tested prompt templates for the Enginehaus multi-agent coordination workflow. Each template enforces proper tool usage, decision logging, and quality gate validation.

**IMPORTANT**: These prompts are designed specifically for Enginehaus. They reference MCP tools directly and enforce the coordination workflow.

---

## Table of Contents

1. [Start Session](#start-session) - Begin a new coding session
2. [Continue Task](#continue-task) - Pick up in-progress work
3. [Handoff Task](#handoff-task) - Transfer to another agent
4. [Complete Task](#complete-task) - Validate and close out
5. [Log Decision](#log-decision) - Capture architectural choices
6. [Bug Fix](#bug-fix) - Investigate and fix issues
7. [Feature Implementation](#feature-implementation) - Build new functionality

---

## Workflow Expectations

**CRITICAL RULES - Follow these during every session:**

1. **NEVER access SQLite directly** - Always use Enginehaus MCP tools:
   - `get_next_task` not `SELECT * FROM unified_tasks`
   - `add_task` not `INSERT INTO unified_tasks`
   - `complete_task_smart` not `UPDATE unified_tasks SET status`

2. **Log architectural decisions** - Use `log_decision` when you:
   - Choose between approaches
   - Make a tradeoff
   - Select a dependency
   - Design an API

3. **Validate quality gates before completing** - Run these commands:
   - `npm test` - All tests pass
   - `npm run build` - No TypeScript errors
   - `npm run lint` (if available) - No linting errors

4. **Use CLI for quick operations**:
   - `enginehaus task list` - See pending tasks
   - `enginehaus status` - Project health check
   - `enginehaus task show <id>` - Full task details

---

## Start Session

Begin a new coding session with proper project context and task selection.

### Context Required
- Project slug or ID
- Optional: specific task to work on

### Prompt Template

```
I'm starting a new coding session.

## Setup Steps
1. First, set the active project:
   ```
   Use MCP tool: set_active_project with slug "[PROJECT_SLUG]"
   Or CLI: enginehaus project set [PROJECT_SLUG]
   ```

2. Get context on project health:
   ```
   Use MCP tool: get_project_health
   Or CLI: enginehaus status
   ```

3. Get the next available task (auto-claims and creates branch):
   ```
   Use MCP tool: get_next_task with sessionId "[SESSION_ID]"
   Or CLI: enginehaus task next
   ```

4. Review the task details:
   - Read the task description carefully
   - Check strategicContext and technicalContext
   - Identify files that will be affected

## Starting Work
Once you have a task:
1. Read all files listed in the task's `files` array
2. Understand existing patterns in the codebase
3. Plan your implementation approach
4. If you make any architectural choices, log them with `log_decision`
5. Make incremental changes, testing as you go
6. Complete with `complete_task_smart` when finished
```

### Quality Checklist
- [ ] Active project is set
- [ ] Task is claimed and in-progress
- [ ] Git branch created for the task
- [ ] Workflow expectations understood

---

## Continue Task

Pick up an in-progress task from a previous session or handoff.

### Context Required
- Task ID or partial ID
- Previous session context (if available)

### Prompt Template

```
I'm continuing work on an existing task.

## Recovery Steps
1. Get full task context:
   ```
   Use MCP tool: get_task with taskId "[TASK_ID]" and includeContext true
   Or CLI: enginehaus task show [TASK_ID]
   ```

2. Check for any handoff notes from previous session:
   ```
   Use MCP tool: continue_session with taskId "[TASK_ID]"
   ```

3. Review current git state:
   ```bash
   git status
   git diff
   git log --oneline -5
   ```

4. Send a heartbeat to claim the session:
   ```
   Use MCP tool: session_heartbeat with taskId "[TASK_ID]"
   ```

## Understanding Previous Work
- Read the task's `implementation.phaseProgress` to see completed phases
- Check `implementation.currentPhase` for where to resume
- Review any decisions logged with `list_decisions`
- Look at git commits on this branch for progress

## Continuing Work
1. Pick up from the current phase
2. If phase is unclear, run `get_task_phase` for status
3. Make changes incrementally
4. Log any new decisions with `log_decision`
5. Advance phases with `advance_phase` as you complete them
6. Complete with `complete_task_smart` when all phases done
```

### Quality Checklist
- [ ] Previous progress understood
- [ ] Uncommitted changes reviewed
- [ ] Session heartbeat active
- [ ] Ready to continue from where we left off

---

## Handoff Task

Transfer a task to another agent with preserved state and context.

### Context Required
- Task ID being handed off
- Current progress summary
- Next steps
- Blockers (if any)

### Prompt Template

```
I need to hand off this task to another agent.

## Before Handoff
1. Commit or stash all current changes:
   ```bash
   git add -A
   git commit -m "WIP: [PROGRESS_SUMMARY]"
   ```

2. Document current state for the next agent:
   ```
   Use MCP tool: prepare_handoff with:
   - taskId: "[TASK_ID]"
   - progressSummary: "[PROGRESS_SUMMARY]"
   - nextSteps: ["step1", "step2"]
   - blockers: ["blocker1"] (if any)
   ```

3. End your session cleanly:
   ```
   Use MCP tool: end_session with sessionId "[SESSION_ID]"
   ```

## What Gets Preserved
The handoff captures:
- Current phase progress
- Uncommitted file changes (if any)
- What you were working on
- What needs to happen next
- Any blockers or concerns

## For the Next Agent
The receiving agent should use:
```
Use MCP tool: continue_session with taskId "[TASK_ID]"
```

This will provide them with:
- Full task context
- Your handoff notes
- Decisions made so far
- Current branch and commit state
```

### Quality Checklist
- [ ] Progress clearly documented
- [ ] Uncommitted changes committed or stashed
- [ ] Blockers identified and communicated
- [ ] Handoff context persisted

---

## Complete Task

Validate quality gates and close out a task properly.

### Context Required
- Task ID to complete
- Completion summary
- Quality validation results

### Prompt Template

```
I'm ready to complete this task.

## Pre-Completion Checklist
Before calling `complete_task_smart`, verify:

### 1. Quality Gates
```bash
# Run tests
npm test

# Build to check for TypeScript errors
npm run build

# Run linter if available
npm run lint
```

### 2. Decision Logging
Check that you logged important decisions:
```
Use MCP tool: list_decisions with taskId "[TASK_ID]"
```

If you made architectural choices but didn't log them, do it now:
```
Use MCP tool: log_decision with:
- decision: "What you decided"
- rationale: "Why you chose this approach"
- category: "architecture" | "tradeoff" | "dependency" | "pattern"
```

### 3. Git State
```bash
# Ensure all changes are committed
git status

# Review your commits
git log --oneline -5
```

## Completing the Task
```
Use MCP tool: complete_task_smart with:
- taskId: "[TASK_ID]"
- summary: "[COMPLETION_SUMMARY]"
- qualityEvidence: {
    testsPass: true,
    buildSucceeds: true,
    lintClean: true
  }
```

## What Happens
`complete_task_smart` will:
1. Check for workflow gaps (missing decisions, quality evidence)
2. Return warnings if anything looks incomplete
3. Mark the task as completed
4. End the active session
5. Track completion in the audit log
```

### Quality Checklist
- [ ] All tests pass
- [ ] Build succeeds
- [ ] No linting errors
- [ ] Decisions were logged
- [ ] Changes committed with descriptive message

---

## Log Decision

Capture an architectural or design decision with context.

### Context Required
- What was decided
- Why this approach was chosen
- What alternatives were considered

### When to Log Decisions

Log a decision whenever you:
- Choose between multiple valid approaches
- Make a tradeoff (performance vs. readability, etc.)
- Select a library or dependency
- Design an API or data structure
- Deviate from existing patterns
- Make assumptions about requirements

### Prompt Template

```
I need to log an important decision.

## Decision Details
**Decision**: [What you decided]
**Category**: [architecture | tradeoff | dependency | pattern | other]
**Rationale**: [Why you chose this approach]
**Alternatives Considered**: [What else you considered]
**Impact**: [How this affects the codebase]

## Logging the Decision
```
Use MCP tool: log_decision with:
- decision: "[DECISION]"
- rationale: "[RATIONALE]"
- impact: "[IMPACT]"
- category: "[CATEGORY]"
- taskId: "[TASK_ID]" (optional, links to current task)
```
```

### Examples of Good Decisions to Log

#### Architecture
"Using repository pattern for data access to enable future database migration"

#### Tradeoff
"Chose SQLite over PostgreSQL for simplicity, accepting single-writer limitation"

#### Dependency
"Selected zod for validation over joi due to better TypeScript inference"

#### Pattern
"Using factory functions instead of classes for stateless utilities"

### Why This Matters
- Future agents can understand past choices
- Prevents re-litigating settled decisions
- Creates institutional knowledge
- Supports audit and compliance requirements

### Quality Checklist
- [ ] Decision is clearly stated
- [ ] Rationale explains the "why"
- [ ] Alternatives documented
- [ ] Impact understood

---

## Bug Fix

Investigate and fix a bug using Enginehaus workflow.

### Context Required
- Bug description
- Reproduction steps
- Expected vs actual behavior

### Prompt Template

```
I need to fix a bug.

## Step 1: Find or Create a Task
First, check if a task exists for this bug:
```
Use MCP tool: list_tasks with status "ready" or "in-progress"
Or CLI: enginehaus task list
```

If no task exists, create one:
```
Use MCP tool: add_task with:
- title: "Fix: [BUG_TITLE]"
- description: "[BUG_DESCRIPTION]"
- priority: "[PRIORITY]"
- files: [affected files]
```

## Step 2: Claim the Task
```
Use MCP tool: get_next_task with sessionId "[SESSION_ID]"
(or claim specific task with claim_task)
```

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
**Description**: [BUG_DESCRIPTION]
**Reproduction**: [REPRODUCTION_STEPS]
**Expected**: [EXPECTED_BEHAVIOR]
**Actual**: [ACTUAL_BEHAVIOR]

## Step 4: Fix and Verify
1. Make the minimal fix that addresses the root cause
2. Add a test that would catch this bug
3. Run all tests: `npm test`
4. Build to check types: `npm run build`

## Step 5: Log Decision (if applicable)
If you chose between fix approaches:
```
Use MCP tool: log_decision with:
- decision: "Fix approach for [BUG_TITLE]"
- rationale: "Why this fix was chosen"
- category: "tradeoff"
```

## Step 6: Complete the Task
```
Use MCP tool: complete_task_smart with:
- taskId: "[TASK_ID]"
- summary: "Fixed: [BUG_TITLE]. Root cause was..."
- qualityEvidence: { testsPass: true, buildSucceeds: true }
```
```

### Quality Checklist
- [ ] Root cause identified
- [ ] Fix addresses root cause (not symptoms)
- [ ] Regression test added
- [ ] Similar patterns checked
- [ ] Decisions logged if applicable

---

## Feature Implementation

Implement a new feature using the full Enginehaus workflow.

### Context Required
- Feature description
- Requirements
- Technical constraints
- Files to modify

### Prompt Template

```
I need to implement a new feature.

## Step 1: Get or Create a Task
Check if a task exists:
```
Use MCP tool: list_tasks with status "ready"
Or CLI: enginehaus task list
```

If no task exists, create one:
```
Use MCP tool: add_task with:
- title: "[FEATURE_TITLE]"
- description: "[FEATURE_DESCRIPTION]"
- priority: "[PRIORITY]"
- files: [files to modify]
- strategicContext: { businessRationale: "Why this feature" }
- technicalContext: { architecture: "How it fits" }
```

## Step 2: Claim and Initialize Phases
```
Use MCP tool: start_work with sessionId "[SESSION_ID]"
Use MCP tool: advance_phase with taskId "[TASK_ID]"
```

## Feature Details
**Title**: [FEATURE_TITLE]
**Description**: [FEATURE_DESCRIPTION]
**Requirements**: [REQUIREMENTS]
**Constraints**: [CONSTRAINTS]
**Files**: [FILES]

## Step 3: Work Through Phases

### Phase 1: Context & Planning
- Read existing code in affected files
- Understand current patterns
- Plan the implementation
```
Use MCP tool: advance_phase with taskId "[TASK_ID]"
```

### Phase 2: Architecture (if complex)
- Design the solution
- Log design decisions
```
Use MCP tool: log_decision with:
- decision: "Design approach for [FEATURE_TITLE]"
- rationale: "Why this design"
- category: "architecture"

Use MCP tool: advance_phase with taskId "[TASK_ID]"
```

### Phase 3: Core Implementation
- Write the main functionality
- Keep changes minimal and focused
```
Use MCP tool: advance_phase with taskId "[TASK_ID]"
```

### Phase 4: Integration
- Wire up the new code
- Update imports/exports
```
Use MCP tool: advance_phase with taskId "[TASK_ID]"
```

### Phase 5: Testing
- Add unit tests
- Add integration tests if needed
```bash
npm test
```
```
Use MCP tool: advance_phase with taskId "[TASK_ID]"
```

### Phase 6: Documentation (if needed)
- Update README or docs
- Add JSDoc comments
```
Use MCP tool: advance_phase with taskId "[TASK_ID]"
```

### Phase 7: Review
- Run all quality checks
- Review your own changes
```bash
npm test
npm run build
```

### Phase 8: Complete
```
Use MCP tool: complete_task_smart with:
- taskId: "[TASK_ID]"
- summary: "Implemented [FEATURE_TITLE]"
- qualityEvidence: { testsPass: true, buildSucceeds: true }
```
```

### Quality Checklist
- [ ] Task exists and is claimed
- [ ] Phases tracked with advance_phase
- [ ] Decisions logged for design choices
- [ ] Tests written for new functionality
- [ ] Quality gates validated

---

## Using These Templates

### Via MCP Tools

```
# List all available templates
Use MCP tool: list_prompts

# Get a specific template
Use MCP tool: get_prompt with templateId "start-session"

# Get template with auto-filled task context
Use MCP tool: get_prompt with templateId "continue-task" and taskId "[TASK_ID]"
```

### Via CLI

```bash
# View project status
enginehaus status

# List tasks
enginehaus task list

# Get task details
enginehaus task show [TASK_ID]

# Run health check
enginehaus health
```

### Best Practices

1. **Always use MCP tools** - Never access SQLite directly
2. **Log decisions early** - Don't wait until task completion
3. **Validate quality gates** - Run tests and build before completing
4. **Use phases for complex tasks** - Track progress systematically
5. **Handoff cleanly** - Document state before transferring work

---

## Quick Reference

| Action | MCP Tool | CLI |
|--------|----------|-----|
| Set project | `set_active_project` | `enginehaus project set` |
| Get next task | `get_next_task` | `enginehaus task next` |
| List tasks | `list_tasks` | `enginehaus task list` |
| Show task | `get_task` | `enginehaus task show` |
| Log decision | `log_decision` | - |
| Complete task | `complete_task_smart` | `enginehaus task complete` |
| Project health | `get_project_health` | `enginehaus status` |
| Advance phase | `advance_phase` | - |

---

*These templates are based on actual dogfooding patterns from Enginehaus development.*
