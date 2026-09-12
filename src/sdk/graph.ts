import {
  list_tasks_by_statuses_for_directory,
  type TaskReadOptions,
} from '../task/tasks.service'
import type { TaskStatus } from '../task/types'
import type {
  Task as SdkTask,
  TaskGraphQuery as SdkTaskGraphQuery,
  TaskGraphResult as SdkTaskGraphResult,
} from './types'
import { map_task } from './mappers'

const GRAPH_TASK_STATUSES: TaskStatus[] = [
  'open',
  'ready',
  'blocked',
  'completed',
  'cancelled',
]

async function list_graph_tasks(
  directory: string,
  options: TaskReadOptions,
  parentId?: string,
): Promise<SdkTask[]> {
  const tasks = await list_tasks_by_statuses_for_directory(
    directory,
    { statuses: GRAPH_TASK_STATUSES, parent_id: parentId },
    options,
  )
  return tasks.map(map_task)
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
  const visited = new Set([parentId])
  const queue = [...(byParent.get(parentId) ?? [])]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.id)) continue
    visited.add(current.id)
    result.push(current.id)
    const children = byParent.get(current.id)
    if (children) queue.push(...children)
  }
  return result
}

function collect_ancestors(tasks: SdkTask[], taskId: string): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const result: string[] = []
  const visited = new Set([taskId])
  let current = byId.get(taskId)
  while (current?.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent || visited.has(parent.id)) break
    visited.add(parent.id)
    result.push(parent.id)
    current = parent
  }
  return result
}

export async function query_task_graph(
  directory: string,
  query: SdkTaskGraphQuery,
  taskId: string,
  options: TaskReadOptions = {},
): Promise<SdkTaskGraphResult> {
  if (query === 'children') {
    const tasks = await list_graph_tasks(directory, options, taskId)
    return { taskIds: tasks.map((task) => task.id) }
  }

  const tasks = await list_graph_tasks(directory, options)
  if (query === 'ancestors') {
    return { taskIds: collect_ancestors(tasks, taskId) }
  }
  return { taskIds: collect_descendants(tasks, taskId) }
}
