<!-- INSTRUCTIONS_VERSION: 2.2 -->
<!-- Last updated: 2026-03-07 -->

# Claude Code Guidelines for Enginehaus

> Instructions Version: 2.2

## Quick Reference (TL;DR)

**Every session — structurally enforced (edits blocked without claimed task):**
```bash
# 1. CLAIM your task (briefing runs automatically via SessionStart hook)
enginehaus task claim <id>      # Claim specific task
enginehaus task next            # Or claim highest priority

# 2. BRANCH from main
git checkout -b feature/<task-id-prefix>-<short-description>

# 3. LOG DECISIONS as you work
enginehaus decision log "Why X over Y" -r "rationale" -c architecture

# 4. TEST before committing
npm test

# 5. COMMIT and PUSH
git add <files> && git commit -m "..." && git push -u origin <branch>

# 6. COMPLETE the task
enginehaus task complete <id> -s "Summary of what was done"
```

> **Enforcement:** A `PreToolUse` hook blocks `Edit`/`Write` calls if no task is claimed.
> `completeTaskSmart` blocks completion if changes are uncommitted or unpushed.

**Common commands:**
```bash
enginehaus task list            # See all tasks
enginehaus task show <id>       # Task details
enginehaus task release <id>    # Unclaim without completing
enginehaus metrics --by-agent   # See your stats
enginehaus decision list        # Recent decisions
```

**Categories for decisions:** `architecture`, `tradeoff`, `dependency`, `pattern`, `other`

---

This document provides rules and best practices for AI agents working with this codebase.

## Critical Rules

### 1. NEVER Access SQLite Directly

**You MUST use Enginehaus MCP tools for ALL coordination operations.** Do not:

- Run `sqlite3` commands directly
- Read/write the `~/.enginehaus/data/enginehaus.db` file
- Use any bash commands that interact with the database
- Bypass MCP tools to "quickly" check or modify data

**Why this matters:**
- Direct SQLite access loses the audit trail
- Events are not emitted, breaking the coordination system
- Session state becomes inconsistent
- Other agents cannot see your changes via the event system
- Quality gates and validations are skipped

### 2. Use the Right MCP Tool

Instead of direct database access, use these Enginehaus tools:

| Operation | Correct Tool | NOT This |
|-----------|--------------|----------|
| List tasks | `list_tasks` | `sqlite3 ~/.enginehaus/data/enginehaus.db "SELECT * FROM tasks"` |
| Get next task | `get_next_task` | Reading task table directly |
| Complete task | `complete_task` | `UPDATE tasks SET status='completed'` |
| Add task | `add_task` | Direct INSERT statement |
| Check status | `get_briefing` | Reading session/task tables |
| List projects | `list_projects` | `SELECT * FROM projects` |
| Get stats | `get_stats` | Counting rows manually |

### 3. Always Use CLI for Quick Operations

The Enginehaus CLI provides the same functionality with proper coordination:

```bash
# Task management
enginehaus task list              # List all tasks
enginehaus task next              # Get next priority task
enginehaus task show <id>         # Show task details
enginehaus task add -t "Title" -p high  # Add a task
enginehaus task complete <id> -s "Summary"  # Complete with git analysis

# Project management
enginehaus project list           # List projects
enginehaus project active         # Show active project
enginehaus status                 # Current working context
enginehaus stats                  # Coordination statistics
```

## Workflow Guidelines

### The Core Loop: Task → Phases → Decisions → Complete

Every implementation session should follow this pattern:

1. **Start**: `get_next_task` - Claims task and returns full context
2. **Work in phases**: Use `advance_phase` after completing each phase of work
3. **Log decisions**: `log_decision` - Record every architectural choice, tradeoff, or design decision
4. **End**: `complete_task_smart` - Auto-generates docs from your git history

### Phase-Based Workflow

For non-trivial tasks, work through phases to maintain structure and create audit trails.

**The 8 Default Phases:**
1. **Context & Planning** - Understand requirements, gather context
2. **Architecture** - Design solution, make technical decisions
3. **Core Implementation** - Build primary functionality
4. **Integration** - Connect components, wire up dependencies
5. **Testing** - Add tests, verify behavior
6. **Documentation** - Update docs, add comments
7. **Review** - Self-review, address issues
8. **Deployment** - Final checks, merge preparation

**Using phases:**

```javascript
// After completing Phase 1 (Context & Planning):
advance_phase({
  taskId: "abc123",
  commitSha: "a1b2c3d",  // Must commit before advancing
  note: "Gathered requirements from task description and reviewed related code"
})

// Skip optional phases (like Documentation for a bug fix):
skip_phase({
  taskId: "abc123",
  reason: "Bug fix doesn't require documentation changes"
})

// Check current phase:
get_task_phase({ taskId: "abc123" })
```

