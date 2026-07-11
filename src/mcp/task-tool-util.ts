import { map_task } from '../sdk/mappers'
import type { Task } from '../sdk/types'
import { ContinuumError } from '../task/error'
import { get_task_for_directory } from '../task/tasks.service'

export async function requireTask(
  directory: string,
  id: string,
): Promise<Task> {
  const task = await getMappedTask(directory, id)
  if (!task) throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  return task
}

export async function getMappedTask(
  directory: string,
  id: string,
): Promise<Task | null> {
  const task = await get_task_for_directory(directory, id)
  return task ? map_task(task) : null
}

export function parseStepId(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new ContinuumError('ITEM_NOT_FOUND', 'Invalid step id')
  return parsed
}
