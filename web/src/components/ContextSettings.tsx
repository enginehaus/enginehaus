import { useState, useCallback } from 'react';
import {
  FileText,
  Hash,
  Clock,
  Zap,
  Plus,
  X,
  Check,
  Edit2,
} from 'lucide-react';
import type { ContextConfig, ContextAssemblyConfig, ContextLimitsConfig, TokenBudgetsConfig } from '../api/client';
import './ContextSettings.css';

interface ContextSettingsProps {
  context: ContextConfig;
  onSave: (context: ContextConfig) => void;
  isSaving?: boolean;
}

interface EditingState {
  section: string | null;
  field: string | null;
}

export function ContextSettings({ context, onSave, isSaving }: ContextSettingsProps) {
  const [localContext, setLocalContext] = useState<ContextConfig>(context);
  const [editing, setEditing] = useState<EditingState>({ section: null, field: null });
  const [editValue, setEditValue] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [newPattern, setNewPattern] = useState('');
  const [newExtension, setNewExtension] = useState('');

  const updateAssembly = useCallback((updates: Partial<ContextAssemblyConfig>) => {
    setLocalContext(prev => ({
      ...prev,
      assembly: { ...prev.assembly, ...updates },
    }));
    setHasChanges(true);
  }, []);

  const updateLimits = useCallback((updates: Partial<ContextLimitsConfig>) => {
    setLocalContext(prev => ({
      ...prev,
      limits: { ...prev.limits, ...updates },
    }));
    setHasChanges(true);
  }, []);

  const updateTokenBudgets = useCallback((updates: Partial<TokenBudgetsConfig>) => {
    setLocalContext(prev => ({
      ...prev,
      tokenBudgets: { ...prev.tokenBudgets, ...updates },
    }));
    setHasChanges(true);
  }, []);

  const startEditing = (section: string, field: string, currentValue: number) => {
    setEditing({ section, field });
    setEditValue(String(currentValue));
  };

  const saveEdit = () => {
    const value = parseInt(editValue, 10);
    if (isNaN(value)) {
      cancelEdit();
      return;
    }

    if (editing.section === 'assembly') {
      updateAssembly({ [editing.field as string]: value });
    } else if (editing.section === 'limits') {
      updateLimits({ [editing.field as string]: value });
    } else if (editing.section === 'tokenBudgets') {
      updateTokenBudgets({ [editing.field as string]: value });
    }
    setEditing({ section: null, field: null });
  };

  const cancelEdit = () => {
    setEditing({ section: null, field: null });
    setEditValue('');
  };

  const addExcludePattern = () => {
    if (!newPattern.trim()) return;
    updateAssembly({
      excludePatterns: [...localContext.assembly.excludePatterns, newPattern.trim()],
    });
    setNewPattern('');
  };

  const removeExcludePattern = (index: number) => {
    updateAssembly({
      excludePatterns: localContext.assembly.excludePatterns.filter((_, i) => i !== index),
    });
  };

  const addBinaryExtension = () => {
    if (!newExtension.trim()) return;
    const ext = newExtension.trim().startsWith('.') ? newExtension.trim() : `.${newExtension.trim()}`;
    updateAssembly({
      binaryExtensions: [...localContext.assembly.binaryExtensions, ext],
    });
    setNewExtension('');
  };

  const removeBinaryExtension = (index: number) => {
    updateAssembly({
      binaryExtensions: localContext.assembly.binaryExtensions.filter((_, i) => i !== index),
    });
  };

  const handleSave = () => {
    onSave(localContext);
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalContext(context);
    setHasChanges(false);
  };

  const isEditing = (section: string, field: string) =>
    editing.section === section && editing.field === field;

  const renderNumberField = (
    section: string,
    field: string,
    value: number,
    label: string,
    suffix?: string
  ) => {
    if (isEditing(section, field)) {
      return (
        <div className="number-field editing">
          <label>{label}</label>
          <div className="edit-input-group">
            <input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            {suffix && <span className="suffix">{suffix}</span>}
            <button className="icon-btn save" onClick={saveEdit} title="Save">
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
      <div className="number-field" onClick={() => startEditing(section, field, value)}>
        <label>{label}</label>
        <div className="field-value">
          <span>{value}{suffix && <span className="suffix">{suffix}</span>}</span>
          <Edit2 size={12} className="edit-icon" />
        </div>
      </div>
    );
  };

  // Calculate estimated tokens
  const estimatedTokens = {
    minimal: localContext.tokenBudgets.minimal,
    standard: localContext.tokenBudgets.standard,
    full: localContext.tokenBudgets.full,
  };

  return (
    <div className="context-settings">
      <div className="editor-header">
        <p className="editor-description">
          Configure how context is assembled for AI agents. These settings affect token usage and context quality.
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

      <div className="settings-sections">
        {/* File Handling */}
        <div className="settings-card">
          <div className="card-header">
            <FileText size={20} />
            <h3>File Handling</h3>
          </div>
          <div className="card-content">
            <div className="fields-grid">
              {renderNumberField('assembly', 'maxFileSizeKb', localContext.assembly.maxFileSizeKb, 'Max File Size', ' KB')}
              {renderNumberField('assembly', 'maxLinesPerFile', localContext.assembly.maxLinesPerFile, 'Max Lines per File')}
            </div>

            <div className="toggle-field">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={localContext.assembly.includeHiddenFiles}
                  onChange={() => updateAssembly({ includeHiddenFiles: !localContext.assembly.includeHiddenFiles })}
                />
                Include hidden files (dotfiles)
              </label>
            </div>
          </div>
        </div>

        {/* Exclude Patterns */}
        <div className="settings-card">
          <div className="card-header">
            <Hash size={20} />
            <h3>Exclude Patterns</h3>
          </div>
          <div className="card-content">
            <p className="card-description">
              Directories and patterns to exclude from context assembly.
            </p>
            <div className="tags-list">
              {localContext.assembly.excludePatterns.map((pattern, i) => (
                <span key={i} className="tag">
                  <code>{pattern}</code>
                  <button onClick={() => removeExcludePattern(i)} title="Remove">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="add-input">
              <input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="Add pattern (e.g., node_modules, *.log)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addExcludePattern();
                }}
              />
              <button className="add-btn" onClick={addExcludePattern} disabled={!newPattern.trim()}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
        </div>

        {/* Binary Extensions */}
        <div className="settings-card">
          <div className="card-header">
            <FileText size={20} />
            <h3>Binary Extensions</h3>
          </div>
          <div className="card-content">
            <p className="card-description">
              File extensions treated as binary (skipped in context assembly).
            </p>
            <div className="tags-list compact">
              {localContext.assembly.binaryExtensions.map((ext, i) => (
                <span key={i} className="tag small">
                  <code>{ext}</code>
                  <button onClick={() => removeBinaryExtension(i)} title="Remove">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="add-input">
              <input
                type="text"
                value={newExtension}
                onChange={(e) => setNewExtension(e.target.value)}
                placeholder="Add extension (e.g., .bin, .dat)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addBinaryExtension();
                }}
              />
              <button className="add-btn" onClick={addBinaryExtension} disabled={!newExtension.trim()}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
        </div>

        {/* Context Limits */}
        <div className="settings-card">
          <div className="card-header">
            <Clock size={20} />
            <h3>Context Limits</h3>
          </div>
          <div className="card-content">
            <p className="card-description">
              Control how much recent data is included in agent context.
            </p>
            <div className="fields-grid">
              {renderNumberField('limits', 'recentDecisions', localContext.limits.recentDecisions, 'Recent Decisions')}
              {renderNumberField('limits', 'recentUxRequirements', localContext.limits.recentUxRequirements, 'Recent UX Requirements')}
              {renderNumberField('limits', 'recentTechnicalPlans', localContext.limits.recentTechnicalPlans, 'Recent Technical Plans')}
              {renderNumberField('limits', 'readyTasksPreview', localContext.limits.readyTasksPreview, 'Ready Tasks Preview')}
              {renderNumberField('limits', 'sessionHistoryDepth', localContext.limits.sessionHistoryDepth, 'Session History Depth')}
            </div>
          </div>
        </div>

        {/* Token Budgets */}
        <div className="settings-card">
          <div className="card-header">
            <Zap size={20} />
            <h3>Token Budgets</h3>
          </div>
          <div className="card-content">
            <p className="card-description">
              Target token counts for different context detail levels.
            </p>
            <div className="fields-grid budgets">
              {renderNumberField('tokenBudgets', 'minimal', localContext.tokenBudgets.minimal, 'Minimal', ' tokens')}
              {renderNumberField('tokenBudgets', 'standard', localContext.tokenBudgets.standard, 'Standard', ' tokens')}
              {renderNumberField('tokenBudgets', 'full', localContext.tokenBudgets.full, 'Full', ' tokens')}
            </div>

            <div className="token-preview">
              <h4>Estimated Usage</h4>
              <div className="usage-bars">
                <div className="usage-bar">
                  <span className="label">Minimal</span>
                  <div className="bar">
                    <div className="fill" style={{ width: `${Math.min(100, (estimatedTokens.minimal / 10000) * 100)}%` }}></div>
                  </div>
                  <span className="value">{estimatedTokens.minimal.toLocaleString()}</span>
                </div>
                <div className="usage-bar">
                  <span className="label">Standard</span>
                  <div className="bar">
                    <div className="fill" style={{ width: `${Math.min(100, (estimatedTokens.standard / 10000) * 100)}%` }}></div>
                  </div>
                  <span className="value">{estimatedTokens.standard.toLocaleString()}</span>
                </div>
                <div className="usage-bar">
                  <span className="label">Full</span>
                  <div className="bar">
                    <div className="fill" style={{ width: `${Math.min(100, (estimatedTokens.full / 10000) * 100)}%` }}></div>
                  </div>
                  <span className="value">{estimatedTokens.full.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
