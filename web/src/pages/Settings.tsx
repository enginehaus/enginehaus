import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ConfigValidationIssue, ConfigHistoryEntry, PhaseDefinition, QualityGatesConfig, IntegrationsConfig, IntegrationTestResult, ContextConfig, AuditEvent, AuditEventType } from '../api/client';
import { PhaseEditor } from '../components/PhaseEditor';
import { QualityGateEditor } from '../components/QualityGateEditor';
import { IntegrationPanel } from '../components/IntegrationPanel';
import { ContextSettings } from '../components/ContextSettings';
import {
  Settings as SettingsIcon,
  RefreshCw,
  Check,
  AlertTriangle,
  AlertCircle,
  History,
  Save,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  Shield,
  Workflow,
  User,
  Bot,
  CheckSquare,
  PlayCircle,
  FolderOpen,
  Link,
  Layers,
  Filter,
  AlertOctagon,
} from 'lucide-react';
import './Settings.css';

interface SettingsSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function SettingsSection({ title, icon, children, defaultOpen = false }: SettingsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="settings-section">
      <button className="section-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="section-title">
          {icon}
          <span>{title}</span>
        </div>
        {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
      </button>
      {isOpen && <div className="section-content">{children}</div>}
    </div>
  );
}

interface SettingFieldProps {
  label: string;
  description?: string;
  path: string;
  value: unknown;
  type?: 'text' | 'number' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  onSave: (path: string, value: unknown) => void;
}

