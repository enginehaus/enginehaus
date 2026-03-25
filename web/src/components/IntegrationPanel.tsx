import { useState, useCallback } from 'react';
import {
  Github,
  MessageSquare,
  Webhook,
  Check,
  X,
  Edit2,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Plus,
} from 'lucide-react';
import type {
  IntegrationsConfig,
  GitHubIntegrationConfig,
  SlackIntegrationConfig,
  WebhookIntegrationConfig,
  IntegrationStatus,
  IntegrationTestResult,
} from '../api/client';
import './IntegrationPanel.css';

interface IntegrationPanelProps {
  integrations: IntegrationsConfig;
  onSave: (integrations: IntegrationsConfig) => void;
  onTest: (integration: string) => Promise<IntegrationTestResult>;
  isSaving?: boolean;
}

interface EditingState {
  integration: string | null;
  field: string | null;
}

// Slack notification events
const SLACK_EVENTS = [
  { key: 'taskCompleted', label: 'Task Completed' },
  { key: 'taskBlocked', label: 'Task Blocked' },
  { key: 'sessionStarted', label: 'Session Started' },
  { key: 'qualityGateFailed', label: 'Quality Gate Failed' },
  { key: 'phaseCompleted', label: 'Phase Completed' },
];

// Webhook events
const WEBHOOK_EVENTS = [
  'task.created',
  'task.completed',
  'task.blocked',
  'session.started',
  'session.completed',
  'decision.logged',
  'phase.completed',
  'quality.gate_failed',
];

