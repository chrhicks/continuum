export type TaskStatus =
  | 'open'
  | 'ready'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'deleted'

export type TaskType = 'epic' | 'feature' | 'bug' | 'investigation' | 'chore'

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

export interface TaskStep {
  id: string
  status: TaskStepStatus
  position?: number | null
  title: string
  description: string
  summary?: string | null
  notes?: string | null
}

export interface Task {
  id: string
  title: string
  description: string
  intent?: string | null
  plan?: string | null
  status: TaskStatus
  priority: number
  type: TaskType
  parentId: string | null
  blockedBy: string[]
  discoveries: TaskDiscovery[]
  decisions: TaskDecision[]
  steps: TaskStep[]
  createdAt: string
  updatedAt: string
  outcome?: string | null
  completedAt?: string | null
}

export interface InitStatus {
  success: boolean
  pluginDirExists: boolean
  dbFileExists: boolean
  initialized: boolean
  created: boolean
}
