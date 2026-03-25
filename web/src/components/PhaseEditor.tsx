import { useState, useCallback } from 'react';
import {
  GripVertical,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  X,
  Edit2,
} from 'lucide-react';
import type { PhaseDefinition, PhaseRole } from '../api/client';
import './PhaseEditor.css';

const ALL_ROLES: { value: PhaseRole; label: string }[] = [
  { value: 'pm', label: 'PM' },
  { value: 'ux', label: 'UX' },
  { value: 'tech-lead', label: 'Tech Lead' },
  { value: 'developer', label: 'Developer' },
  { value: 'qa', label: 'QA' },
  { value: 'human', label: 'Human' },
];

interface PhaseEditorProps {
  phases: PhaseDefinition[];
  onSave: (phases: PhaseDefinition[]) => void;
  isSaving?: boolean;
}

interface EditingState {
  phaseId: number | null;
  field: string | null;
}

export function PhaseEditor({ phases, onSave, isSaving }: PhaseEditorProps) {
  const [localPhases, setLocalPhases] = useState<PhaseDefinition[]>(phases);
  const [editing, setEditing] = useState<EditingState>({ phaseId: null, field: null });
  const [editValue, setEditValue] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const updatePhase = useCallback((id: number, updates: Partial<PhaseDefinition>) => {
    setLocalPhases(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    setHasChanges(true);
  }, []);

  const startEditing = (phaseId: number, field: string, currentValue: string) => {
    setEditing({ phaseId, field });
    setEditValue(currentValue);
  };

  const saveEdit = (phaseId: number, field: string) => {
    updatePhase(phaseId, { [field]: editValue });
    setEditing({ phaseId: null, field: null });
  };

  const cancelEdit = () => {
    setEditing({ phaseId: null, field: null });
    setEditValue('');
  };

  const toggleSkip = (phaseId: number, currentValue: boolean) => {
    updatePhase(phaseId, { canSkip: !currentValue });
  };

  const toggleRole = (phaseId: number, role: PhaseRole, currentRoles: PhaseRole[] = []) => {
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter(r => r !== role)
      : [...currentRoles, role];

    // Get current phase to check primaryRole
    const phase = localPhases.find(p => p.id === phaseId);
    const updates: Partial<PhaseDefinition> = { roleSet: newRoles };

    // If removing the primary role, clear it or set to first remaining role
    if (phase?.primaryRole === role && !newRoles.includes(role)) {
      updates.primaryRole = newRoles.length > 0 ? newRoles[0] : undefined;
    }

    updatePhase(phaseId, updates);
  };

  const setPrimaryRole = (phaseId: number, role: PhaseRole) => {
    updatePhase(phaseId, { primaryRole: role });
  };

  const movePhase = (fromIndex: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= localPhases.length) return;

    const newPhases = [...localPhases];
    const [moved] = newPhases.splice(fromIndex, 1);
    newPhases.splice(toIndex, 0, moved);

    // Reassign IDs to maintain order
    const reindexed = newPhases.map((p, i) => ({ ...p, id: i + 1 }));
    setLocalPhases(reindexed);
    setHasChanges(true);
  };

  const addPhase = () => {
    const maxId = Math.max(...localPhases.map(p => p.id), 0);
    const newPhase: PhaseDefinition = {
      id: maxId + 1,
      name: 'New Phase',
      shortName: 'NEW',
      description: '',
      commitPrefix: 'new',
      canSkip: true,
    };
    setLocalPhases([...localPhases, newPhase]);
    setHasChanges(true);
  };

  const removePhase = (phaseId: number) => {
    if (localPhases.length <= 1) return; // Keep at least one phase
    const newPhases = localPhases.filter(p => p.id !== phaseId);
    // Reassign IDs
    const reindexed = newPhases.map((p, i) => ({ ...p, id: i + 1 }));
    setLocalPhases(reindexed);
    setHasChanges(true);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newPhases = [...localPhases];
    const [moved] = newPhases.splice(draggedIndex, 1);
    newPhases.splice(index, 0, moved);

    // Reassign IDs
    const reindexed = newPhases.map((p, i) => ({ ...p, id: i + 1 }));
    setLocalPhases(reindexed);
    setDraggedIndex(index);
    setHasChanges(true);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSave = () => {
    onSave(localPhases);
    setHasChanges(false);
  };

  const handleReset = () => {
    setLocalPhases(phases);
    setHasChanges(false);
  };

  const isEditing = (phaseId: number, field: string) =>
    editing.phaseId === phaseId && editing.field === field;

  const renderEditableField = (
    phase: PhaseDefinition,
    field: keyof PhaseDefinition,
    label: string,
    placeholder?: string
  ) => {
    const value = phase[field] as string || '';

    if (isEditing(phase.id, field)) {
      return (
        <div className="editable-field editing">
          <label>{label}</label>
          <div className="edit-input-group">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit(phase.id, field);
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <button className="icon-btn save" onClick={() => saveEdit(phase.id, field)} title="Save">
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
      <div className="editable-field" onClick={() => startEditing(phase.id, field, value)}>
        <label>{label}</label>
        <div className="field-value">
          <span className={!value ? 'placeholder' : ''}>{value || placeholder}</span>
          <Edit2 size={12} className="edit-icon" />
        </div>
      </div>
    );
  };

  return (
    <div className="phase-editor">
      <div className="editor-header">
        <p className="editor-description">
          Customize your workflow phases. Drag to reorder, click to edit.
        </p>
        <div className="editor-actions">
          <button className="action-btn" onClick={addPhase}>
            <Plus size={16} />
            Add Phase
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

      <div className="phases-list">
        {localPhases.map((phase, index) => (
          <div
            key={phase.id}
            className={`phase-editor-card ${draggedIndex === index ? 'dragging' : ''}`}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
          >
            <div className="phase-drag-handle">
              <GripVertical size={20} />
            </div>

            <div className="phase-id-badge">{phase.id}</div>

            <div className="phase-fields">
              <div className="phase-main-fields">
                {renderEditableField(phase, 'name', 'Name', 'Phase name')}
                {renderEditableField(phase, 'shortName', 'Short', 'SHORT')}
                {renderEditableField(phase, 'commitPrefix', 'Commit Prefix', 'prefix')}
              </div>

              <div className="phase-description-field">
                {renderEditableField(phase, 'description', 'Description', 'Optional description...')}
              </div>

              <div className="phase-toggle">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={phase.canSkip}
                    onChange={() => toggleSkip(phase.id, phase.canSkip)}
                  />
                  <span className="toggle-text">Can be skipped</span>
                </label>
              </div>

              <div className="phase-roles">
                <label className="roles-label">Roles</label>
                <div className="role-checkboxes">
                  {ALL_ROLES.map(({ value, label }) => (
                    <label key={value} className="role-checkbox">
                      <input
                        type="checkbox"
                        checked={phase.roleSet?.includes(value) || false}
                        onChange={() => toggleRole(phase.id, value, phase.roleSet)}
                      />
                      <span className={phase.primaryRole === value ? 'primary' : ''}>{label}</span>
                    </label>
                  ))}
                </div>
                {phase.roleSet && phase.roleSet.length > 1 && (
                  <div className="primary-role-select">
                    <label>Primary:</label>
                    <select
                      value={phase.primaryRole || ''}
                      onChange={(e) => setPrimaryRole(phase.id, e.target.value as PhaseRole)}
                    >
                      {phase.roleSet.map(role => (
                        <option key={role} value={role}>
                          {ALL_ROLES.find(r => r.value === role)?.label || role}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="phase-actions">
              <button
                className="icon-btn"
                onClick={() => movePhase(index, 'up')}
                disabled={index === 0}
                title="Move up"
              >
                <ChevronUp size={16} />
              </button>
              <button
                className="icon-btn"
                onClick={() => movePhase(index, 'down')}
                disabled={index === localPhases.length - 1}
                title="Move down"
              >
                <ChevronDown size={16} />
              </button>
              <button
                className="icon-btn danger"
                onClick={() => removePhase(phase.id)}
                disabled={localPhases.length <= 1}
                title="Remove phase"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
