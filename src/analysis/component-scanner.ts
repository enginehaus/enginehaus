/**
 * Component Auto-Detection Scanner
 *
 * Scans a repository to auto-discover components from:
 * - Directory structure and naming conventions
 * - Package.json / tsconfig.json boundaries
 * - Import/export analysis for dependency graphs
 * - Git activity for hotspot detection
 *
 * This is the "eyes" of the BIM-for-apps model — it reads the repo
 * and builds the component registry automatically.
 */

import { simpleGit, SimpleGitOptions, SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

export interface DetectedComponent {
  name: string;
  type: ComponentType;
  layer?: ComponentLayer;
  description?: string;
  filePatterns: string[];
  entryPoint?: string;
  files: string[];
  metadata: Record<string, unknown>;
}

export type ComponentType =
  | 'module' | 'service' | 'component' | 'api-endpoint' | 'database'
  | 'config' | 'test-suite' | 'library' | 'cli' | 'worker' | 'middleware';

export type ComponentLayer =
  | 'core' | 'adapter' | 'ui' | 'api' | 'storage' | 'infrastructure'
  | 'config' | 'test' | 'build' | 'shared';

export interface DetectedRelationship {
  sourceName: string;
  targetName: string;
  type: 'depends-on' | 'tests' | 'configures' | 'uses';
  metadata?: Record<string, unknown>;
}

export interface ScanResult {
  components: DetectedComponent[];
  relationships: DetectedRelationship[];
  gitActivity: Map<string, GitFileActivity>;
  scanDuration: number;
}

export interface GitFileActivity {
  commitCount: number;
  lastCommit: Date;
  authors: string[];
  linesChanged: number;
}

// ============================================================================
// Scanner
// ============================================================================

export class ComponentScanner {
  /**
   * Scan a repository and detect components, relationships, and activity.
   */
  async scan(repoPath: string): Promise<ScanResult> {
    const start = Date.now();

    // 1. Discover directory structure
    const tree = await this.buildFileTree(repoPath);

    // 2. Detect components from structure
    const components = await this.detectComponents(repoPath, tree);

    // 3. Analyze imports for relationships
    const relationships = await this.detectRelationships(repoPath, components);

    // 4. Get git activity per file
    const gitActivity = await this.getGitActivity(repoPath);

    return {
      components,
      relationships,
      gitActivity,
      scanDuration: Date.now() - start,
    };
  }

  /**
   * Build a file tree, respecting gitignore and common excludes.
   */
  private async buildFileTree(repoPath: string): Promise<string[]> {
    const excludeDirs = new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage', '.next',
      '.turbo', '.cache', '__pycache__', '.venv', 'venv', '.enginehaus',
      '.claude', 'vendor', 'target', 'out',
    ]);
    const excludeFiles = new Set([
      '.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    ]);

    const files: string[] = [];

    const walk = (dir: string, prefix: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (!excludeDirs.has(entry.name) && !entry.name.startsWith('.')) {
            walk(path.join(dir, entry.name), relPath);
          }
        } else if (entry.isFile()) {
          if (!excludeFiles.has(entry.name)) {
            files.push(relPath);
          }
        }
      }
    };

    walk(repoPath, '');
    return files;
  }

  /**
   * Detect components from directory structure and file patterns.
   */
  private async detectComponents(repoPath: string, files: string[]): Promise<DetectedComponent[]> {
    const components: DetectedComponent[] = [];
    const seen = new Set<string>();

    // Strategy 1: src/ subdirectories are components
    const srcDirs = this.findDirectories(files, 'src');
    for (const dir of srcDirs) {
      if (seen.has(dir)) continue;
      seen.add(dir);

      const dirFiles = files.filter(f => f.startsWith(`src/${dir}/`));
      if (dirFiles.length === 0) continue;

      const component = this.classifyDirectory(dir, dirFiles, repoPath);
      if (component) components.push(component);
    }

    // Strategy 2: Top-level directories with code
    const topDirs = this.findTopLevelCodeDirs(files);
    for (const dir of topDirs) {
      if (seen.has(dir)) continue;
      seen.add(dir);

      const dirFiles = files.filter(f => f.startsWith(`${dir}/`));
      const component = this.classifyDirectory(dir, dirFiles, repoPath);
      if (component) components.push(component);
    }

    // Strategy 3: Test suites
    const testDirs = ['tests', 'test', '__tests__', 'spec'];
    for (const testDir of testDirs) {
      if (seen.has(testDir)) continue;
      const testFiles = files.filter(f => f.startsWith(`${testDir}/`));
      if (testFiles.length > 0) {
        seen.add(testDir);
        // Group by subdirectory for granularity
        const testSubdirs = this.findDirectories(testFiles, testDir);
        if (testSubdirs.length > 1) {
          for (const sub of testSubdirs) {
            const subFiles = testFiles.filter(f => f.startsWith(`${testDir}/${sub}/`));
            if (subFiles.length > 0) {
              components.push({
                name: `test/${sub}`,
                type: 'test-suite',
                layer: 'test',
                description: `Tests for ${sub}`,
                filePatterns: [`${testDir}/${sub}/**`],
                files: subFiles,
                metadata: { fileCount: subFiles.length },
              });
            }
          }
        } else {
          components.push({
            name: testDir,
            type: 'test-suite',
            layer: 'test',
            description: `Test suite`,
            filePatterns: [`${testDir}/**`],
            files: testFiles,
            metadata: { fileCount: testFiles.length },
          });
        }
      }
    }

    // Strategy 4: Config files as a component
    const configFiles = files.filter(f =>
      /^(tsconfig|\.eslintrc|vitest\.config|jest\.config|webpack\.config|vite\.config|next\.config|tailwind\.config|postcss\.config)/i.test(path.basename(f))
    );
    if (configFiles.length > 0) {
      components.push({
        name: 'build-config',
        type: 'config',
        layer: 'build',
        description: 'Build and tooling configuration',
        filePatterns: configFiles.map(f => f),
        files: configFiles,
        metadata: { fileCount: configFiles.length },
      });
    }

    // Strategy 5: CLI/bin entry points
    const binFiles = files.filter(f =>
      f.startsWith('src/bin/') || f.startsWith('bin/') || f.startsWith('scripts/')
    );
    if (binFiles.length > 0 && !seen.has('bin')) {
      components.push({
        name: 'cli',
        type: 'cli',
        layer: 'adapter',
        description: 'CLI entry points',
        filePatterns: ['src/bin/**', 'bin/**', 'scripts/**'],
        entryPoint: binFiles[0],
        files: binFiles,
        metadata: { fileCount: binFiles.length },
      });
    }

    return components;
  }

  /**
   * Find immediate subdirectory names under a prefix.
   */
  private findDirectories(files: string[], prefix: string): string[] {
    const dirs = new Set<string>();
    const prefixWithSlash = `${prefix}/`;
    for (const f of files) {
      if (f.startsWith(prefixWithSlash)) {
        const rest = f.slice(prefixWithSlash.length);
        const slashIdx = rest.indexOf('/');
        if (slashIdx > 0) {
          dirs.add(rest.slice(0, slashIdx));
        }
      }
    }
    return Array.from(dirs).sort();
  }

  /**
   * Find top-level directories that contain code files (not src/).
   */
  private findTopLevelCodeDirs(files: string[]): string[] {
    const codeExtensions = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.rs', '.go', '.swift']);
    const topDirs = new Set<string>();
    const skipDirs = new Set(['src', 'tests', 'test', '__tests__', 'docs', 'spec']);

    for (const f of files) {
      const slashIdx = f.indexOf('/');
      if (slashIdx > 0) {
        const dir = f.slice(0, slashIdx);
        if (!skipDirs.has(dir) && codeExtensions.has(path.extname(f))) {
          topDirs.add(dir);
        }
      }
    }
    return Array.from(topDirs).sort();
  }

  /**
   * Classify a directory into a component type and layer.
   */
  private classifyDirectory(name: string, files: string[], _repoPath: string): DetectedComponent | null {
    if (files.length === 0) return null;

    const lower = name.toLowerCase();

    // Infer type from directory name
    let type: ComponentType = 'module';
    let layer: ComponentLayer = 'core';

    // Service patterns
    if (lower.includes('service') || lower.includes('services')) {
      type = 'service'; layer = 'core';
    } else if (lower.includes('handler') || lower.includes('handlers') || lower.includes('controller')) {
      type = 'middleware'; layer = 'adapter';
    } else if (lower.includes('api') || lower.includes('routes') || lower.includes('endpoints')) {
      type = 'api-endpoint'; layer = 'api';
    } else if (lower.includes('adapter') || lower.includes('adapters') || lower.includes('mcp')) {
      type = 'module'; layer = 'adapter';
    } else if (lower.includes('storage') || lower.includes('database') || lower.includes('db') || lower.includes('repo')) {
      type = 'database'; layer = 'storage';
    } else if (lower.includes('component') || lower.includes('ui') || lower.includes('view') || lower.includes('page')) {
      type = 'component'; layer = 'ui';
    } else if (lower.includes('config') || lower.includes('configuration')) {
      type = 'config'; layer = 'config';
    } else if (lower.includes('util') || lower.includes('helpers') || lower.includes('lib') || lower.includes('shared') || lower.includes('common')) {
      type = 'library'; layer = 'shared';
    } else if (lower.includes('worker') || lower.includes('job') || lower.includes('queue')) {
      type = 'worker'; layer = 'infrastructure';
    } else if (lower.includes('middleware')) {
      type = 'middleware'; layer = 'adapter';
    } else if (lower.includes('infra') || lower.includes('deploy') || lower.includes('ci')) {
      type = 'module'; layer = 'infrastructure';
    }

    // Find entry point (index file or matching name)
    const entryPoint =
      files.find(f => path.basename(f) === 'index.ts' || path.basename(f) === 'index.js') ||
      files.find(f => path.basename(f, path.extname(f)) === name) ||
      files[0];

    return {
      name,
      type,
      layer,
      description: `${type} — ${files.length} files`,
      filePatterns: [`src/${name}/**`, `${name}/**`],
      entryPoint,
      files,
      metadata: {
        fileCount: files.length,
        extensions: [...new Set(files.map(f => path.extname(f)))],
      },
    };
  }

  /**
   * Detect relationships between components by analyzing imports.
   */
  private async detectRelationships(
    repoPath: string,
    components: DetectedComponent[]
  ): Promise<DetectedRelationship[]> {
    const relationships: DetectedRelationship[] = [];
    const componentByFile = new Map<string, string>();

    // Build file → component name mapping
    for (const comp of components) {
      for (const file of comp.files) {
        componentByFile.set(file, comp.name);
      }
    }

    // Analyze imports in TypeScript/JavaScript files
    const tsFiles = components
      .flatMap(c => c.files)
      .filter(f => /\.(ts|js|tsx|jsx)$/.test(f));

    // Track unique relationships
    const relSet = new Set<string>();

    for (const file of tsFiles) {
      const sourceComp = componentByFile.get(file);
      if (!sourceComp) continue;

      let content: string;
      try {
        content = fs.readFileSync(path.join(repoPath, file), 'utf8');
      } catch {
        continue;
      }

      // Extract import paths
      const importPattern = /(?:import|from)\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importPattern.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          // Resolve relative import to find target component
          const resolvedDir = path.dirname(file);
          const resolvedPath = path.normalize(path.join(resolvedDir, importPath));

          // Find which component this import targets
          for (const [compFile, compName] of componentByFile) {
            if (compName === sourceComp) continue;
            if (resolvedPath.startsWith(path.dirname(compFile).split('/').slice(0, 2).join('/'))) {
              const key = `${sourceComp}→${compName}`;
              if (!relSet.has(key)) {
                relSet.add(key);
                relationships.push({
                  sourceName: sourceComp,
                  targetName: compName,
                  type: 'depends-on',
                });
              }
              break;
            }
          }
        }
      }

      // Detect test relationships
      if (sourceComp.startsWith('test/') || file.includes('.test.') || file.includes('.spec.')) {
        // Find what this test file is testing
        const baseName = path.basename(file).replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, '');
        for (const comp of components) {
          if (comp.name !== sourceComp && comp.files.some(f => path.basename(f, path.extname(f)) === baseName)) {
            const key = `${sourceComp}→${comp.name}:tests`;
            if (!relSet.has(key)) {
              relSet.add(key);
              relationships.push({
                sourceName: sourceComp,
                targetName: comp.name,
                type: 'tests',
              });
            }
          }
        }
      }
    }

    return relationships;
  }

  /**
   * Get git activity metrics per file (last 30 days).
   */
  private async getGitActivity(repoPath: string): Promise<Map<string, GitFileActivity>> {
    const activity = new Map<string, GitFileActivity>();

    const gitOpts: Partial<SimpleGitOptions> = {
      baseDir: repoPath,
      binary: 'git',
    };

    const git: SimpleGit = simpleGit(gitOpts);

    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Get file-level stats from git log
      const log = await git.log({
        '--since': since.toISOString(),
        '--name-only': null,
        '--no-merges': null,
      });

      for (const commit of log.all) {
        const commitDate = new Date(commit.date);
        const author = commit.author_name;

        // The diff field contains changed file paths
        const body = commit.body || '';
        const diffStr = commit.diff?.files?.map(f => f.file) || [];
        const changedFiles = diffStr.length > 0 ? diffStr : body.split('\n').filter(l => l.trim());

        for (const file of changedFiles) {
          if (!file || file.startsWith(' ')) continue;

          const existing = activity.get(file) || {
            commitCount: 0,
            lastCommit: commitDate,
            authors: [],
            linesChanged: 0,
          };

          existing.commitCount++;
          if (commitDate > existing.lastCommit) {
            existing.lastCommit = commitDate;
          }
          if (!existing.authors.includes(author)) {
            existing.authors.push(author);
          }

          activity.set(file, existing);
        }
      }
    } catch {
      // Not a git repo or other issue — return empty
    }

    return activity;
  }
}

