import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { ChevronDown, FolderOpen, Check } from 'lucide-react';
import './ProjectSwitcher.css';

export function ProjectSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
  });

  const { data: activeData } = useQuery({
    queryKey: ['activeProject'],
    queryFn: () => api.projects.getActive(),
  });

  const activateMutation = useMutation({
    mutationFn: (projectId: string) => api.projects.activate(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeProject'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['decisions'] });
      setIsOpen(false);
    },
  });

  const projects = projectsData?.projects || [];
  const activeProject = activeData?.project;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (projectId: string) => {
    if (projectId !== activeProject?.id) {
      activateMutation.mutate(projectId);
    } else {
      setIsOpen(false);
    }
  };

  return (
    <div className="project-switcher" ref={dropdownRef}>
      <button
        className={`switcher-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="project-name">
          {activeProject?.name || 'Select Project'}
        </span>
        <ChevronDown size={14} className="chevron" />
      </button>

      {isOpen && (
        <div className="switcher-dropdown">
          <div className="dropdown-header">
            <span>Switch Project</span>
          </div>
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  className={`project-option ${project.id === activeProject?.id ? 'active' : ''}`}
                  onClick={() => handleSelect(project.id)}
                >
                  <FolderOpen size={16} />
                  <span className="option-name">{project.name}</span>
                  {project.techStack && project.techStack.length > 0 && (
                    <span className="option-tech">{project.techStack.join(', ')}</span>
                  )}
                  {project.id === activeProject?.id && (
                    <Check size={16} className="check-icon" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {projects.length === 0 && (
            <div className="empty-projects">
              No projects found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
