import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { api, type Task } from '../api/client';
import { GitBranch, PieChart, Calendar, Network } from 'lucide-react';
import { TaskGraph } from '../components/TaskGraph';
import './Visualizations.css';

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#646cff',
    primaryTextColor: '#fff',
    primaryBorderColor: '#535bf2',
    lineColor: '#666',
    secondaryColor: '#1a1a1a',
    tertiaryColor: '#242424',
  },
});

type ChartType = 'graph' | 'dependency' | 'status' | 'priority' | 'timeline';

export function Visualizations() {
  const [activeChart, setActiveChart] = useState<ChartType>('graph');
  const chartRef = useRef<HTMLDivElement>(null);
  // Track selected task for potential future detail panel
  const [, setSelectedTaskId] = useState<string | null>(null);
  const [graphStatusFilter, setGraphStatusFilter] = useState<string | null>(null);
  const [graphPriorityFilter, setGraphPriorityFilter] = useState<string | null>(null);

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.tasks.list(),
  });

  const tasks = tasksData?.tasks || [];

  // Only render Mermaid charts for non-graph types
  useEffect(() => {
    if (!chartRef.current || tasks.length === 0 || activeChart === 'graph') return;

    const renderChart = async () => {
      const chart = generateChart(tasks, activeChart);
      if (!chart) return;

      try {
        chartRef.current!.innerHTML = '';
        const { svg } = await mermaid.render('mermaid-chart', chart);
        chartRef.current!.innerHTML = svg;
      } catch (error) {
        console.error('Mermaid render error:', error);
        chartRef.current!.innerHTML = `<div class="chart-error">Failed to render chart</div>`;
      }
    };

    renderChart();
  }, [tasks, activeChart]);

  if (isLoading) {
    return <div className="loading">Loading visualizations...</div>;
  }

  return (
    <div className="visualizations-page">
      <header className="page-header">
        <h1>Visualizations</h1>
        <span className="task-count">{tasks.length} tasks</span>
      </header>

      <div className="chart-tabs">
        <button
          className={`chart-tab ${activeChart === 'graph' ? 'active' : ''}`}
          onClick={() => setActiveChart('graph')}
        >
          <Network size={16} />
          Interactive Graph
        </button>
        <button
          className={`chart-tab ${activeChart === 'dependency' ? 'active' : ''}`}
          onClick={() => setActiveChart('dependency')}
        >
          <GitBranch size={16} />
          Workflow
        </button>
        <button
          className={`chart-tab ${activeChart === 'status' ? 'active' : ''}`}
          onClick={() => setActiveChart('status')}
        >
          <PieChart size={16} />
          Status Distribution
        </button>
        <button
          className={`chart-tab ${activeChart === 'priority' ? 'active' : ''}`}
          onClick={() => setActiveChart('priority')}
        >
          <PieChart size={16} />
          Priority Distribution
        </button>
        <button
          className={`chart-tab ${activeChart === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveChart('timeline')}
        >
          <Calendar size={16} />
          Timeline
        </button>
      </div>

      {activeChart === 'graph' ? (
        <>
          <div className="graph-filters">
            <div className="filter-group">
              <label>Status:</label>
              <select
                value={graphStatusFilter || ''}
                onChange={(e) => setGraphStatusFilter(e.target.value || null)}
              >
                <option value="">All Statuses</option>
                <option value="ready">Ready</option>
                <option value="in-progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div className="filter-group">
              <label>Priority:</label>
              <select
                value={graphPriorityFilter || ''}
                onChange={(e) => setGraphPriorityFilter(e.target.value || null)}
              >
                <option value="">All Priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="chart-container graph-view">
            <TaskGraph
              tasks={tasks}
              onTaskSelect={setSelectedTaskId}
              statusFilter={graphStatusFilter}
              priorityFilter={graphPriorityFilter}
            />
          </div>
          <GraphLegend />
        </>
      ) : (
        <>
          <div className="chart-container">
            <div ref={chartRef} className="mermaid-chart" />
          </div>
          <div className="chart-legend">
            {activeChart === 'dependency' && <DependencyLegend />}
            {activeChart === 'status' && <StatusLegend />}
            {activeChart === 'priority' && <PriorityLegend />}
          </div>
        </>
      )}
    </div>
  );
}

function generateChart(tasks: Task[], type: ChartType): string | null {
  switch (type) {
    case 'dependency':
      return generateDependencyGraph(tasks);
    case 'status':
      return generateStatusPie(tasks);
    case 'priority':
      return generatePriorityPie(tasks);
    case 'timeline':
      return generateTimeline(tasks);
    default:
      return null;
  }
}

function generateDependencyGraph(tasks: Task[]): string {
  const lines = ['flowchart LR'];

  // Group tasks by status for a workflow view
  const byStatus: Record<string, Task[]> = {
    'ready': [],
    'in-progress': [],
    'blocked': [],
    'completed': [],
  };

  tasks.forEach((task) => {
    byStatus[task.status]?.push(task);
  });

  // Create subgraphs for each status
  const statusLabels: Record<string, string> = {
    'ready': 'Ready',
    'in-progress': 'In Progress',
    'blocked': 'Blocked',
    'completed': 'Completed',
  };

  const statusOrder = ['ready', 'in-progress', 'completed'];

  statusOrder.forEach((status) => {
    const statusTasks = byStatus[status];
    if (statusTasks.length === 0) return;

    lines.push(`  subgraph ${status}["${statusLabels[status]}"]`);
    statusTasks.slice(0, 8).forEach((task) => {
      const label = task.title.slice(0, 20) + (task.title.length > 20 ? '...' : '');
      const nodeId = `task_${task.id.replace(/-/g, '_').slice(0, 8)}`;
      const priorityClass = `:::${task.priority}`;
      lines.push(`    ${nodeId}["${label}"]${priorityClass}`);
    });
    if (statusTasks.length > 8) {
      lines.push(`    more_${status}["+${statusTasks.length - 8} more"]:::muted`);
    }
    lines.push('  end');
  });

  // Show blocked tasks separately
  const blockedTasks = byStatus['blocked'];
  if (blockedTasks.length > 0) {
    lines.push('  subgraph blocked["⚠️ Blocked"]');
    blockedTasks.slice(0, 5).forEach((task) => {
      const label = task.title.slice(0, 20) + (task.title.length > 20 ? '...' : '');
      const nodeId = `task_${task.id.replace(/-/g, '_').slice(0, 8)}`;
      lines.push(`    ${nodeId}["${label}"]:::blockedTask`);
    });
    if (blockedTasks.length > 5) {
      lines.push(`    more_blocked["+${blockedTasks.length - 5} more"]:::muted`);
    }
    lines.push('  end');
  }

  // Add flow arrows between status groups
  if (byStatus['ready'].length > 0 && byStatus['in-progress'].length > 0) {
    lines.push('  ready --> |"claim"| in-progress');
  }
  if (byStatus['in-progress'].length > 0 && byStatus['completed'].length > 0) {
    lines.push('  in-progress --> |"complete"| completed');
  }
  if (byStatus['blocked'].length > 0) {
    lines.push('  blocked -.-> |"unblock"| ready');
  }

  // Add style classes
  lines.push('');
  lines.push('  classDef critical fill:#ef4444,stroke:#dc2626,color:#fff');
  lines.push('  classDef high fill:#f59e0b,stroke:#d97706,color:#000');
  lines.push('  classDef medium fill:#646cff,stroke:#535bf2,color:#fff');
  lines.push('  classDef low fill:#4b5563,stroke:#374151,color:#fff');
  lines.push('  classDef blockedTask fill:#7f1d1d,stroke:#ef4444,color:#fff');
  lines.push('  classDef muted fill:#374151,stroke:#4b5563,color:#9ca3af');

  return lines.join('\n');
}

function generateStatusPie(tasks: Task[]): string {
  const statusCounts = tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const lines = ['pie showData title Task Status Distribution'];

  if (statusCounts['ready']) lines.push(`  "Ready" : ${statusCounts['ready']}`);
  if (statusCounts['in-progress']) lines.push(`  "In Progress" : ${statusCounts['in-progress']}`);
  if (statusCounts['blocked']) lines.push(`  "Blocked" : ${statusCounts['blocked']}`);
  if (statusCounts['completed']) lines.push(`  "Completed" : ${statusCounts['completed']}`);

  return lines.join('\n');
}

function generatePriorityPie(tasks: Task[]): string {
  const priorityCounts = tasks.reduce((acc, task) => {
    acc[task.priority] = (acc[task.priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const lines = ['pie showData title Task Priority Distribution'];

  if (priorityCounts['critical']) lines.push(`  "Critical" : ${priorityCounts['critical']}`);
  if (priorityCounts['high']) lines.push(`  "High" : ${priorityCounts['high']}`);
  if (priorityCounts['medium']) lines.push(`  "Medium" : ${priorityCounts['medium']}`);
  if (priorityCounts['low']) lines.push(`  "Low" : ${priorityCounts['low']}`);

  return lines.join('\n');
}

function generateTimeline(tasks: Task[]): string {
  // Sort by creation date
  const sortedTasks = [...tasks].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const lines = ['gantt', '  title Task Timeline', '  dateFormat YYYY-MM-DD'];

  // Group by status
  const byStatus: Record<string, Task[]> = {
    'ready': [],
    'in-progress': [],
    'blocked': [],
    'completed': [],
  };

  sortedTasks.forEach((task) => {
    byStatus[task.status]?.push(task);
  });

  // Add sections
  Object.entries(byStatus).forEach(([status, statusTasks]) => {
    if (statusTasks.length === 0) return;

    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ');
    lines.push(`  section ${statusLabel}`);

    statusTasks.slice(0, 10).forEach((task) => {
      const start = new Date(task.createdAt).toISOString().split('T')[0];
      const label = task.title.slice(0, 20).replace(/[:\[\]]/g, ' ');
      const statusClass = status === 'completed' ? 'done' :
                         status === 'in-progress' ? 'active' :
                         status === 'blocked' ? 'crit' : '';
      lines.push(`    ${label} :${statusClass ? statusClass + ', ' : ''}${start}, 7d`);
    });
  });

  return lines.join('\n');
}

function GraphLegend() {
  return (
    <div className="graph-legend">
      <div className="legend-section">
        <h4>Status</h4>
        <div className="legend-items">
          <div className="legend-item"><span className="legend-dot ready"></span>Ready</div>
          <div className="legend-item"><span className="legend-dot in-progress"></span>In Progress</div>
          <div className="legend-item"><span className="legend-dot blocked"></span>Blocked</div>
          <div className="legend-item"><span className="legend-dot completed"></span>Completed</div>
        </div>
      </div>
      <div className="legend-section">
        <h4>Edges</h4>
        <div className="legend-items">
          <div className="legend-item"><span className="legend-line"></span>Dependency</div>
          <div className="legend-item"><span className="legend-line critical"></span>Critical Path</div>
        </div>
      </div>
      <div className="legend-section">
        <h4>Indicators</h4>
        <div className="legend-items">
          <div className="legend-item"><span className="legend-glow"></span>Bottleneck (blocks 2+)</div>
          <div className="legend-item"><span style={{ color: '#ef4444', fontWeight: 'bold' }}>!</span> Critical priority</div>
          <div className="legend-item"><span style={{ color: '#f59e0b', fontWeight: 'bold' }}>↑</span> High priority</div>
        </div>
      </div>
    </div>
  );
}

function DependencyLegend() {
  return (
    <div className="legend">
      <h4>Priority Colors</h4>
      <div className="legend-items horizontal">
        <div className="legend-item"><span className="color-box critical"></span>Critical</div>
        <div className="legend-item"><span className="color-box high"></span>High</div>
        <div className="legend-item"><span className="color-box medium"></span>Medium</div>
        <div className="legend-item"><span className="color-box low"></span>Low</div>
        <div className="legend-item"><span className="color-box blocked"></span>Blocked</div>
      </div>
    </div>
  );
}

function StatusLegend() {
  return (
    <div className="legend">
      <h4>Status Colors</h4>
      <div className="legend-items horizontal">
        <div className="legend-item"><span className="color-box ready"></span>Ready</div>
        <div className="legend-item"><span className="color-box in-progress"></span>In Progress</div>
        <div className="legend-item"><span className="color-box blocked"></span>Blocked</div>
        <div className="legend-item"><span className="color-box completed"></span>Completed</div>
      </div>
    </div>
  );
}

function PriorityLegend() {
  return (
    <div className="legend">
      <h4>Priority Colors</h4>
      <div className="legend-items horizontal">
        <div className="legend-item"><span className="color-box critical"></span>Critical</div>
        <div className="legend-item"><span className="color-box high"></span>High</div>
        <div className="legend-item"><span className="color-box medium"></span>Medium</div>
        <div className="legend-item"><span className="color-box low"></span>Low</div>
      </div>
    </div>
  );
}
