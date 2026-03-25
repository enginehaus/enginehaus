/**
 * Claude Desktop Client Definition
 *
 * Configuration and templates for Claude Desktop (desktop app).
 */

import * as os from 'os';
import * as path from 'path';
import { ClientDefinition, InstructionOptions, MCPServerConfig } from './types.js';
import { INSTRUCTIONS_VERSION, INSTRUCTIONS_UPDATED } from '../instructions-version.js';

export const claudeDesktopClient: ClientDefinition = {
  id: 'claude-desktop',
  name: 'Claude Desktop',
  description: 'Anthropic\'s desktop application for Claude',

  configPaths: {
    darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    win32: path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    linux: path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json'),
  },

  requiresMCPConfig: true,

  formatMCPConfig: (serverPath: string): MCPServerConfig => {
    return {
      command: '/usr/local/bin/node',
      args: [serverPath],
    };
  },

  handoffPromptFormat: `## Handoff from {{fromAgent}}

**Task:** {{taskTitle}}
**ID:** {{taskId}}

### Context
{{context}}

### What was done
{{summary}}

### What needs to happen next
{{nextSteps}}

### Files touched
{{files}}

Use \`get_task_context({ taskId: "{{taskId}}" })\` for full details.`,

  generateInstructions: (options: InstructionOptions): string => {
    const { project, webConsolePort = 4747, capabilities = [] } = options;
    const sections: string[] = [];

    // Version header (machine-readable comment)
    sections.push(`<!-- INSTRUCTIONS_VERSION: ${INSTRUCTIONS_VERSION} -->`);
    sections.push(`<!-- Last updated: ${INSTRUCTIONS_UPDATED} -->`);
    sections.push('');

    // Header
    sections.push(`# Enginehaus Coordination for ${project.name}`);
    sections.push('');
    sections.push(`> Instructions Version: ${INSTRUCTIONS_VERSION}`);
    sections.push('');
    sections.push('You have access to Enginehaus MCP tools for coordinating AI-assisted development.');
    sections.push('');

    // Capabilities overview
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
    if (capabilities.length > 0) {
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

    // Available tools
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
    sections.push(`- **Name**: ${project.name}`);
    sections.push(`- **Slug**: ${project.slug}`);
    if (project.techStack && project.techStack.length > 0) {
      sections.push(`- **Tech Stack**: ${project.techStack.join(', ')}`);
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
  },

  generateMinimalInstructions: (projectName: string): string => {
    return `<!-- INSTRUCTIONS_VERSION: ${INSTRUCTIONS_VERSION} -->
<!-- Last updated: ${INSTRUCTIONS_UPDATED} -->

# Enginehaus Coordination for ${projectName}

> Instructions Version: ${INSTRUCTIONS_VERSION}

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
  },

  detectVersion: (): string | null => {
    // Claude Desktop version detection is platform-specific
    // For now, return null - could be enhanced to check app bundle
    return null;
  },
};
