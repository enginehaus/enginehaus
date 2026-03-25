import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Decision } from '../api/client';
import {
  ClipboardCheck,
  CheckCircle2,
  Clock,
  XCircle,
  FileCheck,
  Lightbulb,
  Calendar,
  Filter,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import './ReviewItems.css';

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

interface DispositionSummary {
  approved: number;
  deferred: number;
  declined: number;
  pending: number;
}

export function ReviewItems() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

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
      // Transform decisions to review items
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

  // Merge fetched items with local state (to preserve dispositions)
  const mergedItems = decisionsData?.map(fetchedItem => {
    const existing = items.find(i => i.id === fetchedItem.id);
    return existing || fetchedItem;
  }) || [];

  const filteredItems = categoryFilter === 'all'
    ? mergedItems
    : mergedItems.filter(item => item.category === categoryFilter);

  const categories = [...new Set(mergedItems.map(i => i.category).filter(Boolean))];

  const summary: DispositionSummary = {
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

  const getDispositionLabel = (disposition: DispositionAction) => {
    switch (disposition) {
      case 'approve': return 'Approve as Principle';
      case 'defer': return 'Defer for Discussion';
      case 'decline-specific': return 'Decline (Context-specific)';
      case 'decline-covered': return 'Decline (Already covered)';
      default: return 'Pending';
    }
  };

  const getDispositionIcon = (disposition: DispositionAction) => {
    switch (disposition) {
      case 'approve': return <CheckCircle2 size={16} className="icon-approve" />;
      case 'defer': return <Clock size={16} className="icon-defer" />;
      case 'decline-specific':
      case 'decline-covered': return <XCircle size={16} className="icon-decline" />;
      default: return <FileCheck size={16} className="icon-pending" />;
    }
  };

  if (!projectId) {
    return (
      <div className="review-items-page">
        <div className="no-project">
          <ClipboardCheck size={48} />
          <h2>No Active Project</h2>
          <p>Select a project to review items for crystallization.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="review-items-page">
      <header className="page-header">
        <div className="header-title">
          <ClipboardCheck size={24} />
          <div>
            <h1>Items for Review</h1>
            <p className="header-subtitle">Surface items for crystallization during meetings and retros</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="filter-btn"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter size={16} />
            Filters
            {showFilters ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </header>

      {showFilters && (
        <div className="filters-panel">
          <div className="filter-group">
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
      )}

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

      {/* Items List */}
      {isLoading ? (
        <div className="loading">Loading items for review...</div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <Lightbulb size={48} />
          <h3>No Items to Review</h3>
          <p>Recent decisions and discussions will appear here for crystallization review.</p>
        </div>
      ) : (
        <div className="items-list">
          {filteredItems.map(item => {
            const isExpanded = expandedItems.has(item.id);
            const localItem = items.find(i => i.id === item.id);
            const disposition = localItem?.disposition || null;

            return (
              <div
                key={item.id}
                className={`review-item ${disposition ? `disposed-${disposition}` : ''}`}
              >
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
                    {getDispositionIcon(disposition)}
                    <span className={`status-label ${disposition || 'pending'}`}>
                      {getDispositionLabel(disposition)}
                    </span>
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
                        Approve as Principle
                      </button>
                      <button
                        className={`disposition-btn defer ${disposition === 'defer' ? 'active' : ''}`}
                        onClick={() => setDisposition(item.id, 'defer')}
                      >
                        <Clock size={14} />
                        Defer for Discussion
                      </button>
                      <button
                        className={`disposition-btn decline ${disposition === 'decline-specific' ? 'active' : ''}`}
                        onClick={() => setDisposition(item.id, 'decline-specific')}
                      >
                        <XCircle size={14} />
                        Decline (Context-specific)
                      </button>
                      <button
                        className={`disposition-btn decline ${disposition === 'decline-covered' ? 'active' : ''}`}
                        onClick={() => setDisposition(item.id, 'decline-covered')}
                      >
                        <XCircle size={14} />
                        Decline (Already covered)
                      </button>
                    </div>

                    {disposition && (
                      <div className="disposition-note">
                        <label>Notes (optional)</label>
                        <textarea
                          placeholder="Add context for this disposition..."
                          value={localItem?.notes || ''}
                          onChange={(e) => setDisposition(item.id, disposition, e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Session Footer */}
      {items.filter(i => i.disposition !== null).length > 0 && (
        <div className="session-footer">
          <div className="session-summary">
            <strong>{items.filter(i => i.disposition !== null).length}</strong> items reviewed this session
          </div>
          <button className="complete-review-btn" disabled>
            <FileCheck size={16} />
            Complete Review Session
            <span className="coming-soon">(Coming Soon)</span>
          </button>
        </div>
      )}
    </div>
  );
}
