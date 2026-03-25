/**
 * Onboarding CLI commands: init, instructions, link, uninstall
 *
 * These commands handle project setup, configuration display,
 * directory linking, and clean removal of Enginehaus.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { CliContext } from '../cli-context.js';
import { TaskPriority, Project, ProjectDomain } from '../../coordination/types.js';
import { expandPath } from '../../utils/paths.js';
import {
  detectTechStack,
  detectDomain,
  createEngineHausDir,
  generateClaudeMd,
  detectBuildCommands,
} from '../../onboarding/index.js';
import { loadProfile, listProfiles } from '../../profiles/loader.js';
import { profilePhasesToDefinitions } from '../../profiles/types.js';
import {
  getClient,
  listClients,
  listClientIds,
  readClientConfig,
  generateClientInstructions,
} from '../../clients/index.js';

/** Interactive questionnaire for init — skipped with --yes */
interface InitAnswers {
  projectDescription?: string;
  projectState?: 'just-started' | 'in-progress' | 'maintenance';
  constraints?: string;
  agentMode?: 'solo' | 'multi';
  firstTask?: string;
}

async function runInitQuestionnaire(): Promise<InitAnswers> {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question: string): Promise<string> =>
    new Promise(resolve => rl.question(question, resolve));

  const select = async (question: string, options: string[]): Promise<string> => {
    console.log(question);
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
    const answer = await ask('  > ');
    const idx = parseInt(answer, 10) - 1;
    rl.close();
    // Re-open for next question is handled by caller
    return (idx >= 0 && idx < options.length) ? options[idx] : options[0];
  };

  const answers: InitAnswers = {};

  try {
    console.log('\n  Quick setup (press Enter to skip any question)\n');

    // Q1: What is this project?
    const desc = await ask('  What is this project? (one sentence)\n  > ');
    if (desc.trim()) answers.projectDescription = desc.trim();

    // Q2: Current state
    console.log('\n  What\'s the current state?');
    console.log('    1. Just started');
    console.log('    2. In progress');
    console.log('    3. Maintenance');
    const stateAnswer = await ask('  > ');
    const stateMap: Record<string, InitAnswers['projectState']> = {
      '1': 'just-started', '2': 'in-progress', '3': 'maintenance',
    };
    if (stateMap[stateAnswer.trim()]) answers.projectState = stateMap[stateAnswer.trim()];

    // Q3: Constraints
    const constraints = await ask('\n  What should agents never do without asking you first?\n  > ');
    if (constraints.trim()) answers.constraints = constraints.trim();

    // Q4: Solo or multi-agent
    console.log('\n  Solo or multi-agent?');
    console.log('    1. Solo (one agent at a time)');
    console.log('    2. Multi-agent (parallel work)');
    const modeAnswer = await ask('  > ');
    answers.agentMode = modeAnswer.trim() === '2' ? 'multi' : 'solo';

    // Q5: First task
    const firstTask = await ask('\n  What\'s the single most important thing to get done next?\n  > ');
    if (firstTask.trim()) answers.firstTask = firstTask.trim();

    console.log('');
  } finally {
    rl.close();
  }

  return answers;
}

