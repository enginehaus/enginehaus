/**
 * Task Tool Schemas
 *
 * Schema definitions for task management MCP tools.
 */

export const getNextTaskSchema = {
  name: 'get_next_task',
  description: 'Get highest priority ready task and claim it for your session. Returns full strategic/technical context and auto-creates git branch. USE THIS TO START WORK - it handles task claiming automatically. Prefer this over browsing tasks manually.',
  inputSchema: {
    type: 'object',
    properties: {
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Filter by priority level',
      },
      status: {
        type: 'string',
        enum: ['ready', 'in-progress', 'blocked'],
        description: 'Filter by task status (optional, defaults to ready)',
      },
      sessionId: {
        type: 'string',
        description: 'Unique session identifier for tracking',
      },
      withContext: {
        type: 'boolean',
        description: 'Include file previews for task files (default: true)',
      },
      maxPreviewLines: {
        type: 'number',
        description: 'Max lines per file preview (default: 100)',
      },
    },
  },
};

export const updateTaskProgressSchema = {
  name: 'update_progress',
  description: 'Update progress during multi-phase implementations. CALL AFTER COMPLETING EACH PHASE - triggers auto-commit and records deliverables. Use for large tasks spanning multiple sessions or when you want incremental progress visible.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID being updated' },
      role: {
        type: 'string',
        enum: ['pm', 'ux', 'tech-lead', 'developer', 'qa', 'human'],
        description: 'REQUIRED: Your current role (developer, tech-lead, pm, ux, qa, human). Declaring role makes coordination visible.',
      },
      status: {
        type: 'string',
        enum: ['ready', 'in-progress', 'blocked', 'completed'],
        description: 'Current task status',
      },
      currentPhase: { type: 'number', description: 'Current implementation phase (1-8)' },
      deliverables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            status: { type: 'string' },
            description: { type: 'string' },
          },
        },
        description: 'Completed deliverables',
      },
      notes: { type: 'string', description: 'Progress notes for this update' },
      phaseCompletion: {
        type: 'string',
        description: 'Phase completion summary (triggers auto-commit)',
      },
      sessionId: { type: 'string', description: 'Session identifier' },
    },
    required: ['taskId', 'role'],
  },
};

export const completeTaskSchema = {
  name: 'complete_task',
  description: 'Mark task complete with full documentation. Requires manual entry of deliverables, decisions, and metrics. PREFER complete_task_smart instead - it auto-generates docs from git history. Use this only when you need explicit control over completion details.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID being completed' },
      implementationSummary: {
        type: 'string',
        description: 'Comprehensive implementation summary',
      },
      deliverables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            status: { type: 'string' },
            description: { type: 'string' },
          },
        },
        description: 'All completed deliverables',
      },
      qualityMetrics: {
        type: 'object',
        properties: {
          testCoverage: { type: 'string' },
          performanceBenchmarks: { type: 'string' },
          securityValidation: { type: 'string' },
          documentationComplete: { type: 'boolean' },
        },
        description: 'Quality metrics achieved',
      },
      architectureDecisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            decision: { type: 'string' },
            rationale: { type: 'string' },
            impact: { type: 'string' },
          },
        },
        description: 'Architecture decisions made',
      },
      nextSteps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Next steps for continued development',
      },
      handoffNotes: { type: 'string', description: 'Critical context for handoff' },
    },
    required: ['taskId', 'implementationSummary'],
  },
};

