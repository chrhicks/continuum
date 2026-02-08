import { init_project, init_status } from '../task/util'
import {
  create_task,
  delete_task,
  get_db,
  get_task,
  list_tasks,
  update_task,
  type Decision,
  type Discovery,
  type Step,
  type Task,
  type TaskStatus,
  type TaskType,
} from '../task/db'

type TaskNoteSource = 'user' | 'agent' | 'system'

type SdkTaskStatus =
  | 'open'
  | 'ready'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'deleted'

type SdkTaskType = TaskType

type SdkTaskStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

type SdkTaskNote = {
  id: string
  content: string
  source: TaskNoteSource
  rationale?: string | null
  impact?: string | null
  createdAt: string
  updatedAt: string
}

type SdkTaskStep = {
  id: string
  status: SdkTaskStepStatus
  position?: number | null
  title: string
  description: string
}

type SdkTask = {
  id: string
  title: string
  description: string
  intent?: string | null
  plan?: string | null
  status: SdkTaskStatus
  type: SdkTaskType
  parentId: string | null
  blockedBy: string[]
  discoveries: SdkTaskNote[]
  decisions: SdkTaskNote[]
  steps: SdkTaskStep[]
  createdAt: string
  updatedAt: string
  outcome?: string | null
  completedAt?: string | null
}

type SdkListTasksOptions = {
  status?: SdkTaskStatus
  type?: SdkTaskType
  cursor?: string
  limit?: number
  sort?: 'createdAt' | 'updatedAt'
  order?: 'asc' | 'desc'
}

type SdkListTasksResult = {
  tasks: SdkTask[]
  nextCursor?: string
}

type SdkCreateTaskInput = {
  title: string
  type: SdkTaskType
  status?: SdkTaskStatus
  intent?: string | null
  description: string
  plan?: string | null
  parentId?: string | null
  blockedBy?: string[] | null
}

type SdkTaskStepInput = {
  title: string
  description: string
  status?: SdkTaskStepStatus
  position?: number | null
}

type SdkTaskNoteInput = {
  content: string
  source: TaskNoteSource
  rationale?: string | null
  impact?: string | null
}

type SdkCollectionPatch<TAdd, TUpdate> = {
  add?: TAdd[]
  update?: (TUpdate & { id: string })[]
  delete?: string[]
}

type SdkUpdateTaskInput = {
  title?: string
  description?: string
  intent?: string | null
  plan?: string | null
  status?: SdkTaskStatus
  type?: SdkTaskType
  parentId?: string | null
  blockedBy?: string[] | null
  steps?: SdkCollectionPatch<SdkTaskStepInput, Partial<SdkTaskStep>>
  discoveries?: SdkCollectionPatch<SdkTaskNoteInput, Partial<SdkTaskNote>>
  decisions?: SdkCollectionPatch<SdkTaskNoteInput, Partial<SdkTaskNote>>
}

type SdkInitStatus = {
  success: boolean
}

function map_step(step: Step): SdkTaskStep {
  return {
    id: String(step.id),
    status: step.status,
    position: step.position ?? null,
    title: step.title ?? '',
    description: step.description ?? step.details ?? '',
  }
}

function map_note(note: Discovery | Decision): SdkTaskNote {
  return {
    id: String(note.id),
    content: note.content,
    source: note.source,
    rationale: 'rationale' in note ? (note.rationale ?? null) : null,
    impact: note.impact ?? null,
    createdAt: note.created_at,
    updatedAt: note.created_at,
  }
}

function map_task(task: Task): SdkTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    intent: task.intent ?? null,
    plan: task.plan ?? null,
    status: task.status as SdkTaskStatus,
    type: task.type,
    parentId: task.parent_id,
    blockedBy: task.blocked_by,
    discoveries: task.discoveries.map(map_note),
    decisions: task.decisions.map(map_note),
    steps: task.steps.map(map_step),
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    outcome: task.outcome ?? null,
    completedAt: task.completed_at ?? null,
  }
}

function map_status(value?: SdkTaskStatus): TaskStatus | undefined {
  if (!value || value === 'deleted') return undefined
  return value as TaskStatus
}

function map_create_input(input: SdkCreateTaskInput) {
  return {
    title: input.title,
    type: input.type,
    status: map_status(input.status),
    intent: input.intent ?? null,
    description: input.description,
    plan: input.plan ?? null,
    parent_id: input.parentId ?? null,
    blocked_by: input.blockedBy ?? null,
  }
}

function map_update_input(input: SdkUpdateTaskInput) {
  return {
    title: input.title,
    description: input.description,
    intent: input.intent,
    plan: input.plan,
    status: map_status(input.status),
    type: input.type,
    parent_id: input.parentId === undefined ? undefined : input.parentId,
    blocked_by: input.blockedBy === undefined ? undefined : input.blockedBy,
    steps: input.steps
      ? {
          add: input.steps.add?.map((step) => ({
            title: step.title,
            description: step.description,
            status: step.status,
            position: step.position,
          })),
          update: input.steps.update?.map((step) => ({
            id: step.id,
            title: step.title,
            description: step.description,
            status: step.status,
            position: step.position,
          })),
          delete: input.steps.delete,
        }
      : undefined,
    discoveries: input.discoveries
      ? {
          add: input.discoveries.add?.map((note) => ({
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          update: input.discoveries.update?.map((note) => ({
            id: note.id,
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          delete: input.discoveries.delete,
        }
      : undefined,
    decisions: input.decisions
      ? {
          add: input.decisions.add?.map((note) => ({
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          update: input.decisions.update?.map((note) => ({
            id: note.id,
            content: note.content,
            source: note.source,
            rationale: note.rationale,
            impact: note.impact,
          })),
          delete: input.decisions.delete,
        }
      : undefined,
  }
}

async function get_db_for_cwd() {
  return get_db(process.cwd())
}

const continuum = {
  task: {
    init: async (): Promise<SdkInitStatus> => {
      const directory = process.cwd()
      const status = await init_status({ directory })
      if (!status.dbFileExists) {
        await init_project({ directory })
      }
      return { success: true }
    },
    list: async (
      options: SdkListTasksOptions = {},
    ): Promise<SdkListTasksResult> => {
      const db = await get_db_for_cwd()
      const result = await list_tasks(db, {
        status: map_status(options.status),
        type: options.type,
        cursor: options.cursor,
        limit: options.limit,
        sort: options.sort,
        order: options.order,
      })
      return {
        tasks: result.tasks.map(map_task),
        nextCursor: result.nextCursor,
      }
    },
    get: async (id: string): Promise<SdkTask | null> => {
      const db = await get_db_for_cwd()
      const task = await get_task(db, id)
      return task ? map_task(task) : null
    },
    create: async (input: SdkCreateTaskInput): Promise<SdkTask> => {
      const db = await get_db_for_cwd()
      const task = await create_task(db, map_create_input(input))
      return map_task(task)
    },
    update: async (
      id: string,
      input: SdkUpdateTaskInput = {},
    ): Promise<SdkTask> => {
      const db = await get_db_for_cwd()
      const task = await update_task(db, id, map_update_input(input))
      return map_task(task)
    },
    delete: async (id: string): Promise<void> => {
      const db = await get_db_for_cwd()
      await delete_task(db, id)
    },
  },
}

export default continuum
