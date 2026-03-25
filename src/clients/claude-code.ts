/**
 * Claude Code Client Definition
 *
 * Configuration and templates for Claude Code (CLI/editor integration).
 */

import { execSync } from 'child_process';
import { ClientDefinition, InstructionOptions } from './types.js';
import { INSTRUCTIONS_VERSION, INSTRUCTIONS_UPDATED } from '../instructions-version.js';

export const claudeCodeClient: ClientDefinition = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Anthropic\'s CLI tool for code-focused AI assistance',

  // Claude Code reads CLAUDE.md from project root, not a global config
  configPaths: {
    default: '', // No global config path - uses per-project CLAUDE.md
  },

  requiresMCPConfig: false, // Uses CLAUDE.md, not MCP config file
  instructionFile: 'CLAUDE.md',

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

Run \`enginehaus task show {{taskId}}\` or use \`get_task_context\` MCP tool for full details.`,

  generateInstructions: (options: InstructionOptions): string => {
    const { project, webConsolePort = 4747 } = options;
    const sections: string[] = [];

    // Version header (machine-readable comment)
    sections.push(`<!-- INSTRUCTIONS_VERSION: ${INSTRUCTIONS_VERSION} -->`);
    sections.push(`<!-- Last updated: ${INSTRUCTIONS_UPDATED} -->`);
    sections.push('');

    // Header
    sections.push(`# ${project.name}`);
    sections.push('');
    sections.push(`> Instructions Version: ${INSTRUCTIONS_VERSION}`);
    sections.push('');
    sections.push('This project uses Enginehaus for AI coordination.');
    sections.push('');

    // Quick Start
    sections.push('## Quick Start');
    sections.push('');
    sections.push('```bash');
    sections.push('# Start work on next priority task');
    sections.push('enginehaus task next');
    sections.push('');
    sections.push('# Log decisions as you work');
    sections.push('enginehaus decision log "What you decided" -r "Why" -c architecture');
    sections.push('');
    sections.push('# Complete when done');
    sections.push('enginehaus task complete <id> -s "Summary"');
    sections.push('```');
    sections.push('');

    // MCP Tools (if available)
    sections.push('## MCP Tools');
    sections.push('');
    sections.push('If MCP is configured, use these tools directly:');
    sections.push('');
    sections.push('| Tool | Purpose |');
    sections.push('|------|---------|');
    sections.push('| `get_next_task` | Claim next priority task |');
    sections.push('| `log_decision` | Record architectural choices |');
    sections.push('| `complete_task_smart` | Complete with auto-generated docs |');
    sections.push('| `get_briefing` | Project status overview |');
    sections.push('');

    // CLI Fallback
    sections.push('## CLI Commands');
    sections.push('');
    sections.push('```bash');
    sections.push('enginehaus task list          # See all tasks');
    sections.push('enginehaus task next          # Claim next task');
    sections.push('enginehaus task show <id>     # Task details');
    sections.push('enginehaus briefing           # Project status');
    sections.push('enginehaus decision list      # Recent decisions');
    sections.push('```');
    sections.push('');

    // Decision Logging
    sections.push('## Decision Logging');
    sections.push('');
    sections.push('Log decisions as you make them:');
    sections.push('');
    sections.push('```bash');
    sections.push('enginehaus decision log "Use X over Y" -r "Because Z" -c architecture');
    sections.push('```');
    sections.push('');
    sections.push('Categories: `architecture`, `tradeoff`, `dependency`, `pattern`, `other`');
    sections.push('');

    // Project Info
    sections.push('## Project Info');
    sections.push('');
    sections.push(`- **Name**: ${project.name}`);
    sections.push(`- **Slug**: ${project.slug}`);
    if (project.techStack && project.techStack.length > 0) {
      sections.push(`- **Tech Stack**: ${project.techStack.join(', ')}`);
    }
    if (project.domain) {
      sections.push(`- **Domain**: ${project.domain}`);
    }
    sections.push(`- **Web Console**: http://localhost:${webConsolePort}`);
    sections.push('');

    // Rules
    sections.push('## Rules');
    sections.push('');
    sections.push('1. **Get briefing first** - `enginehaus briefing` at session start');
    sections.push('2. **Log decisions as you go** - Not retrospectively');
    sections.push('3. **Never access SQLite directly** - Use CLI or MCP tools');
    sections.push('');

    return sections.join('\n');
  },

  generateMinimalInstructions: (projectName: string): string => {
    return `<!-- INSTRUCTIONS_VERSION: ${INSTRUCTIONS_VERSION} -->
<!-- Last updated: ${INSTRUCTIONS_UPDATED} -->

# ${projectName}

> Instructions Version: ${INSTRUCTIONS_VERSION}

Enginehaus coordination enabled. Use CLI or MCP tools.

## Quick Reference

\`\`\`bash
enginehaus task next            # Get next task
enginehaus decision log "X" -r "Y" -c architecture  # Log decisions
enginehaus task complete <id> -s "Summary"  # Complete task
\`\`\`

## Rules

1. Get briefing first: \`enginehaus briefing\`
2. Log decisions as you work
3. Use tools, not direct SQLite access
`;
  },

  detectVersion: (): string | null => {
    try {
      const output = execSync('claude --version 2>/dev/null', { encoding: 'utf-8' });
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  },
};