export const completeTaskSmartSchema = {
  name: 'complete_task_smart',
  description: 'RECOMMENDED: Complete task with auto-generated docs from git history. Accepts inline decisions and outcome to reduce tool calls. REQUIRES committed changes AND quality gates (tests, decisions) by default. Use enforceQuality: false to bypass quality checks.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID being completed' },
      role: {
        type: 'string',
        enum: ['pm', 'ux', 'tech-lead', 'developer', 'qa', 'human'],
        description: 'REQUIRED: Your role when completing the task. Default: developer for backwards compatibility.',
      },
      summary: { type: 'string', description: 'Brief natural language summary (2-3 sentences)' },
      sessionStartTime: { type: 'string', description: 'ISO timestamp when implementation started (for git analysis). Defaults to last 24 hours.' },
      enforceQuality: { type: 'boolean', description: 'When false, allows completion despite quality gaps (no tests, no decisions). Defaults to true (blocking mode). Set to false to bypass.' },
      allowUnmerged: { type: 'boolean', description: 'When true, allows completion even if the current branch is not merged to main. Defaults to false (blocking mode).' },
      decisions: {
        type: 'array',
        description: 'Inline decisions to log before completing. Eliminates the need for separate log_decision calls.',
        items: {
          type: 'object',
          properties: {
            decision: { type: 'string', description: 'What was decided' },
            rationale: { type: 'string', description: 'Why this choice was made' },
            category: {
              type: 'string',
              enum: ['architecture', 'tradeoff', 'dependency', 'pattern', 'other'],
              description: 'Decision category. Default: other',
            },
          },
          required: ['decision'],
        },
      },
      outcome: {
        type: 'object',
        description: 'Optional outcome to record at completion. Eliminates the need for a separate record_task_outcome call.',
        properties: {
          status: {
            type: 'string',
            enum: ['shipped', 'pending', 'rejected', 'rework', 'abandoned'],
            description: 'Outcome status. Default: shipped',
          },
          notes: { type: 'string', description: 'Outcome notes (what shipped, what was learned)' },
        },
      },
    },
    required: ['taskId', 'summary'],
  },
};

export const listTasksSchema = {
  name: 'list_tasks',
  description: 'List all tasks with status, priority, assignee, and git branch info, optionally filtered by status or tags.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['ready', 'in-progress', 'completed', 'all'],
        description: 'Filter by task status',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags (tasks matching ANY tag)',
      },
    },
  },
};

export const searchTasksSchema = {
  name: 'search_tasks',
  description: 'Search tasks by content across titles, descriptions, and tags. Use when you need to find tasks related to a topic.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (substring match across title, description, tags)' },
      status: {
        type: 'string',
        enum: ['ready', 'in-progress', 'completed', 'blocked', 'all'],
        description: 'Filter by status (default: all)',
      },
      limit: { type: 'number', description: 'Max results to return (default: 20)' },
    },
    required: ['query'],
  },
};

export const addTaskSchema = {
  name: 'add_task',
  description: 'Add a new task discovered during implementation. USE WHEN YOU FIND WORK OUT OF SCOPE for current task - don\'t silently do extra work. Captures strategic/UX/technical context for proper prioritization. Link to an initiative if the work supports a measurable goal.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Task title' },
      description: { type: 'string', description: 'Detailed task description' },
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Task priority',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for lightweight categorization and filtering (e.g. "oss-launch", "ax", "messaging")',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to be modified',
      },
      strategicContext: {
        type: 'object',
        properties: {
          businessRationale: { type: 'string' },
          competitiveAdvantage: { type: 'string' },
          revenueImpact: { type: 'string' },
          timeline: { type: 'string' },
        },
        description: 'Strategic business context',
      },
      uxContext: {
        type: 'object',
        properties: {
          userExperience: { type: 'string' },
          designPattern: { type: 'string' },
          progressiveDisclosure: { type: 'string' },
          technicalConstraints: { type: 'string' },
        },
        description: 'UX design context',
      },
      technicalContext: {
        type: 'object',
        properties: {
          implementation: { type: 'string' },
          architecture: { type: 'string' },
          estimatedEffort: { type: 'string' },
          qualityGates: { type: 'array', items: { type: 'string' } },
        },
        description: 'Technical implementation context',
      },
      qualityRequirements: {
        type: 'array',
        items: { type: 'string' },
        description: 'Quality and testing requirements',
      },
      mode: {
        type: 'string',
        enum: ['exclusive', 'collaborative'],
        description: 'Task mode. exclusive (default): single agent claim. collaborative: multiple agents can join and contribute.',
      },
      references: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to external resource' },
            label: { type: 'string', description: 'Human-readable label' },
            type: { type: 'string', enum: ['design', 'spec', 'pr', 'doc', 'external'], description: 'Reference type' },
          },
          required: ['url'],
        },
        description: 'External references (design docs, PRs, specs, Figma links, etc.)',
      },
    },
    required: ['title', 'description', 'priority'],
  },
};

