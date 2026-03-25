/**
 * Cross-LLM Onboarding Templates
 *
 * Generates instruction files for different LLM platforms.
 * Each LLM gets tailored instructions matching its conventions.
 */

import { AgentType } from '../coordination/types.js';

export interface LLMTemplateOptions {
  projectName: string;
  projectSlug: string;
  techStack?: string[];
  mcpEndpoint?: string;
}

/**
 * Generate system prompt instructions for ChatGPT with MCP
 */
export function generateChatGPTInstructions(options: LLMTemplateOptions): string {
  return `# Enginehaus Coordination for ${options.projectName}

You are connected to Enginehaus, a coordination system for AI-assisted development.

## Available MCP Tools

Use these tools to coordinate your work:

### Starting Work
- \`get_next_task\` - Get the highest priority task with full context
- \`get_briefing\` - Get project overview and status

### During Work
- \`log_decision\` - Record architectural choices (IMPORTANT: do this frequently)
  - Categories: architecture, tradeoff, dependency, pattern
- \`advance_phase\` - Mark phase completion (requires commit SHA)
- \`add_task\` - Create new tasks for discovered work

### Completing Work
- \`complete_task_smart\` - Complete task with auto-generated docs

## Workflow

1. Start with \`get_next_task\` to claim work
2. Log decisions as you make them using \`log_decision\`
3. When done, use \`complete_task_smart\` with a summary

## Project Info

- **Project**: ${options.projectName} (${options.projectSlug})
${options.techStack?.length ? `- **Tech Stack**: ${options.techStack.join(', ')}` : ''}
${options.mcpEndpoint ? `- **MCP Endpoint**: ${options.mcpEndpoint}` : ''}

## Agent Identification

When starting a session, include this in your first tool call:
\`\`\`json
{
  "agentMetadata": {
    "agentType": "chatgpt",
    "agentVersion": "gpt-4o"
  }
}
\`\`\`
`;
}

/**
 * Generate instructions for Gemini CLI
 */
export function generateGeminiInstructions(options: LLMTemplateOptions): string {
  return `# Enginehaus Coordination for ${options.projectName}

You are connected to Enginehaus via MCP. Use these coordination tools for structured AI-assisted development.

## Quick Start

\`\`\`
# Get your next task
get_next_task()

# Log decisions as you work
log_decision({
  decision: "Your decision here",
  rationale: "Why you made this choice",
  category: "architecture"
})

# Complete when done
complete_task_smart({
  taskId: "...",
  summary: "What you accomplished"
})
\`\`\`

## Available Tools

| Tool | Purpose |
|------|---------|
| \`get_next_task\` | Claim highest priority task |
| \`get_briefing\` | Project status overview |
| \`log_decision\` | Record architectural choices |
| \`advance_phase\` | Complete a phase of work |
| \`complete_task_smart\` | Finish task with docs |
| \`add_task\` | Create follow-up tasks |

## Decision Categories

- \`architecture\` - Structural choices
- \`tradeoff\` - Compromise decisions
- \`dependency\` - Library/tool selections
- \`pattern\` - Design patterns used

## Project: ${options.projectName}

- Slug: \`${options.projectSlug}\`
${options.techStack?.length ? `- Stack: ${options.techStack.join(', ')}` : ''}

## Agent Identification

Include when starting work:
\`\`\`json
{
  "agentMetadata": {
    "agentType": "gemini",
    "agentVersion": "gemini-2.5-pro"
  }
}
\`\`\`
`;
}

/**
 * Generate instructions for Mistral Le Chat
 */
export function generateMistralInstructions(options: LLMTemplateOptions): string {
  return `# Enginehaus Coordination - ${options.projectName}

Connected to Enginehaus MCP for coordinated AI development.

## Core Workflow

1. **Start**: \`get_next_task()\` - Claims and returns task with context
2. **Work**: Log decisions with \`log_decision()\` as you go
3. **Finish**: \`complete_task_smart()\` - Auto-generates completion docs

## Key Tools

- \`get_next_task\` - Get priority task
- \`get_briefing\` - Project overview
- \`log_decision\` - Record choices (architecture, tradeoff, dependency, pattern)
- \`complete_task_smart\` - Complete with summary
- \`add_task\` - Create new tasks

## Decision Logging

Always log significant decisions:

\`\`\`
log_decision({
  decision: "Use X approach",
  rationale: "Because Y",
  category: "architecture"
})
\`\`\`

## Project

- Name: ${options.projectName}
- Slug: ${options.projectSlug}
${options.techStack?.length ? `- Stack: ${options.techStack.join(', ')}` : ''}

## Agent ID

\`\`\`json
{
  "agentMetadata": {
    "agentType": "mistral",
    "agentVersion": "mistral-large"
  }
}
\`\`\`
`;
}

