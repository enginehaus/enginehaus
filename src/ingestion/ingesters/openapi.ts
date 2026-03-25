/**
 * OpenAPI/REST Spec Ingester
 *
 * Parses OpenAPI 3.x specifications to extract:
 * - Paths and operations (endpoints)
 * - Schemas and components
 * - Tags for domain grouping
 *
 * Hierarchy: API → Domain (tag) → Resource → Endpoint
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

export interface OpenAPIConfig {
  /** Path to OpenAPI spec file (default: 'openapi.yaml' or 'openapi.json') */
  specFile?: string;
  /** Whether to create entities for schemas (default: true) */
  includeSchemas?: boolean;
  /** Whether to use tags for domain grouping (default: true) */
  useTags?: boolean;
}

const DEFAULT_CONFIG: OpenAPIConfig = {
  includeSchemas: true,
  useTags: true,
};

interface OpenAPISpec {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  paths?: Record<string, Record<string, OperationObject>>;
  tags?: Array<{ name: string; description?: string }>;
  components?: {
    schemas?: Record<string, SchemaObject>;
  };
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  requestBody?: unknown;
  responses?: Record<string, unknown>;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  $ref?: string;
}

export class OpenAPIIngester implements Ingester {
  readonly sourceType = 'openapi' as const;
  readonly name = 'OpenAPI/REST Spec Ingester';
  readonly version = '1.0.0';

