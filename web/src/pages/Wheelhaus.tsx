/**
 * Wheelhaus Control Room
 *
 * Real-time observability interface for AI teams.
 * Shows what's happening NOW - not records, not dashboards.
 */

import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Zap,
  GitBranch,
  Heart,
  User,
  Clock,
  Lightbulb,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Radio,
  Layers,
  RefreshCw,
  Sparkles,
  MoreHorizontal,
  Hand,
  Ban,
  ArrowDown,
  Eye,
  Keyboard,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import { api } from '../api/client';
import { useAISummary } from '../hooks/useAISummary';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useTheme } from '../hooks/useTheme';
import { AgentMind } from '../components/AgentMind';
import { ProjectChat } from '../components/ProjectChat';
import '../components/AgentMind.css';
import '../components/ProjectChat.css';
import type {
  ActiveSessionView,
  DecisionStreamItem,
  TaskGraphNode,
  ContextHealthMetrics,
} from '../api/client';
import './Wheelhaus.css';

// Phase names for display
const PHASE_NAMES: Record<number, string> = {
  1: 'Context & Planning',
  2: 'Architecture',
  3: 'Core Implementation',
  4: 'Integration',
  5: 'Testing',
  6: 'Documentation',
  7: 'Review',
  8: 'Deployment',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

// Toast system via React context
interface ToastState {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const ToastContext = createContext<(message: string, type?: 'success' | 'error') => void>(() => {});

function useToast() {
  return useContext(ToastContext);
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ message, type, id: Date.now() });
    timeoutRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div key={toast.id} className={`wheelhaus-toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// Action Menu Component
interface ActionItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'warning' | 'danger';
}

function ActionMenu({ actions }: { actions: ActionItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="action-menu">
      <button
        className="action-menu-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        title="Actions"
      >
        <MoreHorizontal size={14} />
      </button>
      {isOpen && (
        <>
          <div className="action-menu-backdrop" onClick={() => setIsOpen(false)} />
          <div className="action-menu-dropdown">
            {actions.map((action, i) => (
              <button
                key={i}
                className={`action-menu-item ${action.variant || 'default'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                  setIsOpen(false);
                }}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Active Sessions Panel
function ActiveSessionsPanel({ sessions }: { sessions: ActiveSessionView[] }) {
  const getSessionActions = (session: ActiveSessionView): ActionItem[] => [
    {
      label: 'View context',
      icon: <Eye size={14} />,
      onClick: () => {
        window.open(`/sessions?id=${session.sessionId}`, '_blank');
      },
    },
  ];

  return (
    <div className="wheelhaus-panel sessions-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Activity size={18} />
          <span>Active Sessions</span>
        </div>
        <span className="panel-count">{sessions.length}</span>
      </div>

      <div className="panel-content">
        {sessions.length === 0 ? (
          <div className="panel-empty">
            <User size={32} />
            <span>No active sessions</span>
          </div>
        ) : (
          <div className="sessions-list">
            {sessions.map((session) => (
              <div key={session.sessionId} className="session-item">
                <div className="session-header">
                  <span className="agent-badge">
                    <User size={14} />
                    {session.agentId}
                  </span>
                  <div className="session-header-right">
                    <span className="session-duration">
                      <Clock size={12} />
                      {formatDuration(session.durationSeconds)}
                    </span>
                    <ActionMenu actions={getSessionActions(session)} />
                  </div>
                </div>
                <div className="session-task">{session.taskTitle}</div>
                {session.currentPhase && (
                  <div className="session-phase">
                    <Layers size={12} />
                    Phase {session.phaseNumber}: {session.currentPhase}
                  </div>
                )}
                <div className="session-heartbeat">
                  <Radio size={10} />
                  Last heartbeat: {formatRelativeTime(session.lastHeartbeat)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Decision Stream Panel
function DecisionStreamPanel({ decisions }: { decisions: DecisionStreamItem[] }) {
  const getDecisionActions = (decision: DecisionStreamItem): ActionItem[] => [
    {
      label: 'View details',
      icon: <Eye size={14} />,
      onClick: () => {
        window.open(`/decisions?id=${decision.id}`, '_blank');
      },
    },
  ];

  return (
    <div className="wheelhaus-panel decisions-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Lightbulb size={18} />
          <span>Decision Stream</span>
        </div>
        <span className="panel-count">{decisions.length}</span>
      </div>

      <div className="panel-content">
        {decisions.length === 0 ? (
          <div className="panel-empty">
            <Lightbulb size={32} />
            <span>No decisions yet</span>
          </div>
        ) : (
          <div className="decisions-stream">
            {decisions.slice(0, 20).map((decision, index) => (
              <div
                key={decision.id}
                className={`decision-item ${index === 0 ? 'latest' : ''}`}
              >
                <div className="decision-header">
                  {decision.category && (
                    <span className={`category-tag category-${decision.category}`}>
                      {decision.category}
                    </span>
                  )}
                  <div className="decision-header-right">
                    <span className="decision-time">
                      {formatRelativeTime(decision.timestamp)}
                    </span>
                    <ActionMenu actions={getDecisionActions(decision)} />
                  </div>
                </div>
                <div className="decision-text">{decision.decision}</div>
                <div className="decision-rationale">{decision.rationale}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Agent Mind Panel (Task Graph with Force-Directed Visualization)
function AgentMindPanel({ tasks }: { tasks: TaskGraphNode[] }) {
  const showToast = useToast();
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [filter, setFilter] = useState<'all' | 'in-progress' | 'blocked' | 'ready'>('all');
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 280 });

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width - 2, height: rect.height - 2 });
      }
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Mutations for task actions
  const claimTask = useMutation({
    mutationFn: (taskId: string) => api.tasks.claim(taskId, 'human-user'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wheelhaus'] });
      showToast('Task claimed successfully', 'success');
    },
    onError: (err: Error) => showToast(`Failed to claim task: ${err.message}`, 'error'),
  });

  const updateTask = useMutation({
    mutationFn: ({ taskId, updates }: { taskId: string; updates: { status?: 'ready' | 'in-progress' | 'blocked' | 'completed'; priority?: 'critical' | 'high' | 'medium' | 'low' } }) =>
      api.tasks.update(taskId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wheelhaus'] });
    },
    onError: (err: Error) => showToast(`Failed to update task: ${err.message}`, 'error'),
  });

  const getTaskActions = (task: TaskGraphNode): ActionItem[] => {
    const actions: ActionItem[] = [];

    if (task.status === 'ready' || (task.status === 'in-progress' && task.assignedTo !== 'human-user')) {
      actions.push({
        label: 'Claim task',
        icon: <Hand size={14} />,
        onClick: () => claimTask.mutate(task.id),
      });
    }

    if (task.status !== 'blocked') {
      actions.push({
        label: 'Mark blocked',
        icon: <Ban size={14} />,
        onClick: () => {
          updateTask.mutate({ taskId: task.id, updates: { status: 'blocked' } });
          showToast('Task marked as blocked', 'success');
        },
        variant: 'warning',
      });
    }

    if (task.status === 'blocked') {
      actions.push({
        label: 'Unblock',
        icon: <CheckCircle size={14} />,
        onClick: () => {
          updateTask.mutate({ taskId: task.id, updates: { status: 'ready' } });
          showToast('Task unblocked', 'success');
        },
      });
    }

    if (task.priority !== 'low') {
      actions.push({
        label: 'Deprioritize',
        icon: <ArrowDown size={14} />,
        onClick: () => {
          updateTask.mutate({ taskId: task.id, updates: { priority: 'low' } });
          showToast('Task deprioritized', 'success');
        },
      });
    }

    actions.push({
      label: 'View details',
      icon: <Eye size={14} />,
      onClick: () => {
        window.open(`/tasks?id=${task.id}`, '_blank');
      },
    });

    return actions;
  };

  const handleNodeClick = (task: TaskGraphNode) => {
    window.open(`/tasks?id=${task.id}`, '_blank');
    showToast('Opening task details...');
  };

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'all') return true;
    return task.status === filter;
  });

  const statusCounts = {
    all: tasks.length,
    'in-progress': tasks.filter((t) => t.status === 'in-progress').length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    ready: tasks.filter((t) => t.status === 'ready').length,
  };

  return (
    <div className="wheelhaus-panel tasks-panel agent-mind-panel">
      <div className="panel-header">
        <div className="panel-title">
          <GitBranch size={18} />
          <span>Agent Mind</span>
        </div>
        <div className="panel-header-controls">
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'graph' ? 'active' : ''}`}
              onClick={() => setViewMode('graph')}
              title="Graph view"
            >
              <GitBranch size={14} />
            </button>
            <button
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <Layers size={14} />
            </button>
          </div>
          {viewMode === 'list' && (
            <div className="task-filters">
              {(['all', 'in-progress', 'blocked', 'ready'] as const).map((f) => (
                <button
                  key={f}
                  className={`filter-btn ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f}
                  <span className="filter-count">{statusCounts[f]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel-content" ref={panelRef}>
        {viewMode === 'graph' ? (
          <AgentMind
            tasks={tasks}
            onNodeClick={handleNodeClick}
            width={dimensions.width}
            height={dimensions.height}
          />
        ) : (
          filteredTasks.length === 0 ? (
            <div className="panel-empty">
              <GitBranch size={32} />
              <span>No tasks</span>
            </div>
          ) : (
            <div className="tasks-graph">
              {filteredTasks.slice(0, 20).map((task) => (
                <div
                  key={task.id}
                  className={`task-node status-${task.status} priority-${task.priority}`}
                >
                  <div className="task-node-header">
                    <span className={`status-indicator status-${task.status}`}>
                      {task.status === 'in-progress' && <Activity size={12} />}
                      {task.status === 'blocked' && <AlertTriangle size={12} />}
                      {task.status === 'ready' && <CheckCircle size={12} />}
                      {task.status === 'completed' && <CheckCircle size={12} />}
                    </span>
                    <span className={`priority-badge priority-${task.priority}`}>
                      {task.priority}
                    </span>
                    <ActionMenu actions={getTaskActions(task)} />
                  </div>
                  <div className="task-node-title">{task.title}</div>
                  {task.currentPhase && (
                    <div className="task-node-phase">
                      Phase {task.phaseNumber}: {PHASE_NAMES[task.phaseNumber || 0] || task.currentPhase}
                    </div>
                  )}
                  {task.blockedBy.length > 0 && (
                    <div className="task-node-blockers">
                      <AlertTriangle size={10} />
                      Blocked by {task.blockedBy.length} task(s)
                    </div>
                  )}
                  {task.blocks.length > 0 && (
                    <div className="task-node-blocking">
                      <ArrowRight size={10} />
                      Blocking {task.blocks.length} task(s)
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Legend for graph view */}
      {viewMode === 'graph' && tasks.length > 0 && (
        <div className="agent-mind-legend">
          <div className="legend-item">
            <span className="legend-dot active" />
            <span>Active</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot ready" />
            <span>Ready</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot blocked" />
            <span>Blocked</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Context Health Panel
function ContextHealthPanel({ health }: { health: ContextHealthMetrics | null }) {
  if (!health) {
    return (
      <div className="wheelhaus-panel health-panel">
        <div className="panel-header">
          <div className="panel-title">
            <Heart size={18} />
            <span>Context Health</span>
          </div>
        </div>
        <div className="panel-content">
          <div className="panel-empty">
            <Heart size={32} />
            <span>Loading health metrics...</span>
          </div>
        </div>
      </div>
    );
  }

  const qualityRatio = health.qualityGatesPassed + health.qualityGatesFailed > 0
    ? Math.round((health.qualityGatesPassed / (health.qualityGatesPassed + health.qualityGatesFailed)) * 100)
    : 100;

  return (
    <div className="wheelhaus-panel health-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Heart size={18} />
          <span>Context Health</span>
        </div>
        <span className={`health-status ${qualityRatio >= 80 ? 'healthy' : qualityRatio >= 60 ? 'warning' : 'critical'}`}>
          {qualityRatio >= 80 ? 'Healthy' : qualityRatio >= 60 ? 'Warning' : 'Critical'}
        </span>
      </div>

      <div className="panel-content">
        <div className="health-grid">
          <div className="health-metric">
            <div className="metric-value">{health.activeSessions}</div>
            <div className="metric-label">Active Sessions</div>
          </div>
          <div className="health-metric">
            <div className="metric-value">{health.tasksInProgress}</div>
            <div className="metric-label">In Progress</div>
          </div>
          <div className="health-metric">
            <div className="metric-value">{health.tasksBlocked}</div>
            <div className="metric-label">Blocked</div>
          </div>
          <div className="health-metric">
            <div className="metric-value">{health.tasksReady}</div>
            <div className="metric-label">Ready</div>
          </div>
          <div className="health-metric">
            <div className="metric-value">{health.decisionsLast24h}</div>
            <div className="metric-label">Decisions (24h)</div>
          </div>
          <div className="health-metric quality">
            <div className="metric-value">
              <CheckCircle size={16} className="quality-icon pass" />
              {health.qualityGatesPassed}
              <XCircle size={16} className="quality-icon fail" />
              {health.qualityGatesFailed}
            </div>
            <div className="metric-label">Quality Gates</div>
          </div>
          <div className="health-metric">
            <div className="metric-value">{health.avgSessionDurationMinutes}m</div>
            <div className="metric-label">Avg Session</div>
          </div>
          <div className="health-metric">
            <div className="metric-value">{health.eventRate.toFixed(1)}/min</div>
            <div className="metric-label">Event Rate</div>
          </div>
        </div>

        {health.lastEventAt && (
          <div className="last-event">
            <Zap size={12} />
            Last event: {formatRelativeTime(health.lastEventAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// AI Summary Banner
function AISummaryBanner() {
  const { summary, isLoading, isRefreshing, refresh } = useAISummary();

  return (
    <div className="ai-summary-banner">
      <div className="summary-content">
        <Sparkles size={18} className="summary-icon" />
        {isLoading ? (
          <span className="summary-text loading">Generating summary...</span>
        ) : (
          <span className="summary-text">{summary || 'Loading status...'}</span>
        )}
      </div>
      <button
        className="summary-refresh-btn"
        onClick={refresh}
        disabled={isLoading || isRefreshing}
        title="Refresh summary"
      >
        <RefreshCw size={14} className={isRefreshing ? 'spinning' : ''} />
      </button>
    </div>
  );
}

// Project Chat Panel
function ProjectChatPanel() {
  return (
    <div className="wheelhaus-panel chat-panel">
      <div className="panel-header">
        <div className="panel-title">
          <Sparkles size={16} />
          Ask About Project
        </div>
      </div>
      <ProjectChat className="panel-chat" />
    </div>
  );
}

// Keyboard Shortcuts Help Modal
function KeyboardShortcutsModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  const shortcuts = [
    { key: '?', description: 'Show/hide this help' },
    { key: 'R', description: 'Refresh data' },
    { key: '1-5', description: 'Focus panel (Sessions, Decisions, Tasks, Health, Chat)' },
    { key: 'N', description: 'Claim next task' },
    { key: '⌘K', description: 'Open command palette' },
    { key: 'Esc', description: 'Close modal / clear focus' },
  ];

  return (
    <div className="shortcuts-modal-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h3>
            <Keyboard size={18} />
            Keyboard Shortcuts
          </h3>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="shortcuts-list">
          {shortcuts.map(({ key, description }) => (
            <div key={key} className="shortcut-item">
              <kbd>{key}</kbd>
              <span>{description}</span>
            </div>
          ))}
        </div>
        <div className="shortcuts-footer">
          Press <kbd>?</kbd> to toggle this help
        </div>
      </div>
    </div>
  );
}

// Loading skeleton for panels
function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="panel-content">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${70 + Math.random() * 25}%`, animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function WheelhausGridSkeleton() {
  return (
    <div className="wheelhaus-grid">
      {['Sessions', 'Decisions', 'Agent Mind', 'Health'].map((label) => (
        <div key={label} className="wheelhaus-panel">
          <div className="panel-header">
            <div className="panel-title"><span>{label}</span></div>
          </div>
          <PanelSkeleton lines={label === 'Health' ? 4 : 3} />
        </div>
      ))}
      <div className="wheelhaus-panel chat-panel">
        <div className="panel-header">
          <div className="panel-title"><span>Ask About Project</span></div>
        </div>
        <PanelSkeleton lines={2} />
      </div>
    </div>
  );
}

// Main Wheelhaus Component (inner, uses toast context)
function WheelhausInner() {
  const showToast = useToast();

  // Fetch data with polling
  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['wheelhaus'],
    queryFn: () => api.wheelhaus.getSnapshot(),
    refetchInterval: 3000,
  });

  const sessions = data?.sessions || [];
  const decisions = data?.decisions || [];
  const tasks = data?.tasks || [];
  const health = data?.health || null;

  // Theme
  const { toggleTheme, isDark } = useTheme();

  // Keyboard shortcuts
  const { showHelp, setShowHelp } = useKeyboardShortcuts({
    onRefresh: () => refetch(),
    onFocusPanel: (panel) => {
      const panels = document.querySelectorAll('.wheelhaus-panel');
      if (panels[panel - 1]) {
        (panels[panel - 1] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
        (panels[panel - 1] as HTMLElement).classList.add('panel-focused');
        setTimeout(() => {
          (panels[panel - 1] as HTMLElement).classList.remove('panel-focused');
        }, 1500);
      }
    },
    onClaimNext: async () => {
      try {
        const response = await api.tasks.getNext();
        if (response?.task) {
          showToast(`Claimed: ${response.task.title}`);
          refetch();
        } else {
          showToast('No tasks available to claim');
        }
      } catch {
        showToast('Failed to claim task', 'error');
      }
    },
  });

  return (
    <div className="wheelhaus-page">
      <header className="wheelhaus-header">
        <div className="header-left">
          <h1>
            <Zap size={28} />
            Wheelhaus
          </h1>
          <span className="subtitle">AI Team Control Room</span>
        </div>
        <div className="header-right">
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="shortcuts-btn"
            onClick={() => setShowHelp(true)}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={16} />
          </button>
          <button className="refresh-btn" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={16} className={isLoading ? 'spinning' : ''} />
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          <span className="connection-status connected">
            <Radio size={12} />
            Live
          </span>
          {dataUpdatedAt && (
            <span className="last-updated">
              Updated {formatRelativeTime(new Date(dataUpdatedAt).toISOString())}
            </span>
          )}
        </div>
      </header>

      <AISummaryBanner />

      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} />
          <span>Failed to load data: {(error as Error).message}</span>
        </div>
      )}

      {isLoading && !data ? (
        <WheelhausGridSkeleton />
      ) : (
        <div className="wheelhaus-grid">
          <ActiveSessionsPanel sessions={sessions} />
          <DecisionStreamPanel decisions={decisions} />
          <AgentMindPanel tasks={tasks} />
          <ContextHealthPanel health={health} />
          <ProjectChatPanel />
        </div>
      )}

      <KeyboardShortcutsModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}

// Exported component wraps with ToastProvider
export function Wheelhaus() {
  return (
    <ToastProvider>
      <WheelhausInner />
    </ToastProvider>
  );
}
