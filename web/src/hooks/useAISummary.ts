/**
 * useAISummary Hook
 *
 * Fetches and caches the AI-generated status summary for Wheelhaus.
 * The summary provides a one-sentence overview of current project state.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AISummaryResponse } from '../api/client';

export interface UseAISummaryResult {
  summary: string | null;
  generatedAt: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useAISummary(): UseAISummaryResult {
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isFetching,
    error,
  } = useQuery<AISummaryResponse, Error>({
    queryKey: ['wheelhaus-summary'],
    queryFn: () => api.wheelhaus.getSummary(),
    staleTime: 30000, // Consider fresh for 30 seconds (matches server cache)
    refetchOnWindowFocus: false,
  });

  const refresh = async () => {
    // Force refresh by invalidating cache and fetching with refresh flag
    await queryClient.fetchQuery({
      queryKey: ['wheelhaus-summary'],
      queryFn: () => api.wheelhaus.getSummary(true),
    });
  };

  return {
    summary: data?.summary ?? null,
    generatedAt: data?.generatedAt ?? null,
    isLoading,
    isRefreshing: isFetching && !isLoading,
    error: error ?? null,
    refresh,
  };
}
