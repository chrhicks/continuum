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
import type { TaskStatus } from '../task/types'
import { ContinuumError, isContinuumError } from '../task/error'
import { is_valid_task_type, TASK_TYPES } from '../task/templates'
import { validate_status_transition } from '../task/validation'
import { query_task_graph } from './graph'
import {
  map_create_input,
  map_list_status,
  map_task,
  map_update_input,
} from './mappers'
import type {
  CompleteTaskInput as SdkCompleteTaskInput,
  ContinuumSDK,
  CreateTaskInput as SdkCreateTaskInput,
  InitStatus as SdkInitStatus,
  ListTasksOptions as SdkListTasksOptions,
  ListTasksResult as SdkListTasksResult,
  TaskGraphQuery as SdkTaskGraphQuery,
  TaskGraphResult as SdkTaskGraphResult,
  TaskNoteInput as SdkTaskNoteInput,
  TaskStatus as SdkTaskStatus,
  TaskStep as SdkTaskStep,
  TaskStepCompleteResult as SdkTaskStepCompleteResult,
  TaskStepInput as SdkTaskStepInput,
  UpdateTaskInput as SdkUpdateTaskInput,
  TaskValidationResult as SdkTaskValidationResult,
  Task as SdkTask,
} from './types'

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
      return query_task_graph(get_directory(), query, taskId)
    },
    steps: {
      add: async (
        taskId: string,
        input: { steps: SdkTaskStepInput[] },
      ): Promise<SdkTask> => {
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
      ): Promise<SdkTask> => {
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
      ): Promise<SdkTaskStepCompleteResult> => {
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
      ): Promise<SdkTask> => {
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
