/**
 * Project Initializer for Enginehaus
 *
 * Handles first-run project setup including:
 * - Creating .enginehaus/ directory marker
 * - Generating CLAUDE.md
 * - Creating welcome task
 * - Tech stack detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { Project, ProjectDomain, UnifiedTask, TaskPriority } from '../coordination/types.js';
import { generateClaudeMd, generateMinimalClaudeMd } from './claude-md-generator.js';
import { v4 as uuidv4 } from 'uuid';

export interface InitializationResult {
  success: boolean;
  project?: Project;
  createdFiles: string[];
  welcomeTask?: UnifiedTask;
  errors: string[];
  warnings: string[];
}

export interface InitOptions {
  projectDir: string;
  name: string;
  domain?: ProjectDomain;
  techStack?: string[];
  description?: string;
  generateClaudeMd?: boolean;
  createWelcomeTask?: boolean;
  minimal?: boolean;
}

/**
 * Detect tech stack from common project files
 */
export function detectTechStack(projectDir: string): string[] {
  const detected: string[] = [];

  const fileChecks: [string, string[]][] = [
    ['package.json', ['node', 'javascript']],
    ['tsconfig.json', ['typescript']],
    ['Cargo.toml', ['rust']],
    ['go.mod', ['go']],
    ['requirements.txt', ['python']],
    ['pyproject.toml', ['python']],
    ['Gemfile', ['ruby']],
    ['pom.xml', ['java', 'maven']],
    ['build.gradle', ['java', 'gradle']],
    ['composer.json', ['php']],
    ['Package.swift', ['swift']],
    ['pubspec.yaml', ['dart', 'flutter']],
  ];

  for (const [file, techs] of fileChecks) {
    if (fs.existsSync(path.join(projectDir, file))) {
      detected.push(...techs);
    }
  }

  // Check for specific frameworks in package.json
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (allDeps.react || allDeps['react-dom']) detected.push('react');
      if (allDeps.vue) detected.push('vue');
      if (allDeps.angular || allDeps['@angular/core']) detected.push('angular');
      if (allDeps.svelte) detected.push('svelte');
      if (allDeps.next) detected.push('next.js');
      if (allDeps.express) detected.push('express');
      if (allDeps.fastify) detected.push('fastify');
      if (allDeps.nest || allDeps['@nestjs/core']) detected.push('nestjs');
      if (allDeps.electron) detected.push('electron');
    } catch {
      // Ignore parse errors
    }
  }

  // Deduplicate
  return [...new Set(detected)];
}

/**
 * Detect project domain from project structure and tech stack
 */
export function detectDomain(projectDir: string, techStack: string[]): ProjectDomain {
  // Check for specific indicators
  if (techStack.includes('flutter') || techStack.includes('react-native')) {
    return 'mobile';
  }

  if (techStack.includes('electron')) {
    return 'web'; // Electron is technically desktop but web-based
  }

  // Check for infrastructure files
  const infraFiles = ['terraform', 'pulumi', 'docker-compose.yml', 'Dockerfile', 'kubernetes', 'k8s'];
  for (const file of infraFiles) {
    if (fs.existsSync(path.join(projectDir, file))) {
      return 'infrastructure';
    }
  }

  // Check for ML indicators
  const mlIndicators = ['model', 'training', 'pytorch', 'tensorflow'];
  const packageJsonPath = path.join(projectDir, 'package.json');
  const requirementsPath = path.join(projectDir, 'requirements.txt');

  if (fs.existsSync(requirementsPath)) {
    const content = fs.readFileSync(requirementsPath, 'utf-8').toLowerCase();
    if (content.includes('torch') || content.includes('tensorflow') || content.includes('scikit')) {
      return 'ml';
    }
  }

  // Check for API indicators
  if (techStack.includes('express') || techStack.includes('fastify') || techStack.includes('nestjs')) {
    // Check if there's also frontend
    if (techStack.includes('react') || techStack.includes('vue') || techStack.includes('angular')) {
      return 'web';
    }
    return 'api';
  }

  // Default to web for frontend frameworks
  if (techStack.includes('react') || techStack.includes('vue') || techStack.includes('angular') || techStack.includes('svelte')) {
    return 'web';
  }

  return 'other';
}

