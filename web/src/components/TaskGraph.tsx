/**
 * Interactive D3 Force-Directed Task Graph
 *
 * Visualizes tasks as nodes with dependency relationships as edges.
 * Features: zoom/pan, click-to-focus, filtering, bottleneck highlighting.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { Task } from '../api/client';
import './TaskGraph.css';

interface TaskGraphProps {
  tasks: Task[];
  onTaskSelect?: (taskId: string) => void;
  statusFilter?: string | null;
  priorityFilter?: string | null;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  task: Task;
  blocksCount: number;  // How many tasks this blocks (bottleneck weight)
  blockedByCount: number;
  isCriticalPath: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  type: 'blocks' | 'semantic';
}

const STATUS_COLORS: Record<string, string> = {
  'ready': '#646cff',
  'in-progress': '#f59e0b',
  'blocked': '#ef4444',
  'completed': '#22c55e',
};

const PRIORITY_SIZES: Record<string, number> = {
  'critical': 24,
  'high': 20,
  'medium': 16,
  'low': 12,
};

export function TaskGraph({ tasks, onTaskSelect, statusFilter, priorityFilter }: TaskGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Build graph data from tasks
  const buildGraphData = useCallback(() => {
    // Filter tasks
    let filteredTasks = tasks;
    if (statusFilter) {
      filteredTasks = filteredTasks.filter(t => t.status === statusFilter);
    }
    if (priorityFilter) {
      filteredTasks = filteredTasks.filter(t => t.priority === priorityFilter);
    }

    const taskMap = new Map(filteredTasks.map(t => [t.id, t]));

    // Calculate bottleneck weight (how many tasks each task blocks)
    const blocksCountMap = new Map<string, number>();
    filteredTasks.forEach(task => {
      (task.blocks || []).forEach(blockedId => {
        if (taskMap.has(blockedId)) {
          blocksCountMap.set(task.id, (blocksCountMap.get(task.id) || 0) + 1);
        }
      });
    });

    // Identify critical path (tasks with high blocks count or blocking critical tasks)
    const criticalIds = new Set<string>();
    filteredTasks.forEach(task => {
      if (task.priority === 'critical' || (blocksCountMap.get(task.id) || 0) >= 3) {
        criticalIds.add(task.id);
        // Mark blockers of critical tasks as critical path
        (task.blockedBy || []).forEach(blockerId => {
          if (taskMap.has(blockerId)) {
            criticalIds.add(blockerId);
          }
        });
      }
    });

    // Build nodes
    const nodes: GraphNode[] = filteredTasks.map(task => ({
      id: task.id,
      task,
      blocksCount: blocksCountMap.get(task.id) || 0,
      blockedByCount: (task.blockedBy || []).filter(id => taskMap.has(id)).length,
      isCriticalPath: criticalIds.has(task.id),
    }));

    // Build links (only between filtered tasks)
    const links: GraphLink[] = [];
    filteredTasks.forEach(task => {
      (task.blockedBy || []).forEach(blockerId => {
        if (taskMap.has(blockerId)) {
          links.push({
            source: blockerId,
            target: task.id,
            type: 'blocks',
          });
        }
      });
    });

    return { nodes, links };
  }, [tasks, statusFilter, priorityFilter]);

  // Handle window resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width: width || 800, height: height || 600 });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Render D3 graph
  useEffect(() => {
    if (!svgRef.current || tasks.length === 0) return;

    const { nodes, links } = buildGraphData();
    if (nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create main group for zooming
    const g = svg.append('g');

    // Create arrow marker for directed edges
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', '#666');

    // Create critical path arrow marker
    svg.select('defs').append('marker')
      .attr('id', 'arrowhead-critical')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', '#ef4444');

    // Create force simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => PRIORITY_SIZES[d.task.priority] + 10));

    // Helper to get node from link source/target
    const getNodeId = (ref: string | GraphNode): string => {
      return typeof ref === 'string' ? ref : ref.id;
    };

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('class', d => {
        const sourceNode = nodes.find(n => n.id === getNodeId(d.source));
        const targetNode = nodes.find(n => n.id === getNodeId(d.target));
        const isCritical = sourceNode?.isCriticalPath && targetNode?.isCriticalPath;
        return `link ${d.type} ${isCritical ? 'critical' : ''}`;
      })
      .attr('marker-end', d => {
        const sourceNode = nodes.find(n => n.id === getNodeId(d.source));
        const targetNode = nodes.find(n => n.id === getNodeId(d.target));
        const isCritical = sourceNode?.isCriticalPath && targetNode?.isCriticalPath;
        return isCritical ? 'url(#arrowhead-critical)' : 'url(#arrowhead)';
      });

    // Create node groups
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', d => `node ${d.isCriticalPath ? 'critical-path' : ''} ${selectedNode === d.id ? 'selected' : ''}`)
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Add bottleneck glow for high-impact nodes
    node.filter(d => d.blocksCount >= 2)
      .append('circle')
      .attr('class', 'bottleneck-glow')
      .attr('r', d => PRIORITY_SIZES[d.task.priority] + 8);

    // Add node circles
    node.append('circle')
      .attr('r', d => PRIORITY_SIZES[d.task.priority])
      .attr('fill', d => STATUS_COLORS[d.task.status])
      .attr('stroke', d => d.isCriticalPath ? '#ef4444' : '#333')
      .attr('stroke-width', d => d.isCriticalPath ? 3 : 1.5);

    // Add priority indicator for critical/high
    node.filter(d => d.task.priority === 'critical' || d.task.priority === 'high')
      .append('text')
      .attr('class', 'priority-indicator')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .text(d => d.task.priority === 'critical' ? '!' : '↑');

    // Add labels
    node.append('text')
      .attr('class', 'node-label')
      .attr('dy', d => PRIORITY_SIZES[d.task.priority] + 14)
      .attr('text-anchor', 'middle')
      .text(d => d.task.title.slice(0, 20) + (d.task.title.length > 20 ? '...' : ''));

    // Add blocks count badge for bottleneck nodes
    node.filter(d => d.blocksCount > 0)
      .append('g')
      .attr('class', 'blocks-badge')
      .attr('transform', d => `translate(${PRIORITY_SIZES[d.task.priority] - 4}, ${-PRIORITY_SIZES[d.task.priority] + 4})`)
      .call(g => {
        g.append('circle')
          .attr('r', 8)
          .attr('fill', '#ef4444');
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('fill', '#fff')
          .attr('font-size', '10px')
          .text(d => d.blocksCount);
      });

    // Handle click
    node.on('click', (event, d) => {
      event.stopPropagation();
      setSelectedNode(prev => prev === d.id ? null : d.id);
      onTaskSelect?.(d.id);
    });

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Click on background to deselect
    svg.on('click', () => {
      setSelectedNode(null);
    });

    // Initial zoom to fit
    const initialScale = 0.8;
    svg.call(zoom.transform, d3.zoomIdentity
      .translate(width * (1 - initialScale) / 2, height * (1 - initialScale) / 2)
      .scale(initialScale));

    return () => {
      simulation.stop();
    };
  }, [tasks, dimensions, buildGraphData, selectedNode, onTaskSelect]);

  if (tasks.length === 0) {
    return (
      <div className="task-graph-empty">
        <p>No tasks to visualize</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="task-graph-container">
      <svg ref={svgRef} width={dimensions.width} height={dimensions.height} />
      <div className="graph-controls">
        <span className="control-hint">Drag nodes • Scroll to zoom • Pan to navigate</span>
      </div>
    </div>
  );
}
