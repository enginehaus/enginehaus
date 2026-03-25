/**
 * Xcode Project Ingester
 *
 * Parses Xcode projects (.xcodeproj) to extract:
 * - Targets (apps, frameworks, extensions)
 * - Groups and file organization
 * - Build phases and dependencies
 *
 * Hierarchy: App → Target → Group → File
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

export interface XcodeConfig {
  /** Path to .xcodeproj directory (auto-detected if not specified) */
  projectPath?: string;
  /** Whether to include file entities (default: true) */
  includeFiles?: boolean;
  /** Whether to parse dependencies between targets (default: true) */
  parseDependencies?: boolean;
  /** File extensions to track (default: all in project) */
  fileExtensions?: string[];
}

const DEFAULT_CONFIG: XcodeConfig = {
  includeFiles: true,
  parseDependencies: true,
};

interface PBXObject {
  isa: string;
  [key: string]: unknown;
}

interface PBXProject {
  objects: Record<string, PBXObject>;
  rootObject: string;
}

export class XcodeIngester implements Ingester {
  readonly sourceType = 'xcode' as const;
  readonly name = 'Xcode Project Ingester';
  readonly version = '1.0.0';

  async parse(config: SourceConfig): Promise<IngestionResult> {
    const startedAt = new Date();
    const xcodeConfig = { ...DEFAULT_CONFIG, ...(config.config as XcodeConfig) };
    const rootPath = config.location;

    const entities: EntityWithLevel[] = [];
    const relationships: Relationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let itemsProcessed = 0;

    // Find .xcodeproj directory
    const projectPath = this.findXcodeProject(rootPath, xcodeConfig.projectPath);
    if (!projectPath) {
      errors.push('No Xcode project found');
      return {
        sourceId: config.id,
        entities,
        relationships,
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

    // Parse project.pbxproj
    const pbxprojPath = path.join(projectPath, 'project.pbxproj');
    if (!fs.existsSync(pbxprojPath)) {
      errors.push('project.pbxproj not found');
      return {
        sourceId: config.id,
        entities,
        relationships,
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

    let pbxContent: string;
    let project: PBXProject;
    try {
      pbxContent = fs.readFileSync(pbxprojPath, 'utf-8');
      project = this.parsePbxproj(pbxContent);
      itemsProcessed++;
    } catch (e) {
      errors.push(`Failed to parse project.pbxproj: ${e}`);
      return {
        sourceId: config.id,
        entities,
        relationships,
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

    // Get project info
    const rootObj = project.objects[project.rootObject];
    if (!rootObj || rootObj.isa !== 'PBXProject') {
      errors.push('Invalid project structure');
      return {
        sourceId: config.id,
        entities,
        relationships,
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

    const projectName = path.basename(projectPath, '.xcodeproj');
    const appId = `xcode:${this.slugify(projectName)}`;

    // Create app entity (root)
    entities.push({
      sourceId: appId,
      name: projectName,
      levelId: 'app',
      entityType: 'app',
      metadata: {
        projectPath: projectPath,
        buildConfigurationList: rootObj.buildConfigurationList,
      },
      sourceLocation: projectPath,
      contentHash: this.hashContent(pbxContent.slice(0, 1000)),
    });

    // Extract targets
    const targets = (rootObj.targets as string[]) || [];
    for (const targetId of targets) {
      const target = project.objects[targetId];
      if (!target) continue;

      const targetName = (target.name as string) || 'Unknown';
      const targetType = this.getTargetType(target.isa);
      const targetSourceId = `${appId}/target/${this.slugify(targetName)}`;

      entities.push({
        sourceId: targetSourceId,
        name: targetName,
        levelId: 'target',
        parentSourceId: appId,
        entityType: 'target',
        metadata: {
          isa: target.isa,
          productType: target.productType,
          productName: target.productName,
          type: targetType,
        },
        sourceLocation: projectPath,
      });
      itemsProcessed++;

      // Parse build phases for dependencies
      if (xcodeConfig.parseDependencies) {
        const buildPhases = (target.buildPhases as string[]) || [];
        for (const phaseId of buildPhases) {
          const phase = project.objects[phaseId];
          if (!phase) continue;

          // Framework build phase contains dependencies
          if (phase.isa === 'PBXFrameworksBuildPhase') {
            const files = (phase.files as string[]) || [];
            for (const fileId of files) {
              const buildFile = project.objects[fileId];
              if (!buildFile) continue;

              const fileRefId = buildFile.fileRef as string;
              const fileRef = project.objects[fileRefId];
              if (fileRef && fileRef.name) {
                relationships.push({
                  fromSourceId: targetSourceId,
                  toSourceId: `framework:${fileRef.name}`,
                  type: 'depends_on',
                  confidence: 1.0,
                  metadata: { phase: 'frameworks' },
                });
              }
            }
          }
        }

        // Target dependencies
        const dependencies = (target.dependencies as string[]) || [];
        for (const depId of dependencies) {
          const dep = project.objects[depId];
          if (!dep) continue;

          const targetProxyId = dep.targetProxy as string;
          if (targetProxyId) {
            const proxy = project.objects[targetProxyId];
            if (proxy && proxy.remoteGlobalIDString) {
              const remoteTarget = project.objects[proxy.remoteGlobalIDString as string];
              if (remoteTarget && remoteTarget.name) {
                relationships.push({
                  fromSourceId: targetSourceId,
                  toSourceId: `${appId}/target/${this.slugify(remoteTarget.name as string)}`,
                  type: 'depends_on',
                  confidence: 1.0,
                  metadata: { type: 'target' },
                });
              }
            }
          }
        }
      }
    }

    // Extract groups and files
    if (xcodeConfig.includeFiles) {
      const mainGroupId = rootObj.mainGroup as string;
      if (mainGroupId) {
        await this.processGroup(
          mainGroupId,
          project,
          appId,
          appId,
          rootPath,
          xcodeConfig,
          entities,
          warnings,
          () => itemsProcessed++
        );
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

  private findXcodeProject(rootPath: string, configuredPath?: string): string | null {
    if (configuredPath) {
      const fullPath = path.join(rootPath, configuredPath);
      return fs.existsSync(fullPath) ? fullPath : null;
    }

    // Search for .xcodeproj in root directory
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith('.xcodeproj')) {
        return path.join(rootPath, entry.name);
      }
    }

    return null;
  }

  private parsePbxproj(content: string): PBXProject {
    // Simplified pbxproj parser
    // Note: Real implementation would use a proper plist parser
    const objects: Record<string, PBXObject> = {};
    let rootObject = '';

    // Extract rootObject
    const rootMatch = content.match(/rootObject\s*=\s*([A-F0-9]+)/);
    if (rootMatch) {
      rootObject = rootMatch[1];
    }

    // Parse objects section
    const objectsMatch = content.match(/objects\s*=\s*\{([\s\S]*?)\n\t\};/);
    if (objectsMatch) {
      const objectsContent = objectsMatch[1];

      // Match individual objects
      const objectPattern = /([A-F0-9]+)\s*\/\*[^*]*\*\/\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\};/g;
      let match;

      while ((match = objectPattern.exec(objectsContent)) !== null) {
        const id = match[1];
        const objContent = match[2];

        const obj: PBXObject = { isa: '' };

        // Parse isa
        const isaMatch = objContent.match(/isa\s*=\s*(\w+)/);
        if (isaMatch) {
          obj.isa = isaMatch[1];
        }

        // Parse name
        const nameMatch = objContent.match(/name\s*=\s*"?([^";]+)"?/);
        if (nameMatch) {
          obj.name = nameMatch[1].trim();
        }

        // Parse path
        const pathMatch = objContent.match(/path\s*=\s*"?([^";]+)"?/);
        if (pathMatch) {
          obj.path = pathMatch[1].trim();
        }

        // Parse productType
        const productTypeMatch = objContent.match(/productType\s*=\s*"?([^";]+)"?/);
        if (productTypeMatch) {
          obj.productType = productTypeMatch[1].trim();
        }

        // Parse productName
        const productNameMatch = objContent.match(/productName\s*=\s*"?([^";]+)"?/);
        if (productNameMatch) {
          obj.productName = productNameMatch[1].trim();
        }

        // Parse children (for groups)
        const childrenMatch = objContent.match(/children\s*=\s*\(([^)]*)\)/);
        if (childrenMatch) {
          const children = childrenMatch[1]
            .match(/[A-F0-9]+/g) || [];
          obj.children = children;
        }

        // Parse targets (for project)
        const targetsMatch = objContent.match(/targets\s*=\s*\(([^)]*)\)/);
        if (targetsMatch) {
          const targets = targetsMatch[1].match(/[A-F0-9]+/g) || [];
          obj.targets = targets;
        }

        // Parse mainGroup
        const mainGroupMatch = objContent.match(/mainGroup\s*=\s*([A-F0-9]+)/);
        if (mainGroupMatch) {
          obj.mainGroup = mainGroupMatch[1];
        }

        // Parse buildPhases
        const buildPhasesMatch = objContent.match(/buildPhases\s*=\s*\(([^)]*)\)/);
        if (buildPhasesMatch) {
          const buildPhases = buildPhasesMatch[1].match(/[A-F0-9]+/g) || [];
          obj.buildPhases = buildPhases;
        }

        // Parse files (for build phases)
        const filesMatch = objContent.match(/files\s*=\s*\(([^)]*)\)/);
        if (filesMatch) {
          const files = filesMatch[1].match(/[A-F0-9]+/g) || [];
          obj.files = files;
        }

        // Parse fileRef (for build files)
        const fileRefMatch = objContent.match(/fileRef\s*=\s*([A-F0-9]+)/);
        if (fileRefMatch) {
          obj.fileRef = fileRefMatch[1];
        }

        // Parse dependencies
        const dependenciesMatch = objContent.match(/dependencies\s*=\s*\(([^)]*)\)/);
        if (dependenciesMatch) {
          const dependencies = dependenciesMatch[1].match(/[A-F0-9]+/g) || [];
          obj.dependencies = dependencies;
        }

        // Parse targetProxy
        const targetProxyMatch = objContent.match(/targetProxy\s*=\s*([A-F0-9]+)/);
        if (targetProxyMatch) {
          obj.targetProxy = targetProxyMatch[1];
        }

        // Parse remoteGlobalIDString
        const remoteGlobalIDMatch = objContent.match(/remoteGlobalIDString\s*=\s*([A-F0-9]+)/);
        if (remoteGlobalIDMatch) {
          obj.remoteGlobalIDString = remoteGlobalIDMatch[1];
        }

        // Parse buildConfigurationList
        const configListMatch = objContent.match(/buildConfigurationList\s*=\s*([A-F0-9]+)/);
        if (configListMatch) {
          obj.buildConfigurationList = configListMatch[1];
        }

        objects[id] = obj;
      }
    }

