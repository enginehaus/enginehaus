import { useState, useCallback } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  X,
  Edit2,
  Play,
  Loader2,
  Terminal,
} from 'lucide-react';
import type { QualityGatesConfig, QualityGateConfig, CustomQualityGate } from '../api/client';
import './QualityGateEditor.css';

interface QualityGateEditorProps {
  gates: QualityGatesConfig;
  onSave: (gates: QualityGatesConfig) => void;
  isSaving?: boolean;
}

type DefaultGateName = 'compilation' | 'linting' | 'tests' | 'coverage';

const DEFAULT_GATE_LABELS: Record<DefaultGateName, { name: string; description: string; defaultCommand: string }> = {
  compilation: {
    name: 'Compilation',
    description: 'TypeScript/build compilation check',
    defaultCommand: 'npm run build',
  },
  linting: {
    name: 'Linting',
    description: 'Code style and lint rules',
    defaultCommand: 'npm run lint',
  },
  tests: {
    name: 'Tests',
    description: 'Unit and integration tests',
    defaultCommand: 'npm test',
  },
  coverage: {
    name: 'Coverage',
    description: 'Code coverage threshold',
    defaultCommand: 'npm run test:coverage',
  },
};

interface EditingState {
  gateKey: string | null;
  field: string | null;
}

