import { init_project, init_status } from '../task/util'
import {
  complete_task_for_directory,
  create_task_for_directory,
  delete_task_for_directory,
  get_task_for_directory,
  list_tasks_for_directory,
  update_task_for_directory,
} from '../task/tasks.service'
import type { Decision, Discovery, Step, Task, TaskStatus } from '../task/types'
import { isContinuumError } from '../task/error'
import { is_valid_task_type, TASK_TYPES } from '../task/templates'
import type {
  CollectionPatch as SdkCollectionPatch,
  CompleteTaskInput as SdkCompleteTaskInput,
  ContinuumSDK,
  CreateTaskInput as SdkCreateTaskInput,
  InitStatus as SdkInitStatus,
  ListTasksOptions as SdkListTasksOptions,
  ListTasksResult as SdkListTasksResult,
  Task as SdkTask,
  TaskDecision as SdkTaskDecision,
  TaskDiscovery as SdkTaskDiscovery,
  TaskNote as SdkTaskNote,
  TaskNoteInput as SdkTaskNoteInput,
  TaskStatus as SdkTaskStatus,
  TaskStep as SdkTaskStep,
  TaskStepInput as SdkTaskStepInput,
  TaskType as SdkTaskType,
} from './types'

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
  discoveries?: SdkCollectionPatch<SdkTaskNoteInput, Partial<SdkTaskDiscovery>>
  decisions?: SdkCollectionPatch<SdkTaskNoteInput, Partial<SdkTaskDecision>>
}

function map_step(step: Step): SdkTaskStep {
  return {
    id: String(step.id),
    status: step.status,
    position: step.position ?? null,
    title: step.title ?? '',
    description: step.description ?? step.details ?? '',
    summary: step.summary ?? null,
    notes: step.notes ?? null,
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

function map_list_status(
  value?: SdkTaskStatus,
): TaskStatus | 'deleted' | undefined {
  return value as TaskStatus | 'deleted' | undefined
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

function get_directory(): string {
  return process.cwd()
}

const continuum: ContinuumSDK = {
  task: {
    init: async (): Promise<SdkInitStatus> => {
      const directory = process.cwd()
      const initial = await init_status({ directory })
      let created = false
      if (!initial.dbFileExists) {
        await init_project({ directory })
        created = true
      }
      const finalStatus = await init_status({ directory })
      return {
        success: true,
        pluginDirExists: finalStatus.pluginDirExists,
        dbFileExists: finalStatus.dbFileExists,
        initialized: finalStatus.pluginDirExists && finalStatus.dbFileExists,
        created,
      }
    },
    list: async (
      options: SdkListTasksOptions = {},
    ): Promise<SdkListTasksResult> => {
      const includeDeleted =
        options.includeDeleted === true || options.status === 'deleted'
      const result = await list_tasks_for_directory(get_directory(), {
        status: map_list_status(options.status),
        type: options.type,
        parent_id: options.parentId,
        includeDeleted,
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
      const task = await get_task_for_directory(get_directory(), id)
      return task ? map_task(task) : null
    },
    create: async (input: SdkCreateTaskInput): Promise<SdkTask> => {
      const task = await create_task_for_directory(
        get_directory(),
        map_create_input(input),
      )
      return map_task(task)
    },
    update: async (
      id: string,
      input: SdkUpdateTaskInput = {},
    ): Promise<SdkTask> => {
      const task = await update_task_for_directory(
        get_directory(),
        id,
        map_update_input(input),
      )
      return map_task(task)
    },
    complete: async (
      id: string,
      input: SdkCompleteTaskInput,
    ): Promise<SdkTask> => {
      const task = await complete_task_for_directory(get_directory(), {
        task_id: id,
        outcome: input.outcome,
      })
      return map_task(task)
    },
    delete: async (id: string): Promise<void> => {
      await delete_task_for_directory(get_directory(), id)
    },
  },
}

export { isContinuumError, is_valid_task_type as isValidTaskType, TASK_TYPES }

export default continuum
