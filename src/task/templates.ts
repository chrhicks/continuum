import type { TaskType } from './types'

export const TASK_TYPES: TaskType[] = [
  'epic',
  'feature',
  'bug',
  'investigation',
  'chore',
]

export function is_valid_task_type(type: string): type is TaskType {
  return TASK_TYPES.includes(type as TaskType)
}