**When to use phases:**
- Complex features (3+ files changed)
- Tasks taking more than one session
- Work you want other agents to be able to pick up

**When to skip phases:**
- Quick bug fixes (1-2 lines)
- Trivial changes
- Use `skip_phase` to document why you're skipping

### Starting a Task

```bash
# BEST: Use MCP tool - claims task AND gets full context
get_next_task()

# Alternative: CLI for quick view
enginehaus task next
```

**Important:** `get_next_task` automatically claims the task for your session. You don't need to call `claim_task` separately.

### During Implementation: Log Decisions

This is the most important habit for behavioral reliability. Every time you:
- Choose between two approaches
- Make an architectural tradeoff
- Select a dependency or pattern
- Decide NOT to do something

**Log it:**

```javascript
log_decision({
  decision: "Use SQLite over PostgreSQL",
  rationale: "Simpler deployment, sufficient for single-user coordination",
  category: "architecture"  // or: tradeoff, dependency, pattern
})
```

**Why this matters:** Decisions logged during implementation appear in the completion docs and help future agents understand WHY, not just what.

### Completing a Task

```javascript
// RECOMMENDED: Auto-generates docs from git history
complete_task_smart({
  taskId: "abc123",
  summary: "Implemented feature X with full test coverage"
})

// To bypass quality enforcement (not recommended)
complete_task_smart({
  taskId: "abc123",
  summary: "Quick fix that doesn't need tests",
  enforceQuality: false  // Bypass quality checks
})

// Only use complete_task when you need manual control over docs
```

**Note:** `complete_task_smart` will flag if no decisions were logged during implementation.

### Quality Enforcement

`complete_task_smart` supports structural quality enforcement:

- **`enforceQuality: true` (default)**: Blocking mode - returns error if quality gaps detected
- **`enforceQuality: false`**: Bypass mode - warns about quality gaps but completes the task anyway

**Always-enforced (cannot be bypassed with `enforceQuality: false`):**
- **Uncommitted changes block**: If your working tree has uncommitted changes, `complete_task_smart` will reject the completion. Commit all changes before completing. This is the first check that runs, regardless of any quality settings. To disable, set `requireCommitOnCompletion: false` in project config.
- **Unpushed commits block**: If your branch has a remote tracking branch with unpushed commits, `complete_task_smart` will reject the completion. Push your work before completing. If no remote is configured for the branch, this check is skipped. To disable, set `requirePushOnCompletion: false` in project config.

**Quality gaps that can block completion (when `enforceQuality: true`):**
1. No decisions logged during implementation
2. No test files or test-related commits detected

**Project-level bypass:**
Set `quality.enforceOnCompletion: false` in project config to disable quality enforcement for all completions:

```json
{
  "quality": {
    "enforceOnCompletion": false
  }
}
```

The `enforceQuality` parameter overrides the project config when explicitly set.

### Discovering Out-of-Scope Work

When you find work that's outside your current task:

```javascript
// DON'T silently do extra work
// DO add it as a new task
add_task({
  title: "Refactor auth module for consistency",
  description: "Discovered during feature X implementation",
  priority: "medium"
})
```

### Linking Work to Goals (Initiatives)

For multi-task efforts with measurable outcomes:

```javascript
// Before starting related work
create_initiative({
  title: "Reduce API latency by 50%",
  successCriteria: "P95 latency under 100ms"
})

// When completing tasks that contribute
link_task_to_initiative({
  taskId: "abc123",
  initiativeId: "init-xyz",
  contributionNotes: "Optimized database queries"
})

// When the goal is achieved (or abandoned)
record_initiative_outcome({
  initiativeId: "init-xyz",
  status: "succeeded",
  outcomeNotes: "P95 now at 85ms, 57% improvement"
})
```

## Tool Selection Guide

### Task Lifecycle Tools

| When to use | Tool | Notes |
|-------------|------|-------|
| Start work on next priority task | `get_next_task` | **Primary entry point** - claims & returns context |
| Start work on a specific task | `claim_task` | When you know which task, not recommended normally |
| Complete a phase of work | `advance_phase` | **Use after each phase** - requires commit SHA |
| Skip an optional phase | `skip_phase` | When a phase doesn't apply (e.g., docs for bug fix) |
| Check current phase | `get_task_phase` | See phase progress |
| Complete a task | `complete_task_smart` | **Recommended** - auto-generates docs |
| Complete with manual docs | `complete_task` | Only when you need explicit control |
| Found out-of-scope work | `add_task` | Don't silently do extra work |
| Passing work to another agent | `get_handoff_context` | Includes decisions and file state |

### Decision & Learning Tools