export function registerOnboardingCommands(program: Command, ctx: CliContext): void {
  const { coordination, resolveProject, registerCommand } = ctx;

  // ==========================================================================
  // Profile Management
  // ==========================================================================

  const profileCmd = program.command('profile').description('Manage domain profiles');

  profileCmd
    .command('list')
    .description('List available domain profiles')
    .action(async () => {
      const profiles = await listProfiles();
      console.log('\nAvailable profiles:\n');
      for (const p of profiles) {
        const exp = p.experimental ? ' (experimental)' : '';
        console.log(`  ${p.name} — ${p.label}${exp}`);
      }
      console.log('\nApply with: enginehaus init --profile <name>');
      console.log('');
    });

  // ==========================================================================
  // Quick Start: Top-level init command
  // ==========================================================================

  program
    .command('init')
    .description('Initialize Enginehaus in the current directory')
    .argument('[name]', 'Project name (defaults to directory name)')
    .option('-d, --domain <domain>', 'Project domain (web, mobile, api, infrastructure, ml, other)')
    .option('-t, --tech <tech>', 'Comma-separated tech stack')
    .option('--description <description>', 'Project description')
    .option('--minimal', 'Generate minimal CLAUDE.md')
    .option('--skip-mcp', 'Skip MCP configuration for Claude Desktop')
    .option('--profile <name>', 'Domain profile: software (default), writing, research')
    .option('-y, --yes', 'Skip interactive questionnaire')
    .action(async (name, opts) => {
      await coordination.initialize();
      const { existsSync, writeFileSync, readFileSync, mkdirSync } = await import('fs');

      const cwd = process.cwd();
      const dirName = path.basename(cwd);

      // Use provided name or derive from directory
      const projectName = name || dirName.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      // Generate slug from directory name
      const slug = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Check if project already exists for this path
      const projects = await coordination.listProjects();
      const existing = projects.find(p => expandPath(p.rootPath) === cwd);
      if (existing) {
        console.log(`\n✅ Already initialized: ${existing.name}\n`);
        console.log('Ready to use:');
        console.log('  eh add "Your task"    # Add a task');
        console.log('  eh next               # Claim next priority task');
        console.log('');
        return;
      }

      // Check if slug is taken
      const slugTaken = projects.find(p => p.slug === slug);
      if (slugTaken) {
        console.error(`Error: Project slug "${slug}" already in use by: ${slugTaken.name}`);
        console.error('Use: enginehaus project init -n "Name" to specify a different name');
        process.exit(1);
      }

      // Auto-detect tech stack (silently)
      let techStack = opts.tech ? opts.tech.split(',').map((t: string) => t.trim()) : [];
      if (techStack.length === 0) {
        techStack = detectTechStack(cwd);
      }

      // Auto-detect domain (silently)
      const validDomains: ProjectDomain[] = ['web', 'mobile', 'api', 'infrastructure', 'ml', 'other'];
      let domain: ProjectDomain;
      if (opts.domain && validDomains.includes(opts.domain as ProjectDomain)) {
        domain = opts.domain as ProjectDomain;
      } else {
        domain = detectDomain(cwd, techStack);
      }

      // Create project through CoordinationService (generates ID, emits events)
      const project = await coordination.createProject({
        name: projectName,
        slug,
        description: opts.description,
        rootPath: cwd,
        domain,
        techStack,
      });
      await coordination.setActiveProject(project.id);

      // Interactive questionnaire (skip with --yes or non-TTY)
      let initAnswers: InitAnswers = {};
      if (!opts.yes && process.stdin.isTTY) {
        initAnswers = await runInitQuestionnaire();
        // Update project description if provided
        if (initAnswers.projectDescription && !opts.description) {
          await coordination.updateProject(project.id, { description: initAnswers.projectDescription });
        }
      }

      // Create .enginehaus/ directory with config
      createEngineHausDir(cwd);
      const configPath = path.join(cwd, '.enginehaus', 'config.json');
      const config = {
        version: '1.0',
        projectId: project.id,
        projectSlug: project.slug,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      // Apply domain profile if specified
      if (opts.profile) {
        const profile = await loadProfile(opts.profile);
        if (!profile) {
          const available = (await listProfiles()).map(p => p.name).join(', ');
          console.error(`Unknown profile: ${opts.profile}. Available: ${available}`);
          process.exit(1);
        }

        if (profile.experimental) {
          console.log(`\n⚠️  Profile "${profile.label}" is experimental — functional but evolving.`);
        }

        // Merge profile settings into project config
        const profileConfig = {
          ...JSON.parse(readFileSync(configPath, 'utf-8')),
          workflow: {
            phases: {
              definition: 'custom',
              custom: {
                name: profile.label,
                description: `${profile.label} workflow phases`,
                phases: profilePhasesToDefinitions(profile.phases),
              },
            },
          },
          quality: {
            profileGates: profile.qualityGates,
          },
          decisions: {
            categories: profile.decisionCategories,
          },
          tasks: {
            checkpointProtocol: profile.checkpointProtocol,
            ...(profile.checkpointProtocol === 'manual' ? {
              requireCommitOnCompletion: false,
              requirePushOnCompletion: false,
            } : {}),
          },
          context: {
            labels: profile.contextLabels,
          },
        };
        writeFileSync(configPath, JSON.stringify(profileConfig, null, 2));

        console.log(`\n✅ Applied "${profile.label}" profile`);
        console.log(`   Phases: ${profile.phases.map(p => p.name).join(' → ')}`);
        console.log(`   Decision categories: ${profile.decisionCategories.join(', ')}`);
        console.log(`   Quality gates: ${profile.qualityGates.map(g => g.name).join(', ')}`);
        console.log(`   Checkpoint protocol: ${profile.checkpointProtocol}`);
      }

      // Generate CLAUDE.md if it doesn't exist
      const claudeMdPath = path.join(cwd, 'CLAUDE.md');
      let claudeMdCreated = false;
      if (!existsSync(claudeMdPath)) {
        const customGuidelines: string[] = [];
        if (initAnswers.constraints) {
          customGuidelines.push(`## Constraints\n\n**Never do these without asking the human first:**\n- ${initAnswers.constraints}`);
        }
        if (initAnswers.projectDescription) {
          customGuidelines.push(`## About This Project\n\n${initAnswers.projectDescription}`);
        }
        const content = generateClaudeMd({
          project: initAnswers.projectDescription
            ? { ...project, description: initAnswers.projectDescription }
            : project,
          includeQuickStart: !opts.minimal,
          customGuidelines: customGuidelines.length > 0 ? customGuidelines : undefined,
        });
        writeFileSync(claudeMdPath, content);
        claudeMdCreated = true;
      }

      // Configure MCP for all supported tools
      type McpStatus = 'configured' | 'already' | 'failed' | 'skipped';
      const mcpResults: Record<string, { status: McpStatus; error?: string }> = {};

      // Find the enginehaus build path
      // import.meta.url = .../build/bin/commands/onboarding-commands.js → up 3 to project root
      const ehProjectDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
      const indexJs = path.join(ehProjectDir, 'build', 'index.js');

      // Helper: patch or create an MCP config file
      const patchMcpConfig = (
        filePath: string,
        serverKey: string,          // e.g. "mcpServers" or "servers"
        serverConfig: Record<string, unknown>,
        createDirs: boolean = false,
      ): McpStatus => {
        try {
          if (existsSync(filePath)) {
            const existing = JSON.parse(readFileSync(filePath, 'utf-8'));
            const servers = existing[serverKey] || {};
            if (servers.enginehaus) return 'already';
            servers.enginehaus = serverConfig;
            existing[serverKey] = servers;
            writeFileSync(filePath, JSON.stringify(existing, null, 2));
            return 'configured';
          } else {
            if (createDirs) mkdirSync(path.dirname(filePath), { recursive: true });
            writeFileSync(filePath, JSON.stringify({ [serverKey]: { enginehaus: serverConfig } }, null, 2));
            return 'configured';
          }
        } catch (error) {
          return 'failed';
        }
      };

      const stdioConfig = { type: 'stdio' as const, command: 'node', args: [indexJs] };
      const bareConfig = { command: 'node', args: [indexJs] };

      // 1. Claude Code — .mcp.json (project-scoped, always)
      mcpResults['Claude Code'] = {
        status: patchMcpConfig(path.join(cwd, '.mcp.json'), 'mcpServers', stdioConfig),
      };

      // 2. Cursor — .cursor/mcp.json (project-scoped, always)
      const cursorDir = path.join(cwd, '.cursor');
      if (!existsSync(cursorDir)) mkdirSync(cursorDir, { recursive: true });
      mcpResults['Cursor'] = {
        status: patchMcpConfig(path.join(cursorDir, 'mcp.json'), 'mcpServers', stdioConfig),
      };

      // 3. VS Code / Copilot — .vscode/mcp.json (project-scoped, always)
      // VS Code uses "servers" key (not "mcpServers") and "type" is required
      const vscodeDir = path.join(cwd, '.vscode');
      if (!existsSync(vscodeDir)) mkdirSync(vscodeDir, { recursive: true });
      mcpResults['VS Code'] = {
        status: patchMcpConfig(path.join(vscodeDir, 'mcp.json'), 'servers', stdioConfig),
      };

      // 4. Claude Desktop — global config (unless skipped)
      if (!opts.skipMcp) {
        const platform = process.platform;
        let claudeConfigPath: string;
        if (platform === 'darwin') {
          claudeConfigPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        } else if (platform === 'win32') {
          claudeConfigPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
        } else {
          claudeConfigPath = path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json');
        }
        mcpResults['Claude Desktop'] = {
          status: patchMcpConfig(claudeConfigPath, 'mcpServers', bareConfig, true),
        };
      } else {
        mcpResults['Claude Desktop'] = { status: 'skipped' };
      }

      // 5. Windsurf — global config (only if directory exists)
      const windsurfBase = process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming', 'Codeium', 'windsurf', 'mcp_config.json')
        : path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
      if (existsSync(path.dirname(windsurfBase))) {
        mcpResults['Windsurf'] = {
          status: patchMcpConfig(windsurfBase, 'mcpServers', stdioConfig, true),
        };
      }

      // 6. Kiro CLI — project-level config (only if .kiro/ exists)
      const kiroConfigPath = path.join(cwd, '.kiro', 'settings', 'mcp.json');
      if (existsSync(path.join(cwd, '.kiro')) ||
          existsSync(path.join(os.homedir(), '.kiro'))) {
        mcpResults['Kiro CLI'] = {
          status: patchMcpConfig(kiroConfigPath, 'mcpServers', stdioConfig, true),
        };
      }

      // 7. Gemini CLI — project-level config (only if .gemini/ exists)
      if (existsSync(path.join(cwd, '.gemini')) ||
          existsSync(path.join(os.homedir(), '.gemini'))) {
        const geminiConfigPath = path.join(cwd, '.gemini', 'settings.json');
        mcpResults['Gemini CLI'] = {
          status: patchMcpConfig(geminiConfigPath, 'mcpServers', stdioConfig, true),
        };
      }

      // 8. LM Studio — global config (only if ~/.lmstudio/ exists)
      const lmStudioDir = path.join(os.homedir(), '.lmstudio');
      if (existsSync(lmStudioDir)) {
        mcpResults['LM Studio'] = {
          status: patchMcpConfig(path.join(lmStudioDir, 'mcp.json'), 'mcpServers', stdioConfig, true),
        };
      }

      // Create first task — either from Q5 answer or default welcome task
      if (initAnswers.firstTask) {
        await coordination.createTask({
          title: initAnswers.firstTask,
          priority: 'high' as TaskPriority,
          projectId: project.id,
        });
      }
      // Always create the explore task (low priority, teaches the workflow)
      await coordination.createTask({
        title: 'Explore Enginehaus',
        description: `Welcome! This task exists so you can try the workflow.

Try these:
- \`eh list\` - See your tasks
- \`eh next\` - Claim this task and start working
- \`log_decision()\` - Capture a choice (MCP tool)

Complete this task anytime:
\`enginehaus task complete <id> -s "Explored the basics"\``,
        priority: 'low' as TaskPriority,
        type: 'docs',
        projectId: project.id,
      });

      // Log initial decision capturing project intent
      if (initAnswers.projectDescription || initAnswers.agentMode) {
        await coordination.logDecision({
          decision: `Initialize ${projectName} with Enginehaus`,
          rationale: [
            initAnswers.projectDescription ? `Project: ${initAnswers.projectDescription}` : null,
            initAnswers.projectState ? `State: ${initAnswers.projectState}` : null,
            initAnswers.agentMode ? `Mode: ${initAnswers.agentMode}` : null,
            initAnswers.constraints ? `Constraints: ${initAnswers.constraints}` : null,
          ].filter(Boolean).join('. '),
          category: 'architecture',
          projectId: project.id,
        });
      }

      // =========================================================================
      // OUTPUT: Human-centered curriculum style
      // =========================================================================

      console.log(`\n✅ Enginehaus initialized for ${projectName}\n`);

      // What this means (empowerment: explain the value in user terms)
      console.log('What this means:');
      console.log('  • Your conversations with Claude now have memory');
      console.log('  • Decisions you make are captured and retrievable');
      console.log('  • You can hand off work between Code and Desktop seamlessly');
      console.log('');

      // Status per tool (clear at-a-glance)
      const codeLabel = claudeMdCreated ? 'CLAUDE.md created' : 'CLAUDE.md exists';
      console.log(`  Claude Code:    ${codeLabel}`);
      console.log('');
      console.log('MCP configured for:');
      for (const [tool, result] of Object.entries(mcpResults)) {
        const icon = result.status === 'configured' ? '✅' :
                     result.status === 'already' ? '✓ ' :
                     result.status === 'skipped' ? '⏭️' : '❌';
        const label = result.status === 'configured' ? 'configured' :
                      result.status === 'already' ? 'already set' :
                      result.status === 'skipped' ? 'skipped' : 'failed';
        console.log(`  ${icon} ${tool}: ${label}`);
      }
      console.log('');

      // Desktop instructions inline (respect: show, don't hide)
      if (mcpResults['Claude Desktop']?.status === 'configured' || mcpResults['Claude Desktop']?.status === 'already') {
        console.log('📋 Copy to Desktop project settings:');
        console.log('─'.repeat(50));
        // Compact inline instructions
        console.log(`# ${projectName} — Enginehaus Coordination

## Session Start
get_briefing()  // Always first

## Workflow
start_work()                      // Get next task
log_decision({ decision, rationale, category })
finish_work({ summary })          // Complete task

## Handoff to Code
quick_handoff({ targetAgent: "claude-code", context: "..." })

## Rules
1. Get briefing first
2. Log decisions as you go
3. Use MCP tools, not SQLite directly`);
        console.log('─'.repeat(50));
        console.log('');
      }

      // Wheelhaus (empowerment: see everything)
      console.log('📊 Wheelhaus (see everything): enginehaus serve → localhost:4747');
      console.log('');

      // Single clear next step with explanation (respect: not a forced flow)
      console.log('Next: Open Claude Code and run start_work()');
      console.log('      This claims a task and shows you what to work on.');
      console.log('');
    });

  // ==========================================================================
  // Instructions Command: Regenerate setup instructions without re-init
  // ==========================================================================

  program
    .command('instructions')
    .argument('[target]', 'Target client: desktop, code, mcp, or any registered client (default: desktop)')
    .description('Show setup instructions for Claude Desktop, Code, or other clients')
    .option('--json', 'Output as JSON')
    .option('--list', 'List available clients')
    .action(async (target: string | undefined, opts: { json?: boolean; list?: boolean }) => {
      // List available clients
      if (opts.list) {
        const clients = listClients();
        if (opts.json) {
          console.log(JSON.stringify(clients.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            requiresMCPConfig: c.requiresMCPConfig,
            instructionFile: c.instructionFile,
          })), null, 2));
        } else {
          console.log('\nAvailable clients:\n');
          clients.forEach(c => {
            console.log(`  ${c.id.padEnd(16)} ${c.name}`);
            console.log(`                   ${c.description}`);
            if (c.instructionFile) {
              console.log(`                   Instruction file: ${c.instructionFile}`);
            }
            console.log('');
          });
        }
        return;
      }

      await coordination.initialize();
      const cwd = process.cwd();

      // Detect project from current directory
      const projects = await coordination.listProjects();
      const project = projects.find(p => expandPath(p.rootPath) === cwd);

      if (!project) {
        console.error('\n❌ No Enginehaus project found in this directory.');
        console.error('   Run `enginehaus init` first, or cd to a project directory.\n');
        process.exit(1);
      }

      const targetType = (target || 'desktop').toLowerCase();

      // Map short names to client IDs
      const clientIdMap: Record<string, string> = {
        'desktop': 'claude-desktop',
        'code': 'claude-code',
      };
      const clientId = clientIdMap[targetType] || targetType;

      // Special case: mcp shows config info
      if (targetType === 'mcp') {
        // Use client registry for config path
        const configResult = readClientConfig('claude-desktop');

        if (opts.json) {
          console.log(JSON.stringify({
            type: 'mcp',
            ...configResult,
            platform: process.platform,
          }, null, 2));
        } else {
          console.log('\n🔧 MCP Configuration\n');
          console.log(`Config file: ${configResult.configPath}`);
          console.log(`Status: ${configResult.exists ? '✅ Exists' : '❌ Not found'}`);
          console.log('');

          if (configResult.exists && configResult.valid) {
            console.log(`Enginehaus entry: ${configResult.hasEnginehaus ? '✅ Configured' : '❌ Not configured'}`);
            if (configResult.hasEnginehaus) {
              try {
                const config = JSON.parse(fs.readFileSync(configResult.configPath, 'utf-8'));
                const ehConfig = config.mcpServers?.enginehaus;
                if (ehConfig) {
                  console.log(`  Command: ${ehConfig.command}`);
                  console.log(`  Args: ${JSON.stringify(ehConfig.args)}`);
                }
              } catch {
                // Already reported as valid, just skip details
              }
            }
          } else if (configResult.exists && !configResult.valid) {
            console.log('⚠️  Could not parse config file');
            if (configResult.error) {
              console.log(`   Error: ${configResult.error}`);
            }
          } else {
            console.log('Run `enginehaus init` to configure MCP automatically.');
          }
          console.log('');
        }
        return;
      }

      // Try to get client from registry
      const client = getClient(clientId);

      if (!client) {
        console.error(`\n❌ Unknown client: ${targetType}`);
        console.error('   Available clients: ' + listClientIds().join(', '));
        console.error('   Also: mcp (show MCP config status)\n');
        process.exit(1);
      }

      // Generate instructions using client's template
      const instructions = generateClientInstructions(clientId, {
        project,
        webConsolePort: 4747,
      });

      if (!instructions) {
        console.error(`\n❌ Could not generate instructions for ${client.name}\n`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({
          type: clientId,
          client: client.name,
          project: project.name,
          instructions,
          instructionFile: client.instructionFile,
        }, null, 2));
      } else {
        console.log(`\n📋 ${client.name} Instructions\n`);
        if (client.instructionFile) {
          console.log(`This content goes in ${client.instructionFile}:\n`);
        } else if (client.requiresMCPConfig) {
          console.log('Copy this into your project settings:\n');
        }
        console.log('─'.repeat(60));
        console.log(instructions);
        console.log('─'.repeat(60));
        if (client.instructionFile) {
          console.log(`\nFile location: ./${client.instructionFile}`);
        }
        console.log('');
      }
    });

  // ==========================================================================
  // Link Command: Connect existing directory to Enginehaus project
  // ==========================================================================

  program
    .command('link')
    .description('Link current directory to an existing Enginehaus project')
    .option('-p, --project <slug>', 'Project slug to link to (otherwise auto-detect or prompt)')
    .option('--no-claude-md', 'Skip CLAUDE.md generation')
    .option('--force', 'Overwrite existing CLAUDE.md')
    .option('--minimal', 'Generate minimal CLAUDE.md')
    .action(async (opts) => {
      await coordination.initialize();
      const { existsSync, writeFileSync, mkdirSync } = await import('fs');
      const { createInterface } = await import('readline');

      const cwd = process.cwd();
      const dirName = path.basename(cwd);
      const projects = await coordination.listProjects();

      console.log('\n🔗 Linking directory to Enginehaus project...\n');

      let targetProject: Project | undefined;

      // If --project specified, find it
      if (opts.project) {
        targetProject = projects.find(p => p.slug === opts.project);
        if (!targetProject) {
          console.error(`Error: Project with slug "${opts.project}" not found.`);
          console.error('Available projects:');
          projects.forEach(p => console.error(`  - ${p.slug} (${p.name})`));
          process.exit(1);
        }
      } else {
        // Try to auto-detect by matching directory name to slug/name
        const slugMatch = projects.find(p => p.slug === dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        const nameMatch = projects.find(p => p.name.toLowerCase() === dirName.toLowerCase());
        const pathMatch = projects.find(p => expandPath(p.rootPath) === cwd);

        if (pathMatch) {
          console.log(`  Directory already linked to: ${pathMatch.name} (${pathMatch.slug})`);
          targetProject = pathMatch;
        } else if (slugMatch) {
          targetProject = slugMatch;
          console.log(`  Auto-detected project: ${slugMatch.name} (${slugMatch.slug})`);
        } else if (nameMatch) {
          targetProject = nameMatch;
          console.log(`  Auto-detected project: ${nameMatch.name} (${nameMatch.slug})`);
        } else {
          // Prompt user to select
          console.log('  Could not auto-detect project. Available projects:\n');
          projects.forEach((p, i) => {
            console.log(`    ${i + 1}. ${p.name} (${p.slug})`);
            console.log(`       Path: ${p.rootPath}`);
          });
          console.log('');

          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) => {
            rl.question('  Select project number (or press Enter to cancel): ', resolve);
          });
          rl.close();

          const selection = parseInt(answer, 10);
          if (isNaN(selection) || selection < 1 || selection > projects.length) {
            console.log('\nCancelled.\n');
            process.exit(0);
          }

          targetProject = projects[selection - 1];
        }
      }

      if (!targetProject) {
        console.error('Error: No project selected.');
        process.exit(1);
      }

      // Update project rootPath if different
      const currentRootPath = expandPath(targetProject.rootPath);
      if (currentRootPath !== cwd) {
        console.log(`  Updating project path: ${targetProject.rootPath} → ${cwd}`);
        await coordination.updateProject(targetProject.id, { rootPath: cwd });
        targetProject.rootPath = cwd;
      }

      // Create .enginehaus/ directory with config
      const ehDir = path.join(cwd, '.enginehaus');
      if (!existsSync(ehDir)) {
        mkdirSync(ehDir, { recursive: true });
        console.log('  Created .enginehaus/ directory');
      }

      // Create config.json with project binding
      const configPath = path.join(ehDir, 'config.json');
      const config = {
        version: '1.0',
        projectId: targetProject.id,
        projectSlug: targetProject.slug,
        linkedAt: new Date().toISOString(),
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('  Created .enginehaus/config.json');

      // Create project.json marker (for compatibility with init)
      const markerPath = path.join(ehDir, 'project.json');
      if (!existsSync(markerPath)) {
        const marker = {
          version: '1.0',
          createdAt: new Date().toISOString(),
          note: 'This directory marks this folder as an Enginehaus-managed project',
        };
        writeFileSync(markerPath, JSON.stringify(marker, null, 2));
      }

      // Generate CLAUDE.md
      const claudeMdPath = path.join(cwd, 'CLAUDE.md');
      if (opts.claudeMd !== false) {
        if (existsSync(claudeMdPath) && !opts.force) {
          console.log('  CLAUDE.md exists (use --force to overwrite)');
        } else {
          // Detect build commands
          const buildCommands = detectBuildCommands(cwd);
          const hasBuildCommands = Object.values(buildCommands).some(v => v);
          if (hasBuildCommands) {
            console.log('  Detected build commands:');
            if (buildCommands.build) console.log(`    Build: ${buildCommands.build}`);
            if (buildCommands.test) console.log(`    Test: ${buildCommands.test}`);
            if (buildCommands.lint) console.log(`    Lint: ${buildCommands.lint}`);
          }

          // Generate CLAUDE.md with build commands
          const webConsoleUrl = `http://localhost:47471/projects/${targetProject.slug}`;
          const content = generateClaudeMd({
            project: targetProject,
            includeQuickStart: !opts.minimal,
            buildCommands,
            webConsoleUrl,
          });
          writeFileSync(claudeMdPath, content);
          console.log('  Generated CLAUDE.md with workflow instructions');
        }
      }

      // Set as active project
      await coordination.setActiveProject(targetProject.id);

      // Deploy hook scripts and install for all detected clients
      const { deployHookScripts, installAllHooks } = await import('../../hooks/install.js');
      const { detectClients } = await import('../../hooks/client-detection.js');

      const packageRoot = path.resolve(path.dirname(process.argv[1]), '..', '..');
      const packageHooksDir = path.join(packageRoot, 'src', 'hooks');
      const globalHooksDir = deployHookScripts(packageHooksDir);

      const clients = detectClients(cwd);
      const hookResults = installAllHooks(clients, cwd, globalHooksDir);

      for (const [clientId, hookResult] of Object.entries(hookResults)) {
        if (hookResult.installed.length > 0) {
          console.log(`  Installed hooks for ${clientId}: ${hookResult.installed.join(', ')}`);
        }
        if (hookResult.skipped.length > 0) {
          console.log(`  Hooks already configured for ${clientId}: ${hookResult.skipped.join(', ')}`);
        }
        if (hookResult.errors.length > 0) {
          console.log(`  Hook errors for ${clientId}: ${hookResult.errors.join(', ')}`);
        }
      }

      if (Object.keys(hookResults).length === 0) {
        console.log('  No supported hook clients detected (server-side enforcement active)');
      }

      // Summary
      console.log(`\n✅ Linked to ${targetProject.name}!\n`);
      const clientNames = clients.filter(c => c.tier === 1).map(c => c.name);
      if (clientNames.length > 0) {
        console.log(`Hooks installed for: ${clientNames.join(', ')}`);
      }
      console.log('Agents will auto-load project context on session start.');
      console.log('');
    });

  // ==========================================================================
  // Uninstall Command
  // ==========================================================================

  program
    .command('uninstall')
    .description('Remove Enginehaus from this project (moves data to trash)')
    .option('--global', 'Also remove global data (~/.enginehaus)')
    .option('--dry-run', 'Show what would be removed without removing')
    .action(async (opts: { global?: boolean; dryRun?: boolean }) => {
      const { existsSync } = await import('fs');
      const cwd = process.cwd();
      const isDryRun = opts.dryRun;

      // Move a path to the system trash (or fall back to rename)
      const moveToTrash = async (targetPath: string, label: string): Promise<boolean> => {
        if (!existsSync(targetPath)) {
          console.log(`  ⏭  ${label}: not found, skipping`);
          return false;
        }
        if (isDryRun) {
          console.log(`  📋 Would trash: ${targetPath} (${label})`);
          return true;
        }
        const platform = process.platform;
        try {
          if (platform === 'darwin') {
            execFileSync('trash', [targetPath], { stdio: 'pipe' });
          } else if (platform === 'win32') {
            const psScript = [
              'Add-Type -AssemblyName Microsoft.VisualBasic;',
              `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${targetPath}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
            ].join(' ');
            execFileSync('powershell', ['-Command', psScript], { stdio: 'pipe' });
          } else {
            try {
              execFileSync('trash-put', [targetPath], { stdio: 'pipe' });
            } catch {
              const trashDir = path.join(os.homedir(), '.local', 'share', 'Trash', 'files');
              if (!existsSync(trashDir)) {
                fs.mkdirSync(trashDir, { recursive: true });
              }
              const basename = path.basename(targetPath);
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const dest = path.join(trashDir, `${basename}.${timestamp}`);
              fs.renameSync(targetPath, dest);
              console.log(`    (moved to ${dest} — install trash-cli for native trash support)`);
            }
          }
          console.log(`  🗑  Trashed: ${targetPath} (${label})`);
          return true;
        } catch (err: any) {
          console.error(`  ❌ Failed to trash ${targetPath}: ${err.message}`);
          return false;
        }
      };

      console.log('\n🔧 Enginehaus Uninstall\n');

      // 1. Remove project-level .enginehaus directory
      const projectDir = path.join(cwd, '.enginehaus');
      await moveToTrash(projectDir, 'project config (.enginehaus/)');

      // 2. Remove enginehaus hooks from .claude/settings.json
      const claudeSettingsPath = path.join(cwd, '.claude', 'settings.json');
      if (existsSync(claudeSettingsPath)) {
        if (isDryRun) {
          console.log(`  📋 Would remove enginehaus hooks from ${claudeSettingsPath}`);
        } else {
          try {
            const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
            let changed = false;
            if (settings.hooks) {
              for (const hookType of ['SessionStart', 'PreToolUse', 'PostToolUse']) {
                const hooks = settings.hooks[hookType];
                if (Array.isArray(hooks)) {
                  const filtered = hooks.filter((h: any) =>
                    !h.hooks?.some((hh: any) =>
                      hh.command?.includes('enginehaus') ||
                      hh.command?.includes('session-start') ||
                      hh.command?.includes('enforce-workflow') ||
                      hh.command?.includes('post-commit-reminder')
                    )
                  );
                  if (filtered.length !== hooks.length) {
                    settings.hooks[hookType] = filtered.length > 0 ? filtered : undefined;
                    changed = true;
                  }
                }
              }
              // Clean up empty hooks object
              if (Object.values(settings.hooks).every(v => v === undefined)) {
                delete settings.hooks;
              }
            }
            if (changed) {
              fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2));
              console.log('  🗑  Removed enginehaus hooks from .claude/settings.json');
            } else {
              console.log('  ⏭  No enginehaus hooks found in .claude/settings.json');
            }
          } catch {
            console.log('  ⏭  Could not parse .claude/settings.json, skipping');
          }
        }
      }

      // 3. Global uninstall
      if (opts.global) {
        console.log('\n  Global cleanup:');
        const globalDir = path.join(os.homedir(), '.enginehaus');
        if (existsSync(globalDir)) {
          const dbPath = path.join(globalDir, 'data', 'enginehaus.db');
          if (existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
            console.log(`  ⚠️  Database contains ${sizeMB}MB of task history, decisions, and metrics`);
          }
          await moveToTrash(globalDir, 'global data (~/.enginehaus/)');
        } else {
          console.log('  ⏭  No global data found');
        }
      }

      // Summary
      console.log('');
      if (isDryRun) {
        console.log('Dry run complete. Run without --dry-run to proceed.');
      } else {
        console.log('✅ Enginehaus removed from this project.');
        console.log('   Items are in your trash — restore them if needed.');
        if (!opts.global) {
          console.log('   Global data (~/.enginehaus/) was kept. Use --global to remove it too.');
        }
        console.log('   To fully uninstall: npm uninstall -g enginehaus');
      }
      console.log('');
    });
}
