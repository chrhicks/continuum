import { query_task_graph } from '../sdk/graph'
import { map_task } from '../sdk/mappers'
import type {
  ListTasksOptions,
  Task,
  TaskGraphQuery,
  TaskStatus,
  TaskStep,
} from '../sdk/types'
import { ContinuumError } from '../task/error'
import {
  load_task_view_for_directory,
  validate_task_transition_for_directory,
} from '../task/task-inspection.service'
import { list_tasks_for_directory } from '../task/tasks.service'
import { requireTask } from './task-tool-util'
import { resolveReadOnlyMcpWorkspace } from './tools'

const readOnlyTaskAccess = { readOnly: true } as const

export async function listMcpTasks(input: {
  workspace: string
  options?: ListTasksOptions
}): Promise<{ workspace: string; tasks: Task[]; nextCursor?: string }> {
  const context = resolveReadOnlyMcpWorkspace(input.workspace)
  const options = input.options ?? {}
  const result = await list_tasks_for_directory(
    context.workspaceRoot,
    {
      status: options.status,
      type: options.type,
      parent_id: options.parentId,
      includeDeleted: options.includeDeleted,
      cursor: options.cursor,
      limit: options.limit,
      sort: options.sort,
      order: options.order,
    },
    readOnlyTaskAccess,
  )
  return {
    workspace: context.workspaceRoot,
    tasks: result.tasks.map(map_task),
    nextCursor: result.nextCursor,
  }
}

export async function getMcpTask(input: {
  workspace: string
  id: string
  expand?: Array<'parent' | 'children' | 'blockers'>
  includeDeleted?: boolean
}): Promise<{
  workspace: string
  task: Task
  parent?: Task | null
  children?: Task[]
  blockers?: Task[]
}> {
  const context = resolveReadOnlyMcpWorkspace(input.workspace)
  const expand = new Set(input.expand ?? [])
  const view = await load_task_view_for_directory(
    context.workspaceRoot,
    input.id,
    {
      parent: expand.has('parent'),
      children: expand.has('children'),
      blockers: expand.has('blockers'),
      includeDeleted: input.includeDeleted,
    },
    readOnlyTaskAccess,
  )
  if (!view) throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  return {
    workspace: context.workspaceRoot,
    task: map_task(view.task),
    parent: view.parent ? map_task(view.parent) : view.parent,
    children: view.children?.map(map_task),
    blockers: view.blockers?.map(map_task),
  }
}

export async function validateMcpTask(input: {
  workspace: string
  id: string
  transition: Exclude<TaskStatus, 'deleted'>
}): Promise<{
  workspace: string
  id: string
  transition: Exclude<TaskStatus, 'deleted'>
  valid: boolean
  missingFields: string[]
  openBlockers: string[]
}> {
  const context = resolveReadOnlyMcpWorkspace(input.workspace)
  const { missingFields, openBlockers } =
    await validate_task_transition_for_directory(
      context.workspaceRoot,
      input.id,
      input.transition,
      readOnlyTaskAccess,
    )
  return {
    workspace: context.workspaceRoot,
    id: input.id,
    transition: input.transition,
    valid: missingFields.length === 0 && openBlockers.length === 0,
    missingFields,
    openBlockers,
  }
}

export async function graphMcpTasks(input: {
  workspace: string
  id: string
  query: TaskGraphQuery
}): Promise<{
  workspace: string
  id: string
  query: TaskGraphQuery
  taskIds: string[]
}> {
  const context = resolveReadOnlyMcpWorkspace(input.workspace)
  const result = await query_task_graph(
    context.workspaceRoot,
    input.query,
    input.id,
    readOnlyTaskAccess,
  )
  return {
    workspace: context.workspaceRoot,
    id: input.id,
    query: input.query,
    taskIds: result.taskIds,
  }
}

export async function listMcpTaskSteps(input: {
  workspace: string
  id: string
}): Promise<{ workspace: string; id: string; steps: TaskStep[] }> {
  const context = resolveReadOnlyMcpWorkspace(input.workspace)
  const task = await requireTask(
    context.workspaceRoot,
    input.id,
    readOnlyTaskAccess,
  )
  return { workspace: context.workspaceRoot, id: input.id, steps: task.steps }
}
