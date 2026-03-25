/**
 * useWheelhausWebSocket Hook
 *
 * Real-time WebSocket connection to Wheelhaus backend.
 * Falls back to REST API polling if WebSocket unavailable.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client';
import type {
  ActiveSessionView,
  DecisionStreamItem,
  TaskGraphNode,
  ContextHealthMetrics,
} from '../api/client';

export interface WheelhausData {
  sessions: ActiveSessionView[];
  decisions: DecisionStreamItem[];
  tasks: TaskGraphNode[];
  health: ContextHealthMetrics | null;
  lastMaterializedAt: string | null;
}

interface WheelhausSnapshot {
  sessions: Record<string, ActiveSessionView>;
  decisions: DecisionStreamItem[];
  tasks: Record<string, TaskGraphNode>;
  health: ContextHealthMetrics;
  lastMaterializedAt: string;
}

interface WheelhausMessage {
  type: 'delta' | 'snapshot' | 'pong' | 'error' | 'subscribed';
  data?: unknown;
  channel?: string;
  timestamp: string;
}

interface DeltaData {
  type: 'sessions' | 'decisions' | 'tasks' | 'health' | 'snapshot';
  data: unknown;
}

export interface UseWheelhausWebSocketResult {
  data: WheelhausData;
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  reconnect: () => void;
  lastUpdated: Date | null;
}

const INITIAL_DATA: WheelhausData = {
  sessions: [],
  decisions: [],
  tasks: [],
  health: null,
  lastMaterializedAt: null,
};

// Determine WebSocket URL based on current location
function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;

  // In development, connect to the backend server port
  if (import.meta.env.DEV) {
    return 'ws://localhost:3456/ws/wheelhaus';
  }

  return protocol + '//' + host + '/ws/wheelhaus';
}

export function useWheelhausWebSocket(): UseWheelhausWebSocketResult {
  const [data, setData] = useState<WheelhausData>(INITIAL_DATA);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  const processSnapshot = useCallback((snapshot: WheelhausSnapshot) => {
    setData({
      sessions: Object.values(snapshot.sessions || {}),
      decisions: snapshot.decisions || [],
      tasks: Object.values(snapshot.tasks || {}),
      health: snapshot.health || null,
      lastMaterializedAt: snapshot.lastMaterializedAt || null,
    });
    setLastUpdated(new Date());
  }, []);

  const processDelta = useCallback((delta: DeltaData) => {
    setData(prev => {
      switch (delta.type) {
        case 'sessions': {
          const sessionsMap = delta.data as Record<string, ActiveSessionView>;
          return { ...prev, sessions: Object.values(sessionsMap) };
        }
        case 'decisions': {
          const decisions = delta.data as DecisionStreamItem[];
          return { ...prev, decisions };
        }
        case 'tasks': {
          const tasksMap = delta.data as Record<string, TaskGraphNode>;
          return { ...prev, tasks: Object.values(tasksMap) };
        }
        case 'health': {
          const health = delta.data as ContextHealthMetrics;
          return { ...prev, health };
        }
        case 'snapshot': {
          processSnapshot(delta.data as WheelhausSnapshot);
          return prev;
        }
        default:
          return prev;
      }
    });
    setLastUpdated(new Date());
  }, [processSnapshot]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
        reconnectAttempts.current = 0;

        // Send subscribe message
        ws.send(JSON.stringify({ type: 'subscribe', channels: ['all'] }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WheelhausMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'snapshot':
              processSnapshot(message.data as WheelhausSnapshot);
              break;
            case 'delta':
              processDelta(message.data as DeltaData);
              break;
            case 'pong':
              // Connection alive
              break;
            case 'error':
              console.error('WebSocket error:', message.data);
              break;
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        setError(new Error('WebSocket connection error'));
      };
    } catch (e) {
      setIsConnecting(false);
      setError(e instanceof Error ? e : new Error('Failed to connect'));
    }
  }, [processSnapshot, processDelta]);

  // Fallback: fetch via REST API
  const fetchViaRest = useCallback(async () => {
    try {
      const snapshot = await api.wheelhaus.getSnapshot();
      setData({
        sessions: snapshot.sessions || [],
        decisions: snapshot.decisions || [],
        tasks: snapshot.tasks || [],
        health: snapshot.health || null,
        lastMaterializedAt: snapshot.lastMaterializedAt || null,
      });
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      console.error('REST fallback failed:', e);
    }
  }, []);

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    reconnectAttempts.current = 0;
    connect();
  }, [connect]);

  // Connect on mount, with REST fallback
  useEffect(() => {
    // Fetch initial data via REST immediately (WebSocket may take time)
    fetchViaRest();

    // Then try WebSocket for real-time updates
    connect();

    // Ping to keep connection alive, or poll if disconnected
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      } else {
        // Fallback to polling when WebSocket is disconnected
        fetchViaRest();
      }
    }, 5000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, fetchViaRest]);

  return {
    data,
    isConnected,
    isConnecting,
    error,
    reconnect,
    lastUpdated,
  };
}
