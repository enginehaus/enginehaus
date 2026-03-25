/**
 * React/Web App Ingester
 *
 * Parses React/web applications to extract:
 * - Pages and routes
 * - Components and their hierarchy
 * - Hooks and contexts
 * - Feature organization
 *
 * Hierarchy: App → Feature → Page → Component
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

export interface ReactConfig {
  /** Source directories to scan (default: ['src']) */
  sourceDirs?: string[];
  /** Patterns for page files (default: ['pages/**', 'routes/**', 'app/**']) */
  pagePatterns?: string[];
  /** Patterns for component files (default: ['components/**']) */
  componentPatterns?: string[];
  /** Patterns for hook files (default: ['hooks/**']) */
  hookPatterns?: string[];
  /** Patterns for context files (default: ['contexts/**', 'context/**']) */
  contextPatterns?: string[];
  /** File extensions (default: ['.tsx', '.jsx', '.ts', '.js']) */
  extensions?: string[];
  /** Feature directories to identify (default: ['features', 'modules']) */
  featureDirs?: string[];
}

const DEFAULT_CONFIG: ReactConfig = {
  sourceDirs: ['src'],
  pagePatterns: ['pages', 'routes', 'app'],
  componentPatterns: ['components', 'ui'],
  hookPatterns: ['hooks'],
  contextPatterns: ['contexts', 'context', 'providers'],
  extensions: ['.tsx', '.jsx', '.ts', '.js'],
  featureDirs: ['features', 'modules', 'domains'],
};

interface ComponentInfo {
  name: string;
  path: string;
  type: 'page' | 'component' | 'hook' | 'context' | 'util';
  props?: string[];
  hooks?: string[];
  imports?: string[];
}

export class ReactIngester implements Ingester {
  readonly sourceType = 'react' as const;
  readonly name = 'React/Web App Ingester';
  readonly version = '1.0.0';

