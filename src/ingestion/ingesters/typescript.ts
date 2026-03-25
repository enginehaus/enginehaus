/**
 * TypeScript/Node Project Ingester
 *
 * Parses TypeScript/Node.js projects to extract:
 * - Package structure from package.json
 * - Module organization from file tree
 * - Exports and dependencies
 *
 * Hierarchy: Package → Module → File → Export
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { HierarchyLevel } from '../../coordination/types.js';
import {
  Ingester,
  SourceConfig,
  IngestionResult,
  EntityWithLevel,
  Relationship,
  ValidationResult,
} from '../types.js';

export interface TypeScriptConfig {
  /** Directories to include (default: ['src']) */
  includeDirs?: string[];
  /** Patterns to exclude (default: ['node_modules', 'dist', 'build', '.git']) */
  excludePatterns?: string[];
  /** File extensions to process (default: ['.ts', '.tsx', '.js', '.jsx']) */
  extensions?: string[];
  /** Whether to parse exports from files (default: true) */
  parseExports?: boolean;
  /** Whether to parse imports for relationships (default: true) */
  parseImports?: boolean;
}

const DEFAULT_CONFIG: TypeScriptConfig = {
  includeDirs: ['src'],
  excludePatterns: ['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__'],
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  parseExports: true,
  parseImports: true,
};

export class TypeScriptIngester implements Ingester {
  readonly sourceType = 'typescript' as const;
  readonly name = 'TypeScript/Node Project Ingester';
  readonly version = '1.0.0';