export function IntegrationPanel({ integrations, onSave, onTest, isSaving }: IntegrationPanelProps) {
  const [localIntegrations, setLocalIntegrations] = useState<IntegrationsConfig>(integrations);
  const [editing, setEditing] = useState<EditingState>({ integration: null, field: null });
  const [editValue, setEditValue] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [testingIntegration, setTestingIntegration] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, IntegrationTestResult>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const updateGitHub = useCallback((updates: Partial<GitHubIntegrationConfig>) => {
    setLocalIntegrations(prev => ({
      ...prev,
      github: { ...getDefaultGitHub(), ...prev.github, ...updates },
    }));
    setHasChanges(true);
  }, []);

  const updateSlack = useCallback((updates: Partial<SlackIntegrationConfig>) => {
    setLocalIntegrations(prev => ({
      ...prev,
      slack: { ...getDefaultSlack(), ...prev.slack, ...updates },
    }));
    setHasChanges(true);
  }, []);

  const updateWebhook = useCallback((updates: Partial<WebhookIntegrationConfig>) => {
    setLocalIntegrations(prev => ({
      ...prev,
      webhook: { ...getDefaultWebhook(), ...prev.webhook, ...updates },
    }));
    setHasChanges(true);
  }, []);

  const getDefaultGitHub = (): GitHubIntegrationConfig => ({
    enabled: false,
    token: '',
    autoCreatePRs: false,
    prLabels: ['enginehaus'],
  });

  const getDefaultSlack = (): SlackIntegrationConfig => ({
    enabled: false,
    webhookUrl: '',
    notifications: {},
  });

  const getDefaultWebhook = (): WebhookIntegrationConfig => ({
    enabled: false,
    url: '',
    events: [],
  });

  const startEditing = (integration: string, field: string, currentValue: string) => {
    setEditing({ integration, field });
    setEditValue(currentValue);
  };

  const saveEdit = (integration: string, field: string) => {
    if (integration === 'github') {
      updateGitHub({ [field]: editValue });
    } else if (integration === 'slack') {
      updateSlack({ [field]: editValue });
    } else if (integration === 'webhook') {
      updateWebhook({ [field]: editValue });
    }
    setEditing({ integration: null, field: null });
  };

  const cancelEdit = () => {
    setEditing({ integration: null, field: null });
    setEditValue('');
  };

  const handleTest = async (integration: string) => {
    setTestingIntegration(integration);
    try {
      const result = await onTest(integration);
      setTestResults(prev => ({ ...prev, [integration]: result }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [integration]: { success: false, message: error instanceof Error ? error.message : 'Test failed' },
      }));
    }
    setTestingIntegration(null);
  };

  const handleSave = () => {
    onSave(localIntegrations);
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalIntegrations(integrations);
    setHasChanges(false);
    setTestResults({});
  };

  const getStatus = (integration: string): IntegrationStatus => {
    const config = localIntegrations[integration as keyof IntegrationsConfig];
    if (!config) return 'unconfigured';
    if (!config.enabled) return 'disabled';

    // Check for required fields
    if (integration === 'github' && !(config as GitHubIntegrationConfig).token) return 'unconfigured';
    if (integration === 'slack' && !(config as SlackIntegrationConfig).webhookUrl) return 'unconfigured';
    if (integration === 'webhook' && !(config as WebhookIntegrationConfig).url) return 'unconfigured';

    // Check test results
    const testResult = testResults[integration];
    if (testResult) {
      return testResult.success ? 'connected' : 'error';
    }

    return 'connected'; // Assume connected if configured
  };

  const renderStatusBadge = (status: IntegrationStatus) => {
    switch (status) {
      case 'connected':
        return <span className="status-badge connected"><CheckCircle2 size={14} /> Connected</span>;
      case 'error':
        return <span className="status-badge error"><AlertCircle size={14} /> Error</span>;
      case 'unconfigured':
        return <span className="status-badge unconfigured"><Circle size={14} /> Not Configured</span>;
      case 'disabled':
        return <span className="status-badge disabled"><Circle size={14} /> Disabled</span>;
    }
  };

  const isEditing = (integration: string, field: string) =>
    editing.integration === integration && editing.field === field;

  const toggleShowSecret = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const maskSecret = (value: string) => {
    if (!value) return '';
    if (value.length <= 8) return '••••••••';
    return value.substring(0, 4) + '••••••••' + value.substring(value.length - 4);
  };

  const renderSecretField = (
    integration: string,
    field: string,
    value: string | undefined,
    placeholder: string,
    label: string
  ) => {
    const secretKey = `${integration}-${field}`;
    const isShowing = showSecrets[secretKey];

    if (isEditing(integration, field)) {
      return (
        <div className="field-row secret-field">
          <label>{label}</label>
          <div className="edit-input-group">
            <input
              type={isShowing ? 'text' : 'password'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit(integration, field);
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <button className="icon-btn" onClick={() => toggleShowSecret(secretKey)} title={isShowing ? 'Hide' : 'Show'}>
              {isShowing ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button className="icon-btn save" onClick={() => saveEdit(integration, field)} title="Save">
              <Check size={14} />
            </button>
            <button className="icon-btn cancel" onClick={cancelEdit} title="Cancel">
              <X size={14} />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="field-row secret-field" onClick={() => startEditing(integration, field, value || '')}>
        <label>{label}</label>
        <div className="field-value">
          <span className={!value ? 'placeholder' : 'masked'}>
            {value ? (isShowing ? value : maskSecret(value)) : placeholder}
          </span>
          <div className="field-actions">
            {value && (
              <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); toggleShowSecret(secretKey); }} title={isShowing ? 'Hide' : 'Show'}>
                {isShowing ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            )}
            <Edit2 size={12} className="edit-icon" />
          </div>
        </div>
      </div>
    );
  };

  const renderTextField = (
    integration: string,
    field: string,
    value: string | undefined,
    placeholder: string,
    label: string
  ) => {
    if (isEditing(integration, field)) {
      return (
        <div className="field-row">
          <label>{label}</label>
          <div className="edit-input-group">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit(integration, field);
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <button className="icon-btn save" onClick={() => saveEdit(integration, field)} title="Save">
              <Check size={14} />
            </button>
            <button className="icon-btn cancel" onClick={cancelEdit} title="Cancel">
              <X size={14} />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="field-row" onClick={() => startEditing(integration, field, value || '')}>
        <label>{label}</label>
        <div className="field-value">
          <span className={!value ? 'placeholder' : ''}>{value || placeholder}</span>
          <Edit2 size={12} className="edit-icon" />
        </div>
      </div>
    );
  };

  const github = localIntegrations.github || getDefaultGitHub();
  const slack = localIntegrations.slack || getDefaultSlack();
  const webhook = localIntegrations.webhook || getDefaultWebhook();

  return (
    <div className="integration-panel">
      <div className="editor-header">
        <p className="editor-description">
          Connect external tools for notifications, task sync, and automation.
        </p>
        <div className="editor-actions">
          {hasChanges && (
            <>
              <button className="action-btn secondary" onClick={handleReset}>
                Reset
              </button>
              <button
                className="action-btn primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="integrations-list">
        {/* GitHub Integration */}
        <div className={`integration-card ${github.enabled ? 'enabled' : 'disabled'}`}>
          <div className="integration-header">
            <div className="integration-info">
              <Github size={24} className="integration-icon" />
              <div>
                <h3>GitHub</h3>
                <p>Auto-create PRs, sync issues, and link commits</p>
              </div>
            </div>
            <div className="integration-controls">
              {renderStatusBadge(getStatus('github'))}
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={github.enabled}
                  onChange={() => updateGitHub({ enabled: !github.enabled })}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          {github.enabled && (
            <div className="integration-fields">
              {renderSecretField('github', 'token', github.token, 'ghp_xxxxxxxxxxxx', 'Personal Access Token')}
              {renderTextField('github', 'owner', github.owner, 'organization-or-user', 'Owner')}
              {renderTextField('github', 'repo', github.repo, 'repository-name', 'Repository')}

              <div className="field-row checkbox-field">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={github.autoCreatePRs}
                    onChange={() => updateGitHub({ autoCreatePRs: !github.autoCreatePRs })}
                  />
                  Auto-create PRs on task completion
                </label>
              </div>

              <div className="field-row">
                <label>PR Labels</label>
                <div className="tags-input">
                  {github.prLabels.map((label, i) => (
                    <span key={i} className="tag">
                      {label}
                      <button onClick={() => updateGitHub({ prLabels: github.prLabels.filter((_, j) => j !== i) })}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <button
                    className="add-tag-btn"
                    onClick={() => {
                      const newLabel = prompt('Enter label name:');
                      if (newLabel) {
                        updateGitHub({ prLabels: [...github.prLabels, newLabel] });
                      }
                    }}
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>

              <div className="integration-actions">
                <button
                  className="test-btn"
                  onClick={() => handleTest('github')}
                  disabled={testingIntegration === 'github' || !github.token}
                >
                  {testingIntegration === 'github' ? (
                    <><Loader2 size={14} className="spinning" /> Testing...</>
                  ) : (
                    <><Play size={14} /> Test Connection</>
                  )}
                </button>
                {testResults.github && (
                  <span className={`test-result ${testResults.github.success ? 'success' : 'error'}`}>
                    {testResults.github.message}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Slack Integration */}
        <div className={`integration-card ${slack.enabled ? 'enabled' : 'disabled'}`}>
          <div className="integration-header">
            <div className="integration-info">
              <MessageSquare size={24} className="integration-icon" />
              <div>
                <h3>Slack</h3>
                <p>Send notifications for task events and updates</p>
              </div>
            </div>
            <div className="integration-controls">
              {renderStatusBadge(getStatus('slack'))}
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={slack.enabled}
                  onChange={() => updateSlack({ enabled: !slack.enabled })}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          {slack.enabled && (
            <div className="integration-fields">
              {renderSecretField('slack', 'webhookUrl', slack.webhookUrl, 'https://hooks.slack.com/services/...', 'Webhook URL')}
              {renderTextField('slack', 'channel', slack.channel, '#engineering', 'Channel (optional)')}

              <div className="field-row">
                <label>Notification Events</label>
                <div className="checkbox-group">
                  {SLACK_EVENTS.map(({ key, label }) => (
                    <label key={key} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={slack.notifications[key] || false}
                        onChange={() => updateSlack({
                          notifications: { ...slack.notifications, [key]: !slack.notifications[key] }
                        })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="integration-actions">
                <button
                  className="test-btn"
                  onClick={() => handleTest('slack')}
                  disabled={testingIntegration === 'slack' || !slack.webhookUrl}
                >
                  {testingIntegration === 'slack' ? (
                    <><Loader2 size={14} className="spinning" /> Testing...</>
                  ) : (
                    <><Play size={14} /> Test Connection</>
                  )}
                </button>
                {testResults.slack && (
                  <span className={`test-result ${testResults.slack.success ? 'success' : 'error'}`}>
                    {testResults.slack.message}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Webhook Integration */}
        <div className={`integration-card ${webhook.enabled ? 'enabled' : 'disabled'}`}>
          <div className="integration-header">
            <div className="integration-info">
              <Webhook size={24} className="integration-icon" />
              <div>
                <h3>Custom Webhook</h3>
                <p>Send events to your own endpoint</p>
              </div>
            </div>
            <div className="integration-controls">
              {renderStatusBadge(getStatus('webhook'))}
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={webhook.enabled}
                  onChange={() => updateWebhook({ enabled: !webhook.enabled })}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          {webhook.enabled && (
            <div className="integration-fields">
              {renderTextField('webhook', 'url', webhook.url, 'https://your-server.com/webhook', 'Webhook URL')}
              {renderSecretField('webhook', 'secret', webhook.secret, 'optional-signing-secret', 'Signing Secret (optional)')}

              <div className="field-row">
                <label>Events to Send</label>
                <div className="checkbox-group events-grid">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label key={event} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={webhook.events.includes(event)}
                        onChange={() => {
                          const newEvents = webhook.events.includes(event)
                            ? webhook.events.filter(e => e !== event)
                            : [...webhook.events, event];
                          updateWebhook({ events: newEvents });
                        }}
                      />
                      <code>{event}</code>
                    </label>
                  ))}
                </div>
              </div>

              <div className="integration-actions">
                <button
                  className="test-btn"
                  onClick={() => handleTest('webhook')}
                  disabled={testingIntegration === 'webhook' || !webhook.url}
                >
                  {testingIntegration === 'webhook' ? (
                    <><Loader2 size={14} className="spinning" /> Testing...</>
                  ) : (
                    <><Play size={14} /> Test Connection</>
                  )}
                </button>
                {testResults.webhook && (
                  <span className={`test-result ${testResults.webhook.success ? 'success' : 'error'}`}>
                    {testResults.webhook.message}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Coming Soon: Linear & Jira */}
        <div className="integration-card coming-soon">
          <div className="integration-header">
            <div className="integration-info">
              <div className="placeholder-icon">L</div>
              <div>
                <h3>Linear</h3>
                <p>Bidirectional task sync with Linear</p>
              </div>
            </div>
            <span className="coming-soon-badge">Coming Soon</span>
          </div>
        </div>

        <div className="integration-card coming-soon">
          <div className="integration-header">
            <div className="integration-info">
              <div className="placeholder-icon">J</div>
              <div>
                <h3>Jira</h3>
                <p>Bidirectional task sync with Jira</p>
              </div>
            </div>
            <span className="coming-soon-badge">Coming Soon</span>
          </div>
        </div>
      </div>
    </div>
  );
}
