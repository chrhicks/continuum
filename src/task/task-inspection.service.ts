import { ContinuumError } from './error'
import {
  get_open_blockers_for_directory,
  get_task_for_directory,
  list_tasks_for_directory,
  type TaskReadOptions,
} from './tasks.service'
import type { Task, TaskStatus } from './types'
import { validate_status_transition } from './validation'

export type TaskViewExpansion = {
  parent?: boolean
  children?: boolean
  blockers?: boolean
  includeDeleted?: boolean
}

export type TaskView = {
  task: Task
  parent?: Task | null
  children?: Task[]
  blockers?: Task[]
}

export type TaskTransitionReadiness = {
  missingFields: string[]
  openBlockers: string[]
}

export async function load_task_view_for_directory(
  directory: string,
  taskId: string,
  expansion: TaskViewExpansion = {},
  options: TaskReadOptions = {},
): Promise<TaskView | null> {
  const task = await get_task_for_directory(directory, taskId, options)
  if (!task) return null

  const parent =
    expansion.parent && task.parent_id
      ? await get_task_for_directory(directory, task.parent_id, options)
      : undefined
  const children = expansion.children
    ? (
        await list_tasks_for_directory(
          directory,
          {
            parent_id: task.id,
            includeDeleted: expansion.includeDeleted,
            limit: 1000,
          },
          options,
        )
      ).tasks
    : undefined
  const blockers = expansion.blockers
    ? (
        await Promise.all(
          task.blocked_by.map((id) =>
            get_task_for_directory(directory, id, options),
          ),
        )
      ).filter((item): item is Task => item !== null)
    : undefined

  return { task, parent, children, blockers }
}

export async function validate_task_transition_for_directory(
  directory: string,
  taskId: string,
  nextStatus: TaskStatus,
  options: TaskReadOptions = {},
): Promise<TaskTransitionReadiness> {
  const task = await get_task_for_directory(directory, taskId, options)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }
  const missingFields = validate_status_transition(task, nextStatus)
  const openBlockers =
    nextStatus === 'completed'
      ? await get_open_blockers_for_directory(directory, taskId, options)
      : []
  return { missingFields, openBlockers }
}
