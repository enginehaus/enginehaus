import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type AuditEvent, type AuditEventType } from '../api/client';
import {
  History, Filter, Clock, User, Bot, Settings,
  CheckSquare, PlayCircle, FolderOpen,
  Link, Layers, Shield, AlertOctagon, RefreshCw
} from 'lucide-react';
import './AuditLog.css';

const RESOURCE_TYPES = ['all', 'task', 'session', 'project', 'dependency', 'phase', 'quality', 'system', 'error'] as const;

function getEventIcon(eventType: AuditEventType) {
  const category = eventType.split('.')[0];
  switch (category) {
    case 'task': return <CheckSquare size={14} />;
    case 'session': return <PlayCircle size={14} />;
    case 'project': return <FolderOpen size={14} />;
    case 'dependency': return <Link size={14} />;
    case 'phase': return <Layers size={14} />;
    case 'quality': return <Shield size={14} />;
    case 'system': return <Settings size={14} />;
    case 'error': return <AlertOctagon size={14} />;
    default: return <History size={14} />;
  }
}

function getEventColor(eventType: AuditEventType): string {
  if (eventType.includes('error') || eventType.includes('failed')) return 'error';
  if (eventType.includes('completed') || eventType.includes('passed')) return 'success';
  if (eventType.includes('created') || eventType.includes('started')) return 'info';
  if (eventType.includes('deleted') || eventType.includes('expired')) return 'warning';
  return 'neutral';
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 1 minute
  if (diff < 60000) return 'Just now';

  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }

  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Same year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ActorBadge({ actorType, actorId }: { actorType: AuditEvent['actorType']; actorId: string }) {
  const icon = actorType === 'agent' ? <Bot size={12} /> :
               actorType === 'user' ? <User size={12} /> :
               <Settings size={12} />;

  return (
    <span className={`actor-badge ${actorType}`}>
      {icon}
      <span>{actorId}</span>
    </span>
  );
}

function EventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = getEventColor(event.eventType);

  return (
    <div className={`event-row ${color}`}>
      <div className="event-main" onClick={() => setExpanded(!expanded)}>
        <div className="event-icon">
          {getEventIcon(event.eventType)}
        </div>
        <div className="event-content">
          <div className="event-header">
            <span className="event-type">{event.eventType}</span>
            <ActorBadge actorType={event.actorType} actorId={event.actorId} />
          </div>
          <p className="event-action">{event.action}</p>
        </div>
        <div className="event-meta">
          <span className="event-time">
            <Clock size={12} />
            {formatTimestamp(event.timestamp)}
          </span>
          <span className="event-resource">{event.resourceType}/{event.resourceId.slice(0, 8)}</span>
        </div>
      </div>

      {expanded && (event.beforeState || event.afterState || event.metadata) && (
        <div className="event-details">
          {event.beforeState != null && (
            <div className="detail-section">
              <h5>Before</h5>
              <pre>{JSON.stringify(event.beforeState, null, 2)}</pre>
            </div>
          )}
          {event.afterState != null && (
            <div className="detail-section">
              <h5>After</h5>
              <pre>{JSON.stringify(event.afterState, null, 2)}</pre>
            </div>
          )}
          {event.metadata != null && (
            <div className="detail-section">
              <h5>Metadata</h5>
              <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditLog() {
  const [resourceFilter, setResourceFilter] = useState<string>('all');
  const [limit, setLimit] = useState(50);

  // Use the persisted audit log from SQLite instead of in-memory events
  const { data: auditData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit', resourceFilter, limit],
    queryFn: () => api.audit.list({
      resourceType: resourceFilter !== 'all' ? resourceFilter : undefined,
      limit,
    }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: summaryData } = useQuery({
    queryKey: ['audit-summary'],
    queryFn: () => api.audit.summary(),
  });

  const events = auditData?.entries || [];
  const stats = summaryData?.eventsByType || {};

  // Filter events
  const filteredEvents = resourceFilter === 'all'
    ? events
    : events.filter(e => e.resourceType === resourceFilter);

  // Group events by day
  const eventsByDay = filteredEvents.reduce((acc, event) => {
    const day = new Date(event.timestamp).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!acc[day]) acc[day] = [];
    acc[day].push(event);
    return acc;
  }, {} as Record<string, AuditEvent[]>);

  if (isLoading) {
    return <div className="loading">Loading audit log...</div>;
  }

  return (
    <div className="audit-log-page">
      <header className="page-header">
        <div>
          <h1>Audit Log</h1>
          <span className="event-count">{events.length} events</span>
        </div>
        <button
          className="refresh-btn"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={16} className={isFetching ? 'spinning' : ''} />
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {/* Stats Summary */}
      {Object.keys(stats).length > 0 && (
        <div className="stats-bar">
          {Object.entries(stats).slice(0, 6).map(([type, count]) => (
            <div key={type} className="stat-chip">
              <span className="stat-type">{type}</span>
              <span className="stat-count">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="filters-bar">
        <div className="filter-group">
          <Filter size={16} />
          <span>Filter by:</span>
          <select
            value={resourceFilter}
            onChange={e => setResourceFilter(e.target.value)}
          >
            {RESOURCE_TYPES.map(type => (
              <option key={type} value={type}>
                {type === 'all' ? 'All Resources' : type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <span>Show:</span>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
            <option value={25}>25 events</option>
            <option value={50}>50 events</option>
            <option value={100}>100 events</option>
            <option value={200}>200 events</option>
          </select>
        </div>
      </div>

      {/* Event Timeline */}
      <div className="event-timeline">
        {filteredEvents.length === 0 ? (
          <div className="empty-state">
            <History size={48} />
            <h2>No Events</h2>
            <p>No audit events recorded yet. Events will appear here as actions are performed.</p>
          </div>
        ) : (
          Object.entries(eventsByDay).map(([day, dayEvents]) => (
            <div key={day} className="day-group">
              <div className="day-header">{day}</div>
              <div className="day-events">
                {dayEvents.map(event => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
