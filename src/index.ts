import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createHttpTransport, HttpTransportOptions } from './adapters/mcp/http-transport.js';
import { CoordinationEngine } from './coordination/engine.js';
import { CoordinationService } from './core/services/coordination-service.js';
import { GitService } from './git/git-service.js';
import { QualityService } from './quality/quality-service.js';
// eslint-disable-next-line no-restricted-imports -- Bootstrap: creates storage instance for CoordinationService
import { JSONStorageService, StorageService } from './storage/storage-service.js';
// eslint-disable-next-line no-restricted-imports -- Bootstrap: creates storage instance for CoordinationService
import { SQLiteStorageService } from './storage/sqlite-storage-service.js';
import { SessionHealthChecker } from './coordination/health-check.js';
import { DEFAULT_CONFIG } from './config/types.js';
import { ConfigurationManager } from './config/configuration-manager.js';
import { InsightLoop } from './analysis/insight-loop.js';
import { getDataDir } from './config/paths.js';
import { AuditHelpers } from './audit/audit-service.js';
// Tool registry + self-registering tool definitions
import { registry, type ToolContext } from './adapters/mcp/tool-registry.js';
import './adapters/mcp/tools/index.js'; // triggers all tool registrations
import { WHEELHAUS_UI_RESOURCE_URI } from './adapters/mcp/schemas/wheelhaus-schemas.js';
import { resolveAgentIdentity } from './utils/agent-identity.js';
import { TelemetryService, DEFAULT_TELEMETRY_CONFIG } from './telemetry/index.js';
import { EventOrchestrator } from './events/event-orchestrator.js';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { expandPath } from './utils/paths.js';

/**
 * Auto-detect project from working directory or environment variable
 */
async function autoDetectProject(storage: SQLiteStorageService): Promise<void> {
  // Check env var first
  const envProject = process.env.ENGINEHAUS_PROJECT;
  if (envProject) {
    let project = await storage.getProject(envProject);
    if (!project) {
      project = await storage.getProjectBySlug(envProject);
    }
    if (project) {
      await storage.setActiveProjectId(project.id);
      console.error(`Active project set from env: ${project.name}`);
      return;
    }
  }

  // Match cwd against project rootPaths
  const cwd = process.cwd();
  const projects = await storage.listProjects();

  for (const project of projects) {
    const projectPath = expandPath(project.rootPath);
    if (cwd.startsWith(projectPath)) {
      await storage.setActiveProjectId(project.id);
      console.error(`Active project auto-detected: ${project.name}`);
      return;
    }
  }

  console.error('No project matched working directory, using default');
}

/**
 * Enginehaus MCP Server
 * 
 * Exposes coordination capabilities to Claude Code and other MCP clients.
 */
class EnginehausMCPServer {
  private server: Server;
  private coordination: CoordinationEngine;
  private service: CoordinationService; // Core service layer for consistent business logic
  private telemetry: TelemetryService; // AX telemetry for usage profiling
  private projectRoot: string;
  private sessionTaskCount: number = 0; // Track tasks created this session for first-task confirmation
  private mcpSessionId: string = uuidv4(); // Track MCP session for telemetry
  private sessionState = { taskCount: 0 }; // Mutable state for task handlers

  // AX: Track tool calls for Desktop→Code handoff nudges
  private toolCallCount: number = 0;
  private readonly HANDOFF_NUDGE_THRESHOLD = 15; // After N calls, nudge to hand off
  private handoffNudgeShown: boolean = false; // Show nudge only once per session

  // Server-side enforcement (Tier 2): cached decision
  private _enforceServerSide: boolean | null = null;