| When to use | Tool | Notes |
|-------------|------|-------|
| Made an architectural choice | `log_decision` | **Use frequently** - capture the "why" |
| View past decisions | `list_decisions` | Review before similar work |
| Starting a multi-task goal | `create_initiative` | Before related work begins |
| Task contributes to a goal | `link_task_to_initiative` | Connect work to outcomes |
| Goal completed or abandoned | `record_initiative_outcome` | Be honest about results |
| Learning from past goals | `get_initiative_learnings` | Before starting similar initiatives |

### Anti-patterns

| Bad Pattern | Better Approach |
|-------------|-----------------|
| Browse tasks, then claim one | Use `get_next_task` to get highest priority |
| Complete task, forget to log decisions | Log decisions during implementation |
| Do extra work "while you're here" | Use `add_task` to track discovered work |
| Complete without summary | Always provide implementation summary |
| Big changes with no phase advances | Use `advance_phase` after each phase, or `skip_phase` with reason |

## Planning Files

When creating planning documents, implementation notes, or scratch work:
- Put them in `.enginehaus/scratch/` (gitignored) for temporary work
- Or commit them to `docs/plans/` if they're worth preserving

Don't leave planning files uncommitted in the working tree - they block `finish_work`/`complete_task_smart`.

## Common Mistakes to Avoid

### Mistake 1: Checking Task Status Directly

```bash
# WRONG
sqlite3 ~/.enginehaus/data/enginehaus.db "SELECT status FROM tasks WHERE id='abc123'"

# CORRECT
enginehaus task show abc123
# Or use get_task MCP tool
```

### Mistake 2: Updating Task Status Manually

```bash
# WRONG
sqlite3 ~/.enginehaus/data/enginehaus.db "UPDATE tasks SET status='in-progress'"

# CORRECT
claim_task({ taskId: "abc123" })
update_task({ taskId: "abc123", status: "in-progress" })
```

### Mistake 3: Counting Statistics Manually

```bash
# WRONG
sqlite3 ~/.enginehaus/data/enginehaus.db "SELECT COUNT(*) FROM tasks WHERE status='completed'"

# CORRECT
enginehaus stats
# Or use get_stats MCP tool
```

### Mistake 4: Reading Project Configuration Directly

```bash
# WRONG
sqlite3 ~/.enginehaus/data/enginehaus.db "SELECT * FROM projects WHERE slug='my-project'"

# CORRECT
enginehaus project list
get_project({ slug: "my-project" })
```

## Benefits of Using Enginehaus Tools

1. **Full Audit Trail**: Every operation is logged with actor, timestamp, and before/after state
2. **Event Emission**: Other agents and systems can react to changes
3. **Session Coordination**: Prevents conflicts with other agents
4. **Quality Gates**: Automatic validation runs on task transitions
5. **Git Integration**: Automatic branch/commit management
6. **Context Preservation**: Full strategic/UX/technical context maintained

## Metrics Accuracy Notes

Enginehaus tracks various metrics. Here's what we **actually measure** vs **estimate**:

### Directly Measured
- **Task lifecycle events**: claim/complete/abandon counts and timestamps
- **Session events**: start/end times, active sessions
- **Context fetch patterns**: minimal vs full fetch counts, whether expansion was needed
- **Response byte sizes**: actual response sizes from context fetches
- **Quality gate results**: pass/fail (when `validate_quality_gates` is called)

### Estimated (Heuristics)
- **Token counts**: Calculated as `bytes / 4` - a rough heuristic that varies by content type
- **Token savings**: Based on context fetch patterns, not actual LLM API token counts
- **Cycle times**: Measure claim-to-complete timestamps, not actual working time

### Not Measured
- **Actual LLM token usage**: Would require integration with LLM API response metadata
- **Agent satisfaction**: Requires explicit feedback submission
- **Code quality post-completion**: Only measured if `validate_quality_gates` is called

When reviewing metrics, understand that `estimatedTokensSaved` is an approximation based on context efficiency patterns, not a direct measurement of LLM costs.

## Development Guidelines for This Codebase

### Building and Testing

```bash
npm run build     # Compile TypeScript
npm test          # Run all tests
npm run watch     # Watch mode for development
```

### Code Style

- Use TypeScript with strict mode
- Validate all MCP tool inputs using the validation module
- Emit events for significant state changes
- Use prepared statements for SQL (never string concatenation)

### Adding New MCP Tools

1. Add schema in `src/index.ts` tool definitions
2. Add handler in the appropriate handler group
3. Add validation schema in `src/validation/validators.ts`
4. Add tests in `tests/` directory
5. Update this document if tool affects coordination patterns

## Questions?

If you're unsure which tool to use for an operation, check:
1. `enginehaus --help` for CLI commands
2. MCP tool list via `list_tools`
3. This document for patterns
