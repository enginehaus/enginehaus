/**
 * WebSocket Transport for Wheelhaus
 *
 * Broadcasts ViewMaterializer deltas to connected clients in real-time.
 * Provides much lower latency than polling for the control room experience.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { ViewMaterializer, ViewDelta } from './view-materializer.js';

export interface WebSocketClient {
  id: string;
  ws: WebSocket;
  connectedAt: Date;
  subscriptions: Set<string>; // 'sessions' | 'decisions' | 'tasks' | 'health' | 'all'
  lastPing: Date;
}

export interface WheelhausMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'snapshot';
  channels?: string[];
}

export interface WheelhausResponse {
  type: 'delta' | 'snapshot' | 'pong' | 'error' | 'subscribed';
  data?: unknown;
  channel?: string;
  timestamp: string;
}

export class WheelhausWebSocket {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private materializer: ViewMaterializer;
  private pingInterval: NodeJS.Timeout | null = null;
  private clientIdCounter = 0;

  constructor(materializer: ViewMaterializer) {
    this.materializer = materializer;
  }

  /**
   * Attach to an existing HTTP server
   */
  attachToServer(server: import('http').Server, path = '/ws/wheelhaus'): void {
    this.wss = new WebSocketServer({ server, path });
    this.setupServer();
  }

  /**
   * Create standalone WebSocket server
   */
  listen(port: number): void {
    this.wss = new WebSocketServer({ port });
    this.setupServer();
    console.log(`Wheelhaus WebSocket server listening on port ${port}`);
  }

  /**
   * Setup WebSocket server handlers
   */
  private setupServer(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Subscribe to materializer deltas
    this.materializer.on('delta', (delta: ViewDelta) => {
      this.broadcastDelta(delta);
    });

    // Start ping interval for connection health
    this.pingInterval = setInterval(() => this.pingClients(), 30000);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const clientId = `client_${Date.now()}_${++this.clientIdCounter}`;
    const client: WebSocketClient = {
      id: clientId,
      ws,
      connectedAt: new Date(),
      subscriptions: new Set(['all']), // Subscribe to all by default
      lastPing: new Date(),
    };

    this.clients.set(clientId, client);

    // Send initial snapshot
    this.sendToClient(client, {
      type: 'snapshot',
      data: this.materializer.getSerializableSnapshot(),
      timestamp: new Date().toISOString(),
    });

    // Handle messages
    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as WheelhausMessage;
        this.handleMessage(client, message);
      } catch {
        this.sendToClient(client, {
          type: 'error',
          data: { message: 'Invalid message format' },
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    ws.on('error', () => {
      this.clients.delete(clientId);
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(client: WebSocketClient, message: WheelhausMessage): void {
    switch (message.type) {
      case 'subscribe':
        if (message.channels) {
          for (const channel of message.channels) {
            client.subscriptions.add(channel);
          }
        }
        this.sendToClient(client, {
          type: 'subscribed',
          data: { channels: Array.from(client.subscriptions) },
          timestamp: new Date().toISOString(),
        });
        break;

      case 'unsubscribe':
        if (message.channels) {
          for (const channel of message.channels) {
            client.subscriptions.delete(channel);
          }
        }
        break;

      case 'ping':
        client.lastPing = new Date();
        this.sendToClient(client, {
          type: 'pong',
          timestamp: new Date().toISOString(),
        });
        break;

      case 'snapshot':
        this.sendToClient(client, {
          type: 'snapshot',
          data: this.materializer.getSerializableSnapshot(),
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  /**
   * Broadcast delta to all subscribed clients
   */
  private broadcastDelta(delta: ViewDelta): void {
    const channel = delta.type;
    const response: WheelhausResponse = {
      type: 'delta',
      channel,
      data: delta,
      timestamp: new Date().toISOString(),
    };

    for (const client of this.clients.values()) {
      if (client.subscriptions.has('all') || client.subscriptions.has(channel)) {
        this.sendToClient(client, response);
      }
    }
  }

  /**
   * Send message to specific client
   */
  private sendToClient(client: WebSocketClient, message: WheelhausResponse): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Ping all clients to check connection health
   */
  private pingClients(): void {
    const now = new Date();
    const staleThreshold = 90000; // 90 seconds

    for (const [id, client] of this.clients) {
      // Remove stale connections
      if (now.getTime() - client.lastPing.getTime() > staleThreshold) {
        client.ws.terminate();
        this.clients.delete(id);
        continue;
      }

      // Send ping
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    }
  }

  /**
   * Get connection stats
   */
  getStats(): { clientCount: number; clients: Array<{ id: string; connectedAt: Date; subscriptions: string[] }> } {
    return {
      clientCount: this.clients.size,
      clients: Array.from(this.clients.values()).map(c => ({
        id: c.id,
        connectedAt: c.connectedAt,
        subscriptions: Array.from(c.subscriptions),
      })),
    };
  }

  /**
   * Shutdown WebSocket server
   */
  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}
