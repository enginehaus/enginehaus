/**
 * Database Row Types
 *
 * TypeScript interfaces for SQLite row shapes returned by better-sqlite3.
 * All columns are nullable unless NOT NULL in schema; INTEGER timestamps
 * are stored as epoch milliseconds.
 */

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  root_path: string;
  domain: string;
  tech_stack: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  type: string | null;
  mode: string | null;
  tags: string | null;
  files: string | null;
  strategic_context: string | null;
  ux_context: string | null;
  technical_context: string | null;
  quality_requirements: string | null;
  implementation: string | null;
  checkpoint_phases: string | null;
  active_checkpoint_id: string | null;
  references: string | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
  assigned_to: string | null;
  last_modified_by: string | null;
  version: number;
}

export interface SessionRow {
  id: string;
  project_id: string;
  task_id: string;
  agent_id: string;
  status: string;
  start_time: number;
  end_time: number | null;
  last_heartbeat: number;
  current_phase: number | null;
  context: string;
}

export interface EventRow {
  id: string;
  type: string;
  project_id: string;
  task_id: string | null;
  user_id: string;
  agent_id: string | null;
  timestamp: number;
  data: string;
}

export interface StrategicDecisionRow {
  id: string;
  project_id: string;
  task_id: string | null;
  decision: string;
  rationale: string;
  impact: string;
  timeline: string;
  stakeholders: string;
  requirements: string | null;
  created_at: number;
  created_by: string | null;
  category: string | null;
}

export interface TechnicalPlanRow {
  id: string;
  project_id: string;
  feature: string;
  strategic_context: string | null;
  ux_context: string | null;
  technical_approach: string;
  architecture: string | null;
  estimated_effort: string | null;
  files: string;
  quality_gates: string;
  unified_tasks: string;
  created_at: number;
  created_by: string | null;
}