    return { objects, rootObject };
  }

  private async processGroup(
    groupId: string,
    project: PBXProject,
    appId: string,
    parentSourceId: string,
    rootPath: string,
    config: XcodeConfig,
    entities: EntityWithLevel[],
    warnings: string[],
    onItem: () => void
  ): Promise<void> {
    const group = project.objects[groupId];
    if (!group || group.isa !== 'PBXGroup') return;

    const groupName = (group.name as string) || (group.path as string) || 'Unnamed';
    const groupPath = group.path as string;

    // Skip certain groups
    if (['Frameworks', 'Products'].includes(groupName)) return;

    const groupSourceId = `${appId}/group/${this.slugify(groupName)}-${groupId.slice(0, 6)}`;

    // Only create group entity if it has a name/path
    if (groupName !== 'Unnamed' || groupPath) {
      entities.push({
        sourceId: groupSourceId,
        name: groupName,
        levelId: 'group',
        parentSourceId,
        entityType: 'group',
        metadata: {
          path: groupPath,
        },
      });
      onItem();
    }

    // Process children
    const children = (group.children as string[]) || [];
    for (const childId of children) {
      const child = project.objects[childId];
      if (!child) continue;

      if (child.isa === 'PBXGroup') {
        await this.processGroup(
          childId,
          project,
          appId,
          groupSourceId,
          rootPath,
          config,
          entities,
          warnings,
          onItem
        );
      } else if (child.isa === 'PBXFileReference') {
        const fileName = (child.name as string) || (child.path as string) || 'Unknown';
        const filePath = child.path as string;

        // Check extension filter
        if (config.fileExtensions) {
          const ext = path.extname(fileName);
          if (!config.fileExtensions.includes(ext)) continue;
        }

        const fileSourceId = `${appId}/file/${this.slugify(fileName)}-${childId.slice(0, 6)}`;

        entities.push({
          sourceId: fileSourceId,
          name: fileName,
          levelId: 'file',
          parentSourceId: groupSourceId,
          entityType: 'file',
          metadata: {
            path: filePath,
            fileType: child.lastKnownFileType || child.explicitFileType,
          },
          sourceLocation: filePath ? path.join(rootPath, filePath) : undefined,
        });
        onItem();
      }
    }
  }

  private getTargetType(isa: string): string {
    switch (isa) {
      case 'PBXNativeTarget': return 'native';
      case 'PBXAggregateTarget': return 'aggregate';
      case 'PBXLegacyTarget': return 'legacy';
      default: return 'unknown';
    }
  }

  private slugify(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async validateConfig(config: SourceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const xcodeConfig = config.config as XcodeConfig;

    if (!config.location) {
      errors.push('location is required');
    } else if (!fs.existsSync(config.location)) {
      errors.push(`location does not exist: ${config.location}`);
    } else {
      const projectPath = this.findXcodeProject(config.location, xcodeConfig?.projectPath);
      if (!projectPath) {
        errors.push('No Xcode project (.xcodeproj) found');
      } else {
        const pbxprojPath = path.join(projectPath, 'project.pbxproj');
        if (!fs.existsSync(pbxprojPath)) {
          errors.push('project.pbxproj not found in Xcode project');
        }
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
        color: '#147EFB',
        icon: 'apple',
        description: 'Xcode project/workspace',
      },
      {
        id: 'target',
        name: 'Target',
        pluralName: 'Targets',
        order: 1,
        color: '#53D769',
        icon: 'bullseye',
        description: 'Build target (app, framework, extension)',
      },
      {
        id: 'group',
        name: 'Group',
        pluralName: 'Groups',
        order: 2,
        color: '#FC3D39',
        icon: 'folder',
        description: 'File group in project navigator',
      },
      {
        id: 'file',
        name: 'File',
        pluralName: 'Files',
        order: 3,
        color: '#FF9500',
        icon: 'file',
        description: 'Source file',
      },
    ];
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
