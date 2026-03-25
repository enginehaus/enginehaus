/**
 * CLAUDE.md Generator for Enginehaus
 *
 * Generates project-specific CLAUDE.md files that integrate with
 * Enginehaus coordination workflow.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Project, ProjectDomain } from '../coordination/types.js';

export interface BuildCommands {
  build?: string;
  test?: string;
  lint?: string;
  dev?: string;
  start?: string;
}

export interface ClaudeMdOptions {
  project: Project;
  includeQuickStart?: boolean;
  includeDecisionLogging?: boolean;
  customGuidelines?: string[];
  buildCommands?: BuildCommands;
  webConsoleUrl?: string;
}

/**
 * Get tech-stack-specific guidelines based on the project's tech stack
 */
function getTechStackGuidelines(techStack: string[]): string[] {
  const guidelines: string[] = [];
  const stack = techStack.map(t => t.toLowerCase());

  if (stack.includes('typescript') || stack.includes('ts')) {
    guidelines.push('- Use TypeScript strict mode; avoid `any` types');
    guidelines.push('- Prefer interfaces over type aliases for object shapes');
  }

  if (stack.includes('react')) {
    guidelines.push('- Use functional components with hooks');
    guidelines.push('- Prefer composition over prop drilling');
  }

  if (stack.includes('node') || stack.includes('nodejs')) {
    guidelines.push('- Use async/await over callbacks');
    guidelines.push('- Handle errors with try/catch at appropriate boundaries');
  }

  if (stack.includes('python')) {
    guidelines.push('- Follow PEP 8 style guidelines');
    guidelines.push('- Use type hints for function signatures');
  }

  if (stack.includes('go') || stack.includes('golang')) {
    guidelines.push('- Follow effective Go patterns');
    guidelines.push('- Handle errors explicitly; do not ignore returned errors');
  }

  if (stack.includes('rust')) {
    guidelines.push('- Prefer Result over panic for recoverable errors');
    guidelines.push('- Use clippy lints to maintain code quality');
  }

  return guidelines;
}

/**
 * Get domain-specific guidelines based on project domain
 */
function getDomainGuidelines(domain: ProjectDomain): string[] {
  switch (domain) {
    case 'web':
      return [
        '- Consider accessibility (ARIA, semantic HTML)',
        '- Optimize for Core Web Vitals',
      ];
    case 'api':
      return [
        '- Document all API endpoints with clear request/response schemas',
        '- Use consistent error response formats',
      ];
    case 'mobile':
      return [
        '- Consider offline-first patterns',
        '- Test on multiple device sizes',
      ];
    case 'infrastructure':
      return [
        '- Document infrastructure changes thoroughly',
        '- Consider rollback strategies',
      ];
    case 'ml':
      return [
        '- Document model assumptions and limitations',
        '- Track experiment metadata',
      ];
    default:
      return [];
  }
}

/**
 * Detect build/test/lint commands from project files
 */
export function detectBuildCommands(projectDir: string): BuildCommands {
  const commands: BuildCommands = {};

  // Check package.json for npm scripts
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const scripts = pkg.scripts || {};

      if (scripts.build) commands.build = 'npm run build';
      if (scripts.test) commands.test = 'npm test';
      if (scripts.lint) commands.lint = 'npm run lint';
      if (scripts.dev) commands.dev = 'npm run dev';
      if (scripts.start) commands.start = 'npm start';

      // Check for alternative script names
      if (!commands.lint && scripts['lint:check']) commands.lint = 'npm run lint:check';
      if (!commands.dev && scripts.serve) commands.dev = 'npm run serve';
      if (!commands.dev && scripts.watch) commands.dev = 'npm run watch';
    } catch {
      // Ignore parse errors
    }
  }

  // Check for Makefile
  const makefilePath = path.join(projectDir, 'Makefile');
  if (fs.existsSync(makefilePath)) {
    try {
      const content = fs.readFileSync(makefilePath, 'utf-8');

      // Look for common targets
      if (content.includes('build:') && !commands.build) commands.build = 'make build';
      if (content.includes('test:') && !commands.test) commands.test = 'make test';
      if (content.includes('lint:') && !commands.lint) commands.lint = 'make lint';
    } catch {
      // Ignore read errors
    }
  }

  // Check for Python projects
  const pyprojectPath = path.join(projectDir, 'pyproject.toml');
  const requirementsPath = path.join(projectDir, 'requirements.txt');
  if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath)) {
    if (!commands.test) commands.test = 'pytest';
    if (!commands.lint) commands.lint = 'ruff check .';
  }

  // Check for Cargo.toml (Rust)
  const cargoPath = path.join(projectDir, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    if (!commands.build) commands.build = 'cargo build';
    if (!commands.test) commands.test = 'cargo test';
    if (!commands.lint) commands.lint = 'cargo clippy';
  }

  // Check for go.mod (Go)
  const goModPath = path.join(projectDir, 'go.mod');
  if (fs.existsSync(goModPath)) {
    if (!commands.build) commands.build = 'go build ./...';
    if (!commands.test) commands.test = 'go test ./...';
    if (!commands.lint) commands.lint = 'golangci-lint run';
  }

  // Check for Package.swift (Swift)
  const swiftPackagePath = path.join(projectDir, 'Package.swift');
  if (fs.existsSync(swiftPackagePath)) {
    if (!commands.build) commands.build = 'swift build';
    if (!commands.test) commands.test = 'swift test';
  }

  // Check for Xcode project (Swift/iOS)
  const xcodeFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'));
  if (xcodeFiles.length > 0) {
    // Try to find scheme name from project name
    const xcodeProject = xcodeFiles.find(f => f.endsWith('.xcodeproj')) || xcodeFiles[0];
    const schemeName = xcodeProject.replace(/\.(xcodeproj|xcworkspace)$/, '');

    if (!commands.build) commands.build = `xcodebuild -scheme ${schemeName} build`;
    if (!commands.test) commands.test = `xcodebuild -scheme ${schemeName} test`;
  }

  return commands;
}

