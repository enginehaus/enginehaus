import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Session } from '../api/client';
import { User, Clock, Activity, Filter, CheckCircle, XCircle, Timer } from 'lucide-react';
import { TaskLink } from '../components/CrossReferenceLink';
import './Sessions.css';

type SessionStatus = 'all' | 'active' | 'completed' | 'expired';

const STATUS_FILTERS: { value: SessionStatus; label: string }[] = [
  { value: 'all', label: 'All Sessions' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'expired', label: 'Expired' },
];

function getStatusIcon(status: Session['status']) {
  switch (status) {
    case 'active': return <Activity size={12} />;
    case 'completed': return <CheckCircle size={12} />;
    case 'expired': return <XCircle size={12} />;
    default: return <Timer size={12} />;
  }
}

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  const diff = end.getTime() - start.getTime();

  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function Sessions() {
  const [statusFilter, setStatusFilter] = useState<SessionStatus>('all');

  // Get all sessions from the database (not just active)
  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ['sessions', statusFilter],
    queryFn: () => api.sessions.list({
      status: statusFilter !== 'all' ? statusFilter : undefined,
      limit: 100,
    }),
    refetchInterval: statusFilter === 'active' ? 5000 : 30000, // Faster refresh for active sessions
  });

  const sessions = sessionsData?.sessions || [];

  // Count sessions by status for the filter badges
  const { data: allSessionsData } = useQuery({
    queryKey: ['sessions-counts'],
    queryFn: () => api.sessions.list({ limit: 500 }),
  });
  const allSessions = allSessionsData?.sessions || [];
  const activeCount = allSessions.filter(s => s.status === 'active').length;
  const completedCount = allSessions.filter(s => s.status === 'completed').length;
  const expiredCount = allSessions.filter(s => s.status === 'expired').length;

  if (isLoading) {
    return <div className="loading">Loading sessions...</div>;
  }

  return (
    <div className="sessions-page">
      <header className="page-header">
        <h1>Sessions</h1>
        <span className="session-count">{sessions.length} sessions</span>
      </header>

      {/* Filter bar */}
      <div className="filters-bar">
        <div className="filter-group">
          <Filter size={16} />
          <span>Status:</span>
          {STATUS_FILTERS.map(({ value, label }) => {
            const count = value === 'all' ? allSessions.length :
                         value === 'active' ? activeCount :
                         value === 'completed' ? completedCount : expiredCount;
            return (
              <button
                key={value}
                className={`filter-chip ${statusFilter === value ? 'active' : ''}`}
                onClick={() => setStatusFilter(value)}
              >
                {label}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <User size={48} />
          <h2>No Sessions</h2>
          <p>
            {statusFilter === 'all'
              ? 'When AI agents claim tasks, their sessions will appear here.'
              : `No ${statusFilter} sessions found.`}
          </p>
        </div>
      ) : (
        <div className="sessions-grid">
          {sessions.map((session) => (
            <div key={session.id} className={`session-card status-${session.status}`}>
              <div className="session-header">
                <div className="agent-info">
                  <User size={20} />
                  <span className="agent-id">{session.agentId}</span>
                </div>
                <span className={`status-badge ${session.status}`}>
                  {getStatusIcon(session.status)}
                  {session.status}
                </span>
              </div>

              <div className="session-details">
                <div className="detail-row">
                  <span className="label">Task</span>
                  <span className="value">
                    <TaskLink id={session.taskId} showTitle={true} size="sm" />
                  </span>
                </div>
                <div className="detail-row">
                  <span className="label">Started</span>
                  <span className="value">
                    {new Date(session.startedAt).toLocaleString()}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="label">Duration</span>
                  <span className="value">
                    {formatDuration(session.startedAt)}
                  </span>
                </div>
                {session.status === 'active' && (
                  <div className="detail-row">
                    <span className="label">Last Heartbeat</span>
                    <span className="value heartbeat">
                      <Clock size={14} />
                      {new Date(session.lastHeartbeat).toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
