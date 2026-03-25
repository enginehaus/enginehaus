/**
 * Project CLI commands: list, active, init, delete
 */

import { Command } from 'commander';
import * as path from 'path';
import { CliContext } from '../cli-context.js';
import { TaskPriority, ProjectDomain } from '../../coordination/types.js';
import { expandPath } from '../../utils/paths.js';
import {
  detectTechStack,
  detectDomain,
  createEngineHausDir,
  generateClaudeMd,
} from '../../onboarding/index.js';

export function registerProjectCommands(program: Command, ctx: CliContext): void {
  const { coordination, registerCommand } = ctx;

  const projectCmd = program
    .command('project')
    .description('Manage projects');

  // Register project command specs for agent-help
  registerCommand({
    command: 'project list',
    description: 'List all projects',
    example: 'enginehaus project list',
    altExamples: [
      'enginehaus project list --json',
    ],
    args: [],
    options: [
      { flags: '--json', description: 'Output as JSON', required: false },
    ],
  });

  registerCommand({
    command: 'project active',
    description: 'Show or set active project',
    example: 'enginehaus project active',
    altExamples: [
      'enginehaus project active my-project',
    ],
    args: [
      { name: 'slug', required: false, description: 'Project slug to set as active' },
    ],
    options: [],
  });

  registerCommand({
    command: 'project init',
    description: 'Initialize a new project in the current directory',
    example: 'enginehaus project init -n "My Project"',
    altExamples: [
      'enginehaus project init -n "API Server" -d api -t "typescript,node"',
      'enginehaus project init -n "My App" --minimal --no-welcome-task',
    ],
    args: [],
    options: [
      { flags: '-n, --name <name>', description: 'Project name', required: true },
      { flags: '-d, --domain <domain>', description: 'Project domain (web, mobile, api, infrastructure, ml, other)', required: false },
      { flags: '-t, --tech <tech>', description: 'Comma-separated tech stack', required: false },
      { flags: '--description <description>', description: 'Project description', required: false },
      { flags: '--no-claude-md', description: 'Skip CLAUDE.md generation', required: false },
      { flags: '--no-welcome-task', description: 'Skip welcome task creation', required: false },
      { flags: '--minimal', description: 'Generate minimal CLAUDE.md', required: false },
    ],
  });

  registerCommand({
    command: 'project delete',
    description: 'Delete a project and all its tasks, sessions, and decisions',
    example: 'enginehaus project delete my-project',
    altExamples: [
      'enginehaus project delete my-project --force',
    ],
    args: [
      { name: 'slug', required: true, description: 'Project slug or ID' },
    ],
    options: [
      { flags: '-f, --force', description: 'Skip confirmation prompt', required: false },
    ],
  });

  // ── Command handlers ──────────────────────────────────────────────────────

  projectCmd
    .command('list')
    .description('List all projects')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await coordination.initialize();
      const projects = await coordination.listProjects();

      if (opts.json) {
        console.log(JSON.stringify(projects, null, 2));
      } else {
        const activeProject = await coordination.getActiveProject();
        const activeId = activeProject?.id;
        console.log('\nProjects:\n');
        projects.forEach(p => {
          const active = p.id === activeId ? ' (active)' : '';
          console.log(`  ${p.slug}${active}`);
          console.log(`    Name: ${p.name}`);
          console.log(`    Status: ${p.status}`);
          console.log(`    Path: ${p.rootPath}`);
          console.log('');
        });
      }
    });

  projectCmd
    .command('active')
    .description('Show or set active project')
    .argument('[slug]', 'Project slug to set as active')
    .action(async (slug) => {
      await coordination.initialize();

      if (slug) {
        try {
          await coordination.setActiveProject(slug);
          const project = await coordination.getActiveProject();
          console.log(`Active project set to: ${project?.name} (${project?.slug})`);
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : error}`);
          process.exit(1);
        }
      } else {
        const project = await coordination.getActiveProject();
        if (project) {
          console.log(`Active project: ${project.name} (${project.slug})`);
          console.log(`  Path: ${project.rootPath}`);
          console.log(`  Domain: ${project.domain}`);
          console.log(`  Tech Stack: ${project.techStack?.join(', ') || 'none'}`);
        } else {
          console.log('No active project');
        }
      }
    });

  projectCmd
    .command('init')
    .description('Initialize a new project in the current directory')
    .requiredOption('-n, --name <name>', 'Project name')
    .option('-d, --domain <domain>', 'Project domain (web, mobile, api, infrastructure, ml, other)')
    .option('-t, --tech <tech>', 'Comma-separated tech stack (e.g., "typescript,react,node")')
    .option('--description <description>', 'Project description')
    .option('--no-claude-md', 'Skip CLAUDE.md generation')
    .option('--no-welcome-task', 'Skip welcome task creation')
    .option('--minimal', 'Generate minimal CLAUDE.md')
    .action(async (opts) => {
      await coordination.initialize();
      const { existsSync } = await import('fs');

      const cwd = process.cwd();
      const dirName = path.basename(cwd);

      // Generate slug from directory name
      const slug = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Check if project already exists for this path
      const projects = await coordination.listProjects();
      const existing = projects.find(p => expandPath(p.rootPath) === cwd);
      if (existing) {
        console.error(`Error: Project already exists for this directory: ${existing.name} (${existing.slug})`);
        process.exit(1);
      }

      // Check if slug is taken
      const slugTaken = projects.find(p => p.slug === slug);
      if (slugTaken) {
        console.error(`Error: Project slug "${slug}" already in use by: ${slugTaken.name}`);
        process.exit(1);
      }

      // Auto-detect tech stack if not provided
      let techStack = opts.tech ? opts.tech.split(',').map((t: string) => t.trim()) : [];
      let techStackSource = 'user-provided';
      if (techStack.length === 0) {
        techStack = detectTechStack(cwd);
        techStackSource = techStack.length > 0 ? 'auto-detected' : 'none';
      }

      // Auto-detect domain if not provided
      const validDomains: ProjectDomain[] = ['web', 'mobile', 'api', 'infrastructure', 'ml', 'other'];
      let domain: ProjectDomain;
      let domainSource = 'user-provided';
      if (opts.domain && validDomains.includes(opts.domain as ProjectDomain)) {
        domain = opts.domain as ProjectDomain;
      } else {
        domain = detectDomain(cwd, techStack);
        domainSource = 'auto-detected';
      }

      // Create project through CoordinationService (generates ID, emits events)
      const project = await coordination.createProject({
        name: opts.name,
        slug,
        description: opts.description,
        rootPath: cwd,
        domain,
        techStack,
      });

      // Set as active project
      await coordination.setActiveProject(project.id);

      // Create .enginehaus/ directory marker
      createEngineHausDir(cwd);

      // Generate CLAUDE.md if requested
      const claudeMdPath = path.join(cwd, 'CLAUDE.md');
      let claudeMdCreated = false;
      if (opts.claudeMd !== false) {
        if (existsSync(claudeMdPath)) {
          console.log('\n  Note: CLAUDE.md already exists - not overwriting');
        } else {
          const { writeFileSync } = await import('fs');
          const content = generateClaudeMd({ project, includeQuickStart: !opts.minimal });
          writeFileSync(claudeMdPath, content);
          claudeMdCreated = true;
        }
      }

      // Create welcome task if requested
      let welcomeTaskId: string | null = null;
      if (opts.welcomeTask !== false) {
        const welcomeTask = await coordination.createTask({
          title: 'Complete project setup and review Enginehaus workflow',
          description: `Welcome to ${project.name}!

**Your first steps:**
1. Run \`enginehaus briefing\` to see project status
2. Review the CLAUDE.md file for workflow guidelines
3. When ready, complete this task: \`enginehaus task complete <id> -s "Project setup complete"\`

**Tips for effective coordination:**
- Use \`log_decision\` MCP tool to record important decisions
- Add discovered work with \`enginehaus task add\`
- Run \`enginehaus stats\` to see coordination metrics`,
          priority: 'medium' as TaskPriority,
          projectId: project.id,
        });
        welcomeTaskId = welcomeTask.id;
      }

      // Output results
      console.log('\n✅ Project initialized!\n');
      console.log(`  Name:       ${project.name}`);
      console.log(`  Slug:       ${project.slug}`);
      console.log(`  Path:       ${project.rootPath}`);
      console.log(`  Domain:     ${project.domain} (${domainSource})`);
      if (techStack.length > 0) {
        console.log(`  Tech Stack: ${techStack.join(', ')} (${techStackSource})`);
      }
      console.log('');
      console.log('  Created:');
      console.log('    - .enginehaus/ directory marker');
      if (claudeMdCreated) {
        console.log('    - CLAUDE.md with coordination guidelines');
      }
      if (welcomeTaskId) {
        console.log('    - Welcome task to guide first session');
      }
      console.log('');
      console.log('  Next steps:');
      console.log('    1. Start Claude Code in this directory');
      console.log('    2. Run: enginehaus briefing');
      console.log('    3. Complete the welcome task to learn the workflow');
      console.log('');
    });

  projectCmd
    .command('update <slug>')
    .description('Update project properties')
    .option('--name <name>', 'New project name')
    .option('--root-path <path>', 'New root path')
    .option('--domain <domain>', 'New domain (web, mobile, api, infrastructure, ml, other)')
    .option('--tech <tech>', 'Comma-separated tech stack')
    .option('--description <description>', 'New description')
    .option('--json', 'Output as JSON')
    .action(async (slug: string, opts: {
      name?: string; rootPath?: string; domain?: string;
      tech?: string; description?: string; json?: boolean;
    }) => {
      await coordination.initialize();
      const projects = await coordination.listProjects();
      const project = projects.find(p => p.slug === slug || p.id === slug || p.id.startsWith(slug));

      if (!project) {
        console.error(`\nProject not found: ${slug}`);
        console.error('Available projects:');
        projects.forEach(p => console.error(`  - ${p.slug} (${p.name})`));
        process.exit(1);
      }

      const updates: Record<string, unknown> = {};
      if (opts.name) updates.name = opts.name;
      if (opts.rootPath) updates.rootPath = expandPath(opts.rootPath);
      if (opts.domain) {
        const validDomains: ProjectDomain[] = ['web', 'mobile', 'api', 'infrastructure', 'ml', 'other'];
        if (!validDomains.includes(opts.domain as ProjectDomain)) {
          console.error(`Invalid domain: ${opts.domain}. Must be one of: ${validDomains.join(', ')}`);
          process.exit(1);
        }
        updates.domain = opts.domain;
      }
      if (opts.tech) updates.techStack = opts.tech.split(',').map(t => t.trim());
      if (opts.description) updates.description = opts.description;

      if (Object.keys(updates).length === 0) {
        console.error('\nNo updates specified. Use --name, --root-path, --domain, --tech, or --description.');
        process.exit(1);
      }

      await coordination.updateProject(project.id, updates);
      const result = await coordination.getProjectByIdOrSlug(project.slug);
      const updated = result.project;

      if (opts.json) {
        console.log(JSON.stringify(updated, null, 2));
      } else {
        console.log(`\nUpdated project: ${updated?.name} (${updated?.slug})\n`);
        for (const [key, value] of Object.entries(updates)) {
          const oldVal = (project as unknown as Record<string, unknown>)[key];
          console.log(`  ${key}: ${JSON.stringify(oldVal)} -> ${JSON.stringify(value)}`);
        }
        console.log('');
      }
    });

  projectCmd
    .command('delete <slug>')
    .description('Delete a project and all its tasks, sessions, and decisions')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (slug: string, opts: { force?: boolean }) => {
      await coordination.initialize();
      const { createInterface } = await import('readline');

      // Find the project
      const projects = await coordination.listProjects();
      const project = projects.find(p => p.slug === slug || p.id === slug);

      if (!project) {
        console.error(`\n❌ Project not found: ${slug}`);
        console.error('\nAvailable projects:');
        projects.forEach(p => console.error(`  - ${p.slug} (${p.name})`));
        console.error('');
        process.exit(1);
      }

      // Confirmation unless --force
      if (!opts.force) {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          console.log(`\n⚠️  About to delete project: ${project.name} (${project.slug})`);
          console.log(`   Path: ${project.rootPath}`);
          console.log('');
          console.log('   This will permanently delete:');
          console.log('   - All tasks associated with this project');
          console.log('   - All sessions and decisions');
          console.log('   - The project database entry');
          console.log('');
          console.log('   Note: Files in the project directory are NOT deleted.');
          console.log('');
          rl.question('   Type the project slug to confirm: ', resolve);
        });
        rl.close();

        if (answer !== project.slug) {
          console.log('\n❌ Cancelled. Slug did not match.\n');
          process.exit(1);
        }
      }

      // Delete the project
      const result = await coordination.deleteProjectByIdOrSlug(project.id);

      if (result.success) {
        console.log(`\n✅ Project deleted: ${project.name} (${project.slug})\n`);
      } else {
        console.error(`\n❌ Failed to delete project: ${result.error}\n`);
        process.exit(1);
      }
    });
}