  async parse(config: SourceConfig): Promise<IngestionResult> {
    const startedAt = new Date();
    const apiConfig = { ...DEFAULT_CONFIG, ...(config.config as OpenAPIConfig) };
    const rootPath = config.location;

    const entities: EntityWithLevel[] = [];
    const relationships: Relationship[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let itemsProcessed = 0;

    // Find and load spec file
    const specPath = this.findSpecFile(rootPath, apiConfig.specFile);
    if (!specPath) {
      errors.push('No OpenAPI spec file found');
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

    let spec: OpenAPISpec;
    try {
      spec = this.loadSpec(specPath);
      itemsProcessed++;
    } catch (e) {
      errors.push(`Failed to parse spec file: ${e}`);
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

    const apiName = spec.info?.title || path.basename(rootPath);
    const apiId = `api:${this.slugify(apiName)}`;

    // Create API entity (root)
    entities.push({
      sourceId: apiId,
      name: apiName,
      levelId: 'api',
      entityType: 'api',
      metadata: {
        version: spec.info?.version,
        description: spec.info?.description,
        openApiVersion: spec.openapi,
      },
      sourceLocation: specPath,
      contentHash: this.hashObject(spec.info || {}),
    });

    // Create domain entities from tags
    const domains = new Map<string, EntityWithLevel>();
    if (apiConfig.useTags && spec.tags) {
      for (const tag of spec.tags) {
        const domainId = `${apiId}/domain/${this.slugify(tag.name)}`;
        const domain: EntityWithLevel = {
          sourceId: domainId,
          name: tag.name,
          levelId: 'domain',
          parentSourceId: apiId,
          entityType: 'domain',
          metadata: { description: tag.description },
        };
        domains.set(tag.name, domain);
        entities.push(domain);
        itemsProcessed++;
      }
    }

    // Create a default domain for untagged endpoints
    const defaultDomainId = `${apiId}/domain/default`;
    if (!domains.has('default')) {
      domains.set('default', {
        sourceId: defaultDomainId,
        name: 'Default',
        levelId: 'domain',
        parentSourceId: apiId,
        entityType: 'domain',
        metadata: { description: 'Endpoints without tags' },
      });
    }

    // Process paths
    const resources = new Map<string, EntityWithLevel>();

    if (spec.paths) {
      for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
        // Extract resource from path (e.g., /users/{id} -> users)
        const resourceName = this.extractResourceName(pathStr);
        const resourceId = `${apiId}/resource/${this.slugify(resourceName)}`;

        // Determine domain for this path
        let domainId = defaultDomainId;
        const firstOp = Object.values(pathItem)[0] as OperationObject | undefined;
        if (firstOp?.tags?.[0] && domains.has(firstOp.tags[0])) {
          domainId = domains.get(firstOp.tags[0])!.sourceId;
        }

        // Create resource if not exists
        if (!resources.has(resourceName)) {
          const resource: EntityWithLevel = {
            sourceId: resourceId,
            name: resourceName,
            levelId: 'resource',
            parentSourceId: domainId,
            entityType: 'resource',
            metadata: { basePath: pathStr },
          };
          resources.set(resourceName, resource);
          entities.push(resource);
          itemsProcessed++;
        }

        // Process operations
        for (const [method, operation] of Object.entries(pathItem)) {
          if (!operation || typeof operation !== 'object') continue;

          const op = operation as OperationObject;
          const operationId = op.operationId || `${method}_${pathStr.replace(/[{}\/]/g, '_')}`;
          const endpointId = `${apiId}/endpoint/${this.slugify(operationId)}`;

          entities.push({
            sourceId: endpointId,
            name: op.summary || operationId,
            levelId: 'endpoint',
            parentSourceId: resourceId,
            entityType: 'endpoint',
            metadata: {
              method: method.toUpperCase(),
              path: pathStr,
              operationId,
              description: op.description,
              parameters: op.parameters?.map(p => p.name) || [],
              tags: op.tags,
            },
            sourceLocation: specPath,
            contentHash: this.hashObject(op),
          });
          itemsProcessed++;

          // Create relationships to schemas
          if (apiConfig.includeSchemas) {
            const schemaRefs = this.extractSchemaRefs(op);
            for (const schemaRef of schemaRefs) {
              const schemaName = schemaRef.split('/').pop();
              if (schemaName) {
                relationships.push({
                  fromSourceId: endpointId,
                  toSourceId: `${apiId}/schema/${this.slugify(schemaName)}`,
                  type: 'references',
                  confidence: 1.0,
                  metadata: { ref: schemaRef },
                });
              }
            }
          }
        }
      }
    }

    // Add default domain if it has endpoints
    const defaultDomain = domains.get('default');
    if (defaultDomain) {
      const hasEndpoints = entities.some(
        e => e.levelId === 'resource' && e.parentSourceId === defaultDomainId
      );
      if (hasEndpoints) {
        entities.push(defaultDomain);
      }
    }

    // Process schemas
    if (apiConfig.includeSchemas && spec.components?.schemas) {
      for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
        const schemaId = `${apiId}/schema/${this.slugify(schemaName)}`;

        entities.push({
          sourceId: schemaId,
          name: schemaName,
          levelId: 'schema',
          parentSourceId: apiId,
          entityType: 'schema',
          metadata: {
            type: schema.type,
            properties: schema.properties ? Object.keys(schema.properties) : [],
            required: schema.required,
            description: schema.description,
          },
          sourceLocation: specPath,
          contentHash: this.hashObject(schema),
        });
        itemsProcessed++;

        // Create relationships between schemas (for $ref)
        if (schema.properties) {
          for (const [, propSchema] of Object.entries(schema.properties)) {
            const prop = propSchema as { $ref?: string };
            if (prop.$ref) {
              const refName = prop.$ref.split('/').pop();
              if (refName) {
                relationships.push({
                  fromSourceId: schemaId,
                  toSourceId: `${apiId}/schema/${this.slugify(refName)}`,
                  type: 'references',
                  confidence: 1.0,
                });
              }
            }
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

  private findSpecFile(rootPath: string, configuredFile?: string): string | null {
    if (configuredFile) {
      const fullPath = path.join(rootPath, configuredFile);
      return fs.existsSync(fullPath) ? fullPath : null;
    }

    const candidates = [
      'openapi.yaml',
      'openapi.yml',
      'openapi.json',
      'swagger.yaml',
      'swagger.yml',
      'swagger.json',
      'api.yaml',
      'api.yml',
      'api.json',
    ];

    for (const candidate of candidates) {
      const fullPath = path.join(rootPath, candidate);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }

  private loadSpec(specPath: string): OpenAPISpec {
    const content = fs.readFileSync(specPath, 'utf-8');

    if (specPath.endsWith('.json')) {
      return JSON.parse(content);
    }

    // Simple YAML parsing (for basic cases)
    // In production, would use a proper YAML parser
    try {
      return JSON.parse(content);
    } catch {
      // Attempt basic YAML to JSON conversion for simple specs
      // This is a simplified parser - real implementation would use js-yaml
      const lines = content.split('\n');
      const result: Record<string, unknown> = {};
      let currentSection = result;
      const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: result, indent: -1 }];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const indent = line.search(/\S/);
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) continue;

        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();

        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        currentSection = stack[stack.length - 1].obj;

        if (value) {
          // Simple value
          currentSection[key] = value.replace(/^["']|["']$/g, '');
        } else {
          // Nested object
          currentSection[key] = {};
          stack.push({ obj: currentSection[key] as Record<string, unknown>, indent });
        }
      }

      return result as OpenAPISpec;
    }
  }

  private extractResourceName(path: string): string {
    const parts = path.split('/').filter(p => p && !p.startsWith('{'));
    return parts[0] || 'root';
  }

  private extractSchemaRefs(operation: OperationObject): string[] {
    const refs: string[] = [];
    const content = JSON.stringify(operation);
    const refPattern = /"\$ref"\s*:\s*"([^"]+)"/g;

    let match;
    while ((match = refPattern.exec(content)) !== null) {
      refs.push(match[1]);
    }

    return refs;
  }

  private slugify(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async validateConfig(config: SourceConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const apiConfig = config.config as OpenAPIConfig;

    if (!config.location) {
      errors.push('location is required');
    } else if (!fs.existsSync(config.location)) {
      errors.push(`location does not exist: ${config.location}`);
    } else {
      const specPath = this.findSpecFile(config.location, apiConfig?.specFile);
      if (!specPath) {
        errors.push('No OpenAPI spec file found');
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
        id: 'api',
        name: 'API',
        pluralName: 'APIs',
        order: 0,
        color: '#3498DB',
        icon: 'cloud',
        description: 'REST API root',
      },
      {
        id: 'domain',
        name: 'Domain',
        pluralName: 'Domains',
        order: 1,
        color: '#9B59B6',
        icon: 'tag',
        description: 'API domain (from tags)',
      },
      {
        id: 'resource',
        name: 'Resource',
        pluralName: 'Resources',
        order: 2,
        color: '#2ECC71',
        icon: 'cube',
        description: 'API resource',
      },
      {
        id: 'endpoint',
        name: 'Endpoint',
        pluralName: 'Endpoints',
        order: 3,
        color: '#E74C3C',
        icon: 'route',
        description: 'API endpoint (operation)',
      },
      {
        id: 'schema',
        name: 'Schema',
        pluralName: 'Schemas',
        order: 1,
        color: '#F39C12',
        icon: 'database',
        description: 'Data schema/model',
      },
    ];
  }

  private hashObject(obj: unknown): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
  }
}
