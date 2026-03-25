# Enginehaus Power User Guide

Habits and patterns that make the difference between "using Enginehaus" and getting real value from it.

## Baseline Habits

### Start every session with "Get my briefing"

This isn't ceremony — it orients the agent in seconds. The briefing loads active tasks, recent decisions, bottlenecks, and recommendations. Without it, the agent guesses at context. With it, the agent starts informed.

```
get_briefing()
```

**Not** `view_wheelhaus`. The Wheelhaus dashboard is a human tool — useful for visual project state and showing others the system. But it pulls a full render with overhead (wrong-project risk, large payload). `get_briefing` returns actionable signal faster and scopes to the active project. Agents should use `get_briefing`; open Wheelhaus when *you* want to look.

### Log decisions as you make them

Not after. Not retrospectively. In the moment, when the rationale is fresh.

```bash
enginehaus decision log "Chose WebSocket over polling" \
  -r "Need sub-second updates; polling would hammer the API" \
  -c architecture
```

The decision itself is useful. The rationale is what makes it valuable six weeks later when someone asks "why didn't we just use polling?"

### Capture before closing

Before ending a substantive session, say: "Capture this in EH." The agent files decisions, creates follow-up tasks, and stores artifacts from the conversation. Five seconds of prompting saves twenty minutes of re-discovery next session.

## Intermediate Patterns

### Desktop for thinking, Code for building

Claude Desktop is good at strategy, research, and discussion. Claude Code is good at implementation. Let Enginehaus be the handoff layer between them:

```
# In Desktop — after a strategy discussion:
quick_handoff({
  targetAgent: "claude-code",
  context: "We decided on WebSocket + CRDT for real-time. See decisions."
})
```

The receiving agent gets the full context — decisions, artifacts, task state — without you re-explaining.

### Tag decisions to tasks

When logging decisions during active work, include the task ID:

```bash
enginehaus decision log "Use RS256 over HS256" \
  -r "Asymmetric lets services verify independently" \
  -c architecture \
  --task <id>
```

Tagged decisions appear in task context automatically. Successor tasks inherit them. Untagged decisions are still searchable, but tagged ones are *findable without searching*.

### Mobile thinking, desktop filing

The workflow:

1. Have a conversation on Claude mobile — walking, commuting, thinking out loud
2. When you're back at your desk, open your Enginehaus-connected client and paste or dictate the key points
3. Say: "Capture this in EH — create tasks, log decisions, store any artifacts"

The agent does the filing. You did the thinking. Dead time becomes project velocity.

## Anti-Patterns

### Don't create tasks for everything

Enginehaus is for work that needs coordination and memory — features, bugs, architectural decisions. Don't create tasks for "update import statement" or "fix typo." If it doesn't need context to resume, it doesn't need a task.

### Don't bypass quality gates

`complete_task_smart` checks for uncommitted changes, unpushed commits, and missing decisions. These exist because agents routinely skip them when left to instructions alone. If a gate is blocking you, fix the underlying issue — don't route around it.

### Don't let CLAUDE.md become a novel

CLAUDE.md should orient, not micromanage. If it's longer than a few hundred lines, agents skip the middle. Keep it focused on: what this project is, what the constraints are, and how to use the coordination tools. Everything else goes in docs.

## What to Do When Things Go Wrong

### Agent seems to have no context

Run `enginehaus doctor` to check if MCP is configured correctly. If the tools aren't connected, the agent is flying blind. Most "context loss" is actually "tools not loaded."

### Decisions aren't appearing in briefings

Check that decisions are tagged to the active project. Untagged decisions exist in the database but don't surface in project-scoped views. Run `enginehaus decision list` to see what's there.

### Task is stuck in progress

Someone claimed it and didn't finish. Release it:

```bash
enginehaus task release <id>
```

Then claim it yourself or let `task next` pick it up.

---

[Back to README](../README.md) | [Quick Start](QUICK-START.md) | [CLI Reference](../README.md#cli-reference)
