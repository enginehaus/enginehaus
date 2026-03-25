import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { api, type Artifact, type ArtifactType, type Task } from '../api/client';
import {
  FileText, Image, Code, TestTube, Link, BookOpen,
  Palette, MoreHorizontal, ExternalLink, Trash2, Plus,
  Filter, Search, LayoutGrid, List, ChevronRight, X,
  FolderOpen, Clock
} from 'lucide-react';
import { TaskLink } from '../components/CrossReferenceLink';
import './Artifacts.css';

const ARTIFACT_TYPES: ArtifactType[] = ['design', 'doc', 'code', 'test', 'screenshot', 'url', 'reference', 'other'];

function getTypeIcon(type: ArtifactType, size = 16) {
  switch (type) {
    case 'design': return <Palette size={size} />;
    case 'doc': return <FileText size={size} />;
    case 'code': return <Code size={size} />;
    case 'test': return <TestTube size={size} />;
    case 'screenshot': return <Image size={size} />;
    case 'url': return <Link size={size} />;
    case 'reference': return <BookOpen size={size} />;
    default: return <MoreHorizontal size={size} />;
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type ViewMode = 'grid' | 'list';
type GroupBy = 'type' | 'task' | 'none';

interface ArtifactItemProps {
  artifact: Artifact;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  viewMode: ViewMode;
  taskTitle?: string;
}

function ArtifactItem({ artifact, isSelected, onSelect, onDelete, viewMode, taskTitle }: ArtifactItemProps) {
  const isLink = artifact.uri && (artifact.uri.startsWith('http') || artifact.uri.startsWith('file://'));

  if (viewMode === 'list') {
    return (
      <div
        className={`artifact-list-item type-${artifact.type} ${isSelected ? 'selected' : ''}`}
        onClick={onSelect}
      >
        <span className="artifact-type-icon">{getTypeIcon(artifact.type)}</span>
        <div className="artifact-list-content">
          <span className="artifact-list-title">{artifact.title || artifact.uri}</span>
          {taskTitle && <span className="artifact-list-task">{taskTitle}</span>}
        </div>
        <span className="artifact-list-date">{formatDate(artifact.createdAt)}</span>
        <div className="artifact-list-actions">
          {isLink && (
            <a
              href={artifact.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn"
              title="Open link"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          )}
          <button
            className="action-btn delete"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`artifact-card type-${artifact.type} ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="artifact-header">
        <span className="artifact-type">
          {getTypeIcon(artifact.type)}
          <span>{artifact.type}</span>
        </span>
        <div className="artifact-actions">
          {isLink && (
            <a
              href={artifact.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn"
              title="Open link"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          )}
          <button
            className="action-btn delete"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <h3 className="artifact-title">{artifact.title || artifact.uri}</h3>

      {artifact.description && (
        <p className="artifact-description">{artifact.description}</p>
      )}

      <div className="artifact-meta">
        <span className="artifact-uri" title={artifact.uri}>
          {artifact.uri.length > 40 ? artifact.uri.slice(0, 40) + '...' : artifact.uri}
        </span>
        <span className="artifact-date">{formatDate(artifact.createdAt)}</span>
      </div>
    </div>
  );
}

interface ArtifactPreviewProps {
  artifact: Artifact;
  onClose: () => void;
  onDelete: () => void;
}

function ArtifactPreview({ artifact, onClose, onDelete }: ArtifactPreviewProps) {
  const isLink = artifact.uri && (artifact.uri.startsWith('http') || artifact.uri.startsWith('file://'));
  const isImage = artifact.type === 'screenshot' || artifact.uri.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
  const isMarkdown = artifact.uri.match(/\.md$/i) || artifact.type === 'doc';
  const isCode = artifact.type === 'code' || artifact.uri.match(/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|scss|html|json|yaml|yml|sql)$/i);

  // Get file extension for syntax highlighting hint
  const getLanguage = (uri: string): string => {
    const ext = uri.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', rs: 'rust', go: 'go', java: 'java',
      c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
      css: 'css', scss: 'scss', html: 'html',
      json: 'json', yaml: 'yaml', yml: 'yaml',
      md: 'markdown', sql: 'sql'
    };
    return langMap[ext || ''] || 'plaintext';
  };

  // Simple markdown to HTML (basic support)
  const renderMarkdown = (text: string): string => {
    return text
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold and italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // Code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Lists
      .replace(/^\- (.+)$/gm, '<li>$1</li>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div className="artifact-detail-overlay" onClick={onClose}>
      <div className="artifact-detail-panel" onClick={e => e.stopPropagation()}>
        <header className="detail-header">
          <div className="header-top">
            <span className={`type-pill type-${artifact.type}`}>
              {getTypeIcon(artifact.type, 16)}
              {artifact.type}
            </span>
            <button className="close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <h2>{artifact.title || artifact.uri}</h2>
          <div className="artifact-meta-row">
            <span className="meta-uri" title={artifact.uri}>
              {artifact.uri}
            </span>
          </div>
        </header>

        <div className="detail-content">
          {/* Description */}
          {artifact.description && (
            <section className="detail-section">
              <h3>Description</h3>
              <p className="description">{artifact.description}</p>
            </section>
          )}

          {/* Metadata */}
          <section className="detail-section">
            <h3>
              <Clock size={16} />
              Details
            </h3>
            <div className="metadata-grid">
              <div className="metadata-item">
                <span className="label">Created</span>
                <span className="value">{formatDateFull(artifact.createdAt)}</span>
              </div>
              {artifact.taskId && (
                <div className="metadata-item">
                  <span className="label">Task</span>
                  <span className="value"><TaskLink id={artifact.taskId} showTitle={true} /></span>
                </div>
              )}
              <div className="metadata-item">
                <span className="label">Type</span>
                <span className="value">{artifact.type}</span>
              </div>
            </div>
          </section>

          {/* Content preview based on type */}
          <section className="detail-section preview-section">
            <h3>Preview</h3>
            <div className="preview-main">
              {isImage && isLink && (
                <div className="preview-image">
                  <img src={artifact.uri} alt={artifact.title || 'Artifact'} />
                </div>
              )}

              {isMarkdown && artifact.content && (
                <div className="preview-markdown">
                  <div
                    className="markdown-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(artifact.content) }}
                  />
                </div>
              )}

              {isCode && !isMarkdown && artifact.content && (
                <div className="preview-code">
                  <div className="code-header">
                    <span>{getLanguage(artifact.uri)}</span>
                  </div>
                  <pre><code>{artifact.content}</code></pre>
                </div>
              )}

              {artifact.type === 'url' && (
                <div className="preview-url">
                  <a href={artifact.uri} target="_blank" rel="noopener noreferrer" className="url-link">
                    <ExternalLink size={16} />
                    <span>{artifact.uri}</span>
                  </a>
                  <p className="url-hint">Click to open in a new tab</p>
                </div>
              )}

              {!isImage && !isCode && !isMarkdown && artifact.type !== 'url' && !artifact.content && (
                <div className="preview-empty">
                  <div className="preview-icon">{getTypeIcon(artifact.type, 48)}</div>
                  <p>No preview available</p>
                  {isLink && (
                    <a href={artifact.uri} target="_blank" rel="noopener noreferrer" className="open-link">
                      <ExternalLink size={16} />
                      Open artifact
                    </a>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Origin link */}
          {artifact.originChatUri && (
            <section className="detail-section">
              <a
                href={artifact.originChatUri.startsWith('http') ? artifact.originChatUri : `https://${artifact.originChatUri}`}
                target="_blank"
                rel="noopener noreferrer"
                className="origin-link"
              >
                View source conversation
                <ChevronRight size={14} />
              </a>
            </section>
          )}
        </div>

        <footer className="detail-footer">
          {isLink && (
            <a
              href={artifact.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="action-btn primary"
            >
              <ExternalLink size={16} />
              Open
            </a>
          )}
          <button className="action-btn danger" onClick={onDelete}>
            <Trash2 size={16} />
            Delete
          </button>
        </footer>
      </div>
    </div>
  );
}

export function Artifacts() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<ArtifactType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [groupBy, setGroupBy] = useState<GroupBy>('type');
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);

  // Get active project
  const { data: activeData } = useQuery({
    queryKey: ['activeProject'],
    queryFn: () => api.projects.getActive(),
  });

  const projectId = activeData?.project?.id;

  // Fetch artifacts for the active project
  const { data: artifactsData, isLoading } = useQuery({
    queryKey: ['artifacts', projectId, typeFilter],
    queryFn: () => {
      if (!projectId) return { artifacts: [], count: 0 };
      const type = typeFilter === 'all' ? undefined : typeFilter;
      return api.artifacts.listForProject(projectId, type);
    },
    enabled: !!projectId,
  });

  // Fetch tasks to get task titles for grouping
  const { data: tasksData } = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => {
      if (!projectId) return { tasks: [], count: 0 };
      return api.tasks.list({ projectId });
    },
    enabled: !!projectId,
  });

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    tasksData?.tasks?.forEach(task => map.set(task.id, task));
    return map;
  }, [tasksData]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.artifacts.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      setSelectedArtifact(null);
    },
  });

  const artifacts = artifactsData?.artifacts || [];

  // Apply search filter
  const filteredArtifacts = useMemo(() => {
    if (!search) return artifacts;
    const lower = search.toLowerCase();
    return artifacts.filter(a =>
      a.title?.toLowerCase().includes(lower) ||
      a.uri.toLowerCase().includes(lower) ||
      a.description?.toLowerCase().includes(lower)
    );
  }, [artifacts, search]);

  // Group artifacts based on groupBy setting
  const groupedArtifacts = useMemo(() => {
    if (groupBy === 'none') {
      return { 'All Artifacts': filteredArtifacts };
    }

    if (groupBy === 'task') {
      const groups: Record<string, Artifact[]> = {};
      filteredArtifacts.forEach(artifact => {
        const task = taskMap.get(artifact.taskId);
        const key = task ? task.title : 'Unknown Task';
        if (!groups[key]) groups[key] = [];
        groups[key].push(artifact);
      });
      return groups;
    }

    // Group by type
    const groups: Record<string, Artifact[]> = {};
    filteredArtifacts.forEach(artifact => {
      const key = artifact.type.charAt(0).toUpperCase() + artifact.type.slice(1);
      if (!groups[key]) groups[key] = [];
      groups[key].push(artifact);
    });
    return groups;
  }, [filteredArtifacts, groupBy, taskMap]);

  const handleDelete = (artifact: Artifact) => {
    if (confirm(`Delete artifact "${artifact.title || artifact.uri}"?`)) {
      deleteMutation.mutate(artifact.id);
    }
  };

  if (!projectId) {
    return (
      <div className="artifacts-page">
        <div className="empty-state">
          <FileText size={48} />
          <h2>No Project Selected</h2>
          <p>Select a project to view its artifacts.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div className="loading">Loading artifacts...</div>;
  }

  return (
    <div className="artifacts-page">
      <div className="artifacts-main">
        <header className="page-header">
          <div>
            <h1>Artifacts</h1>
            <span className="artifact-count">{filteredArtifacts.length} artifacts</span>
          </div>
          <button className="add-btn" disabled>
            <Plus size={16} />
            Add Artifact
          </button>
        </header>

        <div className="filters-bar">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search artifacts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <div className="filter-group">
            <Filter size={16} />
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as ArtifactType | 'all')}
            >
              <option value="all">All Types</option>
              {ARTIFACT_TYPES.map(type => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <FolderOpen size={16} />
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value as GroupBy)}
            >
              <option value="type">Group by Type</option>
              <option value="task">Group by Task</option>
              <option value="none">No Grouping</option>
            </select>
          </div>

          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {filteredArtifacts.length === 0 ? (
          <div className="empty-state">
            <FileText size={48} />
            <h2>No Artifacts</h2>
            <p>
              Artifacts are created when agents link resources to tasks.
              {typeFilter !== 'all' && ` Try clearing the "${typeFilter}" filter.`}
              {search && ` Try a different search term.`}
            </p>
          </div>
        ) : groupBy === 'none' ? (
          // Flat view
          <div className={viewMode === 'grid' ? 'artifact-grid' : 'artifact-list'}>
            {filteredArtifacts.map(artifact => (
              <ArtifactItem
                key={artifact.id}
                artifact={artifact}
                isSelected={selectedArtifact?.id === artifact.id}
                onSelect={() => setSelectedArtifact(artifact)}
                onDelete={() => handleDelete(artifact)}
                viewMode={viewMode}
                taskTitle={taskMap.get(artifact.taskId)?.title}
              />
            ))}
          </div>
        ) : (
          // Grouped view
          <div className="artifact-groups">
            {Object.entries(groupedArtifacts).map(([groupName, groupArtifacts]) => (
              <div key={groupName} className="artifact-group">
                <h2 className="group-header">
                  {groupBy === 'type' && getTypeIcon(groupName.toLowerCase() as ArtifactType)}
                  {groupBy === 'task' && <FolderOpen size={16} />}
                  <span>{groupName}</span>
                  <span className="group-count">{groupArtifacts.length}</span>
                </h2>
                <div className={viewMode === 'grid' ? 'artifact-grid' : 'artifact-list'}>
                  {groupArtifacts.map(artifact => (
                    <ArtifactItem
                      key={artifact.id}
                      artifact={artifact}
                      isSelected={selectedArtifact?.id === artifact.id}
                      onSelect={() => setSelectedArtifact(artifact)}
                      onDelete={() => handleDelete(artifact)}
                      viewMode={viewMode}
                      taskTitle={groupBy !== 'task' ? taskMap.get(artifact.taskId)?.title : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview pane */}
      {selectedArtifact && (
        <ArtifactPreview
          artifact={selectedArtifact}
          onClose={() => setSelectedArtifact(null)}
          onDelete={() => handleDelete(selectedArtifact)}
        />
      )}
    </div>
  );
}
