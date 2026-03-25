import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Decision } from '../api/client';
import { TrendingUp, TrendingDown, Activity, Clock, CheckCircle2, AlertTriangle, Zap, ClipboardCheck, XCircle, FileCheck, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import './Quality.css';

// Review tab types
type DispositionAction = 'approve' | 'defer' | 'decline-specific' | 'decline-covered' | null;

interface ReviewItem {
  id: string;
  type: 'decision' | 'task' | 'discussion';
  title: string;
  content: string;
  category?: string;
  createdAt: string;
  disposition: DispositionAction;
  notes?: string;
}

export function Quality() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'metrics' | 'review'>(
    searchParams.get('tab') === 'review' ? 'review' : 'metrics'
  );

  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'review') setActiveTab('review');
    else if (tab === 'metrics' || !tab) setActiveTab('metrics');
  }, [searchParams]);

  const handleTabChange = (tab: 'metrics' | 'review') => {
    setActiveTab(tab);
    if (tab === 'review') {
      setSearchParams({ tab: 'review' });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="quality-page">
      <header className="page-header">
        <h1>Quality</h1>
        <div className="quality-tabs">
          <button
            className={`tab-btn ${activeTab === 'metrics' ? 'active' : ''}`}
            onClick={() => handleTabChange('metrics')}
          >
            <Zap size={16} />
            Metrics
          </button>
          <button
            className={`tab-btn ${activeTab === 'review' ? 'active' : ''}`}
            onClick={() => handleTabChange('review')}
          >
            <ClipboardCheck size={16} />
            Review
          </button>
        </div>
      </header>

      {activeTab === 'metrics' ? <MetricsTab /> : <ReviewTab />}
    </div>
  );
}