/**
 * Generate project-specific CLAUDE.md content
 */
export function generateClaudeMd(options: ClaudeMdOptions): string {
  const { project, customGuidelines = [], buildCommands } = options;

  const techStackGuidelines = getTechStackGuidelines(project.techStack || []);
  const domainGuidelines = getDomainGuidelines(project.domain);
  const allGuidelines = [...techStackGuidelines, ...domainGuidelines, ...customGuidelines];

  const sections: string[] = [];

  // Header
  sections.push(`# ${project.name}`);
  sections.push('');
  if (project.description) {
    sections.push(project.description);
    sections.push('');
  }

  // Build commands section (if provided) — project-specific, before Enginehaus section
  if (buildCommands && Object.keys(buildCommands).some(k => buildCommands[k as keyof BuildCommands])) {
    sections.push('## Build Commands');
    sections.push('');
    sections.push('```bash');
    if (buildCommands.build) sections.push(buildCommands.build);
    if (buildCommands.test) sections.push(buildCommands.test);
    if (buildCommands.lint) sections.push(buildCommands.lint);
    sections.push('```');
    sections.push('');
  }

  // Project-specific guidelines
  if (allGuidelines.length > 0) {
    sections.push('## Code Guidelines');
    sections.push('');
    allGuidelines.forEach(g => sections.push(g));
    sections.push('');
  }

  // Separator before Enginehaus section
  sections.push('---');
  sections.push('');

  // Append the standardized Enginehaus section
  sections.push(generateEnginehausSection());

  return sections.join('\n');
}

/**
 * Generate just the Enginehaus coordination section (no project-specific content).
 * Used by update-instructions to replace the Enginehaus section in existing CLAUDE.md files.
 */
