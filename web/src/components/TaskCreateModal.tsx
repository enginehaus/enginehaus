import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Task } from '../api/client';
import { X, Plus, Trash2 } from 'lucide-react';
import './TaskCreateModal.css';

interface TaskCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Priority = Task['priority'];

export function TaskCreateModal({ isOpen, onClose }: TaskCreateModalProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [files, setFiles] = useState<string[]>([]);
  const [newFile, setNewFile] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Partial<Task>) => api.tasks.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      handleClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setFiles([]);
    setNewFile('');
    setError(null);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      files: files.length > 0 ? files : undefined,
    });
  };

  const addFile = () => {
    if (newFile.trim() && !files.includes(newFile.trim())) {
      setFiles([...files, newFile.trim()]);
      setNewFile('');
    }
  };

  const removeFile = (file: string) => {
    setFiles(files.filter(f => f !== file));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Task</h2>
          <button className="close-btn" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="task-form">
          {error && (
            <div className="form-error">{error}</div>
          )}

          <div className="form-group">
            <label htmlFor="title">Title *</label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Additional details, context, or requirements..."
              rows={4}
            />
          </div>

          <div className="form-group">
            <label htmlFor="priority">Priority</label>
            <div className="priority-options">
              {(['critical', 'high', 'medium', 'low'] as Priority[]).map(p => (
                <button
                  key={p}
                  type="button"
                  className={`priority-btn ${p} ${priority === p ? 'selected' : ''}`}
                  onClick={() => setPriority(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Related Files</label>
            <div className="file-input-row">
              <input
                type="text"
                value={newFile}
                onChange={e => setNewFile(e.target.value)}
                placeholder="src/components/Example.tsx"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addFile();
                  }
                }}
              />
              <button type="button" className="add-file-btn" onClick={addFile}>
                <Plus size={16} />
              </button>
            </div>
            {files.length > 0 && (
              <ul className="file-list">
                {files.map(file => (
                  <li key={file}>
                    <code>{file}</code>
                    <button type="button" onClick={() => removeFile(file)}>
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="form-actions">
            <button type="button" className="cancel-btn" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="submit-btn"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
