/**
 * ProjectService — extracted from CoordinationService
 *
 * All project CRUD, active project management, and project context operations.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Project,
  ProjectDomain,
  ProjectStatus,
} from '../../coordination/types.js';
import type { ServiceContext } from './service-context.js';
import { audit, resolveProjectId } from './service-context.js';
import { ConfigurationManager } from '../../config/configuration-manager.js';
import { findConfigFile } from '../../config/config-service.js';
import { expandPath } from '../../utils/paths.js';

export class ProjectService {
  constructor(
    private ctx: ServiceContext,
    private configManager: ConfigurationManager,
  ) {}

  async createProject(data: {
    name: string;
    slug?: string;
    description?: string;
    rootPath?: string;
    domain?: ProjectDomain;
    techStack?: string[];
  }): Promise<Project> {
    // Validate rootPath if provided
    if (data.rootPath) {
      const expandedPath = data.rootPath.startsWith('~')
        ? data.rootPath.replace('~', process.env.HOME || '')
        : data.rootPath;
      if (expandedPath === '/' || expandedPath === '') {
        throw new Error(`Invalid rootPath: "${data.rootPath}". Must be a specific project directory, not filesystem root.`);
      }
    }

    const now = new Date();
    const project: Project = {
      id: uuidv4(),
      name: data.name,
      slug: data.slug || data.name.toLowerCase().replace(/\s+/g, '-'),
      description: data.description,
      rootPath: data.rootPath || '',
      domain: data.domain || 'other',
      techStack: data.techStack || [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.ctx.storage.createProject(project);

    // Audit event
    await audit(this.ctx.storage, 'project.created', project.id, 'project', project.id, `Project created: ${project.name}`, { metadata: { slug: project.slug, domain: project.domain } });

    // Emit event
    if (this.ctx.events) {
      await this.ctx.events.emitProjectCreated(project, 'internal');
    }

    return project;
  }

  async createProjectWithResponse(data: {
    name: string;
    slug?: string;
    description?: string;
    rootPath?: string;
    domain?: ProjectDomain;
    techStack?: string[];
  }): Promise<{
    success: boolean;
    projectId: string;
    slug: string;
    name: string;
    message: string;
  }> {
    const project = await this.createProject(data);
    return {
      success: true,
      projectId: project.id,
      slug: project.slug,
      name: project.name,
      message: 'Project created successfully',
    };
  }

  async getProject(id: string): Promise<Project | null> {
    return this.ctx.storage.getProject(id);
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    return this.ctx.storage.getProjectBySlug(slug);
  }

  async getProjectByIdOrSlug(idOrSlug: string): Promise<{ success: boolean; project?: Project; error?: string }> {
    let project = await this.ctx.storage.getProject(idOrSlug);
    if (!project) {
      project = await this.ctx.storage.getProjectBySlug(idOrSlug);
    }

    if (!project) {
      return { success: false, error: `Project not found: ${idOrSlug}` };
    }

    return { success: true, project };
  }

  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    return this.ctx.storage.listProjects(status);
  }

  async listProjectsWithResponse(status?: ProjectStatus): Promise<{
    success: boolean;
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      status: string;
      domain?: string;
      rootPath?: string;
      techStack?: string[];
    }>;
    count: number;
  }> {
    const projects = await this.ctx.storage.listProjects(status);
    return {
      success: true,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        domain: p.domain,
        rootPath: p.rootPath,
        techStack: p.techStack,
      })),
      count: projects.length,
    };
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
    await this.ctx.storage.updateProject(id, updates);

    await audit(this.ctx.storage, 'project.updated', id, 'project', id, `Project updated: ${Object.keys(updates).join(', ')}`);

    return this.ctx.storage.getProject(id);
  }

  async updateProjectByIdOrSlug(idOrSlug: string, updates: {
    name?: string;
    description?: string;
    rootPath?: string;
    status?: ProjectStatus;
    techStack?: string[];
  }): Promise<{ success: boolean; projectId?: string; message?: string; error?: string }> {
    const { success, project, error } = await this.getProjectByIdOrSlug(idOrSlug);
    if (!success || !project) {
      return { success: false, error };
    }

    const projectUpdates: Partial<Project> = {};
    if (updates.name) projectUpdates.name = updates.name;
    if (updates.description !== undefined) projectUpdates.description = updates.description;
    if (updates.rootPath) projectUpdates.rootPath = updates.rootPath;
    if (updates.status) projectUpdates.status = updates.status;
    if (updates.techStack) projectUpdates.techStack = updates.techStack;

    await this.ctx.storage.updateProject(project.id, projectUpdates);

    return {
      success: true,
      projectId: project.id,
      message: 'Project updated successfully',
    };
  }

  async deleteProject(id: string): Promise<void> {
    await audit(this.ctx.storage, 'project.deleted', id, 'project', id, `Project deleted`);

    await this.ctx.storage.deleteProject(id);
  }

  async deleteProjectByIdOrSlug(idOrSlug: string): Promise<{ success: boolean; projectId?: string; message?: string; error?: string }> {
    const { success, project, error } = await this.getProjectByIdOrSlug(idOrSlug);
    if (!success || !project) {
      return { success: false, error };
    }

    try {
      await this.ctx.storage.deleteProject(project.id);
      return {
        success: true,
        projectId: project.id,
        message: 'Project deleted successfully',
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getActiveProject(): Promise<Project | null> {
    return this.ctx.storage.getActiveProject();
  }

  async getActiveProjectWithResponse(): Promise<{
    success: boolean;
    activeProject: {
      id: string;
      name: string;
      slug: string;
      status: string;
      domain?: string;
      rootPath?: string;
      techStack?: string[];
    } | null;
  }> {
    const activeProject = await this.ctx.storage.getActiveProject();
    return {
      success: true,
      activeProject: activeProject ? {
        id: activeProject.id,
        name: activeProject.name,
        slug: activeProject.slug,
        status: activeProject.status,
        domain: activeProject.domain,
        rootPath: activeProject.rootPath,
        techStack: activeProject.techStack,
      } : null,
    };
  }

  async setActiveProject(id: string): Promise<void> {
    await this.ctx.storage.setActiveProjectId(id);

    await audit(this.ctx.storage, 'project.activated', id, 'project', id, `Active project set`);
  }

  async setActiveProjectWithResponse(projectId: string): Promise<{
    success: boolean;
    activeProject: { id: string; name: string; slug: string } | null;
    message: string;
    configSynced?: boolean;
    configFile?: string;
  }> {
    await this.ctx.storage.setActiveProjectId(projectId);
    const activeProject = await this.ctx.storage.getActiveProject();

    // Attempt to sync configuration from file if project has rootPath
    let configSynced = false;
    let configFile: string | undefined;

    if (activeProject?.rootPath) {
      const expandedPath = expandPath(activeProject.rootPath);
      const detectedConfigFile = findConfigFile(expandedPath);

      if (detectedConfigFile) {
        try {
          const syncResult = await this.configManager.syncFromFile(
            projectId,
            detectedConfigFile,
            { changedBy: 'project-activation' }
          );
          configSynced = syncResult.success;
          configFile = detectedConfigFile;
        } catch (error) {
          // Config sync is best-effort, don't fail project activation
          console.warn(`Failed to sync config from ${detectedConfigFile}:`, error);
        }
      }
    }

    const messages: string[] = [`Active project set to: ${activeProject?.name || projectId}`];
    if (configSynced && configFile) {
      messages.push(`Configuration synced from: ${configFile}`);
    }

    return {
      success: true,
      activeProject: activeProject ? {
        id: activeProject.id,
        name: activeProject.name,
        slug: activeProject.slug,
      } : null,
      message: messages.join('. '),
      configSynced,
      configFile,
    };
  }

  async getActiveProjectContext(): Promise<{
    projectId: string;
    projectName: string;
    projectSlug: string;
    rootPath?: string;
  } | null> {
    const projectId = await this.ctx.storage.getActiveProjectId();
    if (!projectId) return null;

    const project = await this.ctx.storage.getProject(projectId);
    if (!project) return null;

    return {
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      rootPath: project.rootPath,
    };
  }

  async getActiveProjectRoot(): Promise<string | null> {
    const context = await this.getActiveProjectContext();
    return context?.rootPath || null;
  }

  /** Delegate for resolveProjectId utility */
  resolveProjectId(explicit?: string | null): Promise<string | null> {
    return resolveProjectId(this.ctx.storage, explicit);
  }
}
