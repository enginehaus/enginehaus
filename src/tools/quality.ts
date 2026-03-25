/**
 * Consolidated Quality Tool
 *
 * Combines 4 quality metrics tools into 1 with a `mode` parameter:
 * - get_quality_trends → mode: "trends"
 * - get_quality_metrics → mode: "metrics"
 * - get_quality_insights → mode: "insights"
 * - compare_quality_periods → mode: "compare"
 *
 * All answer: "how are we doing on quality?"
 */

import { CoordinationService } from '../core/services/coordination-service.js';

export type QualityMode = 'trends' | 'metrics' | 'insights' | 'compare';

export interface QualityParams {
  mode: QualityMode;
  // Trends/metrics options
  days?: number;
  periodDays?: number;
  // Compare options
  period1Days?: number;
  period2Days?: number;
}

export const qualityToolSchema = {
  name: 'quality',
  description: 'Analyze project quality metrics. Modes: "trends" (velocity, cycle times, blockers over time), "metrics" (period summary), "insights" (AI recommendations), "compare" (compare two periods)',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['trends', 'metrics', 'insights', 'compare'],
        description: 'Quality analysis mode',
      },
      days: {
        type: 'number',
        description: 'Number of days to analyze (trends mode, default: 30)',
      },
      periodDays: {
        type: 'number',
        description: 'Period in days (metrics mode, default: 7 for weekly)',
      },
      period1Days: {
        type: 'number',
        description: 'First period in days (compare mode, default: 7)',
      },
      period2Days: {
        type: 'number',
        description: 'Second period in days (compare mode, default: 7)',
      },
    },
    required: ['mode'],
  },
};

export async function handleQuality(
  service: CoordinationService,
  args: QualityParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: any;

  switch (args.mode) {
    case 'trends':
      result = await service.getQualityTrends(args.days || 30);
      break;

    case 'metrics':
      result = await service.getQualityMetrics(args.periodDays || 7);
      break;

    case 'insights':
      result = await service.getQualityInsights();
      break;

    case 'compare':
      result = await service.compareQualityPeriods(
        args.period1Days || 7,
        args.period2Days || 7
      );
      break;

    default:
      throw new Error(`Unknown quality mode: ${args.mode}`);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