  // Agent identity: resolved lazily from MCP client info
  private _resolvedAgentId: string | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.server = new Server(
      {
        name: 'enginehaus-coordination',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Initialize services with configurable storage backend
    const storageType = process.env.ENGINEHAUS_STORAGE || 'sqlite';
    const dataDir = getDataDir();

    let storage: StorageService;
    if (storageType === 'json') {
      console.error('Using JSON storage backend');
      storage = new JSONStorageService(dataDir);
    } else {
      console.error('Using SQLite storage backend');
      storage = new SQLiteStorageService(dataDir);
    }

    const gitService = new GitService(projectRoot);
    const qualityService = new QualityService(projectRoot);

    this.coordination = new CoordinationEngine(gitService, qualityService, storage);

    // Initialize the core service layer (shares storage with CoordinationEngine)
    const events = new EventOrchestrator();
    this.service = new CoordinationService(storage as SQLiteStorageService, events);

    // Activate the self-updating insight loop (wires events → learning engine → tasks)
    if (storage instanceof SQLiteStorageService) {
      const insightLoop = new InsightLoop(storage, {
        events,
        coordination: this.service,
      });
      insightLoop.activate();
    }

    // Initialize telemetry service for AX usage profiling
    this.telemetry = new TelemetryService(storage as SQLiteStorageService, {
      level: (process.env.ENGINEHAUS_TELEMETRY_LEVEL as 'off' | 'minimal' | 'full') || 'minimal',
      sessionIdentification: 'pseudonymous',
    });

    // Set up request handlers
    this.setupHandlers();
  }

  /**
   * Determine if server-side enforcement is needed (Tier 2).
   * Tier 1 clients have native hooks — server-side is redundant but harmless.
   * Tier 2 clients need the server to enforce workflow rules.
   */
  private shouldEnforceServerSide(): boolean {
    if (this._enforceServerSide !== null) return this._enforceServerSide;

    // Env var override
    const envTier = process.env.EH_HOOKS_TIER;
    if (envTier === '1') { this._enforceServerSide = false; return false; }
    if (envTier === '2') { this._enforceServerSide = true; return true; }

    // Default: enforce server-side (safe — double enforcement is harmless)
    this._enforceServerSide = true;
    return true;
  }

  /**
   * Get current active project context for response headers.
   * This provides visibility into which project operations are targeting.
   */
  private async getProjectContext(): Promise<{ projectId: string; projectName: string; projectSlug: string } | null> {
    // 1. Try matching PROJECT_ROOT against known project root paths
    //    This ensures the MCP server targets the right project even when
    //    the active project is set to something else.
    if (this.projectRoot) {
      const projects = await this.service.listProjects();
      const match = projects.find(p => {
        if (!p.rootPath) return false;
        const rootPath = expandPath(p.rootPath);
        return this.projectRoot === rootPath || this.projectRoot.startsWith(rootPath + path.sep);
      });
      if (match) {
        return { projectId: match.id, projectName: match.name, projectSlug: match.slug };
      }
    }

    // 2. Fall back to explicit active project
    return this.service.getActiveProjectContext();
  }

  /**
   * Lazily resolve agent identity from MCP client info.
   * Caches the result after first resolution.
   */
  private getResolvedAgentId(): string {
    if (this._resolvedAgentId !== null) return this._resolvedAgentId;

    const clientVersion = this.server.getClientVersion?.();
    const resolved = resolveAgentIdentity({
      mcpClientName: clientVersion?.name,
      envAgentId: process.env.ENGINEHAUS_AGENT_ID,
    });

    this._resolvedAgentId = resolved.agentId;

    if (resolved.source !== 'default') {
      console.error(`Agent identity resolved: ${resolved.agentId} (from ${resolved.source})`);
    }

    return this._resolvedAgentId;
  }

  /**
   * Get the unified tool context for registry-dispatched handlers.
   */
  private getToolContext(): ToolContext {
    return {
      service: this.service,
      coordination: this.coordination,
      projectRoot: this.projectRoot,
      resolvedAgentId: this.getResolvedAgentId(),
      telemetry: this.telemetry,
      sessionState: this.sessionState,
      getProjectContext: () => this.getProjectContext(),
    };
  }

  private setupHandlers(): void {
    // List all registered tools (order determined by registration order in tools/index.ts)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: registry.listSchemas(),
    }));


    // MCP App: List resources (Wheelhaus UI)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [{
        uri: WHEELHAUS_UI_RESOURCE_URI,
        name: 'Wheelhaus Dashboard',
        description: 'Interactive Wheelhaus dashboard UI',
        mimeType: 'text/html;profile=mcp-app',
      }],
    }));

    // MCP App: Read resource (serve bundled HTML)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      if (uri === WHEELHAUS_UI_RESOURCE_URI) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const distDir = path.join(this.projectRoot, 'mcp-app', 'dist');
        try {
          const html = await fs.readFile(path.join(distDir, 'index.html'), 'utf-8');
          return {
            contents: [{
              uri: WHEELHAUS_UI_RESOURCE_URI,
              mimeType: 'text/html;profile=mcp-app',
              text: html,
            }],
          };
        } catch {
          // Fallback: MCP App not built yet
          return {
            contents: [{
              uri: WHEELHAUS_UI_RESOURCE_URI,
              mimeType: 'text/html;profile=mcp-app',
              text: '<html><body><p>Wheelhaus MCP App not built. Run: cd mcp-app && npm install && npm run build</p></body></html>',
            }],
          };
        }
      }
      throw new Error(`Unknown resource: ${uri}`);
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Extract name and args at handler scope for error logging
      const { name, arguments: args } = request.params;
      const startTime = Date.now();
      let success = true;
      let errorType: string | undefined;

      // AX: Track tool calls for handoff nudges (exclude handoff tools themselves)
      const handoffTools = ['generate_continuation_prompt', 'get_handoff_context', 'quick_handoff', 'get_handoff_status'];
      if (!handoffTools.includes(name)) {
        this.toolCallCount++;
      }

      // Server-side enforcement (Tier 2): block mutating tools without a claimed task
      if (this.shouldEnforceServerSide()) {
        const mutatingTools = registry.getMutatingToolNames();
        if (mutatingTools.includes(name)) {
          try {
            const { enforceTaskClaimed } = await import('./hooks/hook-logic.js');
            const enforcement = await enforceTaskClaimed(this.projectRoot);
            if (enforcement.action === 'block') {
              return {
                content: [{ type: 'text', text: `Blocked: ${enforcement.reason}\n\nUse get_next_task or claim_task first.` }],
                isError: true,
              };
            }
          } catch {
            // Don't block on enforcement failures
          }
        }
      }

      try {
        // Start telemetry chain tracking
        this.telemetry.startChain(this.mcpSessionId);

        // Resolve short task ID prefixes to full UUIDs before dispatching
        if (args && typeof args.taskId === 'string' && args.taskId.length < 36) {
          const resolved = await this.service.resolveTaskId(args.taskId);
          if (resolved) {
            args.taskId = resolved.id;
          }
          // If not resolved, let the handler produce its normal "not found" error
        }

        const result = await this.handleToolCall(name, args);

        // AX: Inject handoff nudge once after threshold (only for non-handoff tools)
        if (this.toolCallCount > this.HANDOFF_NUDGE_THRESHOLD && !this.handoffNudgeShown && !handoffTools.includes(name)) {
          this.handoffNudgeShown = true;
          const nudgeMessage = `\n\n---\n⚡ **Handoff Nudge** (${this.toolCallCount} tool calls this session)\nYou've made ${this.toolCallCount} Enginehaus calls. If you're doing implementation/investigation work, consider handing off to Claude Code for faster file access.\n\nQuick handoff: \`quick_handoff({ note: "your context here" })\`\n---`;

          // Inject nudge into result content
          if (result.content && result.content.length > 0 && result.content[0].type === 'text') {
            result.content[0].text += nudgeMessage;
          }

          // Log nudge trigger for telemetry
          await this.telemetry.recordToolInvocation({
            toolName: 'ax_handoff_nudge',
            sessionId: this.mcpSessionId,
            durationMs: 0,
            inputSize: 0,
            outputSize: nudgeMessage.length,
            success: true,
          });
        }

        // Record successful tool invocation
        const inputSize = JSON.stringify(args || {}).length;
        const outputSize = JSON.stringify(result).length;

        await this.telemetry.recordToolInvocation({
          toolName: name,
          sessionId: this.mcpSessionId,
          durationMs: Date.now() - startTime,
          inputSize,
          outputSize,
          success: true,
        });

        return result;
      } catch (error) {
        success = false;
        errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

        // Record failed tool invocation
        await this.telemetry.recordToolInvocation({
          toolName: name,
          sessionId: this.mcpSessionId,
          durationMs: Date.now() - startTime,
          inputSize: JSON.stringify(args || {}).length,
          outputSize: 0,
          success: false,
          errorType,
        });

        // Log error to audit trail
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : undefined;

        try {
          // ARCHITECTURE EXCEPTION: Direct storage access for error audit logging.
          // WHY: Audit logging in catch blocks must not fail or add latency.
          // Routing through CoordinationService risks masking the original error if
          // the service itself has a bug. Fire-and-forget audit logging is acceptable.
          // See: CoordinationService header for full architectural decision documentation.
          const storage = this.coordination['storage'] as SQLiteStorageService;
          const projectId = storage.getActiveProjectIdOrDefault();

          await storage.logAuditEvent(
            AuditHelpers.errorEvent(
              'error.tool_failed',
              name,
              errorMessage,
              projectId,
              {
                args: AuditHelpers.sanitize(args),
                stackTrace: stackTrace?.split('\n').slice(0, 10).join('\n'), // Limit stack trace
                errorType,
              }
            )
          );
        } catch (logError) {
          // Don't let logging errors mask the original error
          console.error('Failed to log error to audit trail:', logError);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      } finally {
        // End telemetry chain tracking
        await this.telemetry.endChain(this.mcpSessionId, success);
      }
    });
  }

  /**
   * Handle individual tool call via registry dispatch.
   */
  private async handleToolCall(name: string, args: Record<string, unknown> | undefined): Promise<{ content: Array<{ type: string; [key: string]: unknown }>; isError?: boolean }> {
    const def = registry.resolve(name);
    if (!def) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return def.handler(this.getToolContext(), args ?? {});
  }

  // All tool dispatch handled by ToolRegistry (see adapters/mcp/tool-registry.ts)

  async run(transportType: 'stdio' | 'http' = 'stdio'): Promise<void> {
    // ARCHITECTURE EXCEPTION: Direct storage access during server initialization.
    // WHY: Storage must be initialized before CoordinationService can be used.
    // This is a bootstrap operation - circular dependency means service needs storage,
    // but storage init happens during bootstrapping before service is ready.
    // See: CoordinationService header for full architectural decision documentation.
    const storage = this.coordination['storage'] as StorageService;

    // Both storage services have initialize() method
    if ('initialize' in storage && typeof storage.initialize === 'function') {
      await storage.initialize();
    }

    // Auto-detect project from working directory (SQLite only)
    if (storage instanceof SQLiteStorageService) {
      await autoDetectProject(storage);

      // Restore active sessions from SQLite
      await this.coordination.initialize();

      // Start session health checker for automatic stale session cleanup
      // Pass engine to sync in-memory sessions after expiring stale ones
      // Get config from active project if available, otherwise use defaults
      const configManager = new ConfigurationManager({ storage });
      const activeProjectId = await storage.getActiveProjectId();
      let sessionConfig = DEFAULT_CONFIG.workflow.sessions;
      let healthCheckConfig = DEFAULT_CONFIG.quality.healthCheck;

      if (activeProjectId) {
        try {
          const effectiveConfig = await configManager.getEffectiveConfig(activeProjectId);
          sessionConfig = effectiveConfig.workflow.sessions;
          healthCheckConfig = effectiveConfig.quality.healthCheck;
        } catch {
          // Use defaults if config lookup fails
        }
      }

      const healthChecker = new SessionHealthChecker(storage, {
        checkIntervalMs: healthCheckConfig.intervalMinutes * 60 * 1000,
        sessionTimeoutMs: sessionConfig.expiryMinutes * 60 * 1000,
        verbose: process.env.ENGINEHAUS_VERBOSE === 'true',
      }, this.coordination);
      healthChecker.start();
      console.error(`Session health checker started (check interval: ${healthCheckConfig.intervalMinutes}m, session timeout: ${sessionConfig.expiryMinutes}m)`);
    }

    // Connect to transport based on type
    if (transportType === 'http') {
      const httpOptions: HttpTransportOptions = {
        port: parseInt(process.env.MCP_PORT || '3000', 10),
        allowedOrigins: process.env.MCP_CORS_ORIGINS?.split(',') || '*',
        verbose: process.env.ENGINEHAUS_VERBOSE === 'true',
      };

      const { transport, listen, close, setupRestApi } = createHttpTransport(this.server, httpOptions);

      // Wire up REST API handlers for simple integrations (bypasses MCP sessions)
      if (setupRestApi) {
        // Get active project ID for REST API handlers
        const getActiveProjectId = () => {
          const sqliteStorage = storage as SQLiteStorageService;
          return sqliteStorage.getActiveProjectIdOrDefault();
        };

        setupRestApi({
          listTasks: async (params) => {
            const projectId = await getActiveProjectId();
            const result = await this.service.listTasksWithResponse({
              status: params.status,
              priority: params.priority,
              projectId,
            });
            // Apply limit manually if provided
            const limit = params.limit ? parseInt(params.limit) : undefined;
            return limit ? result.tasks.slice(0, limit) : result.tasks;
          },
          addTask: async (params) => {
            const projectId = await getActiveProjectId();
            const result = await this.service.createTask({
              title: params.title,
              description: params.description,
              priority: params.priority || 'medium',
              projectId,
            });
            return result;
          },
          completeTask: async (params) => {
            const result = await this.service.completeTaskWithResponse(
              params.taskId,
              { implementationSummary: params.summary || 'Completed via REST API' }
            );
            return result;
          },
          getStats: async () => {
            const projectId = await getActiveProjectId();
            return this.service.getStats(projectId);
          },
          getDecisions: async (params) => {
            const projectId = await getActiveProjectId();
            return this.service.getDecisions({
              category: params.category,
              limit: params.limit ? parseInt(params.limit) : undefined,
              projectId,
            });
          },
          logDecision: async (params) => {
            const projectId = await getActiveProjectId();
            return this.service.logDecision({
              decision: params.decision,
              rationale: params.rationale,
              category: params.category || 'other',
              projectId,
            });
          },
          getContext: async () => {
            const projectId = await getActiveProjectId();
            // Simple context - use the briefing endpoint
            return this.service.getBriefing({ projectId });
          },
          dispatchTask: async (params) => {
            const { v4: uuid } = await import('uuid');
            const task = await this.service.getTask(params.taskId);
            if (!task) throw new Error(`Task ${params.taskId} not found`);
            const dispatch = {
              id: uuid(),
              projectId: task.projectId,
              taskId: params.taskId,
              targetAgent: params.targetAgent,
              dispatchedBy: params.dispatchedBy || 'wheelhaus',
              priorityOverride: params.priorityOverride,
              context: params.context,
              status: 'pending' as const,
              createdAt: new Date(),
              expiresAt: params.expiresInMinutes
                ? new Date(Date.now() + params.expiresInMinutes * 60 * 1000)
                : undefined,
            };
            await this.service.dispatchTask(dispatch);
            return { dispatchId: dispatch.id, taskTitle: task.title };
          },
          listDispatches: async (params) => {
            return this.service.listDispatches({
              status: params.status,
              targetAgent: params.targetAgent,
              limit: params.limit ? parseInt(params.limit) : undefined,
            });
          },
          recallDispatch: async (params) => {
            const recalled = await this.service.recallDispatch(params.dispatchId);
            return { recalled };
          },
        });
      }

      await this.server.connect(transport);
      await listen();

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        await close();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await close();
        process.exit(0);
      });
    } else {
      // Default: stdio transport
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Enginehaus MCP Server running on stdio');
    }
  }
}

// Parse command line arguments
function parseArgs(): { transport: 'stdio' | 'http' } {
  const transportArg = process.argv.find(arg => arg.startsWith('--transport='));
  const transportType = transportArg?.split('=')[1];

  if (transportType && transportType !== 'stdio' && transportType !== 'http') {
    console.error(`Invalid transport type: ${transportType}. Use 'stdio' or 'http'.`);
    process.exit(1);
  }

  return {
    transport: (transportType as 'stdio' | 'http') || 'stdio',
  };
}

// Start the server
const args = parseArgs();
const projectRoot = process.env.PROJECT_ROOT || process.cwd();
const server = new EnginehausMCPServer(projectRoot);
server.run(args.transport).catch(console.error);
