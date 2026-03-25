/**
 * Task Graph Visualization Tool
 *
 * Generates Mermaid dependency graph for task visualization.
 */

import { CoordinationService } from '../core/services/coordination-service.js';

export interface VisualizeParams {
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  showPriority?: boolean;
  showStatus?: boolean;
  maxNodes?: number;
}

export const visualizeToolSchema = {
  name: 'visualize',
  description: 'Generate a Mermaid dependency graph of tasks showing dependencies, status (colors), and priority (shapes). Paste into any Mermaid-compatible viewer.',
  inputSchema: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        enum: ['TB', 'LR', 'BT', 'RL'],
        description: 'Graph direction: TB (top-bottom), LR (left-right), BT, RL',
      },
      showPriority: {
        type: 'boolean',
        description: 'Show priority with shapes (default: true)',
      },
      showStatus: {
        type: 'boolean',
        description: 'Show status with colors (default: true)',
      },
      maxNodes: {
        type: 'number',
        description: 'Max nodes to display (default: 50)',
      },
    },
  },
};

export async function handleVisualize(
  service: CoordinationService,
  args: VisualizeParams
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const result = await service.generateTaskGraph({
    direction: args.direction,
    showPriority: args.showPriority,
    showStatus: args.showStatus,
    maxNodes: args.maxNodes,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}
