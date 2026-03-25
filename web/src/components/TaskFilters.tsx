import { Search, Filter, X } from 'lucide-react';
import './TaskFilters.css';

interface TaskFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string | null;
  onStatusFilterChange: (value: string | null) => void;
  priorityFilter: string | null;
  onPriorityFilterChange: (value: string | null) => void;
}

const STATUSES = ['ready', 'in-progress', 'blocked', 'completed'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

export function TaskFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
}: TaskFiltersProps) {
  const hasFilters = search || statusFilter || priorityFilter;

  const clearAll = () => {
    onSearchChange('');
    onStatusFilterChange(null);
    onPriorityFilterChange(null);
  };

  return (
    <div className="task-filters">
      <div className="search-box">
        <Search size={16} />
        <input
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button className="clear-search" onClick={() => onSearchChange('')}>
            <X size={14} />
          </button>
        )}
      </div>

      <div className="filter-group">
        <Filter size={16} />
        <select
          value={statusFilter || ''}
          onChange={(e) => onStatusFilterChange(e.target.value || null)}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <select
          value={priorityFilter || ''}
          onChange={(e) => onPriorityFilterChange(e.target.value || null)}
        >
          <option value="">All Priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <button className="clear-filters" onClick={clearAll}>
          <X size={14} />
          Clear
        </button>
      )}

      {hasFilters && (
        <span className="filter-indicator">Filtered</span>
      )}
    </div>
  );
}