// ============================================================================
// Utility: Persist scan results to storage
// ============================================================================

export async function persistScanResults(
  storage: { saveComponent: Function; saveComponentRelationship: Function; deleteComponentsByProject: Function },
  projectId: string,
  result: ScanResult,
  options: { clearExisting?: boolean } = {},
): Promise<{ componentsCreated: number; relationshipsCreated: number }> {
  // Optionally clear existing components for this project
  if (options.clearExisting) {
    await storage.deleteComponentsByProject(projectId);
  }

  const componentIdMap = new Map<string, string>();
  let componentsCreated = 0;

  // Save components
  for (const comp of result.components) {
    const id = uuidv4();
    componentIdMap.set(comp.name, id);

    // Compute activity-based metadata
    let totalCommits = 0;
    let totalAuthors = new Set<string>();
    for (const file of comp.files) {
      const act = result.gitActivity.get(file);
      if (act) {
        totalCommits += act.commitCount;
        act.authors.forEach(a => totalAuthors.add(a));
      }
    }

    await storage.saveComponent({
      id,
      projectId,
      name: comp.name,
      type: comp.type,
      layer: comp.layer,
      description: comp.description,
      filePatterns: comp.filePatterns,
      entryPoint: comp.entryPoint,
      metadata: {
        ...comp.metadata,
        gitActivity: {
          totalCommits,
          uniqueAuthors: totalAuthors.size,
          authors: Array.from(totalAuthors),
        },
      },
    });
    componentsCreated++;
  }

  // Save relationships
  let relationshipsCreated = 0;
  for (const rel of result.relationships) {
    const sourceId = componentIdMap.get(rel.sourceName);
    const targetId = componentIdMap.get(rel.targetName);
    if (sourceId && targetId) {
      await storage.saveComponentRelationship({
        id: uuidv4(),
        sourceId,
        targetId,
        type: rel.type,
        metadata: rel.metadata,
      });
      relationshipsCreated++;
    }
  }

  return { componentsCreated, relationshipsCreated };
}
