# Coordination Principles

*A framework for AI-assisted development that works regardless of tools*

---

## Why This Matters

The tools you use for AI-assisted development will change. The models will improve. The interfaces will evolve. But the principles that make coordination work are more durable than any specific implementation.

These principles emerged from building Enginehaus — coordination infrastructure we use to build itself. They're battle-tested through hundreds of tasks across multiple projects. But more importantly, they're portable: you can apply them whether you use Enginehaus, Linear, Notion, or a folder full of markdown files.

---

## Principle 1: Structure > Instruction > Documentation

**The insight:** AI agents follow architectural constraints more reliably than written instructions, no matter how detailed.

You can write the perfect prompt explaining that agents should log decisions, commit frequently, and run tests before marking tasks complete. They'll read it, understand it, and then... take the path of least resistance anyway.

But if completing a task *requires* a commit SHA? If the system *blocks* completion without a test file? Now the correct behavior is the easiest behavior.

**In practice:**
- Design systems where doing the right thing is easier than doing the wrong thing
- Use structural constraints (required fields, blocking gates, enforced sequences) over behavioral instructions
- When agents skip a step, ask "how do I make skipping harder?" not "how do I explain better?"

**The hierarchy:**
1. **Structure** — Architectural constraints that enforce behavior
2. **Instruction** — Prompts and guidance that suggest behavior
3. **Documentation** — Reference material that explains behavior

Each level is less reliable than the one above. Invest accordingly.

---

## Principle 2: Context Survives Sessions

**The insight:** The value of AI-assisted development compounds only if knowledge persists across context boundaries.

Every conversation with an AI starts fresh. Every new session loses the decisions, the rationale, the hard-won understanding of why things are the way they are. Without deliberate effort, you're perpetually re-explaining context instead of building on it.

**The knowledge flywheel:**
1. **Flow** — Strategic discussions, design decisions, implementation learnings emerge in conversation
2. **Crystallize** — Capture the durable insights as artifacts (not transcripts — distilled knowledge)
3. **Retrieve** — Surface relevant context automatically when starting related work
4. **Evolve** — New sessions build on existing knowledge, not from zero

**In practice:**
- Log decisions with rationale, not just outcomes ("We chose X" → "We chose X because Y, trading off Z")
- Link related work explicitly — the agent completing Task B should inherit context from Task A
- Design for retrieval: what will a future agent need to know to understand this?

---

## Principle 3: If the Agent Builds It, the Agent Can Maintain It

**The insight:** Systems should be self-describing enough that the agent who built them can reason about modifying them.

When an agent implements something it doesn't fully understand, you've created technical debt that compounds with every session. The next agent inherits a system they can't reason about. The agent after that inherits their patches. Soon you have archaeology, not engineering.

**The test:** Can an agent, given only the codebase and documented context, understand *why* the system works this way and make informed changes?

**In practice:**
- Preserve the "why" in commit messages, decision logs, and code comments
- Complexity the agent can't explain becomes immediate debt
- If the implementation requires tribal knowledge, that knowledge needs to be crystallized
- Design for future agents to read, not just current agents to write

---

## Principle 4: Quality Enforces, It Doesn't Advise

**The insight:** Warnings get ignored; gates get respected.

You can warn an agent that they should run tests before completing a task. You can remind them in the prompt. You can even show a yellow banner. And sometimes they'll do it. But if tests are *required* — if completion is *blocked* without passing tests — compliance becomes structural, not behavioral.

**The distinction:**
- **Advisory quality:** "You should run tests" → Sometimes followed
- **Enforced quality:** "Task cannot complete without test file" → Always followed

**In practice:**
- Convert "should" to "must" wherever quality matters
- Design gates that block progression, not warnings that suggest caution
- Make the path of least resistance the path of highest quality
- Accept that agents (like humans) optimize for completion — design accordingly

---

## Principle 5: Coordination is Infrastructure, Not Tooling

**The insight:** Tools provide features; infrastructure enables patterns. The value isn't in any single capability — it's in the compounding returns across sessions and agents.

A task manager is a tool. Coordination infrastructure is what enables multiple agents to work on the same codebase without collision, inherit context from each other's work, and build institutional memory that survives any individual session.

**The difference:**
- **Tool thinking:** "I need a way to track tasks"
- **Infrastructure thinking:** "I need a system where work done today makes tomorrow's work easier"

**In practice:**
- Optimize for compounding value, not immediate convenience
- Design for multi-session, multi-agent coordination from the start
- The system should get more valuable as it's used, not just more full

---

## Applying These Principles

You don't need Enginehaus to apply these principles. You don't need any specific tool.

**With Notion:** Structure your database so tasks can't close without required fields. Link decisions to tasks. Create templates that enforce the knowledge flywheel.

**With Linear:** Use automation rules as structural enforcement. Build custom fields for decision rationale. Create issue relationships that surface context.

**With markdown files:** Use git hooks to enforce commit formats. Structure files so context is co-located with code. Build retrieval through consistent naming and linking.

**With Enginehaus:** The infrastructure is designed around these principles — but the principles matter more than the tool.

---

## The Meta-Principle

These five principles share a common thread: **design for how agents actually behave, not how you wish they would.**

Agents take the path of least resistance. They optimize for completion. They don't reliably follow instructions when shortcuts exist. They lose context at session boundaries.

You can fight this reality or design with it. The principles above are strategies for designing with it — building systems where the natural agent behavior produces the outcomes you want.

---

*These principles are open. Use them, adapt them, improve them. If you discover something that works better, that's not a bug in the framework — it's the framework working.*
