import { useQuery } from '@tanstack/react-query';
import { api, type Task } from '../api/client';
import { X, Clock, AlertTriangle, ArrowUp, Minus, ArrowDown, FileCode, GitBranch, CheckCircle2, Lock, Unlock } from 'lucide-react';
import { TaskLink } from './CrossReferenceLink';
import './TaskDetail.css';

const PRIORITY_ICONS = {
  critical: <AlertTriangle size={16} />,
  high: <ArrowUp size={16} />,
  medium: <Minus size={16} />,
  low: <ArrowDown size={16} />,
};

const STATUS_COLORS: Record<string, string> = {
  'ready': 'var(--accent)',
  'in-progress': 'var(--warning)',
  'blocked': 'var(--error)',
  'completed': 'var(--success)',
};

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDetail({ taskId, onClose }: TaskDetailProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.tasks.get(taskId),
  });

  const task = data?.task;

  if (isLoading) {
    return (
      <div className="task-detail-overlay" onClick={onClose}>
        <div className="task-detail-panel" onClick={e => e.stopPropagation()}>
          <div className="loading">Loading task...</div>
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="task-detail-overlay" onClick={onClose}>
        <div className="task-detail-panel" onClick={e => e.stopPropagation()}>
          <div className="error-state">Task not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="task-detail-overlay" onClick={onClose}>
      <div className="task-detail-panel" onClick={e => e.stopPropagation()}>
        <header className="detail-header">
          <div className="header-top">
            <span className={`status-pill status-${task.status}`}>
              {task.status}
            </span>
            <button className="close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <h2>{task.title}</h2>
          <div className="task-meta">
            <span className={`priority priority-${task.priority}`}>
              {PRIORITY_ICONS[task.priority]}
              {task.priority}
            </span>
            <span className="task-id">
              <code>{task.id.slice(0, 8)}</code>
            </span>
          </div>
        </header>

        <div className="detail-content">
          {task.description && (
            <section className="detail-section">
              <h3>Description</h3>
              <p className="description">{task.description}</p>
            </section>
          )}

          {task.files && task.files.length > 0 && (
            <section className="detail-section">
              <h3>
                <FileCode size={16} />
                Associated Files
              </h3>
              <ul className="file-list">
                {task.files.map((file, i) => (
                  <li key={i}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="detail-section">
            <h3>
              <Clock size={16} />
              Timeline
            </h3>
            <div className="timeline-info">
              <div className="timeline-item">
                <span className="label">Created</span>
                <span className="value">
                  {new Date(task.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="timeline-item">
                <span className="label">Updated</span>
                <span className="value">
                  {new Date(task.updatedAt).toLocaleString()}
                </span>
              </div>
            </div>
          </section>

          <PhaseProgress task={task} />
          <DependenciesSection task={task} />
        </div>

        <footer className="detail-footer">
          <StatusActions task={task} />
        </footer>
      </div>
    </div>
  );
}

const PHASE_NAMES = [
  'Context & Planning',
  'Architecture',
  'Core Implementation',
  'Integration',
  'Testing',
  'Documentation',
  'Review',
  'Deployment',
];

function PhaseProgress({ task }: { task: Task }) {
  const phaseProgress = task.implementation?.phaseProgress;

  // If no phase progress, show "not started" state
  if (!phaseProgress) {
    return (
      <section className="detail-section">
        <h3>
          <CheckCircle2 size={16} />
          Phase Progress
        </h3>
        <p className="empty-phases">
          Phase tracking not started. Use <code>start_task_phases</code> via MCP to enable.
        </p>
      </section>
    );
  }

  // Calculate status for each phase
  const phases = PHASE_NAMES.map((name, i) => {
    const phaseId = i + 1;
    let status: 'completed' | 'skipped' | 'in-progress' | 'pending';

    if (phaseProgress.completedPhases.includes(phaseId)) {
      status = 'completed';
    } else if (phaseProgress.skippedPhases.includes(phaseId)) {
      status = 'skipped';
    } else if (phaseProgress.currentPhase === phaseId) {
      status = 'in-progress';
    } else {
      status = 'pending';
    }

    return {
      name,
      status,
      note: phaseProgress.phaseNotes?.[phaseId],
      commitSha: phaseProgress.phaseCommits?.[phaseId],
    };
  });

  return (
    <section className="detail-section">
      <h3>
        <CheckCircle2 size={16} />
        Phase Progress
      </h3>
      <div className="phase-list">
        {phases.map((phase, i) => (
          <div key={i} className={`phase-item phase-${phase.status}`}>
            <span className="phase-number">{i + 1}</span>
            <span className="phase-name">
              {phase.name}
              {phase.note && <span className="phase-note" title={phase.note}>*</span>}
              {phase.commitSha && (
                <code className="phase-sha" title={`Commit: ${phase.commitSha}`}>
                  {phase.commitSha.slice(0, 7)}
                </code>
              )}
            </span>
            <span className={`phase-status ${phase.status}`}>
              {phase.status === 'completed' && '✓'}
              {phase.status === 'skipped' && '—'}
              {phase.status === 'in-progress' && '●'}
              {phase.status === 'pending' && '○'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DependenciesSection({ task }: { task: Task }) {
  const hasBlockedBy = task.blockedBy && task.blockedBy.length > 0;
  const hasBlocks = task.blocks && task.blocks.length > 0;

  if (!hasBlockedBy && !hasBlocks) {
    return (
      <section className="detail-section">
        <h3>
          <GitBranch size={16} />
          Dependencies
        </h3>
        <p className="empty-dependencies">No dependencies configured</p>
      </section>
    );
  }

  return (
    <section className="detail-section">
      <h3>
        <GitBranch size={16} />
        Dependencies
      </h3>
      <div className="dependencies-container">
        {hasBlockedBy && (
          <div className="dependency-group">
            <h4>
              <Lock size={14} />
              Blocked By
            </h4>
            <ul className="dependency-list">
              {task.blockedBy!.map(id => (
                <DependencyItem key={id} taskId={id} />
              ))}
            </ul>
          </div>
        )}
        {hasBlocks && (
          <div className="dependency-group">
            <h4>
              <Unlock size={14} />
              Blocks
            </h4>
            <ul className="dependency-list">
              {task.blocks!.map(id => (
                <DependencyItem key={id} taskId={id} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function DependencyItem({ taskId }: { taskId: string }) {
  return (
    <li className="dependency-item">
      <TaskLink id={taskId} showTitle={true} />
    </li>
  );
}

function StatusActions({ task }: { task: Task }) {
  const statusOptions = ['ready', 'in-progress', 'blocked', 'completed'] as const;

  return (
    <div className="status-actions">
      <span className="label">Change Status:</span>
      <div className="status-buttons">
        {statusOptions.map(status => (
          <button
            key={status}
            className={`status-btn ${status === task.status ? 'active' : ''}`}
            style={{ '--status-color': STATUS_COLORS[status] } as React.CSSProperties}
            disabled={status === task.status}
          >
            {status}
          </button>
        ))}
      </div>
    </div>
  );
}
