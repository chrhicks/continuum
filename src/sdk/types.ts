/**
 * Task lifecycle status.
 *
 * Use when:
 * - tracking progress across sessions
 * - signaling when work can start (ready) or is blocked (blocked)
 *
 * Avoid when:
 * - representing sub-step progress (use TaskStepStatus)
 *
 * Example:
 * ```ts
 * status: 'blocked'
 * ```
 *
 * Note:
 * - 'deleted' is returned by get() after delete()
 * - use task.delete(id) to remove a task from lists
 */
export type TaskStatus =
  | 'open'
  | 'ready'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'deleted'

/**
 * Task category for routing and reporting.
 *
 * Use when:
 * - grouping tasks by type (bugs vs features)
 *
 * Avoid when:
 * - you need a lifecycle state (use TaskStatus)
 */
export type TaskType = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'

/**
 * Task is the top-level unit of work.
 *
 * Use when:
 * - you need a durable work item that spans sessions
 * - you want a single place to collect steps, discoveries, and decisions
 *
 * Avoid when:
 * - you only need a transient note (use TaskNote)
 *
 * Example (Markdown fields are shown verbosely):
 * ```ts
 * const task: Task = {
 *   id: 'task_123',
 *   title: 'Add CSV export',
 *   description: [
 *     '# Summary',
 *     'Allow users to export results as CSV from the report page.',
 *     '',
 *     '## Context',
 *     'Used by ops to share results externally.'
 *   ].join('\n'),
 *   intent: 'Enable external sharing of results',
 *   plan: [
 *     '## Plan',
 *     '- Add Export button to report page',
 *     '- Implement CSV generation on server',
 *     '- Verify with 3 sample reports'
 *   ].join('\n'),
 *   status: 'ready',
 *   type: 'feature',
 *   parentId: null,
 *   blockedBy: [],
 *   discoveries: [],
 *   decisions: [],
 *   steps: [],
 *   createdAt: '2026-02-06T12:00:00Z',
 *   updatedAt: '2026-02-06T12:00:00Z'
 * }
 * ```
 */
export interface Task {
  id: string
  title: string
  /**
   * @name description
   * @description The description of the task. This should be a short description of the task.
   * - This should be used to provide a high-level overview of the task and its purpose.
   * - This should include any relevant context for the task.
   *
   * Use when:
   * - you need a concise, durable summary
   *
   * Avoid when:
   * - writing step-by-step plans or verification checklists (use plan or steps)
   * Format: Markdown
   */
  description: string
  /**
   * @name intent
   * @description The desired outcome or reason the task exists.
   *
   * Use when:
   * - capturing a single-sentence goal for the task
   */
  intent?: string | null
  /**
   * @name plan
   * @description Detailed plan, outcomes, and verification steps.
   *
   * Use when:
   * - describing the full approach in Markdown
   *
   * Avoid when:
   * - tracking atomic steps (use steps)
   * Format: Markdown
   */
  plan?: string | null
  status: TaskStatus
  type: TaskType
  parentId: string | null
  blockedBy: string[]
  /**
   * @name discoveries
   * @description The discoveries made while working on the task. Discoveries
   * represet useful knowledge gained from the task. This should be useful to inform
   * future tasks to avoid problems or improve the product.
   *
   * Use when:
   * - recording facts learned (APIs, constraints, pitfalls)
   *
   * Avoid when:
   * - recording a choice or rationale (use decisions)
   */
  discoveries: TaskDiscovery[]
  /**
   * @name decisions
   * @description The decisions made while working on the task. Includes the decision, the
   * rationale for the decision and downstream impact of the decision. This should be useful
   * to inform future decisions to avoid problems or improve the product.
   *
   * Use when:
   * - documenting a choice and why it was made
   *
   * Avoid when:
   * - recording raw facts without a choice (use discoveries)
   */
  decisions: TaskDecision[]
  /**
   * @name steps
   * @description The steps of the task to be executed with all of the
   * information needed to complete the task. Includes files, code, verification
   * steps, etc. Each step is a separate task that can be completed independently.
   *
   * Use when:
   * - capturing actionable, ordered work items
   *
   * Avoid when:
   * - writing a narrative plan (use plan)
   *
   * Format: Markdown
   */
  steps: TaskStep[]
  createdAt: string
  updatedAt: string
  /**
   * @name outcome
   * @description What actually happened vs the plan. Captures the delta
   * between intent/plan and reality.
   *
   * Use when:
   * - recording what was actually accomplished
   * - explaining deviations from the plan
   *
   * Avoid when:
   * - describing the plan (use plan)
   *
   * Format: Markdown
   */
  outcome?: string | null
  /**
   * @name completedAt
   * @description ISO 8601 timestamp when status became 'completed'.
   */
  completedAt?: string | null
}

