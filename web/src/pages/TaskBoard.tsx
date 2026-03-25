import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Task } from '../api/client';
import { Plus, GripVertical, AlertTriangle, ArrowUp, Minus, ArrowDown } from 'lucide-react';
import { useState, useMemo } from 'react';
import { TaskDetail } from '../components/TaskDetail';
import { TaskFilters } from '../components/TaskFilters';
import { TaskCreateModal } from '../components/TaskCreateModal';
import { useTaskBoardRealtime } from '../hooks/useRealtimeData';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import './TaskBoard.css';

const STATUSES = ['ready', 'in-progress', 'blocked', 'completed'] as const;
const PRIORITY_ICONS = {
  critical: <AlertTriangle size={14} />,
  high: <ArrowUp size={14} />,
  medium: <Minus size={14} />,
  low: <ArrowDown size={14} />,
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TaskCard({ task, onStatusChange, onClick, isDragOverlay = false }: {
  task: Task;
  onStatusChange: (status: string) => void;
  onClick: () => void;
  isDragOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const isRecentlyCompleted = task.status === 'completed' &&
    (new Date().getTime() - new Date(task.updatedAt).getTime()) < 24 * 60 * 60 * 1000; // 24 hours

  // Calculate phase progress for indicator
  const phaseProgress = task.implementation?.phaseProgress;
  const totalPhases = 7; // Standard phases: plan, design, implement, test, review, deploy, monitor
  const completedCount = phaseProgress?.completedPhases?.length || 0;
  const progressPercent = phaseProgress ? Math.round((completedCount / totalPhases) * 100) : 0;

  const style = transform && !isDragOverlay ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      className={`task-card priority-${task.priority} ${isRecentlyCompleted ? 'recently-completed' : ''} ${isDragging ? 'dragging' : ''} ${isDragOverlay ? 'drag-overlay' : ''}`}
      style={style}
      onClick={onClick}
    >
      <div className="task-header">
        <div
          className="drag-handle"
          {...(!isDragOverlay ? { ...listeners, ...attributes } : {})}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={16} />
        </div>
        <span className="task-priority">
          {PRIORITY_ICONS[task.priority]}
          {task.priority}
        </span>
        {task.status === 'completed' && (
          <span className="completed-time">{formatRelativeTime(task.updatedAt)}</span>
        )}
      </div>
      <h4 className="task-title">{task.title}</h4>
      {task.description && (
        <p className="task-description">{task.description.slice(0, 100)}...</p>
      )}
      {/* Progress indicator */}
      {phaseProgress && completedCount > 0 && (
        <div className="task-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="progress-text">{completedCount}/{totalPhases} phases</span>
        </div>
      )}
      <div className="task-footer">
        <span className="task-id">{task.id.slice(0, 8)}</span>
        <select
          value={task.status}
          onChange={(e) => {
            e.stopPropagation();
            onStatusChange(e.target.value);
          }}
          onClick={(e) => e.stopPropagation()}
          className="status-select"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function TaskColumn({ status, tasks, onStatusChange, onTaskClick }: {
  status: string;
  tasks: Task[];
  onStatusChange: (taskId: string, status: string) => void;
  onTaskClick: (taskId: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    data: { status },
  });

  const statusLabels: Record<string, string> = {
    'ready': 'Ready',
    'in-progress': 'In Progress',
    'blocked': 'Blocked',
    'completed': 'Completed',
  };

  return (
    <div className={`task-column status-${status} ${isOver ? 'drop-target' : ''}`}>
      <div className="column-header">
        <h3>{statusLabels[status]}</h3>
        <span className="task-count">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="column-tasks">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onStatusChange={(newStatus) => onStatusChange(task.id, newStatus)}
            onClick={() => onTaskClick(task.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function TaskBoard() {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Real-time updates (polling, ready for SSE)
  const { isConnected } = useTaskBoardRealtime();

  // Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(KeyboardSensor)
  );

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.tasks.list(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.tasks.update(id, { status: status as Task['status'] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const handleStatusChange = (taskId: string, status: string) => {
    updateMutation.mutate({ id: taskId, status });
  };

  const handleTaskClick = (taskId: string) => {
    setSelectedTaskId(taskId);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task;
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as string;
    const task = active.data.current?.task as Task;

    // Only update if status changed
    if (task && task.status !== newStatus && STATUSES.includes(newStatus as typeof STATUSES[number])) {
      handleStatusChange(taskId, newStatus);
    }
  };

  const tasks = tasksData?.tasks || [];

  // Apply filters
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          task.title.toLowerCase().includes(searchLower) ||
          task.description?.toLowerCase().includes(searchLower) ||
          task.id.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Status filter (when using board view, this is handled by columns)
      // But useful when we add list view later
      if (statusFilter && task.status !== statusFilter) return false;

      // Priority filter
      if (priorityFilter && task.priority !== priorityFilter) return false;

      return true;
    });
  }, [tasks, search, statusFilter, priorityFilter]);

  const tasksByStatus = STATUSES.reduce((acc, status) => {
    let statusTasks = filteredTasks.filter((t) => t.status === status);
    // Sort completed tasks by most recently updated first
    if (status === 'completed') {
      statusTasks = [...statusTasks].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }
    acc[status] = statusTasks;
    return acc;
  }, {} as Record<string, Task[]>);

  const totalFiltered = filteredTasks.length;
  const totalTasks = tasks.length;

  if (isLoading) {
    return <div className="loading">Loading tasks...</div>;
  }

  return (
    <div className="task-board">
      <header className="page-header">
        <div>
          <h1>Task Board</h1>
          <div className="header-meta">
            {totalFiltered !== totalTasks && (
              <span className="filter-count">
                Showing {totalFiltered} of {totalTasks} tasks
              </span>
            )}
            <span className={`realtime-status ${isConnected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot" />
              {isConnected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
        <button className="add-task-btn" onClick={() => setShowCreateModal(true)}>
          <Plus size={20} />
          Add Task
        </button>
      </header>

      <TaskFilters
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
      />

      <TaskCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="board-columns">
          {STATUSES.map((status) => (
            <TaskColumn
              key={status}
              status={status}
              tasks={tasksByStatus[status]}
              onStatusChange={handleStatusChange}
              onTaskClick={handleTaskClick}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              onStatusChange={() => {}}
              onClick={() => {}}
              isDragOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedTaskId && (
        <TaskDetail
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