export const updateTaskSchema = {
  name: 'update_task',
  description: 'Modify a task\'s priority, status, description, assignment, tags, or project — use when triaging, reassigning, or correcting task details.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to update' },
      title: { type: 'string', description: 'New task title' },
      description: { type: 'string', description: 'New task description' },
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'New task priority',
      },
      status: {
        type: 'string',
        enum: ['ready', 'in-progress', 'blocked', 'completed'],
        description: 'New task status',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for lightweight categorization and filtering',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Updated files list',
      },
      projectId: {
        type: 'string',
        description: 'Move task to a different project (use project ID)',
      },
      assignedTo: {
        type: 'string',
        description: 'Assign task to a specific user/agent. Tasks assigned to others are blocked from get_next_task. Use empty string to unassign.',
      },
      mode: {
        type: 'string',
        enum: ['exclusive', 'collaborative'],
        description: 'Task mode. exclusive: single agent claim. collaborative: multiple agents can join and contribute.',
      },
      writeMode: {
        type: 'string',
        enum: ['replace', 'append'],
        description: 'How to apply description updates. "replace" (default) overwrites the field. "append" adds your content below the existing description with agent attribution. Use append when contributing to a shared task.',
      },
      expectedVersion: {
        type: 'number',
        description: 'Optimistic locking. Pass the task version you last read. If the task has been modified since (version mismatch), the update is rejected with a conflict error. Get the current version from any task response.',
      },
    },
    required: ['taskId'],
  },
};

export const getStreamingSessionContextSchema = {
  name: 'get_streaming_session_context',
  description: 'Get a lightweight session snapshot (~400 tokens) with current task, phase, and next action — use when you need quick orientation without full context.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session identifier' },
      role: { type: 'string', description: 'Role requesting context' },
    },
    required: ['sessionId', 'role'],
  },
};

export const getMinimalTaskSchema = {
  name: 'get_minimal_task',
  description: 'Get a task\'s title, status, priority, and files (~200 tokens) without full strategic/UX/technical context — use for quick lookups.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to retrieve' },
    },
    required: ['taskId'],
  },
};

export const expandContextSchema = {
  name: 'expand_context',
  description: 'Fetch the full strategic, UX, or technical context for a task after starting with a minimal view — use when you need deeper detail mid-implementation.',
  inputSchema: {
    type: 'object',
    properties: {
      aspect: {
        type: 'string',
        enum: ['strategic', 'ux', 'technical', 'full'],
        description: 'Aspect of context to expand',
      },
      id: { type: 'string', description: 'ID of the entity to expand' },
    },
    required: ['aspect', 'id'],
  },
};

export const batchUpdateTasksSchema = {
  name: 'batch_update_tasks',
  description: 'Update multiple tasks in a single call. Reduces sequential update_task calls when you need to update several tasks at once (e.g., bulk status changes, priority adjustments).',
  inputSchema: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: 'Array of task updates to apply',
        items: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to update' },
            title: { type: 'string', description: 'New title' },
            description: { type: 'string', description: 'New description' },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'New priority' },
            status: { type: 'string', enum: ['ready', 'in-progress', 'blocked', 'completed'], description: 'New status' },
            assignedTo: { type: 'string', description: 'Assign to agent/user (null to unassign)' },
          },
          required: ['taskId'],
        },
      },
    },
    required: ['updates'],
  },
};

export const flagForHumanSchema = {
  name: 'flag_for_human',
  description: 'Flag a task as needing human attention. Sets status to awaiting-human and records why. Use when you hit a decision that requires human judgment, approval, or input you cannot provide.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to flag (defaults to current task if omitted)' },
      reason: { type: 'string', description: 'Why human attention is needed' },
      question: { type: 'string', description: 'Specific question for the human (optional)' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Suggested options/choices for the human (optional)',
      },
    },
    required: ['reason'],
  },
};

export const taskSchemas = [
  updateTaskProgressSchema,
  completeTaskSmartSchema,
  listTasksSchema,
  searchTasksSchema,
  addTaskSchema,
  updateTaskSchema,
  batchUpdateTasksSchema,
  flagForHumanSchema,
];