/**
 * TaskNote is a generic record for comments, discoveries, and decisions.
 *
 * Use when:
 * - adding short, durable notes that explain work
 *
 * Avoid when:
 * - representing tasks or steps (use Task or TaskStep)
 *
 * Example:
 * ```ts
 * const note: TaskNote = {
 *   id: 'note_1',
 *   content: 'API rate limit is 100 req/min',
 *   impact: 'Batch requests to avoid throttling',
 *   source: 'agent',
 *   createdAt: '2026-02-06T12:00:00Z',
 *   updatedAt: '2026-02-06T12:00:00Z'
 * }
 * ```
 */
export interface TaskNote {
  id: string
  content: string
  source: 'user' | 'agent' | 'system'
  rationale?: string | null
  impact?: string | null
  createdAt: string
  updatedAt: string
}

export type TaskDiscovery = TaskNote
export type TaskDecision = TaskNote

export type TaskStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

/**
 * Step within a task, usually ordered.
 *
 * Use when:
 * - breaking a task into executable units
 *
 * Avoid when:
 * - you only need a high-level plan (use Task.plan)
 */
export interface TaskStep {
  id: string
  /**
   * @name status
   * @description The status of the step.
   */
  status: TaskStepStatus
  /**
   * @name position
   * @description Optional ordering position for the step.
   *
   * Use when:
   * - you need deterministic ordering across sessions
   */
  position?: number | null
  /**
   * @name title
   * @description Short description of the step.
   */
  title: string
  /**
   * @name description
   * @description Long description of the step. Include specific implementation details,
   * verification steps, etc.
   *
   * Format: Markdown
   */
  description: string
  /**
   * @name summary
   * @description Brief summary of what was done in this step.
   */
  summary?: string | null
  /**
   * @name notes
   * @description Additional notes about this step.
   */
  notes?: string | null
}

export interface InitStatus {
  success: boolean
  pluginDirExists: boolean
  dbFileExists: boolean
  initialized: boolean
  created: boolean
}

/**
 * Query options for listing tasks.
 *
 * Use when:
 * - narrowing results for an agent session
 *
 * Avoid when:
 * - you need a specific task (use get)
 *
 * Example:
 * ```ts
 * await sdk.task.list({
 *   status: 'ready',
 *   sort: 'updatedAt',
 *   order: 'desc',
 *   limit: 20
 * })
 * ```
 */
export interface ListTasksOptions {
  status?: TaskStatus
  type?: TaskType
  parentId?: string | null
  includeDeleted?: boolean
  cursor?: string
  limit?: number
  sort?: 'createdAt' | 'updatedAt'
  order?: 'asc' | 'desc'
}

/**
 * Result from listing tasks with pagination.
 */
export interface ListTasksResult {
  tasks: Task[]
  nextCursor?: string
}

/**
 * Create input for a task.
 *
 * Use when:
 * - creating a new durable work item
 *
 * Avoid when:
 * - updating an existing task (use update)
 *
 * Example:
 * ```ts
 * await sdk.task.create({
 *   title: 'Fix login redirect',
 *   type: 'bug',
 *   description: [
 *     '# Summary',
 *     'After login, users are sent to / instead of /dashboard.'
 *   ].join('\n'),
 *   intent: 'Restore expected post-login flow'
 * })
 * ```
 */
export interface CreateTaskInput {
  title: string
  type: TaskType
  status?: TaskStatus
  intent?: string | null
  description: string
  plan?: string | null
  parentId?: string | null
  blockedBy?: string[] | null
}

/**
 * Input for adding a new step.
 *
 * Use when:
 * - adding executable units to a task
 *
 * Avoid when:
 * - only changing status or title (use update with Partial<TaskStep>)
 */