function SettingField({ label, description, path, value, type = 'text', options, onSave }: SettingFieldProps) {
  const [editValue, setEditValue] = useState<string>(String(value ?? ''));
  const [isDirty, setIsDirty] = useState(false);

  const handleChange = (newValue: string) => {
    setEditValue(newValue);
    setIsDirty(true);
  };

  const handleSave = () => {
    let parsedValue: unknown = editValue;
    if (type === 'number') {
      parsedValue = Number(editValue);
    } else if (type === 'boolean') {
      parsedValue = editValue === 'true';
    }
    onSave(path, parsedValue);
    setIsDirty(false);
  };

  return (
    <div className="setting-field">
      <div className="field-info">
        <label>{label}</label>
        {description && <span className="field-description">{description}</span>}
        <span className="field-path">{path}</span>
      </div>
      <div className="field-input">
        {type === 'boolean' ? (
          <select
            value={editValue}
            onChange={(e) => handleChange(e.target.value)}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        ) : type === 'select' && options ? (
          <select
            value={editValue}
            onChange={(e) => handleChange(e.target.value)}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            value={editValue}
            onChange={(e) => handleChange(e.target.value)}
          />
        )}
        {isDirty && (
          <button className="save-btn" onClick={handleSave} title="Save">
            <Save size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Settings() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'general' | 'phases' | 'quality' | 'context' | 'integrations' | 'history' | 'audit'>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'audit' || tab === 'history') return tab;
    return 'general';
  });

  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'audit') setActiveTab('audit');
    else if (tab === 'history') setActiveTab('history');
  }, [searchParams]);

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'audit' || tab === 'history') {
      setSearchParams({ tab });
    } else {
      setSearchParams({});
    }
  };

  // Get active project
  const { data: projectData } = useQuery({
    queryKey: ['activeProject'],
    queryFn: () => api.projects.getActive(),
  });

  const projectId = projectData?.project?.id;

  // Get config for active project
  const { data: configData, isLoading: isConfigLoading } = useQuery({
    queryKey: ['config', projectId],
    queryFn: () => api.config.get(projectId!),
    enabled: !!projectId,
  });

  // Get phases
  const { data: phasesData } = useQuery({
    queryKey: ['config', projectId, 'phases'],
    queryFn: () => api.config.getPhases(projectId!),
    enabled: !!projectId,
  });

  // Get quality gates
  const { data: qualityData } = useQuery({
    queryKey: ['config', projectId, 'quality'],
    queryFn: () => api.config.getQuality(projectId!),
    enabled: !!projectId && activeTab === 'quality',
  });

  // Get integrations
  const { data: integrationsData } = useQuery({
    queryKey: ['config', projectId, 'integrations'],
    queryFn: () => api.config.getIntegrations(projectId!),
    enabled: !!projectId && activeTab === 'integrations',
  });

  // Get context settings
  const { data: contextData } = useQuery({
    queryKey: ['config', projectId, 'context'],
    queryFn: () => api.config.getContext(projectId!),
    enabled: !!projectId && activeTab === 'context',
  });

  // Get validation
  const { data: validationData, refetch: revalidate } = useQuery({
    queryKey: ['config', projectId, 'validation'],
    queryFn: () => api.config.validate(projectId!),
    enabled: !!projectId,
  });

  // Get history
  const { data: historyData } = useQuery({
    queryKey: ['config', projectId, 'history'],
    queryFn: () => api.config.getHistory(projectId!, 20),
    enabled: !!projectId && activeTab === 'history',
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ path, value }: { path: string; value: unknown }) =>
      api.config.update(projectId!, { path, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', projectId] });
      revalidate();
    },
  });

  // Reset mutation
  const resetMutation = useMutation({
    mutationFn: () => api.config.reset(projectId!, 'Reset via web console'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', projectId] });
      revalidate();
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: () => api.config.sync(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', projectId] });
      revalidate();
    },
  });

  // Update phases mutation
  const updatePhasesMutation = useMutation({
    mutationFn: (phases: PhaseDefinition[]) => api.config.updatePhases(projectId!, phases),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', projectId, 'phases'] });
      revalidate();
    },
  });

  // Update quality gates mutation
  const updateQualityGatesMutation = useMutation({
    mutationFn: (gates: QualityGatesConfig) => api.config.updateQualityGates(projectId!, gates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', projectId, 'quality'] });
      revalidate();
    },
  });

  // Update integrations mutation
  const updateIntegrationsMutation = useMutation({
    mutationFn: (integrations: IntegrationsConfig) => api.config.updateIntegrations(projectId!, integrations),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', projectId, 'integrations'] });
      revalidate();
    },
  });

  // Test integration function
  const testIntegration = async (integration: string): Promise<IntegrationTestResult> => {
    try {
      return await api.config.testIntegration(projectId!, integration);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Test failed',
      };
    }
  };

  // Update context mutation
  const updateContextMutation = useMutation({
    mutationFn: (context: ContextConfig) => api.config.updateContext(projectId!, context),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config', projectId, 'context'] });
      revalidate();
    },
  });

  if (!projectId) {
    return (
      <div className="settings-page">
        <div className="no-project">
          <SettingsIcon size={48} />
          <h2>No Active Project</h2>
          <p>Select a project to view and edit configuration.</p>
        </div>
      </div>
    );
  }

  if (isConfigLoading) {
    return <div className="loading">Loading configuration...</div>;
  }

  const config = configData?.config as Record<string, unknown> | undefined;
  const validation = validationData;
  const phases = phasesData?.phases || [];
  const qualityGates = qualityData?.quality?.gates;
  const integrations = integrationsData?.integrations || {};
  const contextSettings = contextData?.context;
  const history = historyData?.history || [];

  const handleSave = (path: string, value: unknown) => {
    updateMutation.mutate({ path, value });
  };

  const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
    return path.split('.').reduce((acc: unknown, part) => {
      if (acc && typeof acc === 'object') {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, obj);
  };

  const errors = validation?.issues.filter((i: ConfigValidationIssue) => i.level === 'error') || [];
  const warnings = validation?.issues.filter((i: ConfigValidationIssue) => i.level === 'warning') || [];

  return (
    <div className="settings-page">
      <header className="page-header">
        <div className="header-title">
          <SettingsIcon size={24} />
          <h1>Configuration</h1>
        </div>
        <div className="header-actions">
          <button
            className="action-btn"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw size={16} className={syncMutation.isPending ? 'spinning' : ''} />
            Sync from File
          </button>
          <button
            className="action-btn danger"
            onClick={() => {
              if (confirm('Reset all configuration to defaults?')) {
                resetMutation.mutate();
              }
            }}
            disabled={resetMutation.isPending}
          >
            <RotateCcw size={16} />
            Reset to Defaults
          </button>
        </div>
      </header>

      {/* Validation Status */}
      <div className={`validation-banner ${validation?.valid ? 'valid' : 'invalid'}`}>
        {validation?.valid ? (
          <>
            <Check size={20} />
            <span>Configuration is valid</span>
          </>
        ) : (
          <>
            <AlertCircle size={20} />
            <span>
              {errors.length} error{errors.length !== 1 ? 's' : ''},{' '}
              {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* Validation Issues */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="validation-issues">
          {errors.map((issue: ConfigValidationIssue, i: number) => (
            <div key={i} className="issue error">
              <AlertCircle size={16} />
              <span className="issue-path">{issue.path}</span>
              <span className="issue-message">{issue.message}</span>
            </div>
          ))}
          {warnings.map((issue: ConfigValidationIssue, i: number) => (
            <div key={i} className="issue warning">
              <AlertTriangle size={16} />
              <span className="issue-path">{issue.path}</span>
              <span className="issue-message">{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => handleTabChange('general')}
        >
          General
        </button>
        <button
          className={`tab ${activeTab === 'phases' ? 'active' : ''}`}
          onClick={() => handleTabChange('phases')}
        >
          Phases
        </button>
        <button
          className={`tab ${activeTab === 'quality' ? 'active' : ''}`}
          onClick={() => handleTabChange('quality')}
        >
          Quality Gates
        </button>
        <button
          className={`tab ${activeTab === 'context' ? 'active' : ''}`}
          onClick={() => handleTabChange('context')}
        >
          Context
        </button>
        <button
          className={`tab ${activeTab === 'integrations' ? 'active' : ''}`}
          onClick={() => handleTabChange('integrations')}
        >
          Integrations
        </button>
        <button
          className={`tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => handleTabChange('history')}
        >
          History
        </button>
        <button
          className={`tab ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => handleTabChange('audit')}
        >
          Audit Log
        </button>
      </div>

      {activeTab === 'general' && config && (
        <div className="settings-content">
          <SettingsSection title="Session Settings" icon={<Clock size={20} />} defaultOpen>
            <SettingField
              label="Heartbeat Interval"
              description="Seconds between session heartbeats"
              path="workflow.sessions.heartbeatIntervalSeconds"
              value={getNestedValue(config, 'workflow.sessions.heartbeatIntervalSeconds')}
              type="number"
              onSave={handleSave}
            />
            <SettingField
              label="Session Expiry"
              description="Minutes before inactive sessions expire"
              path="workflow.sessions.expiryMinutes"
              value={getNestedValue(config, 'workflow.sessions.expiryMinutes')}
              type="number"
              onSave={handleSave}
            />
            <SettingField
              label="Allow Multiple Agents"
              description="Allow multiple agents to work on the same project"
              path="workflow.sessions.allowMultipleAgents"
              value={getNestedValue(config, 'workflow.sessions.allowMultipleAgents')}
              type="boolean"
              onSave={handleSave}
            />
          </SettingsSection>

          <SettingsSection title="Quality Settings" icon={<Shield size={20} />}>
            <SettingField
              label="Minimum Coverage"
              description="Minimum test coverage percentage required"
              path="quality.coverage.minimum"
              value={getNestedValue(config, 'quality.coverage.minimum')}
              type="number"
              onSave={handleSave}
            />
            <SettingField
              label="Recommended Coverage"
              description="Target test coverage percentage"
              path="quality.coverage.recommended"
              value={getNestedValue(config, 'quality.coverage.recommended')}
              type="number"
              onSave={handleSave}
            />
            <SettingField
              label="Coverage Enforcement"
              description="How to handle coverage requirements"
              path="quality.coverage.enforcement"
              value={getNestedValue(config, 'quality.coverage.enforcement')}
              type="select"
              options={[
                { value: 'block', label: 'Block (fail on violation)' },
                { value: 'warn', label: 'Warn (allow with warning)' },
                { value: 'info', label: 'Info (log only)' },
                { value: 'disabled', label: 'Disabled' },
              ]}
              onSave={handleSave}
            />
          </SettingsSection>

          <SettingsSection title="Git Settings" icon={<GitBranch size={20} />}>
            <SettingField
              label="Auto Create Branches"
              description="Automatically create branches for new tasks"
              path="git.autoCreateBranches"
              value={getNestedValue(config, 'git.autoCreateBranches')}
              type="boolean"
              onSave={handleSave}
            />
            <SettingField
              label="Auto Commit on Phase"
              description="Automatically commit when advancing phases"
              path="git.commits.autoCommitOnPhase"
              value={getNestedValue(config, 'git.commits.autoCommitOnPhase')}
              type="boolean"
              onSave={handleSave}
            />
            <SettingField
              label="Conventional Commits"
              description="Use conventional commit message format"
              path="git.commits.conventionalCommits"
              value={getNestedValue(config, 'git.commits.conventionalCommits')}
              type="boolean"
              onSave={handleSave}
            />
          </SettingsSection>

          <SettingsSection title="Workflow Settings" icon={<Workflow size={20} />}>
            <SettingField
              label="Phases Enabled"
              description="Enable phase-based task workflow"
              path="workflow.phases.enabled"
              value={getNestedValue(config, 'workflow.phases.enabled')}
              type="boolean"
              onSave={handleSave}
            />
            <SettingField
              label="Phase Enforcement"
              description="How strictly to enforce phase progression"
              path="workflow.phases.enforcement"
              value={getNestedValue(config, 'workflow.phases.enforcement')}
              type="select"
              options={[
                { value: 'strict', label: 'Strict (no skipping)' },
                { value: 'flexible', label: 'Flexible (allow skipping)' },
                { value: 'disabled', label: 'Disabled' },
              ]}
              onSave={handleSave}
            />
            <SettingField
              label="Default Task Priority"
              description="Default priority for new tasks"
              path="workflow.tasks.defaultPriority"
              value={getNestedValue(config, 'workflow.tasks.defaultPriority')}
              type="select"
              options={[
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
              onSave={handleSave}
            />
          </SettingsSection>
        </div>
      )}

      {activeTab === 'phases' && (
        <PhaseEditor
          phases={phases}
          onSave={(updatedPhases) => updatePhasesMutation.mutate(updatedPhases)}
          isSaving={updatePhasesMutation.isPending}
        />
      )}

      {activeTab === 'quality' && qualityGates && (
        <QualityGateEditor
          gates={qualityGates}
          onSave={(updatedGates) => updateQualityGatesMutation.mutate(updatedGates)}
          isSaving={updateQualityGatesMutation.isPending}
        />
      )}

      {activeTab === 'context' && contextSettings && (
        <ContextSettings
          context={contextSettings}
          onSave={(updatedContext) => updateContextMutation.mutate(updatedContext)}
          isSaving={updateContextMutation.isPending}
        />
      )}

      {activeTab === 'integrations' && (
        <IntegrationPanel
          integrations={integrations}
          onSave={(updatedIntegrations) => updateIntegrationsMutation.mutate(updatedIntegrations)}
          onTest={testIntegration}
          isSaving={updateIntegrationsMutation.isPending}
        />
      )}

      {activeTab === 'history' && (
        <div className="history-content">
          {history.length === 0 ? (
            <div className="empty-history">
              <History size={32} />
              <p>No configuration changes recorded</p>
            </div>
          ) : (
            <div className="history-timeline">
              {history.map((entry: ConfigHistoryEntry) => (
                <div key={entry.id} className="history-entry">
                  <div className="entry-time">
                    {new Date(entry.changedAt).toLocaleString()}
                  </div>
                  <div className="entry-content">
                    <div className="entry-type">
                      {entry.changeType}
                      {entry.configPath && (
                        <span className="entry-path">{entry.configPath}</span>
                      )}
                    </div>
                    {entry.reason && (
                      <div className="entry-reason">{entry.reason}</div>
                    )}
                    {entry.changedBy && (
                      <div className="entry-actor">by {entry.changedBy}</div>
                    )}
                    {entry.configPath && entry.oldValue !== undefined && (
                      <div className="entry-diff">
                        <span className="old-value">{JSON.stringify(entry.oldValue)}</span>
                        <span className="arrow">→</span>
                        <span className="new-value">{JSON.stringify(entry.newValue)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'audit' && (
        <AuditLogTab />
      )}
    </div>
  );
}

// Audit Log Tab - integrated from standalone page
function AuditLogTab() {
  const [resourceFilter, setResourceFilter] = useState<string>('all');
  const [limit, setLimit] = useState(50);

  const RESOURCE_TYPES = ['all', 'task', 'session', 'project', 'dependency', 'phase', 'quality', 'system', 'error'] as const;

  const { data: auditData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit', resourceFilter, limit],
    queryFn: () => api.audit.list({
      resourceType: resourceFilter !== 'all' ? resourceFilter : undefined,
      limit,
    }),
    refetchInterval: 30000,
  });

  const { data: summaryData } = useQuery({
    queryKey: ['audit-summary'],
    queryFn: () => api.audit.summary(),
  });

  const events = auditData?.entries || [];
  const stats = summaryData?.eventsByType || {};

  const filteredEvents = resourceFilter === 'all'
    ? events
    : events.filter((e: AuditEvent) => e.resourceType === resourceFilter);

  const eventsByDay = filteredEvents.reduce((acc: Record<string, AuditEvent[]>, event: AuditEvent) => {
    const day = new Date(event.timestamp).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!acc[day]) acc[day] = [];
    acc[day].push(event);
    return acc;
  }, {});

  const getEventIcon = (eventType: AuditEventType) => {
    const category = eventType.split('.')[0];
    switch (category) {
      case 'task': return <CheckSquare size={14} />;
      case 'session': return <PlayCircle size={14} />;
      case 'project': return <FolderOpen size={14} />;
      case 'dependency': return <Link size={14} />;
      case 'phase': return <Layers size={14} />;
      case 'quality': return <Shield size={14} />;
      case 'system': return <SettingsIcon size={14} />;
      case 'error': return <AlertOctagon size={14} />;
      default: return <History size={14} />;
    }
  };

  const getEventColor = (eventType: AuditEventType): string => {
    if (eventType.includes('error') || eventType.includes('failed')) return 'error';
    if (eventType.includes('completed') || eventType.includes('passed')) return 'success';
    if (eventType.includes('created') || eventType.includes('started')) return 'info';
    if (eventType.includes('deleted') || eventType.includes('expired')) return 'warning';
    return 'neutral';
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  if (isLoading) {
    return <div className="loading">Loading audit log...</div>;
  }

  return (
    <div className="audit-content">
      <div className="audit-header">
        <span className="event-count">{events.length} events</span>
        <button
          className="refresh-btn"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={16} className={isFetching ? 'spinning' : ''} />
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {Object.keys(stats).length > 0 && (
        <div className="stats-bar">
          {Object.entries(stats).slice(0, 6).map(([type, count]) => (
            <div key={type} className="stat-chip">
              <span className="stat-type">{type}</span>
              <span className="stat-count">{String(count)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="filters-bar">
        <div className="filter-group">
          <Filter size={16} />
          <span>Filter by:</span>
          <select value={resourceFilter} onChange={e => setResourceFilter(e.target.value)}>
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

      <div className="event-timeline">
        {filteredEvents.length === 0 ? (
          <div className="empty-state">
            <History size={48} />
            <h2>No Events</h2>
            <p>No audit events recorded yet.</p>
          </div>
        ) : (
          Object.entries(eventsByDay).map(([day, dayEvents]) => (
            <div key={day} className="day-group">
              <div className="day-header">{day}</div>
              <div className="day-events">
                {(dayEvents as AuditEvent[]).map((event: AuditEvent) => (
                  <div key={event.id} className={`event-row ${getEventColor(event.eventType)}`}>
                    <div className="event-main">
                      <div className="event-icon">{getEventIcon(event.eventType)}</div>
                      <div className="event-content">
                        <div className="event-header">
                          <span className="event-type">{event.eventType}</span>
                          <span className={`actor-badge ${event.actorType}`}>
                            {event.actorType === 'agent' ? <Bot size={12} /> : <User size={12} />}
                            <span>{event.actorId}</span>
                          </span>
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
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