function MetricsTab() {
  const { isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api.metrics({ period: 'week' }),
  });

  const { data: statsData } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.stats(),
  });

  // Build metrics from available data
  const stats = statsData;
  const totalTasks = stats?.tasks.total || 0;
  const completedTasks = stats?.tasks.byStatus?.completed || 0;
  const blockedTasks = stats?.tasks.byStatus?.blocked || 0;
  const readyTasks = stats?.tasks.byStatus?.ready || 0;

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const blockerRate = totalTasks > 0 ? Math.round((blockedTasks / totalTasks) * 100) : 0;

  // Calculate health score (simple algorithm)
  const healthScore = Math.max(0, Math.min(100,
    100 - (blockerRate * 2) + (completionRate * 0.5)
  ));

  const healthGrade = healthScore >= 90 ? 'A' :
                      healthScore >= 80 ? 'B' :
                      healthScore >= 70 ? 'C' :
                      healthScore >= 60 ? 'D' : 'F';

  if (isLoading) {
    return <div className="loading">Loading quality metrics...</div>;
  }

  return (
    <div className="metrics-content">
      <div className="period-selector">
        <button className="period-btn active">Week</button>
        <button className="period-btn">Month</button>
        <button className="period-btn">Quarter</button>
      </div>

      {/* Health Score Card */}
      <div className="health-score-card">
        <div className="score-circle">
          <span className="grade">{healthGrade}</span>
          <span className="score">{Math.round(healthScore)}</span>
        </div>
        <div className="score-details">
          <h2>Project Health</h2>
          <p className="score-description">
            {healthScore >= 80
              ? 'Excellent progress with minimal blockers'
              : healthScore >= 60
                ? 'Good progress but some areas need attention'
                : 'Several issues require immediate attention'}
          </p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">
            <CheckCircle2 size={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{completionRate}%</span>
            <span className="metric-label">Completion Rate</span>
          </div>
          <div className="metric-trend up">
            <TrendingUp size={16} />
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon warning">
            <AlertTriangle size={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{blockerRate}%</span>
            <span className="metric-label">Blocker Rate</span>
          </div>
          <div className={`metric-trend ${blockerRate > 20 ? 'down' : 'up'}`}>
            {blockerRate > 20 ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">
            <Zap size={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{completedTasks}</span>
            <span className="metric-label">Completed This Period</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">
            <Clock size={24} />
          </div>
          <div className="metric-content">
            <span className="metric-value">{readyTasks}</span>
            <span className="metric-label">Ready to Work</span>
          </div>
        </div>
      </div>

      {/* Distribution Charts */}
      <div className="charts-section">
        <div className="chart-card">
          <h3>Task Distribution by Status</h3>
          <div className="status-bars">
            <StatusBar
              label="Ready"
              value={stats?.tasks.byStatus?.ready || 0}
              total={totalTasks}
              color="var(--accent)"
            />
            <StatusBar
              label="In Progress"
              value={stats?.tasks.byStatus?.['in-progress'] || 0}
              total={totalTasks}
              color="var(--warning)"
            />
            <StatusBar
              label="Blocked"
              value={stats?.tasks.byStatus?.blocked || 0}
              total={totalTasks}
              color="var(--error)"
            />
            <StatusBar
              label="Completed"
              value={stats?.tasks.byStatus?.completed || 0}
              total={totalTasks}
              color="var(--success)"
            />
          </div>
        </div>

        <div className="chart-card">
          <h3>Task Distribution by Priority</h3>
          <div className="status-bars">
            <StatusBar
              label="Critical"
              value={stats?.tasks.byPriority?.critical || 0}
              total={totalTasks}
              color="var(--error)"
            />
            <StatusBar
              label="High"
              value={stats?.tasks.byPriority?.high || 0}
              total={totalTasks}
              color="var(--warning)"
            />
            <StatusBar
              label="Medium"
              value={stats?.tasks.byPriority?.medium || 0}
              total={totalTasks}
              color="var(--accent)"
            />
            <StatusBar
              label="Low"
              value={stats?.tasks.byPriority?.low || 0}
              total={totalTasks}
              color="var(--text-muted)"
            />
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="insights-section">
        <h3>
          <Activity size={20} />
          Insights & Recommendations
        </h3>
        <div className="insights-grid">
          <div className="insight-card highlight">
            <h4>Highlights</h4>
            <ul>
              {completionRate > 30 && <li>Good completion rate of {completionRate}%</li>}
              {blockerRate < 15 && <li>Low blocker rate indicates healthy workflow</li>}
              {readyTasks > 5 && <li>{readyTasks} tasks ready for immediate work</li>}
              {completionRate <= 30 && blockerRate >= 15 && <li>Focus on reducing blocked tasks</li>}
            </ul>
          </div>
          <div className="insight-card concern">
            <h4>Areas of Concern</h4>
            <ul>
              {blockerRate > 20 && <li>High blocker rate ({blockerRate}%) may slow progress</li>}
              {completionRate < 25 && <li>Low completion rate needs attention</li>}
              {blockedTasks > 10 && <li>{blockedTasks} tasks currently blocked</li>}
              {blockerRate <= 20 && completionRate >= 25 && <li>No major concerns at this time</li>}
            </ul>
          </div>
          <div className="insight-card recommendation">
            <h4>Recommendations</h4>
            <ul>
              {blockedTasks > 0 && <li>Review and resolve {blockedTasks} blocked tasks</li>}
              <li>Maintain regular task updates for accurate tracking</li>
              <li>Consider breaking down large tasks into smaller units</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// Review Tab - crystallization of decisions
function ReviewTab() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Get active project
  const { data: projectData } = useQuery({
    queryKey: ['activeProject'],
    queryFn: () => api.projects.getActive(),
  });

  const projectId = projectData?.project?.id;

  // Get recent decisions
  const { data: decisionsData, isLoading } = useQuery({
    queryKey: ['decisions', projectId, 'review'],
    queryFn: () => api.decisions.list({ projectId, limit: 50 }),
    enabled: !!projectId,
    select: (data) => {
      const reviewItems: ReviewItem[] = data.decisions.map((d: Decision) => ({
        id: d.id,
        type: 'decision' as const,
        title: d.decision,
        content: d.rationale,
        category: d.category,
        createdAt: d.createdAt,
        disposition: null,
        notes: undefined,
      }));
      return reviewItems;
    },
  });

  const mergedItems = decisionsData?.map(fetchedItem => {
    const existing = items.find(i => i.id === fetchedItem.id);
    return existing || fetchedItem;
  }) || [];

  const summary = {
    approved: items.filter(i => i.disposition === 'approve').length,
    deferred: items.filter(i => i.disposition === 'defer').length,
    declined: items.filter(i => i.disposition?.startsWith('decline')).length,
    pending: mergedItems.length - items.filter(i => i.disposition !== null).length,
  };

  const setDisposition = (id: string, disposition: DispositionAction, notes?: string) => {
    setItems(prev => {
      const existing = prev.find(i => i.id === id);
      if (existing) {
        return prev.map(i => i.id === id ? { ...i, disposition, notes } : i);
      }
      const newItem = mergedItems.find(i => i.id === id);
      if (newItem) {
        return [...prev, { ...newItem, disposition, notes }];
      }
      return prev;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!projectId) {
    return (
      <div className="empty-state">
        <ClipboardCheck size={48} />
        <h2>No Active Project</h2>
        <p>Select a project to review items for crystallization.</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="loading">Loading items for review...</div>;
  }

  return (
    <div className="review-content">
      {/* Summary Banner */}
      <div className="summary-banner">
        <div className="summary-stat">
          <span className="stat-value pending">{summary.pending}</span>
          <span className="stat-label">Pending</span>
        </div>
        <div className="summary-stat">
          <span className="stat-value approved">{summary.approved}</span>
          <span className="stat-label">Approved</span>
        </div>
        <div className="summary-stat">
          <span className="stat-value deferred">{summary.deferred}</span>
          <span className="stat-label">Deferred</span>
        </div>
        <div className="summary-stat">
          <span className="stat-value declined">{summary.declined}</span>
          <span className="stat-label">Declined</span>
        </div>
      </div>

      {mergedItems.length === 0 ? (
        <div className="empty-state">
          <ClipboardCheck size={48} />
          <h3>No Items to Review</h3>
          <p>Recent decisions will appear here for crystallization review.</p>
        </div>
      ) : (
        <div className="items-list">
          {mergedItems.map(item => {
            const isExpanded = expandedItems.has(item.id);
            const localItem = items.find(i => i.id === item.id);
            const disposition = localItem?.disposition || null;

            return (
              <div key={item.id} className={`review-item ${disposition ? `disposed-${disposition}` : ''}`}>
                <div className="item-header" onClick={() => toggleExpanded(item.id)}>
                  <div className="item-expand">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <div className="item-info">
                    <h4>{item.title}</h4>
                    <div className="item-meta">
                      {item.category && <span className="category-badge">{item.category}</span>}
                      <span className="item-date">
                        <Calendar size={12} />
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="item-status">
                    {disposition === 'approve' && <CheckCircle2 size={16} className="icon-approve" />}
                    {disposition === 'defer' && <Clock size={16} className="icon-defer" />}
                    {disposition?.startsWith('decline') && <XCircle size={16} className="icon-decline" />}
                    {!disposition && <FileCheck size={16} className="icon-pending" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="item-content">
                    <p className="item-rationale">{item.content}</p>
                    <div className="disposition-actions">
                      <button
                        className={`disposition-btn approve ${disposition === 'approve' ? 'active' : ''}`}
                        onClick={() => setDisposition(item.id, 'approve')}
                      >
                        <CheckCircle2 size={14} />
                        Approve
                      </button>
                      <button
                        className={`disposition-btn defer ${disposition === 'defer' ? 'active' : ''}`}
                        onClick={() => setDisposition(item.id, 'defer')}
                      >
                        <Clock size={14} />
                        Defer
                      </button>
                      <button
                        className={`disposition-btn decline ${disposition?.startsWith('decline') ? 'active' : ''}`}
                        onClick={() => setDisposition(item.id, 'decline-specific')}
                      >
                        <XCircle size={14} />
                        Decline
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBar({ label, value, total, color }: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="status-bar-item">
      <div className="bar-label">
        <span>{label}</span>
        <span className="bar-value">{value}</span>
      </div>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