export interface TaskStepInput {
  title: string
  description: string
  status?: TaskStepStatus
  position?: number | null
  summary?: string | null
  notes?: string | null
}

/**
 * Input for adding a discovery or decision.
 *
 * Use when:
 * - logging facts, decisions, or rationale
 *
 * Avoid when:
 * - adding a task step (use TaskStepInput)
 */
export interface TaskNoteInput {
  content: string
  source: 'user' | 'agent' | 'system'
  rationale?: string | null
  impact?: string | null
}

export interface CompleteTaskInput {
  outcome: string
}

export type TaskGraphQuery = 'ancestors' | 'descendants' | 'children'

export interface TaskGraphResult {
  taskIds: string[]
}

export interface TaskValidationResult {
  missingFields: string[]
  openBlockers: string[]
}

/**
 * Patch operations for nested collections on a task.
 *
 * Use when:
 * - adding, updating, and deleting in one call
 *
 * Avoid when:
 * - you only need to change task fields (omit collection patches)
 *
 * Example:
 * ```ts
 * await sdk.task.update(taskId, {
 *   steps: {
 *     add: [
 *       {
 *         title: 'Update API handler',
 *         description: 'Add CSV output format and tests',
 *         position: 1
 *       }
 *     ],
 *     update: [
 *       { id: 'step_2', status: 'completed' }
 *     ],
 *     delete: ['step_3']
 *   },
 *   discoveries: {
 *     add: [
 *       { content: 'CSV export needs RFC4180 quoting', source: 'agent' }
 *     ]
 *   }
 * })
 * ```
 */
export interface CollectionPatch<TAdd, TUpdate> {
  add?: TAdd[]
  update?: (TUpdate & { id: string })[]
  delete?: string[]
}

export interface ContinuumSDK {
  task: {
    /**
     * Initialize the task system.
     *
     * Use when:
     * - first run in a new workspace
     */
    init: () => Promise<InitStatus>
    /**
     * List tasks with optional filtering and pagination.
     *
     * Use when:
     * - retrieving multiple tasks for an agent session
     */
    list: (options?: ListTasksOptions) => Promise<ListTasksResult>
    /**
     * Get a single task by id.
     *
     * Use when:
     * - you already know the task id
     */
    get: (id: string) => Promise<Task | null>
    /**
     * Create a new task.
     *
     * Use when:
     * - starting new work or tracking a new issue
     */
    create: (input: CreateTaskInput) => Promise<Task>
    /**
     * Update task fields and/or nested collections.
     *
     * Use when:
     * - adding steps, discoveries, or decisions
     * - changing status or metadata
     *
     * Avoid when:
     * - deleting a task (use delete)
     */
    update: (
      id: string,
      input?: {
        title?: string
        description?: string
        intent?: string | null
        plan?: string | null
        status?: TaskStatus
        type?: TaskType
        parentId?: string | null
        blockedBy?: string[] | null
        steps?: CollectionPatch<TaskStepInput, Partial<TaskStep>>
        discoveries?: CollectionPatch<TaskNoteInput, Partial<TaskDiscovery>>
        decisions?: CollectionPatch<TaskNoteInput, Partial<TaskDecision>>
      },
    ) => Promise<Task>
    /**
     * Complete a task with an outcome.
     *
     * Use when:
     * - finalizing a task and capturing what happened
     */
    complete: (id: string, input: CompleteTaskInput) => Promise<Task>
    /**
     * Delete a task.
     *
     * Use when:
     * - removing a task that should no longer appear in lists
     */
    delete: (id: string) => Promise<void>
    validateTransition: (
      id: string,
      nextStatus: TaskStatus,
    ) => Promise<TaskValidationResult>
    graph: (query: TaskGraphQuery, taskId: string) => Promise<TaskGraphResult>
    steps: {
      add: (taskId: string, input: { steps: TaskStepInput[] }) => Promise<Task>
      update: (
        taskId: string,
        stepId: string,
        input: Partial<TaskStep>,
      ) => Promise<Task>
      complete: (
        taskId: string,
        input?: { stepId?: string; notes?: string },
      ) => Promise<Task>
    }
    notes: {
      add: (
        taskId: string,
        input: TaskNoteInput & { kind: 'discovery' | 'decision' },
      ) => Promise<Task>
    }
  }
}
