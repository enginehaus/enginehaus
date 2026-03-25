/**
 * CrossReferenceLink Component
 *
 * Provides clickable cross-references to tasks, artifacts, decisions, and sessions.
 * Links can either navigate to a page or open a detail modal.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ListTodo, FileText, Lightbulb, Users, AlertCircle
} from 'lucide-react';
import { api, type Task, type Artifact, type Decision } from '../api/client';
import { TaskDetail } from './TaskDetail';
import './CrossReferenceLink.css';

export type ReferenceType = 'task' | 'artifact' | 'decision' | 'session';

interface CrossReferenceLinkProps {
  type: ReferenceType;
  id: string;
  /** Optional display text (defaults to truncated ID) */
  label?: string;
  /** Show full title/name if available */
  showTitle?: boolean;
  /** Navigate to page instead of opening modal */
  navigateToPage?: boolean;
  /** Size variant */
  size?: 'sm' | 'md';
}

const TYPE_ICONS = {
  task: ListTodo,
  artifact: FileText,
  decision: Lightbulb,
  session: Users,
};

const TYPE_COLORS = {
  task: '#3b82f6',
  artifact: '#22c55e',
  decision: '#f59e0b',
  session: '#a855f7',
};

const TYPE_ROUTES = {
  task: '/tasks',
  artifact: '/artifacts',
  decision: '/decisions',
  session: '/sessions',
};

export function CrossReferenceLink({
  type,
  id,
  label,
  showTitle = false,
  navigateToPage = false,
  size = 'md',
}: CrossReferenceLinkProps) {
  const navigate = useNavigate();
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const Icon = TYPE_ICONS[type];
  const color = TYPE_COLORS[type];

  // Fetch entity data for title and tooltip
  const { data, isLoading, error } = useQuery({
    queryKey: [type, id],
    queryFn: async () => {
      switch (type) {
        case 'task':
          return api.tasks.get(id);
        case 'artifact':
          return api.artifacts.get(id);
        case 'decision':
          return api.decisions.get(id);
        default:
          return null;
      }
    },
    enabled: showTitle || showTooltip,
    staleTime: 30000,
  });

  const getTitle = (): string | undefined => {
    if (!data) return undefined;
    if ('task' in data) return (data as { task: Task }).task?.title;
    if ('artifact' in data) return (data as { artifact: Artifact }).artifact?.title || (data as { artifact: Artifact }).artifact?.uri;
    if ('decision' in data) return (data as { decision: Decision }).decision?.decision;
    return undefined;
  };

  const getStatus = (): string | undefined => {
    if (!data) return undefined;
    if ('task' in data) return (data as { task: Task }).task?.status;
    return undefined;
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (navigateToPage) {
      navigate(TYPE_ROUTES[type], { state: { selectedId: id } });
    } else if (type === 'task') {
      setShowTaskModal(true);
    } else {
      // For non-task types, navigate to the page with the ID
      navigate(TYPE_ROUTES[type], { state: { selectedId: id } });
    }
  };

  const title = showTitle ? getTitle() : undefined;
  const status = getStatus();
  const displayLabel = label || (title && showTitle ? title : id.slice(0, 8));

  return (
    <>
      <span
        className={`cross-ref-link type-${type} size-${size} ${error ? 'error' : ''}`}
        style={{ '--ref-color': color } as React.CSSProperties}
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title={error ? 'Not found' : getTitle()}
      >
        <Icon size={size === 'sm' ? 12 : 14} />
        <span className="ref-label">
          {isLoading && showTitle ? '...' : displayLabel}
        </span>
        {status && (
          <span className={`ref-status status-${status}`}>
            {status}
          </span>
        )}
        {error && <AlertCircle size={10} className="error-icon" />}
      </span>

      {showTaskModal && type === 'task' && (
        <TaskDetail
          taskId={id}
          onClose={() => setShowTaskModal(false)}
        />
      )}
    </>
  );
}

/**
 * TaskLink - Shorthand for task cross-references
 */
export function TaskLink({
  id,
  showTitle,
  label,
  size,
}: {
  id: string;
  showTitle?: boolean;
  label?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <CrossReferenceLink
      type="task"
      id={id}
      showTitle={showTitle}
      label={label}
      size={size}
    />
  );
}

/**
 * ArtifactLink - Shorthand for artifact cross-references
 */
export function ArtifactLink({
  id,
  showTitle,
  label,
  size,
  navigateToPage = true,
}: {
  id: string;
  showTitle?: boolean;
  label?: string;
  size?: 'sm' | 'md';
  navigateToPage?: boolean;
}) {
  return (
    <CrossReferenceLink
      type="artifact"
      id={id}
      showTitle={showTitle}
      label={label}
      size={size}
      navigateToPage={navigateToPage}
    />
  );
}

/**
 * DecisionLink - Shorthand for decision cross-references
 */
export function DecisionLink({
  id,
  showTitle,
  label,
  size,
  navigateToPage = true,
}: {
  id: string;
  showTitle?: boolean;
  label?: string;
  size?: 'sm' | 'md';
  navigateToPage?: boolean;
}) {
  return (
    <CrossReferenceLink
      type="decision"
      id={id}
      showTitle={showTitle}
      label={label}
      size={size}
      navigateToPage={navigateToPage}
    />
  );
}

/**
 * Utility to parse and render text with inline cross-references
 * Supports formats like: @task:abc123, @artifact:def456, @decision:ghi789
 */
export function parseReferences(text: string): React.ReactNode[] {
  const refPattern = /@(task|artifact|decision|session):([a-f0-9-]+)/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = refPattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const type = match[1].toLowerCase() as ReferenceType;
    const id = match[2];

    parts.push(
      <CrossReferenceLink
        key={`${type}-${id}-${match.index}`}
        type={type}
        id={id}
        size="sm"
      />
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

/**
 * RichText component that automatically converts @type:id references to links
 */
export function RichText({ children }: { children: string }) {
  const parts = parseReferences(children);
  return <span className="rich-text">{parts}</span>;
}