  async parse(config: SourceConfig): Promise<IngestionResult> {
    const startedAt = new Date();
    const reactConfig = { ...DEFAULT_CONFIG, ...(config.config as ReactConfig) };
    const rootPath = config.location;

    const entities: EntityWithLevel[] = [];
    const relationships: Relationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let itemsProcessed = 0;

    // Get app name from package.json
    const packageJsonPath = path.join(rootPath, 'package.json');
    let appName = path.basename(rootPath);
    let appMetadata: Record<string, unknown> = {};

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        appName = packageJson.name || appName;
        appMetadata = {
          version: packageJson.version,
          description: packageJson.description,
          framework: this.detectFramework(packageJson),
        };
        itemsProcessed++;
      } catch (e) {
        warnings.push(`Failed to parse package.json: ${e}`);
      }
    }

    const appId = `app:${this.slugify(appName)}`;

    // Create app entity (root)
    entities.push({
      sourceId: appId,
      name: appName,
      levelId: 'app',
      entityType: 'app',
      metadata: appMetadata,
      sourceLocation: rootPath,
      contentHash: this.hashObject(appMetadata),
    });

    // Track features and their entities
    const features = new Map<string, EntityWithLevel>();
    const components = new Map<string, ComponentInfo>();

    // Scan source directories
    for (const sourceDir of reactConfig.sourceDirs || ['src']) {
      const srcPath = path.join(rootPath, sourceDir);
      if (!fs.existsSync(srcPath)) {
        warnings.push(`Source directory not found: ${sourceDir}`);
        continue;
      }

      await this.walkDirectory(
        srcPath,
        rootPath,
        appId,
        reactConfig,
        entities,
        relationships,
        features,
        components,
        warnings,
        () => itemsProcessed++
      );
    }

    // Create relationships from imports
    for (const [compPath, comp] of components) {
      if (comp.imports) {
        for (const importPath of comp.imports) {
          // Try to resolve import to a component
          const resolved = this.resolveImport(importPath, compPath, rootPath, components);
          if (resolved) {
            relationships.push({
              fromSourceId: `comp:${appName}/${compPath}`,
              toSourceId: `comp:${appName}/${resolved}`,
              type: 'imports',
              confidence: 1.0,
            });
          }
        }
      }
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
    appId: string,
    config: ReactConfig,
    entities: EntityWithLevel[],
    relationships: Relationship[],
    features: Map<string, EntityWithLevel>,
    components: Map<string, ComponentInfo>,
    warnings: string[],
    onItem: () => void
  ): Promise<void> {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const relativePath = path.relative(rootPath, dirPath);
    const appName = appId.replace('app:', '');

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const entryRelativePath = path.relative(rootPath, fullPath);

      // Skip node_modules and common non-source directories
      if (['node_modules', 'dist', 'build', '.git', 'public', '.next'].includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Check if this is a feature directory
        const isFeatureDir = config.featureDirs?.some(fd =>
          relativePath.includes(fd) || entry.name === fd
        );

        if (isFeatureDir && !features.has(entry.name)) {
          const featureId = `feature:${appName}/${entry.name}`;
          const feature: EntityWithLevel = {
            sourceId: featureId,
            name: this.formatName(entry.name),
            levelId: 'feature',
            parentSourceId: appId,
            entityType: 'feature',
            metadata: { path: entryRelativePath },
          };
          features.set(entry.name, feature);
          entities.push(feature);
          onItem();
        }

        // Recurse
        await this.walkDirectory(
          fullPath, rootPath, appId, config,
          entities, relationships, features, components, warnings, onItem
        );
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!config.extensions?.includes(ext)) {
          continue;
        }

        // Determine component type from path
        const componentType = this.determineComponentType(entryRelativePath, config);
        if (!componentType) continue;

        // Parse the file
        let content = '';
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
        } catch (e) {
          warnings.push(`Failed to read file: ${entryRelativePath}`);
          continue;
        }

        const componentName = this.extractComponentName(content, entry.name);
        const componentInfo: ComponentInfo = {
          name: componentName,
          path: entryRelativePath,
          type: componentType,
          props: this.extractProps(content),
          hooks: this.extractHooks(content),
          imports: this.extractImports(content),
        };
        components.set(entryRelativePath, componentInfo);

        // Determine parent
        let parentSourceId = appId;
        const featureName = this.getFeatureFromPath(entryRelativePath, config.featureDirs || []);
        if (featureName && features.has(featureName)) {
          parentSourceId = features.get(featureName)!.sourceId;
        }

        // For pages, the parent is the feature or app
        // For components, try to find the page or feature parent
        const levelId = this.getLevelId(componentType);

        entities.push({
          sourceId: `comp:${appName}/${entryRelativePath}`,
          name: componentName,
          levelId,
          parentSourceId,
          entityType: componentType,
          metadata: {
            path: entryRelativePath,
            props: componentInfo.props,
            hooks: componentInfo.hooks,
          },
          sourceLocation: fullPath,
          contentHash: this.hashContent(content),
        });
        onItem();
      }
    }
  }

  private detectFramework(packageJson: Record<string, unknown>): string {
    const deps = {
      ...(packageJson.dependencies as Record<string, string> || {}),
      ...(packageJson.devDependencies as Record<string, string> || {}),
    };

    if (deps['next']) return 'Next.js';
    if (deps['gatsby']) return 'Gatsby';
    if (deps['remix'] || deps['@remix-run/react']) return 'Remix';
    if (deps['vite']) return 'Vite';
    if (deps['react-scripts']) return 'Create React App';
    if (deps['react']) return 'React';
    return 'Unknown';
  }

  private determineComponentType(
    relativePath: string,
    config: ReactConfig
  ): 'page' | 'component' | 'hook' | 'context' | 'util' | null {
    const normalizedPath = relativePath.replace(/\\/g, '/');

    for (const pattern of config.pagePatterns || []) {
      if (normalizedPath.includes(`/${pattern}/`) || normalizedPath.startsWith(`src/${pattern}/`)) {
        return 'page';
      }
    }

    for (const pattern of config.hookPatterns || []) {
      if (normalizedPath.includes(`/${pattern}/`) || normalizedPath.includes('/use')) {
        return 'hook';
      }
    }

    for (const pattern of config.contextPatterns || []) {
      if (normalizedPath.includes(`/${pattern}/`) || normalizedPath.includes('Context')) {
        return 'context';
      }
    }

    for (const pattern of config.componentPatterns || []) {
      if (normalizedPath.includes(`/${pattern}/`)) {
        return 'component';
      }
    }

    // Check if it's a React component (has JSX or default export with capital letter)
    return 'component';
  }

  private getLevelId(type: 'page' | 'component' | 'hook' | 'context' | 'util'): string {
    switch (type) {
      case 'page': return 'page';
      case 'component': return 'component';
      case 'hook': return 'hook';
      case 'context': return 'context';
      default: return 'component';
    }
  }

  private extractComponentName(content: string, fileName: string): string {
    // Try to find export default function/class Name
    const defaultExport = content.match(/export\s+default\s+(?:function|class)\s+(\w+)/);
    if (defaultExport) return defaultExport[1];

    // Try to find const Name = ... export default Name
    const constExport = content.match(/const\s+(\w+)\s*=.*?export\s+default\s+\1/s);
    if (constExport) return constExport[1];

    // Fall back to file name
    const baseName = path.basename(fileName, path.extname(fileName));
    return baseName === 'index' ? path.basename(path.dirname(fileName)) : baseName;
  }

  private extractProps(content: string): string[] {
    const props: string[] = [];

    // Match TypeScript interface/type Props
    const propsMatch = content.match(/(?:interface|type)\s+\w*Props\w*\s*(?:=\s*)?\{([^}]+)\}/);
    if (propsMatch) {
      const propsContent = propsMatch[1];
      const propNames = propsContent.match(/(\w+)\s*[?:]:/g);
      if (propNames) {
        props.push(...propNames.map(p => p.replace(/[?:]/g, '').trim()));
      }
    }

    // Match destructured props
    const destructuredMatch = content.match(/(?:function|const)\s+\w+\s*=?\s*\(\s*\{\s*([^}]+)\s*\}/);
    if (destructuredMatch) {
      const destructured = destructuredMatch[1];
      const names = destructured.split(',').map(p => p.trim().split(/[=:]/)[0].trim());
      props.push(...names.filter(n => n && !n.includes('...')));
    }

    return [...new Set(props)];
  }

  private extractHooks(content: string): string[] {
    const hooks: string[] = [];

    // Match React hooks usage
    const hookPattern = /use[A-Z]\w+/g;
    let match;
    while ((match = hookPattern.exec(content)) !== null) {
      hooks.push(match[0]);
    }

    return [...new Set(hooks)];
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];

    // Match relative imports
    const importPattern = /import\s+.*?\s+from\s+['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  private getFeatureFromPath(relativePath: string, featureDirs: string[]): string | null {
    const parts = relativePath.split(/[/\\]/);
    for (let i = 0; i < parts.length; i++) {
      if (featureDirs.includes(parts[i]) && parts[i + 1]) {
        return parts[i + 1];
      }
    }
    return null;
  }

  private resolveImport(
    importPath: string,
    fromPath: string,
    rootPath: string,
    components: Map<string, ComponentInfo>
  ): string | null {
    const fromDir = path.dirname(fromPath);
    let resolved = path.normalize(path.join(fromDir, importPath));

    // Try with extensions
    const extensions = ['.tsx', '.jsx', '.ts', '.js', '/index.tsx', '/index.jsx', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const testPath = resolved + ext;
      if (components.has(testPath)) {
        return testPath;
      }
    }

    return null;
  }

  private formatName(name: string): string {
    return name
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private slugify(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async validateConfig(config: SourceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const reactConfig = config.config as ReactConfig;

    if (!config.location) {
      errors.push('location is required');
    } else if (!fs.existsSync(config.location)) {
      errors.push(`location does not exist: ${config.location}`);
    } else {
      // Check for React indicators
      const packageJsonPath = path.join(config.location, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
          const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
          if (!deps.react) {
            warnings.push('No React dependency found in package.json');
          }
        } catch {
          warnings.push('Failed to parse package.json');
        }
      }

      // Check for source directory
      const hasSourceDir = (reactConfig?.sourceDirs || ['src']).some(dir =>
        fs.existsSync(path.join(config.location, dir))
      );
      if (!hasSourceDir) {
        warnings.push('No source directory found');
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
        id: 'app',
        name: 'Application',
        pluralName: 'Applications',
        order: 0,
        color: '#61DAFB',
        icon: 'react',
        description: 'React application root',
      },
      {
        id: 'feature',
        name: 'Feature',
        pluralName: 'Features',
        order: 1,
        color: '#764ABC',
        icon: 'puzzle-piece',
        description: 'Feature module',
      },
      {
        id: 'page',
        name: 'Page',
        pluralName: 'Pages',
        order: 2,
        color: '#FF6B6B',
        icon: 'file',
        description: 'Route/page component',
      },
      {
        id: 'component',
        name: 'Component',
        pluralName: 'Components',
        order: 3,
        color: '#4ECDC4',
        icon: 'cube',
        description: 'UI component',
      },
      {
        id: 'hook',
        name: 'Hook',
        pluralName: 'Hooks',
        order: 2,
        color: '#95E1D3',
        icon: 'anchor',
        description: 'Custom React hook',
      },
      {
        id: 'context',
        name: 'Context',
        pluralName: 'Contexts',
        order: 2,
        color: '#F38181',
        icon: 'share-alt',
        description: 'React context provider',
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