/**
 * Generate instructions for Cursor IDE
 */
export function generateCursorInstructions(options: LLMTemplateOptions): string {
  return `# Enginehaus Coordination for ${options.projectName}

Cursor is connected to Enginehaus MCP for coordination.

## Workflow

1. Use \`get_next_task\` to claim priority work
2. Log decisions with \`log_decision\` as you code
3. Complete with \`complete_task_smart\`

## Tools

| Tool | Use |
|------|-----|
| \`get_next_task\` | Start work |
| \`log_decision\` | Record choices |
| \`add_task\` | Track discovered work |
| \`complete_task_smart\` | Finish task |

## Decision Categories

- \`architecture\` - Design decisions
- \`tradeoff\` - Compromises
- \`dependency\` - Libraries
- \`pattern\` - Patterns used

## Project: ${options.projectName} (\`${options.projectSlug}\`)
${options.techStack?.length ? `Stack: ${options.techStack.join(', ')}` : ''}

Agent metadata: \`{ "agentType": "cursor" }\`
`;
}

/**
 * Generate instructions for Continue.dev
 */
export function generateContinueInstructions(options: LLMTemplateOptions): string {
  return `# Enginehaus Coordination

Connected to Enginehaus for coordinated development.

## Commands

- \`get_next_task\` - Get priority task
- \`log_decision\` - Record decisions (architecture, tradeoff, dependency, pattern)
- \`complete_task_smart\` - Complete task
- \`add_task\` - Create tasks

## Workflow

1. \`get_next_task()\` → claim task
2. Work, logging decisions along the way
3. \`complete_task_smart()\` → finish

## Project: ${options.projectName}

Agent metadata: \`{ "agentType": "continue" }\`
`;
}

/**
 * Get the appropriate template generator for an agent type
 */
export function getTemplateGenerator(
  agentType: AgentType
): ((options: LLMTemplateOptions) => string) | null {
  switch (agentType) {
    case 'chatgpt':
      return generateChatGPTInstructions;
    case 'gemini':
      return generateGeminiInstructions;
    case 'mistral':
      return generateMistralInstructions;
    case 'cursor':
      return generateCursorInstructions;
    case 'continue':
      return generateContinueInstructions;
    default:
      return null;
  }
}

/**
 * Get the filename for LLM-specific instructions
 */
export function getInstructionFilename(agentType: AgentType): string {
  switch (agentType) {
    case 'claude':
      return 'CLAUDE.md';
    case 'chatgpt':
      return 'CHATGPT.md';
    case 'gemini':
      return 'GEMINI.md';
    case 'mistral':
      return 'MISTRAL.md';
    case 'cursor':
      return 'CURSOR.md';
    case 'continue':
      return 'CONTINUE.md';
    default:
      return 'AGENT.md';
  }
}

/**
 * All supported LLM types with their metadata
 */
export const SUPPORTED_LLMS: Array<{
  type: AgentType;
  name: string;
  mcpSupport: 'native' | 'http' | 'partial';
  configLocation?: string;
}> = [
  {
    type: 'claude',
    name: 'Claude (Code/Desktop)',
    mcpSupport: 'native',
    configLocation: '~/.config/claude-code/mcp_settings.json',
  },
  {
    type: 'chatgpt',
    name: 'ChatGPT',
    mcpSupport: 'http',
    configLocation: 'Developer Mode settings',
  },
  {
    type: 'gemini',
    name: 'Gemini',
    mcpSupport: 'native',
    configLocation: '~/.config/gemini/mcp.json',
  },
  {
    type: 'mistral',
    name: 'Mistral Le Chat',
    mcpSupport: 'http',
    configLocation: 'MCP Connectors settings',
  },
  {
    type: 'cursor',
    name: 'Cursor',
    mcpSupport: 'native',
    configLocation: '~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/settings.json',
  },
  {
    type: 'continue',
    name: 'Continue.dev',
    mcpSupport: 'native',
    configLocation: '~/.continue/config.json',
  },
];