/**
 * Create the .enginehaus/ directory structure
 */
export function createEngineHausDir(projectDir: string): string {
  const ehDir = path.join(projectDir, '.enginehaus');

  if (!fs.existsSync(ehDir)) {
    fs.mkdirSync(ehDir, { recursive: true });
  }

  // Create a marker file with project binding info
  const markerPath = path.join(ehDir, 'project.json');
  if (!fs.existsSync(markerPath)) {
    const marker = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      note: 'This directory marks this folder as an Enginehaus-managed project',
    };
    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  }

  return ehDir;
}

/**
 * Create a welcome task for new projects
 */
export function createWelcomeTask(project: Project): UnifiedTask {
  const now = new Date();

  return {
    id: uuidv4(),
    projectId: project.id,
    title: 'Complete project setup and review Enginehaus workflow',
    description: `Welcome to ${project.name}! This task will help you get familiar with the Enginehaus coordination workflow.

**Checklist:**
1. Run \`enginehaus briefing\` to see project status
2. Review the generated CLAUDE.md file
3. Add your first real task with \`enginehaus task add\`
4. Complete this task when done

**Tips:**
- Use \`log_decision\` MCP tool to record important decisions
- Run \`enginehaus stats\` to see coordination metrics
- Use \`enginehaus task complete <id> -s "summary"\` to complete tasks

You're ready to start building! Complete this task to mark your project as fully set up.`,
    priority: 'medium' as TaskPriority,
    status: 'ready',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Initialize a new Enginehaus project in a directory
 */
export async function initializeProject(options: InitOptions): Promise<InitializationResult> {
  const result: InitializationResult = {
    success: false,
    createdFiles: [],
    errors: [],
    warnings: [],
  };

  const {
    projectDir,
    name,
    domain,
    description,
    generateClaudeMd: shouldGenerateClaudeMd = true,
    createWelcomeTask: shouldCreateWelcomeTask = true,
    minimal = false,
  } = options;

  try {
    // Detect tech stack if not provided
    let techStack = options.techStack;
    if (!techStack || techStack.length === 0) {
      techStack = detectTechStack(projectDir);
      if (techStack.length > 0) {
        result.warnings.push(`Detected tech stack: ${techStack.join(', ')}`);
      }
    }

    // Detect domain if not provided
    const projectDomain = domain || detectDomain(projectDir, techStack);

    // Generate slug from directory name
    const dirName = path.basename(projectDir);
    const slug = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Create project object
    const now = new Date();
    const project: Project = {
      id: uuidv4(),
      name,
      slug,
      description,
      status: 'active',
      rootPath: projectDir,
      domain: projectDomain,
      techStack,
      createdAt: now,
      updatedAt: now,
    };

    result.project = project;

    // Create .enginehaus/ directory
    const ehDir = createEngineHausDir(projectDir);
    result.createdFiles.push(ehDir);

    // Generate CLAUDE.md
    if (shouldGenerateClaudeMd) {
      const claudeMdPath = path.join(projectDir, 'CLAUDE.md');

      // Don't overwrite existing CLAUDE.md
      if (fs.existsSync(claudeMdPath)) {
        result.warnings.push('CLAUDE.md already exists - not overwriting');
      } else {
        const claudeMdContent = minimal
          ? generateMinimalClaudeMd(name)
          : generateClaudeMd({ project });

        fs.writeFileSync(claudeMdPath, claudeMdContent);
        result.createdFiles.push(claudeMdPath);
      }
    }

    // Create welcome task
    if (shouldCreateWelcomeTask) {
      result.welcomeTask = createWelcomeTask(project);
    }

    result.success = true;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Check if a directory is already initialized as an Enginehaus project
 */
export function isEngineHausProject(projectDir: string): boolean {
  const ehDir = path.join(projectDir, '.enginehaus');
  const markerPath = path.join(ehDir, 'project.json');
  return fs.existsSync(markerPath);
}

/**
 * Get Enginehaus project info from a directory
 */
export function getProjectMarker(projectDir: string): { version: string; createdAt: string } | null {
  const markerPath = path.join(projectDir, '.enginehaus', 'project.json');
  if (!fs.existsSync(markerPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
  } catch {
    return null;
  }
}