export function generateEnginehausSection(): string {
  const lines: string[] = [];

  lines.push('<!-- ENGINEHAUS_INSTRUCTIONS_VERSION: 2.2 -->');
  lines.push('<!-- Last updated: 2026-03-07 -->');
  lines.push('');
  lines.push('## Enginehaus Coordination');
  lines.push('');
  lines.push('> Enginehaus Instructions v2.2 — This section is auto-managed. Project-specific rules above take precedence.');
  lines.push('');

  lines.push('### Every Session');
  lines.push('');
  lines.push('Context loads automatically via hooks (Claude Code, Cursor, VS Code, Gemini CLI, Cline)');
  lines.push('or MCP resources (any MCP client). Workflow enforcement blocks edits without a claimed task.');
  lines.push('');
  lines.push('**MCP workflow (2 tools):**');
  lines.push('```');
  lines.push('start_work()                      # Claims task, loads context, creates branch');
  lines.push('# ... do your work, log decisions ...');
  lines.push('finish_work({ summary: "..." })   # Validates quality, completes, suggests next');
  lines.push('```');
  lines.push('');
  lines.push('**CLI workflow:**');
  lines.push('```bash');
  lines.push('eh next                           # Claim highest priority task');
  lines.push('enginehaus decision log "Why X" -r "rationale" -c architecture');
  lines.push('# ... test, commit, push ...');
  lines.push('enginehaus task complete <id> -s "Summary"');
  lines.push('```');
  lines.push('');
  lines.push('**Decision categories:** `architecture`, `tradeoff`, `dependency`, `pattern`, `other`');
  lines.push('');

  lines.push('### Critical Rules');
  lines.push('');
  lines.push('1. **Never access SQLite directly** — use Enginehaus CLI/MCP tools only. Direct DB access loses the audit trail and breaks coordination.');
  lines.push('2. **Log decisions** — every architectural choice, tradeoff, or "why not" should be captured via `log_decision`. This is the most important habit for institutional memory.');
  lines.push('3. **Complete tasks properly** — always provide a meaningful summary. Work is only visible if it\'s completed through the workflow.');
  lines.push('4. **Don\'t do untracked work** — found something out of scope? Add it as a task:');
  lines.push('   ```bash');
  lines.push('   enginehaus task add -t "Discovered: something needs fixing" -p medium');
  lines.push('   ```');
  lines.push('');

  lines.push('### Quality Enforcement');
  lines.push('');
  lines.push('`complete_task_smart` (the MCP tool behind `task complete`) enforces these structural checks:');
  lines.push('');
  lines.push('| Check | Behavior | Override |');
  lines.push('|-------|----------|---------|');
  lines.push('| **Uncommitted changes** | Blocks completion | Commit your work first |');
  lines.push('| **Unpushed commits** | Blocks completion | `git push` before completing |');
  lines.push('| **No decisions logged** | Warning (or blocks if `enforceQuality: true`) | Log at least one decision |');
  lines.push('| **No tests detected** | Warning (or blocks if `enforceQuality: true`) | Add tests or set `enforceQuality: false` |');
  lines.push('');

  lines.push('### Phase Workflow (for complex tasks)');
  lines.push('');
  lines.push('For tasks touching 3+ files, use phases to structure your work:');
  lines.push('');
  lines.push('```bash');
  lines.push('# After completing a phase of work:');
  lines.push('# Use advance_phase MCP tool with commit SHA and note');
  lines.push('');
  lines.push('# Skip phases that don\'t apply:');
  lines.push('# Use skip_phase MCP tool with reason');
  lines.push('```');
  lines.push('');
  lines.push('**Phases:** Context & Planning -> Architecture -> Core Implementation -> Integration -> Testing -> Documentation -> Review -> Deployment');
  lines.push('');

  lines.push('### Useful Commands');
  lines.push('');
  lines.push('```bash');
  lines.push('enginehaus task list              # See all tasks');
  lines.push('enginehaus task show <id>         # Task details');
  lines.push('enginehaus task release <id>      # Unclaim without completing');
  lines.push('enginehaus decision list          # Recent decisions');
  lines.push('enginehaus stats                  # Coordination statistics');
  lines.push('enginehaus analyze worldview      # Cross-project insights');
  lines.push('enginehaus arch health            # Component health report');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Update the Enginehaus section of an existing CLAUDE.md file.
 * Preserves all project-specific content above the --- separator.
 * Returns the updated content, or null if no Enginehaus section was found.
 */
export function updateEnginehausSection(existingContent: string): string {
  // Look for the Enginehaus section marker
  const markerRegex = /<!-- ENGINEHAUS_INSTRUCTIONS_VERSION: [\d.]+ -->/;
  const hasMarker = markerRegex.test(existingContent);

  if (hasMarker) {
    // Find the --- separator before the marker
    const markerIndex = existingContent.search(markerRegex);
    // Walk backwards to find the preceding ---
    const beforeMarker = existingContent.substring(0, markerIndex);
    const separatorIndex = beforeMarker.lastIndexOf('---');

    if (separatorIndex >= 0) {
      // Preserve everything before the separator (project-specific content)
      const projectContent = existingContent.substring(0, separatorIndex).trimEnd();
      return projectContent + '\n\n---\n\n' + generateEnginehausSection();
    }
  }

  // No existing Enginehaus section — append it
  const trimmed = existingContent.trimEnd();
  return trimmed + '\n\n---\n\n' + generateEnginehausSection();
}

/**
 * Generate minimal CLAUDE.md for quick setup
 */
export function generateMinimalClaudeMd(projectName: string): string {
  return `# ${projectName}

---

<!-- ENGINEHAUS_INSTRUCTIONS_VERSION: 2.1 -->

## Enginehaus Coordination

> Enginehaus Instructions v2.1

### Every Session

The SessionStart hook runs \`enginehaus briefing\` automatically. Then:

\`\`\`bash
enginehaus task next              # Claim highest priority task
enginehaus decision log "Why X" -r "rationale" -c architecture  # Log decisions
enginehaus task complete <id> -s "summary"  # Complete when done
\`\`\`

### Critical Rules

1. **Never access SQLite directly** — use CLI/MCP tools only
2. **Log decisions** — capture architectural choices via \`log_decision\`
3. **Complete tasks properly** — always provide a summary
4. **Don't do untracked work** — \`enginehaus task add -t "title" -p medium\`

### Quality Enforcement

Completion blocks on: uncommitted changes, unpushed commits.
Warns on: no decisions logged, no tests detected.
`;
}