  async parse(config: SourceConfig): Promise<IngestionResult> {
    const startedAt = new Date();
    const tsConfig = { ...DEFAULT_CONFIG, ...(config.config as TypeScriptConfig) };
    const rootPath = config.location;

    const entities: EntityWithLevel[] = [];
    const relationships: Relationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let itemsProcessed = 0;

    // Parse package.json for package entity
    const packageJsonPath = path.join(rootPath, 'package.json');
    let packageName = path.basename(rootPath);
    let packageMetadata: Record<string, unknown> = {};

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        packageName = packageJson.name || packageName;
        packageMetadata = {
          version: packageJson.version,
          description: packageJson.description,
          main: packageJson.main,
          type: packageJson.type,
          dependencies: Object.keys(packageJson.dependencies || {}),
          devDependencies: Object.keys(packageJson.devDependencies || {}),
        };
        itemsProcessed++;
      } catch (e) {
        warnings.push(`Failed to parse package.json: ${e}`);
      }
    }

    // Create package entity (root)
    entities.push({
      sourceId: `pkg:${packageName}`,
      name: packageName,
      levelId: 'package',
      entityType: 'package',
      metadata: packageMetadata,
      sourceLocation: packageJsonPath,
      contentHash: this.hashObject(packageMetadata),
    });

    // Walk directories and build module/file entities
    for (const includeDir of tsConfig.includeDirs || ['src']) {
      const dirPath = path.join(rootPath, includeDir);
      if (!fs.existsSync(dirPath)) {
        warnings.push(`Include directory not found: ${includeDir}`);
        continue;
      }

      await this.walkDirectory(
        dirPath,
        rootPath,
        packageName,
        tsConfig,
        entities,
        relationships,
        warnings,
        () => itemsProcessed++
      );
    }

    return {
      sourceId: config.id,
      entities,
      relationships,
      suggestedHierarchy: this.getSuggestedHierarchy(),
      metadata: {
        startedAt,
        completedAt: new Date(),
        itemsProcessed,
        warnings,
        errors,
        ingesterVersion: this.version,
      },
    };
  }

  private async walkDirectory(
    dirPath: string,
    rootPath: string,
    packageName: string,
    config: TypeScriptConfig,
    entities: EntityWithLevel[],
    relationships: Relationship[],
    warnings: string[],
    onItem: () => void
  ): Promise<void> {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(rootPath, fullPath);

      // Check exclusions
      if (config.excludePatterns?.some(p => relativePath.includes(p))) {
        continue;
      }

      if (entry.isDirectory()) {
        // Create module entity for directory
        const moduleName = relativePath.replace(/\//g, '/');
        const moduleId = `mod:${packageName}/${moduleName}`;

        entities.push({
          sourceId: moduleId,
          name: entry.name,
          levelId: 'module',
          parentSourceId: this.getParentModuleId(relativePath, packageName),
          entityType: 'module',
          metadata: { path: relativePath },
          sourceLocation: fullPath,
        });
        onItem();

        // Recurse
        await this.walkDirectory(
          fullPath, rootPath, packageName, config,
          entities, relationships, warnings, onItem
        );
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!config.extensions?.includes(ext)) {
          continue;
        }

        // Create file entity
        const fileName = entry.name;
        const fileId = `file:${packageName}/${relativePath}`;
        const parentDir = path.dirname(relativePath);
        const parentModuleId = parentDir === '.'
          ? `pkg:${packageName}`
          : `mod:${packageName}/${parentDir}`;

        let fileContent = '';
        let contentHash = '';
        try {
          fileContent = fs.readFileSync(fullPath, 'utf-8');
          contentHash = this.hashContent(fileContent);
        } catch (e) {
          warnings.push(`Failed to read file: ${relativePath}`);
          continue;
        }

        const fileMetadata: Record<string, unknown> = {
          path: relativePath,
          extension: ext,
          lines: fileContent.split('\n').length,
        };

        entities.push({
          sourceId: fileId,
          name: fileName,
          levelId: 'file',
          parentSourceId: parentModuleId,
          entityType: 'file',
          metadata: fileMetadata,
          sourceLocation: fullPath,
          contentHash,
        });
        onItem();

        // Parse exports if enabled
        if (config.parseExports) {
          const exports = this.parseExports(fileContent, fileId, packageName, relativePath);
          entities.push(...exports.entities);
        }

        // Parse imports for relationships if enabled
        if (config.parseImports) {
          const imports = this.parseImports(fileContent, fileId, packageName, rootPath, relativePath);
          relationships.push(...imports);
        }
      }
    }
  }

  private getParentModuleId(relativePath: string, packageName: string): string {
    const parentDir = path.dirname(relativePath);
    if (parentDir === '.' || parentDir === '') {
      return `pkg:${packageName}`;
    }
    return `mod:${packageName}/${parentDir}`;
  }

  private parseExports(
    content: string,
    fileId: string,
    packageName: string,
    relativePath: string
  ): { entities: EntityWithLevel[] } {
    const entities: EntityWithLevel[] = [];

    // Match export patterns
    const patterns = [
      // export function name
      /export\s+(?:async\s+)?function\s+(\w+)/g,
      // export const/let/var name
      /export\s+(?:const|let|var)\s+(\w+)/g,
      // export class name
      /export\s+class\s+(\w+)/g,
      // export interface name
      /export\s+(?:interface|type)\s+(\w+)/g,
      // export default (class|function) name
      /export\s+default\s+(?:class|function)\s+(\w+)/g,
    ];

    const exportNames = new Set<string>();
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        exportNames.add(match[1]);
      }
    }

    // Also check for named exports: export { a, b, c }
    const namedExportMatch = content.match(/export\s*\{([^}]+)\}/g);
    if (namedExportMatch) {
      for (const exportBlock of namedExportMatch) {
        const names = exportBlock.match(/\{([^}]+)\}/)?.[1] || '';
        names.split(',').forEach(n => {
          const name = n.trim().split(/\s+as\s+/)[0].trim();
          if (name && !name.includes('*')) {
            exportNames.add(name);
          }
        });
      }
    }

    for (const name of exportNames) {
      entities.push({
        sourceId: `exp:${packageName}/${relativePath}#${name}`,
        name,
        levelId: 'export',
        parentSourceId: fileId,
        entityType: 'export',
        metadata: { exportedFrom: relativePath },
        sourceLocation: relativePath,
      });
    }

    return { entities };
  }

  private parseImports(
    content: string,
    fileId: string,
    packageName: string,
    rootPath: string,
    relativePath: string
  ): Relationship[] {
    const relationships: Relationship[] = [];

    // Match import patterns
    const importPattern = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;

    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const importPath = match[1];

      // Skip external packages
      if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
        continue;
      }

      // Resolve relative import to file ID
      const currentDir = path.dirname(relativePath);
      let resolvedPath = path.normalize(path.join(currentDir, importPath));

      // Try to resolve with extensions
      const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
      let targetFileId: string | null = null;

      for (const ext of possibleExtensions) {
        const testPath = resolvedPath + ext;
        const fullTestPath = path.join(rootPath, testPath);
        if (fs.existsSync(fullTestPath)) {
          targetFileId = `file:${packageName}/${testPath}`;
          break;
        }
      }

      // Also try without extension if file exists
      const directPath = path.join(rootPath, resolvedPath);
      if (!targetFileId && fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
        targetFileId = `file:${packageName}/${resolvedPath}`;
      }

      if (targetFileId) {
        relationships.push({
          fromSourceId: fileId,
          toSourceId: targetFileId,
          type: 'imports',
          confidence: 1.0,
          metadata: { importPath },
        });
      }
    }

    return relationships;
  }

  async validateConfig(config: SourceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.location) {
      errors.push('location is required');
    } else if (!fs.existsSync(config.location)) {
      errors.push(`location does not exist: ${config.location}`);
    } else {
      const packageJsonPath = path.join(config.location, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        warnings.push('No package.json found - will use directory name as package name');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async suggestHierarchy(): Promise<HierarchyLevel[]> {
    return this.getSuggestedHierarchy();
  }

  private getSuggestedHierarchy(): HierarchyLevel[] {
    return [
      {
        id: 'package',
        name: 'Package',
        pluralName: 'Packages',
        order: 0,
        color: '#4A90D9',
        icon: 'package',
        description: 'NPM package root',
      },
      {
        id: 'module',
        name: 'Module',
        pluralName: 'Modules',
        order: 1,
        color: '#7B68EE',
        icon: 'folder',
        description: 'Code module (directory)',
      },
      {
        id: 'file',
        name: 'File',
        pluralName: 'Files',
        order: 2,
        color: '#20B2AA',
        icon: 'file-code',
        description: 'Source file',
      },
      {
        id: 'export',
        name: 'Export',
        pluralName: 'Exports',
        order: 3,
        color: '#FFB347',
        icon: 'arrow-right-from-bracket',
        description: 'Exported function, class, or type',
      },
    ];
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private hashObject(obj: Record<string, unknown>): string {
    return this.hashContent(JSON.stringify(obj));
  }
}
