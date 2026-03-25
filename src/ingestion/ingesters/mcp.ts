/**
 * MCP Server Manifest Ingester
 *
 * Parses MCP (Model Context Protocol) server definitions to extract:
 * - Tools and their parameters
 * - Resources and templates
 * - Prompts
 *
 * Hierarchy: Server → Category → Tool/Resource/Prompt
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

export interface MCPConfig {
  /** Path to server entry file (default: 'src/index.ts') */
  entryFile?: string;
  /** Whether to extract tool categories from naming (default: true) */
  extractCategories?: boolean;
  /** Category separator in tool names (default: '_') */
  categorySeparator?: string;
}

const DEFAULT_CONFIG: MCPConfig = {
  entryFile: 'src/index.ts',
  extractCategories: true,
  categorySeparator: '_',
};

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

export class MCPIngester implements Ingester {
  readonly sourceType = 'mcp' as const;
  readonly name = 'MCP Server Manifest Ingester';
  readonly version = '1.0.0';

  async parse(config: SourceConfig): Promise<IngestionResult> {
    const startedAt = new Date();
    const mcpConfig = { ...DEFAULT_CONFIG, ...(config.config as MCPConfig) };
    const rootPath = config.location;

    const entities: EntityWithLevel[] = [];
    const relationships: Relationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let itemsProcessed = 0;

    // Get server name from package.json
    const packageJsonPath = path.join(rootPath, 'package.json');
    let serverName = path.basename(rootPath);
    let serverMetadata: Record<string, unknown> = {};

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        serverName = packageJson.name || serverName;
        serverMetadata = {
          version: packageJson.version,
          description: packageJson.description,
        };
        itemsProcessed++;
      } catch (e) {
        warnings.push(`Failed to parse package.json: ${e}`);
      }
    }

    // Create server entity (root)
    entities.push({
      sourceId: `mcp:${serverName}`,
      name: serverName,
      levelId: 'server',
      entityType: 'service',
      metadata: serverMetadata,
      sourceLocation: rootPath,
      contentHash: this.hashObject(serverMetadata),
    });

    // Parse the entry file for tool definitions
    const entryPath = path.join(rootPath, mcpConfig.entryFile || 'src/index.ts');
    if (!fs.existsSync(entryPath)) {
      warnings.push(`Entry file not found: ${mcpConfig.entryFile}`);
    } else {
      try {
        const content = fs.readFileSync(entryPath, 'utf-8');
        const tools = this.extractTools(content);
        const categories = new Map<string, EntityWithLevel>();

        for (const tool of tools) {
          itemsProcessed++;

          // Extract category from tool name
          let categoryId = 'general';
          let categoryName = 'General';
          if (mcpConfig.extractCategories) {
            const parts = tool.name.split(mcpConfig.categorySeparator || '_');
            if (parts.length > 1) {
              categoryId = parts[0];
              categoryName = this.formatCategoryName(parts[0]);
            }
          }

          // Create category if not exists
          const categorySourceId = `mcp:${serverName}/category/${categoryId}`;
          if (!categories.has(categoryId)) {
            const categoryEntity: EntityWithLevel = {
              sourceId: categorySourceId,
              name: categoryName,
              levelId: 'category',
              parentSourceId: `mcp:${serverName}`,
              entityType: 'category',
              metadata: { categoryId },
            };
            categories.set(categoryId, categoryEntity);
            entities.push(categoryEntity);
          }

          // Create tool entity
          const toolSourceId = `mcp:${serverName}/tool/${tool.name}`;
          entities.push({
            sourceId: toolSourceId,
            name: tool.name,
            levelId: 'tool',
            parentSourceId: categorySourceId,
            entityType: 'tool',
            metadata: {
              description: tool.description,
              parameters: tool.inputSchema?.properties
                ? Object.keys(tool.inputSchema.properties)
                : [],
              requiredParams: tool.inputSchema?.required || [],
            },
            sourceLocation: entryPath,
            contentHash: this.hashObject(tool),
          });

          // Create relationships for shared schemas (if any)
          // This is a simplified version - a full implementation would parse schema refs
        }

        // Look for resources and prompts
        const resources = this.extractResources(content);
        for (const resource of resources) {
          itemsProcessed++;
          entities.push({
            sourceId: `mcp:${serverName}/resource/${resource.name}`,
            name: resource.name,
            levelId: 'resource',
            parentSourceId: `mcp:${serverName}`,
            entityType: 'resource',
            metadata: {
              uri: resource.uri,
              description: resource.description,
              mimeType: resource.mimeType,
            },
            sourceLocation: entryPath,
          });
        }

        const prompts = this.extractPrompts(content);
        for (const prompt of prompts) {
          itemsProcessed++;
          entities.push({
            sourceId: `mcp:${serverName}/prompt/${prompt.name}`,
            name: prompt.name,
            levelId: 'prompt',
            parentSourceId: `mcp:${serverName}`,
            entityType: 'prompt',
            metadata: {
              description: prompt.description,
              arguments: prompt.arguments,
            },
            sourceLocation: entryPath,
          });
        }
      } catch (e) {
        errors.push(`Failed to parse entry file: ${e}`);
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

  private extractTools(content: string): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    // Match tool definitions in the tools array
    // This regex looks for object literals with name, description, inputSchema
    const toolPattern = /\{\s*name:\s*['"]([^'"]+)['"],\s*description:\s*['"]([^'"]+)['"]/g;

    let match;
    while ((match = toolPattern.exec(content)) !== null) {
      tools.push({
        name: match[1],
        description: match[2],
      });
    }

    // Also try to match more complex definitions with inputSchema
    // This is a simplified version - real parsing would use an AST
    const detailedPattern = /\{\s*name:\s*['"]([^'"]+)['"],[\s\S]*?description:\s*['"`]([^'"`]+)['"`][\s\S]*?inputSchema:\s*\{[\s\S]*?properties:\s*\{([\s\S]*?)\}[\s\S]*?required:\s*\[([^\]]*)\]/g;

    while ((match = detailedPattern.exec(content)) !== null) {
      const name = match[1];
      // Update existing tool or add new
      const existing = tools.find(t => t.name === name);
      if (existing) {
        const required = match[4].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
        existing.inputSchema = { required };
      }
    }

    return tools;
  }

  private extractResources(content: string): Array<{ name: string; uri?: string; description?: string; mimeType?: string }> {
    const resources: Array<{ name: string; uri?: string; description?: string; mimeType?: string }> = [];

    // Match resource definitions
    const resourcePattern = /resources:\s*\[[\s\S]*?\{[\s\S]*?name:\s*['"]([^'"]+)['"][\s\S]*?uri:\s*['"]([^'"]+)['"][\s\S]*?\}/g;

    let match;
    while ((match = resourcePattern.exec(content)) !== null) {
      resources.push({
        name: match[1],
        uri: match[2],
      });
    }

    return resources;
  }

  private extractPrompts(content: string): Array<{ name: string; description?: string; arguments?: string[] }> {
    const prompts: Array<{ name: string; description?: string; arguments?: string[] }> = [];

    // Match prompt definitions
    const promptPattern = /prompts:\s*\[[\s\S]*?\{[\s\S]*?name:\s*['"]([^'"]+)['"][\s\S]*?description:\s*['"]([^'"]+)['"][\s\S]*?\}/g;

    let match;
    while ((match = promptPattern.exec(content)) !== null) {
      prompts.push({
        name: match[1],
        description: match[2],
      });
    }

    return prompts;
  }

  private formatCategoryName(categoryId: string): string {
    return categoryId
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  async validateConfig(config: SourceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const mcpConfig = config.config as MCPConfig;

    if (!config.location) {
      errors.push('location is required');
    } else if (!fs.existsSync(config.location)) {
      errors.push(`location does not exist: ${config.location}`);
    } else {
      const entryPath = path.join(config.location, mcpConfig?.entryFile || 'src/index.ts');
      if (!fs.existsSync(entryPath)) {
        errors.push(`Entry file not found: ${mcpConfig?.entryFile || 'src/index.ts'}`);
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
        id: 'server',
        name: 'MCP Server',
        pluralName: 'MCP Servers',
        order: 0,
        color: '#6B5B95',
        icon: 'server',
        description: 'MCP server root',
      },
      {
        id: 'category',
        name: 'Tool Category',
        pluralName: 'Tool Categories',
        order: 1,
        color: '#88B04B',
        icon: 'folder',
        description: 'Group of related tools',
      },
      {
        id: 'tool',
        name: 'Tool',
        pluralName: 'Tools',
        order: 2,
        color: '#F7CAC9',
        icon: 'wrench',
        description: 'MCP tool definition',
      },
      {
        id: 'resource',
        name: 'Resource',
        pluralName: 'Resources',
        order: 1,
        color: '#92A8D1',
        icon: 'database',
        description: 'MCP resource',
      },
      {
        id: 'prompt',
        name: 'Prompt',
        pluralName: 'Prompts',
        order: 1,
        color: '#955251',
        icon: 'message',
        description: 'MCP prompt template',
      },
    ];
  }

  private hashObject(obj: unknown): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
  }
}
