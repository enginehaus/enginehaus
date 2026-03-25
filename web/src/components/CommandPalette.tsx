/**
 * Command Palette (Cmd+K / Ctrl+K)
 *
 * Global command palette for quick navigation, search, and actions.
 * Inspired by Linear, Raycast, and Vercel.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { api } from '../api/client';
import {
  Search,
  Zap,
  ListTodo,
  Users,
  Briefcase,
  FileText,
  BarChart3,
  Settings,
  Plus,
  Lightbulb,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
} from 'lucide-react';
import './CommandPalette.css';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  // Fetch tasks for search
  const { data: tasksData } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.tasks.list(),
    enabled: open,
  });

  // Fetch decisions for search
  const { data: decisionsData } = useQuery({
    queryKey: ['decisions'],
    queryFn: () => api.decisions.list({ limit: 20 }),
    enabled: open,
  });

  // Fetch projects for switching
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    enabled: open,
  });

  const tasks = tasksData?.tasks || [];
  const decisions = decisionsData?.decisions || [];
  const projects = projectsData?.projects || [];

  // Recent items (in-progress tasks)
  const recentTasks = tasks.filter(t => t.status === 'in-progress').slice(0, 3);

  const runCommand = useCallback((callback: () => void) => {
    onOpenChange(false);
    callback();
  }, [onOpenChange]);

  // Reset search when closed
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command Palette"
    >
      <div className="command-palette-header">
        <Search size={18} />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Type a command or search..."
        />
        <kbd className="command-shortcut">ESC</kbd>
      </div>

      <Command.List>
        <Command.Empty>No results found.</Command.Empty>

        {/* Recent Items */}
        {recentTasks.length > 0 && !search && (
          <Command.Group heading="Recent">
            {recentTasks.map((task) => (
              <Command.Item
                key={task.id}
                value={`recent ${task.title}`}
                onSelect={() => runCommand(() => navigate(`/tasks?id=${task.id}`))}
              >
                <AlertCircle size={16} className="item-icon in-progress" />
                <span className="item-label">{task.title}</span>
                <span className="item-meta">{task.status}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* Quick Actions */}
        <Command.Group heading="Actions">
          <Command.Item
            value="create task add new"
            onSelect={() => runCommand(() => navigate('/tasks?action=create'))}
          >
            <Plus size={16} className="item-icon" />
            <span className="item-label">Create Task</span>
            <ArrowRight size={14} className="item-arrow" />
          </Command.Item>
          <Command.Item
            value="log decision record"
            onSelect={() => runCommand(() => navigate('/decisions?action=log'))}
          >
            <Lightbulb size={16} className="item-icon" />
            <span className="item-label">Log Decision</span>
            <ArrowRight size={14} className="item-arrow" />
          </Command.Item>
        </Command.Group>

        {/* Navigation */}
        <Command.Group heading="Navigate">
          <Command.Item
            value="go wheelhaus home control room"
            onSelect={() => runCommand(() => navigate('/'))}
          >
            <Zap size={16} className="item-icon accent" />
            <span className="item-label">Wheelhaus</span>
            <kbd className="item-shortcut">G H</kbd>
          </Command.Item>
          <Command.Item
            value="go tasks board kanban"
            onSelect={() => runCommand(() => navigate('/tasks'))}
          >
            <ListTodo size={16} className="item-icon" />
            <span className="item-label">Tasks</span>
            <kbd className="item-shortcut">G T</kbd>
          </Command.Item>
          <Command.Item
            value="go sessions agents"
            onSelect={() => runCommand(() => navigate('/sessions'))}
          >
            <Users size={16} className="item-icon" />
            <span className="item-label">Sessions</span>
            <kbd className="item-shortcut">G S</kbd>
          </Command.Item>
          <Command.Item
            value="go decisions architecture"
            onSelect={() => runCommand(() => navigate('/decisions'))}
          >
            <Briefcase size={16} className="item-icon" />
            <span className="item-label">Decisions</span>
            <kbd className="item-shortcut">G D</kbd>
          </Command.Item>
          <Command.Item
            value="go artifacts files"
            onSelect={() => runCommand(() => navigate('/artifacts'))}
          >
            <FileText size={16} className="item-icon" />
            <span className="item-label">Artifacts</span>
            <kbd className="item-shortcut">G A</kbd>
          </Command.Item>
          <Command.Item
            value="go quality metrics review"
            onSelect={() => runCommand(() => navigate('/quality'))}
          >
            <BarChart3 size={16} className="item-icon" />
            <span className="item-label">Quality</span>
            <kbd className="item-shortcut">G Q</kbd>
          </Command.Item>
          <Command.Item
            value="go settings configuration"
            onSelect={() => runCommand(() => navigate('/settings'))}
          >
            <Settings size={16} className="item-icon" />
            <span className="item-label">Settings</span>
            <kbd className="item-shortcut">G ,</kbd>
          </Command.Item>
        </Command.Group>

        {/* Projects */}
        {projects.length > 0 && (
          <Command.Group heading="Switch Project">
            {projects.map((project) => (
              <Command.Item
                key={project.id}
                value={`project switch ${project.name} ${project.slug}`}
                onSelect={() => runCommand(() => {
                  api.projects.activate(project.id);
                  window.location.reload();
                })}
              >
                <FolderOpen size={16} className="item-icon" />
                <span className="item-label">{project.name}</span>
                <span className="item-meta">{project.slug}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {/* Task Search Results */}
        {search && tasks.length > 0 && (
          <Command.Group heading="Tasks">
            {tasks
              .filter(t =>
                t.title.toLowerCase().includes(search.toLowerCase()) ||
                t.description?.toLowerCase().includes(search.toLowerCase())
              )
              .slice(0, 5)
              .map((task) => (
                <Command.Item
                  key={task.id}
                  value={`task ${task.title} ${task.description || ''}`}
                  onSelect={() => runCommand(() => navigate(`/tasks?id=${task.id}`))}
                >
                  {task.status === 'completed' ? (
                    <CheckCircle2 size={16} className="item-icon success" />
                  ) : task.status === 'in-progress' ? (
                    <AlertCircle size={16} className="item-icon warning" />
                  ) : (
                    <Clock size={16} className="item-icon" />
                  )}
                  <span className="item-label">{task.title}</span>
                  <span className={`item-status ${task.status}`}>{task.status}</span>
                </Command.Item>
              ))}
          </Command.Group>
        )}

        {/* Decision Search Results */}
        {search && decisions.length > 0 && (
          <Command.Group heading="Decisions">
            {decisions
              .filter(d =>
                d.decision.toLowerCase().includes(search.toLowerCase()) ||
                d.rationale?.toLowerCase().includes(search.toLowerCase())
              )
              .slice(0, 3)
              .map((decision) => (
                <Command.Item
                  key={decision.id}
                  value={`decision ${decision.decision} ${decision.rationale || ''}`}
                  onSelect={() => runCommand(() => navigate(`/decisions?id=${decision.id}`))}
                >
                  <Lightbulb size={16} className="item-icon accent" />
                  <span className="item-label">{decision.decision.slice(0, 60)}...</span>
                  {decision.category && (
                    <span className="item-category">{decision.category}</span>
                  )}
                </Command.Item>
              ))}
          </Command.Group>
        )}
      </Command.List>

      <div className="command-palette-footer">
        <div className="footer-hint">
          <kbd>↑↓</kbd> navigate
          <kbd>↵</kbd> select
          <kbd>esc</kbd> close
        </div>
      </div>
    </Command.Dialog>
  );
}

// Hook for global keyboard shortcut
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { open, setOpen };
}
