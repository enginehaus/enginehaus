/**
 * HTTP/SSE Transport for Enginehaus MCP Server
 *
 * Provides HTTP transport alongside stdio using the MCP SDK's built-in
 * StreamableHTTPServerTransport. Enables remote access from ChatGPT,
 * Gemini, Mistral, and other HTTP-capable MCP clients.
 *
 * @see docs/research/mcp-http-transport-research.md
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport, EventStore, EventId, StreamId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { AuthConfig, loadAuthConfig } from './auth/config.js';
import { createAuthMiddleware, skipAuthForPaths } from './auth/middleware.js';

/**
 * In-memory event store for session resumability.
 * Implements the SDK's EventStore interface.
 */
class InMemoryEventStore implements EventStore {
  private events: Map<EventId, { streamId: StreamId; message: JSONRPCMessage }> = new Map();

  private generateEventId(streamId: StreamId): EventId {
    return `${streamId}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  private getStreamIdFromEventId(eventId: EventId): StreamId {
    const parts = eventId.split('_');
    return parts.length > 0 ? parts[0] : '';
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const eventId = this.generateEventId(streamId);
    this.events.set(eventId, { streamId, message });
    return eventId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> }
  ): Promise<StreamId> {
    if (!lastEventId || !this.events.has(lastEventId)) {
      return '';
    }

    const streamId = this.getStreamIdFromEventId(lastEventId);
    if (!streamId) {
      return '';
    }

    let foundLastEvent = false;
    const sortedEvents = [...this.events.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [eventId, { streamId: eventStreamId, message }] of sortedEvents) {
      if (eventStreamId !== streamId) {
        continue;
      }
      if (eventId === lastEventId) {
        foundLastEvent = true;
        continue;
      }
      if (foundLastEvent) {
        await send(eventId, message);
      }
    }

    return streamId;
  }
}

/**
 * Options for HTTP transport configuration
 */
export interface HttpTransportOptions {
  /** Port to listen on (default: 3000) */
  port?: number;
  /** CORS allowed origins (default: '*') */
  allowedOrigins?: string | string[];
  /** Enable verbose logging */
  verbose?: boolean;
  /** Authentication configuration (loaded from env if not provided) */
  auth?: AuthConfig;
}

/**
 * Result of creating an HTTP transport
 */
export interface HttpTransportResult {
  /** Express app instance */
  app: Express;
  /** Transport instance for server connection */
  transport: StreamableHTTPServerTransport;
  /** Start listening on configured port */
  listen: () => Promise<void>;
  /** Cleanup function to close all sessions */
  close: () => Promise<void>;
  /** Setup REST API handlers (bypasses MCP sessions) */
  setupRestApi?: (handlers: {
    listTasks: (params: any) => Promise<any>;
    addTask: (params: any) => Promise<any>;
    completeTask: (params: any) => Promise<any>;
    getStats: () => Promise<any>;
    getDecisions: (params: any) => Promise<any>;
    logDecision: (params: any) => Promise<any>;
    getContext: (params: any) => Promise<any>;
    dispatchTask?: (params: any) => Promise<any>;
    listDispatches?: (params: any) => Promise<any>;
    recallDispatch?: (params: any) => Promise<any>;
  }) => void;
}

/**
 * Create an HTTP transport for the MCP server.
 *
 * Usage:
 * ```typescript
 * const { app, transport, listen } = createHttpTransport(server, { port: 3000 });
 * await server.connect(transport);
 * await listen();
 * ```
 */
export function createHttpTransport(
  server: Server,
  options: HttpTransportOptions = {}
): HttpTransportResult {
  const {
    port = parseInt(process.env.MCP_PORT || '3000', 10),
    allowedOrigins = process.env.MCP_CORS_ORIGINS?.split(',') || '*',
    verbose = process.env.ENGINEHAUS_VERBOSE === 'true',
    auth,
  } = options;

  const app = express();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  // JSON body parser
  app.use(express.json());

  // CORS configuration - expose Mcp-Session-Id header for clients
  app.use(cors({
    origin: allowedOrigins,
    exposedHeaders: ['Mcp-Session-Id'],
  }));

  // Load auth configuration (from options or environment)
  const authConfig = auth || loadAuthConfig();

  // Create auth middleware (skips /health endpoint)
  const authMiddleware = createAuthMiddleware(authConfig);
  const protectedAuthMiddleware = skipAuthForPaths(authMiddleware, ['/health']);
  app.use(protectedAuthMiddleware);

  // Health check endpoint (no auth required)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      transport: 'http',
      auth: authConfig.mode,
      activeSessions: sessions.size,
      timestamp: new Date().toISOString(),
    });
  });

  // REST API endpoints (bypasses MCP sessions for simple integrations)
  // These are injected by the server after setup via app.restApi
  (app as any).restApi = {
    setHandlers: (handlers: {
      listTasks: (params: any) => Promise<any>;
      addTask: (params: any) => Promise<any>;
      completeTask: (params: any) => Promise<any>;
      getStats: () => Promise<any>;
      getDecisions: (params: any) => Promise<any>;
      logDecision: (params: any) => Promise<any>;
      getContext: (params: any) => Promise<any>;
      dispatchTask?: (params: any) => Promise<any>;
      listDispatches?: (params: any) => Promise<any>;
      recallDispatch?: (params: any) => Promise<any>;
    }) => {
      app.get('/api/tasks', async (req: Request, res: Response) => {
        try {
          const result = await handlers.listTasks(req.query);
          res.json({ success: true, data: result });
        } catch (error) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.post('/api/tasks', async (req: Request, res: Response) => {
        try {
          const result = await handlers.addTask(req.body);
          res.json({ success: true, data: result });
        } catch (error) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.post('/api/tasks/:taskId/complete', async (req: Request, res: Response) => {
        try {
          const result = await handlers.completeTask({ taskId: req.params.taskId, ...req.body });
          res.json({ success: true, data: result });
        } catch (error) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.get('/api/stats', async (_req: Request, res: Response) => {
        try {
          const result = await handlers.getStats();
          res.json({ success: true, data: result });
        } catch (error) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.get('/api/decisions', async (req: Request, res: Response) => {
        try {
          const result = await handlers.getDecisions(req.query);
          res.json({ success: true, data: result });
        } catch (error) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.post('/api/decisions', async (req: Request, res: Response) => {
        try {
          const result = await handlers.logDecision(req.body);
          res.json({ success: true, data: result });
        } catch (error) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      app.get('/api/context', async (req: Request, res: Response) => {
        try {
          const result = await handlers.getContext(req.query);
          res.json({ success: true, data: result });
        } catch (error) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        }
      });

      // Dispatch queue endpoints
      if (handlers.dispatchTask) {
        app.post('/api/dispatches', async (req: Request, res: Response) => {
          try {
            const result = await handlers.dispatchTask!(req.body);
            res.json({ success: true, data: result });
          } catch (error) {
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
          }
        });
      }
      if (handlers.listDispatches) {
        app.get('/api/dispatches', async (req: Request, res: Response) => {
          try {
            const result = await handlers.listDispatches!(req.query);
            res.json({ success: true, data: result });
          } catch (error) {
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
          }
        });
      }
      if (handlers.recallDispatch) {
        app.post('/api/dispatches/:dispatchId/recall', async (req: Request, res: Response) => {
          try {
            const result = await handlers.recallDispatch!({ dispatchId: req.params.dispatchId });
            res.json({ success: true, data: result });
          } catch (error) {
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
          }
        });
      }
    }
  };

  // MCP endpoint handler
  const mcpHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (verbose) {
      console.error(`[HTTP] ${req.method} /mcp session=${sessionId || 'new'}`);
    }

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessions.has(sessionId)) {
        // Reuse existing transport
        transport = sessions.get(sessionId)!;
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        // New initialization request - create transport
        const eventStore = new InMemoryEventStore();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (newSessionId: string) => {
            if (verbose) {
              console.error(`[HTTP] Session initialized: ${newSessionId}`);
            }
            sessions.set(newSessionId, transport);
          },
        });

        // Clean up on close
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            if (verbose) {
              console.error(`[HTTP] Session closed: ${sid}`);
            }
            sessions.delete(sid);
          }
        };

        // Connect transport to server
        await server.connect(transport);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[HTTP] Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  };

  // Register MCP routes (GET for SSE, POST for requests, DELETE for termination)
  app.get('/mcp', mcpHandler);
  app.post('/mcp', mcpHandler);
  app.delete('/mcp', mcpHandler);

  // Start listening
  const listen = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const httpServer = app.listen(port, () => {
        console.error(`Enginehaus MCP HTTP Server listening on port ${port}`);
        console.error(`  Health: http://localhost:${port}/health`);
        console.error(`  MCP:    http://localhost:${port}/mcp`);
        resolve();
      });

      httpServer.on('error', (error) => {
        reject(error);
      });

      // Store server for cleanup
      (app as any).__httpServer = httpServer;
    });
  };

  // Cleanup function
  const close = async (): Promise<void> => {
    console.error('[HTTP] Shutting down...');
    for (const [sessionId, transport] of sessions) {
      try {
        console.error(`[HTTP] Closing session ${sessionId}`);
        await transport.close();
      } catch (error) {
        console.error(`[HTTP] Error closing session ${sessionId}:`, error);
      }
    }
    sessions.clear();

    const httpServer = (app as any).__httpServer;
    if (httpServer) {
      httpServer.close();
    }
  };

  // We need to return a transport for the initial connection
  // Create a placeholder that will be replaced on first request
  const eventStore = new InMemoryEventStore();
  const initialTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    eventStore,
    onsessioninitialized: (sessionId: string) => {
      sessions.set(sessionId, initialTransport);
    },
  });

  return {
    app,
    transport: initialTransport,
    listen,
    close,
    // Expose REST API setup function
    setupRestApi: (app as any).restApi?.setHandlers,
  };
}
