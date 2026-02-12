export type TaskStatus =
  | 'open'
  | 'ready'
  | 'blocked'
  | 'completed'
  | 'cancelled'

export type TaskType = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface Step {
  id: number
  title?: string
  description?: string
  position?: number | null
  summary?: string
  details?: string
  status: StepStatus
  notes: string | null
}

export interface Discovery {
  id: number
  content: string
  source: 'user' | 'agent' | 'system'
  impact: string | null
  created_at: string
}

export interface Decision {
  id: number
  content: string
  rationale: string | null
  source: 'user' | 'agent' | 'system'
  impact: string | null
  created_at: string
}

export interface Task {
  id: string
  title: string
  type: TaskType
  status: TaskStatus | 'deleted'
  intent: string | null
  description: string | null
  plan: string | null
  steps: Step[]
  current_step: number | null
  discoveries: Discovery[]
  decisions: Decision[]
  outcome: string | null
  completed_at: string | null
  parent_id: string | null
  blocked_by: string[]
  created_at: string
  updated_at: string
}

export interface CreateTaskInput {
  title: string
  type: TaskType
  status?: TaskStatus
  intent?: string | null
  description?: string | null
  plan?: string | null
  parent_id?: string | null
  blocked_by?: string[] | null
}

export interface UpdateTaskInput {
  title?: string
  type?: TaskType
  status?: TaskStatus
  intent?: string | null
  description?: string | null
  plan?: string | null
  parent_id?: string | null
  blocked_by?: string[] | null
  steps?: CollectionPatch<StepInput, StepPatch>
  discoveries?: CollectionPatch<DiscoveryInput, DiscoveryPatch>
  decisions?: CollectionPatch<DecisionInput, DecisionPatch>
}

export interface StepInput {
  title: string
  description: string
  status?: StepStatus
  position?: number | null
  summary?: string
  details?: string
  notes?: string | null
}

export interface StepPatch {
  id: number | string
  title?: string
  description?: string
  status?: StepStatus
  position?: number | null
  summary?: string
  details?: string
  notes?: string | null
}

export interface DiscoveryInput {
  content: string
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface DiscoveryPatch {
  id: number | string
  content?: string
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface DecisionInput {
  content: string
  rationale?: string | null
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface DecisionPatch {
  id: number | string
  content?: string
  rationale?: string | null
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface CollectionPatch<TAdd, TUpdate> {
  add?: TAdd[]
  update?: TUpdate[]
  delete?: Array<number | string>
}

export interface ListTaskFilters {
  status?: TaskStatus | 'deleted'
  type?: TaskType
  parent_id?: string | null
  includeDeleted?: boolean
  cursor?: string
  limit?: number
  sort?: 'createdAt' | 'updatedAt'
  order?: 'asc' | 'desc'
}

export interface ListTasksResult {
  tasks: Task[]
  nextCursor?: string
}

export interface AddStepsInput {
  task_id: string
  steps: Array<{
    title?: string
    description?: string
    position?: number | null
    status?: StepStatus
    summary?: string
    details?: string
    notes?: string | null
  }>
}

export interface CompleteStepInput {
  task_id: string
  step_id?: number
  notes?: string
}

export interface CompleteStepResult {
  task: Task
  warnings?: string[]
}

export interface UpdateStepInput {
  task_id: string
  step_id: number
  title?: string
  description?: string
  position?: number | null
  summary?: string
  details?: string
  status?: StepStatus
  notes?: string
}

export interface AddDiscoveryInput {
  task_id: string
  content: string
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface AddDecisionInput {
  task_id: string
  content: string
  rationale?: string
  source?: 'user' | 'agent' | 'system'
  impact?: string | null
}

export interface CompleteTaskInput {
  task_id: string
  outcome: string
}
