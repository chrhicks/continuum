import { list_tasks_for_directory } from '../task/tasks.service'
import type {
  Task as SdkTask,
  TaskGraphQuery as SdkTaskGraphQuery,
  TaskGraphResult as SdkTaskGraphResult,
} from './types'
import { map_task } from './mappers'

async function list_all_tasks(directory: string): Promise<SdkTask[]> {
  const tasks: SdkTask[] = []
  let cursor: string | undefined
  do {
    const result = await list_tasks_for_directory(directory, {
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

export async function query_task_graph(
  directory: string,
  query: SdkTaskGraphQuery,
  taskId: string,
): Promise<SdkTaskGraphResult> {
  if (query === 'children') {
    const result = await list_tasks_for_directory(directory, {
      parent_id: taskId,
      limit: 1000,
    })
    return { taskIds: result.tasks.map((task) => task.id) }
  }

  const tasks = await list_all_tasks(directory)
  if (query === 'ancestors') {
    return { taskIds: collect_ancestors(tasks, taskId) }
  }
  return { taskIds: collect_descendants(tasks, taskId) }
}
