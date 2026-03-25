/**
 * Real-time Data Hook
 *
 * Provides intelligent polling with visual update indicators.
 * Ready for future SSE backend support.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseRealtimeOptions {
  /** Query keys to refresh */
  queryKeys: string[][];
  /** Polling interval in ms (default: 5000) */
  interval?: number;
  /** Whether to show update notifications */
  showNotifications?: boolean;
  /** Enable/disable polling */
  enabled?: boolean;
}

interface RealtimeState {
  lastUpdate: Date | null;
  updateCount: number;
  isConnected: boolean;
}

/**
 * Hook for real-time data updates
 *
 * Currently uses intelligent polling. Infrastructure ready for SSE.
 */
export function useRealtimeData(options: UseRealtimeOptions) {
  const {
    queryKeys,
    interval = 5000,
    enabled = true,
  } = options;

  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeState>({
    lastUpdate: null,
    updateCount: 0,
    isConnected: true,
  });
  const intervalRef = useRef<number | null>(null);
  const documentVisibleRef = useRef(true);

  // Track document visibility to pause polling when tab is hidden
  useEffect(() => {
    const handleVisibility = () => {
      documentVisibleRef.current = document.visibilityState === 'visible';
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Refresh all query keys
  const refresh = useCallback(async () => {
    if (!documentVisibleRef.current) return;

    try {
      await Promise.all(
        queryKeys.map(key => queryClient.invalidateQueries({ queryKey: key }))
      );
      setState(prev => ({
        ...prev,
        lastUpdate: new Date(),
        updateCount: prev.updateCount + 1,
        isConnected: true,
      }));
    } catch {
      setState(prev => ({ ...prev, isConnected: false }));
    }
  }, [queryClient, queryKeys]);

  // Manual refresh
  const forceRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // Set up polling interval
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = window.setInterval(refresh, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, interval, refresh]);

  return {
    ...state,
    forceRefresh,
  };
}

/**
 * Hook specifically for task board real-time updates
 */
export function useTaskBoardRealtime(enabled = true) {
  return useRealtimeData({
    queryKeys: [['tasks'], ['stats'], ['sessions']],
    interval: 5000,
    enabled,
  });
}

/**
 * Hook for dashboard real-time updates
 */
export function useDashboardRealtime(enabled = true) {
  return useRealtimeData({
    queryKeys: [['stats'], ['sessions'], ['decisions']],
    interval: 10000,
    enabled,
  });
}

/**
 * Hook for audit log real-time updates
 */
export function useAuditLogRealtime(enabled = true) {
  return useRealtimeData({
    queryKeys: [['events'], ['events-stats']],
    interval: 15000,
    enabled,
  });
}
