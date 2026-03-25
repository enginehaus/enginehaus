/**
 * Task Graph Visualization - Mermaid Diagram Export
 *
 * Generates Mermaid dependency graph for task visualization.
 */

import { UnifiedTask, TaskPriority, TaskStatus } from '../coordination/types.js';

export interface MermaidOptions {
  direction?: 'TB' | 'LR' | 'BT' | 'RL';  // Top-Bottom, Left-Right, etc.
  showPriority?: boolean;
  showStatus?: boolean;
  showFiles?: boolean;
  maxNodes?: number;
  theme?: 'default' | 'dark' | 'forest' | 'neutral';
}

/**
 * Get node style based on task status
 */
function getStatusStyle(status: TaskStatus): string {
  switch (status) {
    case 'ready':
      return ':::ready';
    case 'in-progress':
      return ':::inprogress';
    case 'blocked':
      return ':::blocked';
    case 'completed':
      return ':::completed';
    default:
      return '';
  }
}

/**
 * Get node shape based on priority
 */
function getPriorityShape(priority: TaskPriority): { open: string; close: string } {
  switch (priority) {
    case 'critical':
      return { open: '{{', close: '}}' };  // Hexagon
    case 'high':
      return { open: '([', close: '])' };  // Stadium
    case 'medium':
      return { open: '[', close: ']' };    // Rectangle
    case 'low':
      return { open: '(', close: ')' };    // Round
    default:
      return { open: '[', close: ']' };
  }
}

/**
 * Sanitize text for Mermaid (escape special characters)
 */
function sanitize(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/[<>]/g, '')
    .replace(/[\n\r]/g, ' ')
    .slice(0, 50);  // Truncate long titles
}

/**
 * Generate unique node ID from task ID
 */
function nodeId(taskId: string): string {
  return `task_${taskId.replace(/-/g, '_').slice(0, 8)}`;
}

/**
 * Generate task dependency graph as Mermaid flowchart
 */
export function generateDependencyGraph(
  tasks: UnifiedTask[],
  options: MermaidOptions = {}
): string {
  const {
    direction = 'TB',
    showPriority = true,
    showStatus = true,
    maxNodes = 50,
  } = options;

  const lines: string[] = [
    `flowchart ${direction}`,
    '',
    '  %% Style definitions',
    '  classDef ready fill:#90EE90,stroke:#228B22,color:#000',
    '  classDef inprogress fill:#87CEEB,stroke:#4169E1,color:#000',
    '  classDef blocked fill:#FFB6C1,stroke:#DC143C,color:#000',
    '  classDef completed fill:#D3D3D3,stroke:#696969,color:#000',
    '',
  ];

  // Limit tasks if too many
  const displayTasks = tasks.slice(0, maxNodes);

  // Generate nodes
  lines.push('  %% Task nodes');
  for (const task of displayTasks) {
    const id = nodeId(task.id);
    const shape = showPriority ? getPriorityShape(task.priority) : { open: '[', close: ']' };
    const style = showStatus ? getStatusStyle(task.status) : '';
    const label = sanitize(task.title);

    lines.push(`  ${id}${shape.open}"${label}"${shape.close}${style}`);
  }

  lines.push('');
  lines.push('  %% Dependencies');

  // Generate edges (dependencies)
  for (const task of displayTasks) {
    if (task.blockedBy && task.blockedBy.length > 0) {
      const targetId = nodeId(task.id);
      for (const blockerId of task.blockedBy) {
        const blockerTask = tasks.find(t => t.id === blockerId);
        if (blockerTask) {
          const sourceId = nodeId(blockerId);
          lines.push(`  ${sourceId} --> ${targetId}`);
        }
      }
    }
  }

  // Add legend if using shapes for priority
  if (showPriority) {
    lines.push('');
    lines.push('  %% Legend');
    lines.push('  subgraph Legend');
    lines.push('    direction LR');
    lines.push('    leg_crit{{"Critical"}}');
    lines.push('    leg_high(["High"])');
    lines.push('    leg_med["Medium"]');
    lines.push('    leg_low("Low")');
    lines.push('  end');
  }

  return lines.join('\n');
}
