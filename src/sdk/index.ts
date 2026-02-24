import { init_project, init_status } from '../task/util'
import {
  complete_task_for_directory,
  create_task_for_directory,
  delete_task_for_directory,
  get_task_for_directory,
  get_open_blockers_for_directory,
  list_tasks_for_directory,
  update_task_for_directory,
  add_steps_for_directory,
  complete_step_for_directory,
  update_step_for_directory,
  add_discovery_for_directory,
  add_decision_for_directory,
} from '../task/tasks.service'
import type { Decision, Discovery, Step, Task, TaskStatus } from '../task/types'
import { ContinuumError, isContinuumError } from '../task/error'
import { is_valid_task_type, TASK_TYPES } from '../task/templates'
import { validate_status_transition } from '../task/validation'
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
  TaskGraphQuery as SdkTaskGraphQuery,
  TaskGraphResult as SdkTaskGraphResult,
  TaskNote as SdkTaskNote,
  TaskNoteInput as SdkTaskNoteInput,
  TaskStatus as SdkTaskStatus,
  TaskStep as SdkTaskStep,
  TaskStepInput as SdkTaskStepInput,
  TaskValidationResult as SdkTaskValidationResult,
  TaskType as SdkTaskType,
} from './types'

type SdkUpdateTaskInput = {
  title?: string
  description?: string
  intent?: string | null
  plan?: string | null
  status?: SdkTaskStatus
  priority?: number | null
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
    priority: task.priority,
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
    priority: input.priority ?? null,
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
    priority: input.priority === undefined ? undefined : input.priority,
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
            summary: step.summary ?? undefined,
            notes: step.notes ?? undefined,
          })),
          update: input.steps.update?.map((step) => ({
            id: step.id,
            title: step.title,
            description: step.description,
            status: step.status,
            position: step.position,
            summary: step.summary ?? undefined,
            notes: step.notes ?? undefined,
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

async function list_all_tasks(): Promise<SdkTask[]> {
  const tasks: SdkTask[] = []
  let cursor: string | undefined
  do {
    const result = await list_tasks_for_directory(get_directory(), {
      cursor,
      limit: 1000,
    })
    tasks.push(...result.tasks.map(map_task))
    cursor = result.nextCursor
  } while (cursor)
  return tasks
}

function collect_descendants(tasks: SdkTask[], parentId: string): string[] {
  const byParent = new Map<string, SdkTask[]>()
  for (const task of tasks) {
    if (!task.parentId) continue
    const list = byParent.get(task.parentId) ?? []
    list.push(task)
    byParent.set(task.parentId, list)
  }

  const result: string[] = []
  const queue = [...(byParent.get(parentId) ?? [])]
  while (queue.length > 0) {
    const current = queue.shift()!
    result.push(current.id)
    const children = byParent.get(current.id)
    if (children) queue.push(...children)
  }
  return result
}

function collect_ancestors(tasks: SdkTask[], taskId: string): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const result: string[] = []
  let current = byId.get(taskId)
  while (current?.parentId) {
    result.push(current.parentId)
    current = byId.get(current.parentId)
  }
  return result
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
    validateTransition: async (
      id: string,
      nextStatus: SdkTaskStatus,
    ): Promise<SdkTaskValidationResult> => {
      if (nextStatus === 'deleted') {
        throw new ContinuumError(
          'INVALID_STATUS',
          'deleted is not a valid transition status',
        )
      }
      const task = await get_task_for_directory(get_directory(), id)
      if (!task) {
        throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
      }
      const missingFields = validate_status_transition(
        task,
        nextStatus as TaskStatus,
      )
      const openBlockers =
        nextStatus === 'completed'
          ? await get_open_blockers_for_directory(get_directory(), id)
          : []
      return { missingFields, openBlockers }
    },
    graph: async (
      query: SdkTaskGraphQuery,
      taskId: string,
    ): Promise<SdkTaskGraphResult> => {
      if (query === 'children') {
        const result = await list_tasks_for_directory(get_directory(), {
          parent_id: taskId,
          limit: 1000,
        })
        return { taskIds: result.tasks.map((task) => task.id) }
      }

      const tasks = await list_all_tasks()
      if (query === 'ancestors') {
        return { taskIds: collect_ancestors(tasks, taskId) }
      }
      return { taskIds: collect_descendants(tasks, taskId) }
    },
    steps: {
      add: async (taskId: string, input: { steps: SdkTaskStepInput[] }) => {
        const steps = input.steps.map((step) => ({
          title: step.title,
          description: step.description,
          status: step.status,
          position: step.position,
          summary: step.summary ?? undefined,
          notes: step.notes ?? undefined,
        }))
        const task = await add_steps_for_directory(get_directory(), {
          task_id: taskId,
          steps,
        })
        return map_task(task)
      },
      update: async (
        taskId: string,
        stepId: string,
        input: Partial<SdkTaskStep>,
      ) => {
        const parsedStepId = Number(stepId)
        if (!Number.isFinite(parsedStepId)) {
          throw new ContinuumError('ITEM_NOT_FOUND', 'Invalid step id')
        }
        const task = await update_step_for_directory(get_directory(), {
          task_id: taskId,
          step_id: parsedStepId,
          title: input.title,
          description: input.description,
          position: input.position,
          summary: input.summary ?? undefined,
          status: input.status,
          notes: input.notes ?? undefined,
        })
        return map_task(task)
      },
      complete: async (
        taskId: string,
        input: { stepId?: string; notes?: string } = {},
      ) => {
        const stepId = input.stepId ? Number(input.stepId) : undefined
        if (input.stepId && !Number.isFinite(stepId)) {
          throw new ContinuumError('ITEM_NOT_FOUND', 'Invalid step id')
        }
        const result = await complete_step_for_directory(get_directory(), {
          task_id: taskId,
          step_id: stepId,
          notes: input.notes,
        })
        return { task: map_task(result.task), warnings: result.warnings }
      },
    },
    notes: {
      add: async (
        taskId: string,
        input: SdkTaskNoteInput & { kind: 'discovery' | 'decision' },
      ) => {
        if (input.kind === 'discovery') {
          const task = await add_discovery_for_directory(get_directory(), {
            task_id: taskId,
            content: input.content,
            source: input.source,
            impact: input.impact,
          })
          return map_task(task)
        }
        const task = await add_decision_for_directory(get_directory(), {
          task_id: taskId,
          content: input.content,
          rationale: input.rationale ?? undefined,
          source: input.source,
          impact: input.impact,
        })
        return map_task(task)
      },
    },
  },
}

export { isContinuumError, is_valid_task_type as isValidTaskType, TASK_TYPES }

export default continuum
