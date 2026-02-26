import type {
  Task,
  TaskDecision,
  TaskDiscovery,
  TaskStatus,
  TaskStep,
  TaskStepStatus,
  TaskType,
} from './task-models'

export interface ListTasksOptions {
  status?: TaskStatus
  type?: TaskType
  parentId?: string | null
  includeDeleted?: boolean
  cursor?: string
  limit?: number
  sort?: 'createdAt' | 'updatedAt' | 'priority'
  order?: 'asc' | 'desc'
}

export interface ListTasksResult {
  tasks: Task[]
  nextCursor?: string
}

export interface CreateTaskInput {
  title: string
  type: TaskType
  status?: TaskStatus
  priority?: number | null
  intent?: string | null
  description: string
  plan?: string | null
  parentId?: string | null
  blockedBy?: string[] | null
}

export interface TaskStepInput {
  title: string
  description: string
  status?: TaskStepStatus
  position?: number | null
  summary?: string | null
  notes?: string | null
}

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

export interface TaskStepCompleteResult {
  task: Task
  warnings?: string[]
}

export interface CollectionPatch<TAdd, TUpdate> {
  add?: TAdd[]
  update?: (TUpdate & { id: string })[]
  delete?: string[]
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  intent?: string | null
  plan?: string | null
  status?: TaskStatus
  priority?: number | null
  type?: TaskType
  parentId?: string | null
  blockedBy?: string[] | null
  steps?: CollectionPatch<TaskStepInput, Partial<TaskStep>>
  discoveries?: CollectionPatch<TaskNoteInput, Partial<TaskDiscovery>>
  decisions?: CollectionPatch<TaskNoteInput, Partial<TaskDecision>>
}
