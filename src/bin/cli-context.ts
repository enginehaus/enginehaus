/**
 * Shared CLI context passed to extracted command modules.
 *
 * When adding a new command module:
 * 1. Create src/bin/commands/your-commands.ts
 * 2. Export a register(program, ctx) function
 * 3. Import and call it from enginehaus.ts
 */

import { Command } from 'commander';
import { CoordinationService } from '../core/services/coordination-service.js';
import { SQLiteStorageService } from '../storage/sqlite-storage-service.js';
import { Project, UnifiedTask } from '../coordination/types.js';

export interface CommandSpec {
  command: string;
  description: string;
  example: string;
  altExamples?: string[];
  args: Array<{ name: string; required: boolean; description: string; flag?: string }>;
  options: Array<{ flags: string; description: string; required: boolean }>;
}

export interface CliContext {
  coordination: CoordinationService;
  storage?: SQLiteStorageService;
  resolveProject: () => Promise<Project | null>;
  getProjectId: () => Promise<string>;
  resolveTaskById: (taskId: string, projectId?: string) => Promise<UnifiedTask | null>;
  displayRelatedLearnings: (taskId: string) => Promise<void>;
  registerCommand: (spec: CommandSpec) => void;
}

export type CommandRegistrar = (program: Command, ctx: CliContext) => void;