export function QualityGateEditor({ gates, onSave, isSaving }: QualityGateEditorProps) {
  const [localGates, setLocalGates] = useState<QualityGatesConfig>(gates);
  const [editing, setEditing] = useState<EditingState>({ gateKey: null, field: null });
  const [editValue, setEditValue] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [testingGate, setTestingGate] = useState<string | null>(null);

  const updateDefaultGate = useCallback((key: DefaultGateName, updates: Partial<QualityGateConfig>) => {
    setLocalGates(prev => ({
      ...prev,
      [key]: { ...prev[key], ...updates },
    }));
    setHasChanges(true);
  }, []);

  const updateCustomGate = useCallback((index: number, updates: Partial<CustomQualityGate>) => {
    setLocalGates(prev => ({
      ...prev,
      custom: (prev.custom || []).map((g, i) => i === index ? { ...g, ...updates } : g),
    }));
    setHasChanges(true);
  }, []);

  const addCustomGate = () => {
    const newGate: CustomQualityGate = {
      name: 'New Gate',
      command: 'npm run check',
      required: false,
      blocking: false,
      timeoutSeconds: 120,
    };
    setLocalGates(prev => ({
      ...prev,
      custom: [...(prev.custom || []), newGate],
    }));
    setHasChanges(true);
  };

  const removeCustomGate = (index: number) => {
    setLocalGates(prev => ({
      ...prev,
      custom: (prev.custom || []).filter((_, i) => i !== index),
    }));
    setHasChanges(true);
  };

  const moveCustomGate = (index: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? index - 1 : index + 1;
    const custom = localGates.custom || [];
    if (toIndex < 0 || toIndex >= custom.length) return;

    const newCustom = [...custom];
    const [moved] = newCustom.splice(index, 1);
    newCustom.splice(toIndex, 0, moved);
    setLocalGates(prev => ({ ...prev, custom: newCustom }));
    setHasChanges(true);
  };

  const startEditing = (gateKey: string, field: string, currentValue: string) => {
    setEditing({ gateKey, field });
    setEditValue(currentValue);
  };

  const saveEdit = (gateKey: string, field: string) => {
    if (gateKey.startsWith('custom-')) {
      const index = parseInt(gateKey.replace('custom-', ''), 10);
      if (field === 'timeoutSeconds') {
        updateCustomGate(index, { [field]: parseInt(editValue, 10) || 120 });
      } else {
        updateCustomGate(index, { [field]: editValue });
      }
    } else {
      const key = gateKey as DefaultGateName;
      if (field === 'timeoutSeconds') {
        updateDefaultGate(key, { [field]: parseInt(editValue, 10) || 120 });
      } else {
        updateDefaultGate(key, { [field]: editValue });
      }
    }
    setEditing({ gateKey: null, field: null });
  };

  const cancelEdit = () => {
    setEditing({ gateKey: null, field: null });
    setEditValue('');
  };

  const testGate = async (_command: string, gateKey: string) => {
    setTestingGate(gateKey);
    // Simulate gate test - in real implementation, this would call a backend endpoint
    // with the _command parameter to execute the gate
    await new Promise(resolve => setTimeout(resolve, 2000));
    setTestingGate(null);
    // TODO: Show test result in UI
  };

  const handleSave = () => {
    onSave(localGates);
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalGates(gates);
    setHasChanges(false);
  };

  const isEditing = (gateKey: string, field: string) =>
    editing.gateKey === gateKey && editing.field === field;

  const renderEditableField = (
    gateKey: string,
    field: string,
    value: string | number | undefined,
    placeholder: string,
    type: 'text' | 'number' = 'text'
  ) => {
    const displayValue = String(value ?? '');

    if (isEditing(gateKey, field)) {
      return (
        <div className="editable-field editing">
          <div className="edit-input-group">
            <input
              type={type}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit(gateKey, field);
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <button className="icon-btn save" onClick={() => saveEdit(gateKey, field)} title="Save">
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
      <div
        className="editable-field"
        onClick={() => startEditing(gateKey, field, displayValue)}
      >
        <span className={!displayValue ? 'placeholder' : ''}>
          {displayValue || placeholder}
        </span>
        <Edit2 size={12} className="edit-icon" />
      </div>
    );
  };

  const renderDefaultGate = (key: DefaultGateName) => {
    const gate = localGates[key];
    const label = DEFAULT_GATE_LABELS[key];

    return (
      <div key={key} className="gate-card default-gate">
        <div className="gate-header">
          <div className="gate-info">
            <Shield size={16} className="gate-icon" />
            <div>
              <h4>{label.name}</h4>
              <p className="gate-description">{label.description}</p>
            </div>
          </div>
          <div className="gate-toggles">
            <label className="toggle-label" title="Gate must pass">
              <input
                type="checkbox"
                checked={gate.required}
                onChange={() => updateDefaultGate(key, { required: !gate.required })}
              />
              Required
            </label>
            <label className="toggle-label" title="Block task completion if fails">
              <input
                type="checkbox"
                checked={gate.blocking}
                onChange={() => updateDefaultGate(key, { blocking: !gate.blocking })}
              />
              Blocking
            </label>
          </div>
        </div>

        <div className="gate-fields">
          <div className="field-row">
            <label>Command</label>
            {renderEditableField(key, 'command', gate.command, label.defaultCommand)}
          </div>
          <div className="field-row">
            <label>Timeout (s)</label>
            {renderEditableField(key, 'timeoutSeconds', gate.timeoutSeconds, '120', 'number')}
          </div>
        </div>

        <div className="gate-actions">
          <button
            className="test-btn"
            onClick={() => testGate(gate.command || label.defaultCommand, key)}
            disabled={testingGate === key}
            title="Test gate command"
          >
            {testingGate === key ? (
              <>
                <Loader2 size={14} className="spinning" />
                Testing...
              </>
            ) : (
              <>
                <Play size={14} />
                Test
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  const renderCustomGate = (gate: CustomQualityGate, index: number) => {
    const gateKey = `custom-${index}`;

    return (
      <div key={gateKey} className="gate-card custom-gate">
        <div className="gate-header">
          <div className="gate-info">
            <Terminal size={16} className="gate-icon custom" />
            <div className="gate-name-field">
              {renderEditableField(gateKey, 'name', gate.name, 'Gate name')}
            </div>
          </div>
          <div className="gate-toggles">
            <label className="toggle-label" title="Gate must pass">
              <input
                type="checkbox"
                checked={gate.required}
                onChange={() => updateCustomGate(index, { required: !gate.required })}
              />
              Required
            </label>
            <label className="toggle-label" title="Block task completion if fails">
              <input
                type="checkbox"
                checked={gate.blocking}
                onChange={() => updateCustomGate(index, { blocking: !gate.blocking })}
              />
              Blocking
            </label>
          </div>
        </div>

        <div className="gate-fields">
          <div className="field-row command-field">
            <label>Command</label>
            {renderEditableField(gateKey, 'command', gate.command, 'npm run check')}
          </div>
          <div className="field-row">
            <label>Timeout (s)</label>
            {renderEditableField(gateKey, 'timeoutSeconds', gate.timeoutSeconds, '120', 'number')}
          </div>
        </div>

        <div className="gate-actions">
          <button
            className="test-btn"
            onClick={() => testGate(gate.command, gateKey)}
            disabled={testingGate === gateKey}
            title="Test gate command"
          >
            {testingGate === gateKey ? (
              <>
                <Loader2 size={14} className="spinning" />
                Testing...
              </>
            ) : (
              <>
                <Play size={14} />
                Test
              </>
            )}
          </button>

          <div className="move-buttons">
            <button
              className="icon-btn"
              onClick={() => moveCustomGate(index, 'up')}
              disabled={index === 0}
              title="Move up"
            >
              <ChevronUp size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={() => moveCustomGate(index, 'down')}
              disabled={index === (localGates.custom?.length || 0) - 1}
              title="Move down"
            >
              <ChevronDown size={16} />
            </button>
          </div>

          <button
            className="icon-btn danger"
            onClick={() => removeCustomGate(index)}
            title="Remove gate"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="quality-gate-editor">
      <div className="editor-header">
        <p className="editor-description">
          Configure quality gates that must pass before task completion. Blocking gates prevent completion if they fail.
        </p>
        <div className="editor-actions">
          <button className="action-btn" onClick={addCustomGate}>
            <Plus size={16} />
            Add Custom Gate
          </button>
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

      <div className="gates-section">
        <h3>Default Gates</h3>
        <div className="gates-list">
          {(['compilation', 'linting', 'tests', 'coverage'] as DefaultGateName[]).map(renderDefaultGate)}
        </div>
      </div>

      {(localGates.custom?.length || 0) > 0 && (
        <div className="gates-section">
          <h3>Custom Gates</h3>
          <div className="gates-list">
            {localGates.custom?.map((gate, index) => renderCustomGate(gate, index))}
          </div>
        </div>
      )}
    </div>
  );
}
