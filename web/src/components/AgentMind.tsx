/**
 * Agent Mind Visualization
 *
 * A living topology showing agent cognition through task relationships,
 * decision links, and attention patterns. The signature 2027-ready feature.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import type { TaskGraphNode } from '../api/client';

interface AgentMindProps {
  tasks: TaskGraphNode[];
  onNodeClick?: (task: TaskGraphNode) => void;
  width?: number;
  height?: number;
}

interface GraphNode {
  id: string;
  task: TaskGraphNode;
  size: number;
  color: string;
  isActive: boolean;
  isBlocked: boolean;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: 'dependency' | 'decision';
}

// Priority to size mapping
const PRIORITY_SIZE: Record<string, number> = {
  critical: 14,
  high: 11,
  medium: 8,
  low: 6,
};

// Status to color mapping
const STATUS_COLOR: Record<string, string> = {
  'in-progress': '#818cf8', // accent purple
  'ready': '#4ade80',       // green
  'blocked': '#f87171',     // red
  'completed': '#71717a',   // gray
};

export function AgentMind({ tasks, onNodeClick, width = 400, height = 300 }: AgentMindProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any>>(undefined);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const animationRef = useRef<number>(0);

  // Build graph data from tasks
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = tasks.map(task => ({
      id: task.id,
      task,
      size: PRIORITY_SIZE[task.priority] || 8,
      color: STATUS_COLOR[task.status] || '#71717a',
      isActive: task.status === 'in-progress',
      isBlocked: task.status === 'blocked',
    }));

    const links: GraphLink[] = [];
    const taskIds = new Set(tasks.map(t => t.id));

    // Add dependency links
    tasks.forEach(task => {
      task.blockedBy.forEach(blockerId => {
        if (taskIds.has(blockerId)) {
          links.push({
            source: blockerId,
            target: task.id,
            type: 'dependency',
          });
        }
      });
    });

    return { nodes, links };
  }, [tasks]);

  // Animation loop for active nodes (glow/pulse)
  useEffect(() => {
    let frame = 0;
    const animate = () => {
      frame++;
      animationRef.current = frame;
      requestAnimationFrame(animate);
    };
    const animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Custom node rendering
  const nodeCanvasObject = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const { x, y, size, color, isActive, isBlocked, task } = node;
    if (x === undefined || y === undefined) return;

    const frame = animationRef.current;
    const baseSize = size;

    // Glow effect for active nodes
    if (isActive) {
      const glowIntensity = 0.5 + 0.3 * Math.sin(frame * 0.05);
      const glowSize = baseSize + 4 + 2 * Math.sin(frame * 0.03);

      ctx.beginPath();
      ctx.arc(x, y, glowSize, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(129, 140, 248, ${glowIntensity * 0.3})`;
      ctx.fill();
    }

    // Pulse effect for blocked nodes
    if (isBlocked) {
      const pulseIntensity = 0.3 + 0.2 * Math.sin(frame * 0.08);
      const pulseSize = baseSize + 3 + Math.sin(frame * 0.1) * 2;

      ctx.beginPath();
      ctx.arc(x, y, pulseSize, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(248, 113, 113, ${pulseIntensity})`;
      ctx.fill();
    }

    // Main node circle
    ctx.beginPath();
    ctx.arc(x, y, baseSize, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Border for hover/focus
    if (hoverNode?.id === node.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Label (only show if zoomed in enough)
    if (globalScale > 0.8) {
      const label = task.title.length > 15 ? task.title.slice(0, 15) + '...' : task.title;
      ctx.font = `${10 / globalScale}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#a1a1aa';
      ctx.fillText(label, x, y + baseSize + 4);
    }
  }, [hoverNode]);

  // Custom link rendering
  const linkCanvasObject = useCallback((link: GraphLink, ctx: CanvasRenderingContext2D) => {
    const source = link.source as GraphNode;
    const target = link.target as GraphNode;

    if (!source.x || !source.y || !target.x || !target.y) return;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = link.type === 'dependency' ? '#3f3f46' : '#4b5563';
    ctx.lineWidth = link.type === 'dependency' ? 1.5 : 0.5;

    // Dashed line for decision links
    if (link.type === 'decision') {
      ctx.setLineDash([3, 3]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.stroke();
    ctx.setLineDash([]);

    // Arrow for dependencies
    if (link.type === 'dependency') {
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const arrowLength = 6;
      const arrowX = target.x - (target.size || 8) * Math.cos(angle);
      const arrowY = target.y - (target.size || 8) * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle - Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle + Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.strokeStyle = '#52525b';
      ctx.stroke();
    }
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (onNodeClick) {
      onNodeClick(node.task);
    }
  }, [onNodeClick]);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoverNode(node);
  }, []);

  // Zoom to fit on mount
  useEffect(() => {
    if (fgRef.current) {
      setTimeout(() => {
        fgRef.current?.zoomToFit(400, 40);
      }, 500);
    }
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="agent-mind-empty">
        <div className="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <span>No tasks to visualize</span>
      </div>
    );
  }

  return (
    <div className="agent-mind-container">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor="transparent"
        nodeRelSize={1}
        nodeCanvasObject={nodeCanvasObject}
        linkCanvasObject={linkCanvasObject}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1}
        linkDirectionalParticleSpeed={0.005}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />
      {hoverNode && (
        <div className="agent-mind-tooltip">
          <div className="tooltip-title">{hoverNode.task.title}</div>
          <div className="tooltip-meta">
            <span className={`status-${hoverNode.task.status}`}>{hoverNode.task.status}</span>
            <span className={`priority-${hoverNode.task.priority}`}>{hoverNode.task.priority}</span>
          </div>
          {hoverNode.task.currentPhase && (
            <div className="tooltip-phase">Phase {hoverNode.task.phaseNumber}: {hoverNode.task.currentPhase}</div>
          )}
        </div>
      )}
    </div>
  );
}
