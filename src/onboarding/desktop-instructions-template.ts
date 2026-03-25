/**
 * Claude Desktop Project Instructions Template
 *
 * Generates instructions for Claude Desktop's project instructions feature.
 * These get copy-pasted into Desktop, unlike Claude Code which reads CLAUDE.md.
 *
 * Key differences from CLAUDE.md:
 * - Desktop uses MCP tools directly (no CLI fallback)
 * - Desktop sessions are conversational (not file-editing focused)
 * - Handoffs between Desktop and Code are important
 * - AX self-reporting helps improve the system
 */

export interface DesktopInstructionsOptions {
  projectName: string;
  projectSlug: string;
  techStack?: string[];
  capabilities?: string[];
  webConsolePort?: number;
}

/**
 * Generate Claude Desktop project instructions
 */
export function generateDesktopInstructions(options: DesktopInstructionsOptions): string {
  const { projectName, projectSlug, techStack, capabilities, webConsolePort = 4747 } = options;

  const sections: string[] = [];

  // Header
  sections.push(`# Enginehaus Coordination for ${projectName}`);
  sections.push('');
  sections.push('You have access to Enginehaus MCP tools for coordinating AI-assisted development.');
  sections.push('');

  // Capabilities overview (what you can do)
  sections.push('## What You Can Do');
  sections.push('');
  sections.push('**Task Management:**');
  sections.push('- Get project briefing and status');
  sections.push('- Claim and work on tasks');
  sections.push('- Create new tasks for discovered work');
  sections.push('- Complete tasks with summaries');
  sections.push('');
  sections.push('**Knowledge Capture:**');
  sections.push('- Log architectural decisions with rationale');
  sections.push('- Record learnings and insights');
  sections.push('- Link work to initiatives (measurable goals)');
  sections.push('');
  sections.push('**Coordination:**');
  sections.push('- Hand off work to Claude Code or other agents');
  sections.push('- See what other agents have done');
  sections.push('- Access cross-session context and learnings');
  sections.push('');
  if (capabilities && capabilities.length > 0) {
    sections.push('**Project-Specific:**');
    capabilities.forEach(cap => sections.push(`- ${cap}`));
    sections.push('');
  }

  // Session start
  sections.push('## Session Start');
  sections.push('');
  sections.push('At the beginning of each substantive work session:');
  sections.push('');
  sections.push('1. **Get briefing**: Call `get_briefing` to see project status');
  sections.push('2. **Check assigned tasks**: Look for tasks already assigned to you');
  sections.push('3. **Review recent decisions**: Understand what choices have been made');
  sections.push('');
  sections.push('```');
  sections.push('get_briefing()  // Always do this first');
  sections.push('```');
  sections.push('');

  // Core workflow
  sections.push('## Core Workflow');
  sections.push('');
  sections.push('**Starting Work:**');
  sections.push('```');
  sections.push('start_work()           // Get next priority task');
  sections.push('start_work({ taskId }) // Work on specific task');
  sections.push('```');
  sections.push('');
  sections.push('**During Work:**');
  sections.push('- Log decisions as you make them (not after):');
  sections.push('```');
  sections.push('log_decision({');
  sections.push('  decision: "Use approach X over Y",');
  sections.push('  rationale: "Because of Z",');
  sections.push('  category: "architecture"  // or: tradeoff, dependency, pattern');
  sections.push('})');
  sections.push('```');
  sections.push('');
  sections.push('**Completing Work:**');
  sections.push('```');
  sections.push('finish_work({ summary: "What was accomplished" })');
  sections.push('```');
  sections.push('');

  // Handoffs
  sections.push('## Handoffs (Desktop ↔ Code)');
  sections.push('');
  sections.push('When passing work to Claude Code or another agent:');
  sections.push('');
  sections.push('```');
  sections.push('quick_handoff({');
  sections.push('  targetAgent: "claude-code",');
  sections.push('  context: "Brief context about what needs to happen next",');
  sections.push('  taskId: "optional-if-task-specific"');
  sections.push('})');
  sections.push('```');
  sections.push('');
  sections.push('**When to hand off to Code:**');
  sections.push('- File editing and code changes');
  sections.push('- Running tests and builds');
  sections.push('- Git operations');
  sections.push('');
  sections.push('**When to stay in Desktop:**');
  sections.push('- Strategic discussions and planning');
  sections.push('- Research and analysis');
  sections.push('- Reviewing and explaining code');
  sections.push('');

  // Capturing insights
  sections.push('## Capturing Insights');
  sections.push('');
  sections.push('When significant strategic discussions emerge, announce and capture:');
  sections.push('');
  sections.push('> "Capturing this as a decision for future reference: [brief summary]"');
  sections.push('');
  sections.push('**Triggers for capture:**');
  sections.push('- Architectural choices with rationale');
  sections.push('- Strategic pivots or priority changes');
  sections.push('- Learnings from implementation');
  sections.push('- Cross-project patterns');
  sections.push('');

  // AX self-reporting
  sections.push('## AX (Agent Experience) Self-Reporting');
  sections.push('');
  sections.push('This project researches how to make AI coordination better. Help by:');
  sections.push('');
  sections.push('**Tracking friction:**');
  sections.push('- Note when coordination steps are skipped and why');
  sections.push('- Flag when information was missing at session start');
  sections.push('- Report tool errors and recovery patterns');
  sections.push('');
  sections.push('**Surface observations naturally:**');
  sections.push('> "AX note: I almost skipped logging that decision - the trigger was unclear"');
  sections.push('> "AX note: I didn\'t have [X] context at session start, which would have helped"');
  sections.push('');
  sections.push('**Periodic reflection (longer sessions):**');
  sections.push('- What coordination am I doing well?');
  sections.push('- What am I skipping?');
  sections.push('- What\'s causing friction?');
  sections.push('');

  // Available tools reference
  sections.push('## Available Tools');
  sections.push('');
  sections.push('| Tool | Purpose |');
  sections.push('|------|---------|');
  sections.push('| `get_briefing` | Project status and context |');
  sections.push('| `start_work` | Begin work on a task |');
  sections.push('| `finish_work` | Complete current task |');
  sections.push('| `log_decision` | Record architectural choices |');
  sections.push('| `add_task` | Create new task |');
  sections.push('| `quick_handoff` | Hand off to another agent |');
  sections.push('| `list_decisions` | View past decisions |');
  sections.push('| `get_task_context` | Full context for a task |');
  sections.push('');

  // Project info
  sections.push('## Project Info');
  sections.push('');
  sections.push(`- **Name**: ${projectName}`);
  sections.push(`- **Slug**: ${projectSlug}`);
  if (techStack && techStack.length > 0) {
    sections.push(`- **Tech Stack**: ${techStack.join(', ')}`);
  }
  sections.push(`- **Web Console**: http://localhost:${webConsolePort} (run \`enginehaus serve\`)`);
  sections.push('');

  // Rules
  sections.push('## Rules');
  sections.push('');
  sections.push('1. **Get briefing first** - Every session, no exceptions');
  sections.push('2. **Log decisions as you go** - Not retrospectively');
  sections.push('3. **Announce coordination actions** - They\'re visible anyway');
  sections.push('4. **Never access SQLite directly** - Use MCP tools only');
  sections.push('');

  return sections.join('\n');
}

/**
 * Generate minimal Desktop instructions for quick setup
 */
export function generateMinimalDesktopInstructions(projectName: string): string {
  return `# Enginehaus Coordination for ${projectName}

You have access to Enginehaus MCP tools. Use them proactively.

## Quick Start

\`\`\`
get_briefing()                    // Always first
start_work()                      // Get next task
log_decision({ decision, rationale, category })  // Capture choices
finish_work({ summary })          // Complete task
\`\`\`

## Key Patterns

- **Session start**: Call \`get_briefing\` first
- **During work**: Log decisions as you make them
- **Handoffs**: Use \`quick_handoff\` to pass work to Claude Code
- **Insights**: Announce when capturing decisions: "Capturing this as a decision..."

## Rules

1. Get briefing first - every session
2. Log decisions as you go
3. Never access SQLite directly - use MCP tools
`;
}
