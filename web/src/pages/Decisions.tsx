import { useQuery } from '@tanstack/react-query';
import { api, type Decision } from '../api/client';
import { Lightbulb, Calendar, Tag, ListTodo } from 'lucide-react';
import { TaskLink } from '../components/CrossReferenceLink';
import './Decisions.css';

function DecisionCard({ decision }: { decision: Decision }) {
  return (
    <div className="decision-card">
      <div className="decision-header">
        <Lightbulb size={20} />
        {decision.category && (
          <span className="category-badge">
            <Tag size={12} />
            {decision.category}
          </span>
        )}
      </div>

      <h3 className="decision-text">{decision.decision}</h3>
      <p className="rationale">{decision.rationale}</p>

      {decision.impact && (
        <div className="impact">
          <strong>Impact:</strong> {decision.impact}
        </div>
      )}

      <div className="decision-footer">
        <span className="timestamp">
          <Calendar size={14} />
          {new Date(decision.createdAt).toLocaleDateString()}
        </span>
        {decision.taskId && (
          <span className="decision-task">
            <ListTodo size={14} />
            <TaskLink id={decision.taskId} showTitle={true} size="sm" />
          </span>
        )}
        <span className="decision-id">{decision.id.slice(0, 8)}</span>
      </div>
    </div>
  );
}

export function Decisions() {
  const { data: decisionsData, isLoading } = useQuery({
    queryKey: ['decisions'],
    queryFn: () => api.decisions.list({ limit: 50 }),
  });

  const decisions = decisionsData?.decisions || [];

  if (isLoading) {
    return <div className="loading">Loading decisions...</div>;
  }

  return (
    <div className="decisions-page">
      <header className="page-header">
        <h1>Strategic Decisions</h1>
        <span className="decision-count">{decisions.length} recorded</span>
      </header>

      {decisions.length === 0 ? (
        <div className="empty-state">
          <Lightbulb size={48} />
          <h2>No Decisions Yet</h2>
          <p>Strategic decisions and architecture choices will appear here.</p>
        </div>
      ) : (
        <div className="decisions-timeline">
          {decisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </div>
      )}
    </div>
  );
}
