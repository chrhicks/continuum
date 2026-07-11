import { map_create_input, map_task, map_update_input } from '../sdk/mappers'
import { query_task_graph } from '../sdk/graph'
import type {
  CreateTaskInput,
  ListTasksOptions,
  Task,
  TaskGraphQuery,
  TaskStatus,
  TaskStep,
  TaskStepInput,
  UpdateTaskInput,
} from '../sdk/types'
import { ContinuumError } from '../task/error'
import {
  add_decision_for_directory,
  add_discovery_for_directory,
  add_steps_for_directory,
  complete_step_for_directory,
  complete_task_for_directory,
  create_task_for_directory,
  delete_task_for_directory,
  get_open_blockers_for_directory,
  get_task_for_directory,
  list_tasks_for_directory,
  update_step_for_directory,
  update_task_for_directory,
} from '../task/tasks.service'
import { validate_status_transition } from '../task/validation'
import { getMappedTask, parseStepId, requireTask } from './task-tool-util'
import { resolveMcpWorkspace } from './tools'

export async function listMcpTasks(input: {
  workspace: string
  options?: ListTasksOptions
}): Promise<{ workspace: string; tasks: Task[]; nextCursor?: string }> {
  const context = resolveMcpWorkspace(input.workspace)
  const options = input.options ?? {}
  const result = await list_tasks_for_directory(context.workspaceRoot, {
    status: options.status,
    type: options.type,
    parent_id: options.parentId,
    includeDeleted: options.includeDeleted,
    cursor: options.cursor,
    limit: options.limit,
    sort: options.sort,
    order: options.order,
  })
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
  const context = resolveMcpWorkspace(input.workspace)
  const task = await requireTask(context.workspaceRoot, input.id)
  const expand = new Set(input.expand ?? [])
  const parent =
    expand.has('parent') && task.parentId
      ? await getMappedTask(context.workspaceRoot, task.parentId)
      : undefined
  const children = expand.has('children')
    ? (
        await listMcpTasks({
          workspace: context.workspaceRoot,
          options: {
            parentId: task.id,
            includeDeleted: input.includeDeleted,
            limit: 1000,
          },
        })
      ).tasks
    : undefined
  const blockers = expand.has('blockers')
    ? (
        await Promise.all(
          task.blockedBy.map((id) => getMappedTask(context.workspaceRoot, id)),
        )
      ).filter((item): item is Task => item !== null)
    : undefined
  return { workspace: context.workspaceRoot, task, parent, children, blockers }
}

export async function createMcpTask(input: {
  workspace: string
  task: CreateTaskInput
}): Promise<{ workspace: string; task: Task }> {
  const context = resolveMcpWorkspace(input.workspace)
  const task = await create_task_for_directory(
    context.workspaceRoot,
    map_create_input(input.task),
  )
  return { workspace: context.workspaceRoot, task: map_task(task) }
}

export async function updateMcpTask(input: {
  workspace: string
  id: string
  patch: UpdateTaskInput
}): Promise<{ workspace: string; task: Task }> {
  const context = resolveMcpWorkspace(input.workspace)
  const task = await update_task_for_directory(
    context.workspaceRoot,
    input.id,
    map_update_input(input.patch),
  )
  return { workspace: context.workspaceRoot, task: map_task(task) }
}

export async function completeMcpTask(input: {
  workspace: string
  id: string
  outcome: string
}): Promise<{ workspace: string; task: Task }> {
  const context = resolveMcpWorkspace(input.workspace)
  const task = await complete_task_for_directory(context.workspaceRoot, {
    task_id: input.id,
    outcome: input.outcome,
  })
  return { workspace: context.workspaceRoot, task: map_task(task) }
}

export async function deleteMcpTask(input: {
  workspace: string
  id: string
}): Promise<{ workspace: string; deleted: true; id: string }> {
  const context = resolveMcpWorkspace(input.workspace)
  await delete_task_for_directory(context.workspaceRoot, input.id)
  return { workspace: context.workspaceRoot, deleted: true, id: input.id }
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
  const context = resolveMcpWorkspace(input.workspace)
  const raw = await get_task_for_directory(context.workspaceRoot, input.id)
  if (!raw) throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  const missingFields = validate_status_transition(raw, input.transition)
  const openBlockers =
    input.transition === 'completed'
      ? await get_open_blockers_for_directory(context.workspaceRoot, input.id)
      : []
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
  const context = resolveMcpWorkspace(input.workspace)
  const result = await query_task_graph(
    context.workspaceRoot,
    input.query,
    input.id,
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
  const context = resolveMcpWorkspace(input.workspace)
  const task = await requireTask(context.workspaceRoot, input.id)
  return { workspace: context.workspaceRoot, id: input.id, steps: task.steps }
}

export async function addMcpTaskSteps(input: {
  workspace: string
  id: string
  steps: TaskStepInput[]
}): Promise<{ workspace: string; task: Task }> {
  const context = resolveMcpWorkspace(input.workspace)
  const task = await add_steps_for_directory(context.workspaceRoot, {
    task_id: input.id,
    steps: input.steps.map((step) => ({
      ...step,
      summary: step.summary ?? undefined,
      notes: step.notes ?? undefined,
    })),
  })
  return { workspace: context.workspaceRoot, task: map_task(task) }
}

export async function updateMcpTaskStep(input: {
  workspace: string
  id: string
  stepId: string
  patch: Partial<TaskStep>
}): Promise<{ workspace: string; task: Task }> {
  const context = resolveMcpWorkspace(input.workspace)
  const stepId = parseStepId(input.stepId)
  const patch = input.patch
  const task = await update_step_for_directory(context.workspaceRoot, {
    task_id: input.id,
    step_id: stepId,
    title: patch.title,
    description: patch.description,
    status: patch.status,
    position: patch.position,
    summary: patch.summary ?? undefined,
    notes: patch.notes ?? undefined,
  })
  return { workspace: context.workspaceRoot, task: map_task(task) }
}

export async function completeMcpTaskStep(input: {
  workspace: string
  id: string
  stepId?: string
  notes?: string
}): Promise<{ workspace: string; task: Task; warnings?: string[] }> {
  const context = resolveMcpWorkspace(input.workspace)
  const result = await complete_step_for_directory(context.workspaceRoot, {
    task_id: input.id,
    step_id: input.stepId ? parseStepId(input.stepId) : undefined,
    notes: input.notes,
  })
  return {
    workspace: context.workspaceRoot,
    task: map_task(result.task),
    warnings: result.warnings,
  }
}

export async function addMcpTaskNote(input: {
  workspace: string
  id: string
  kind: 'discovery' | 'decision'
  content: string
  source?: 'user' | 'agent' | 'system'
  rationale?: string
  impact?: string
}): Promise<{ workspace: string; task: Task }> {
  const context = resolveMcpWorkspace(input.workspace)
  const note = {
    task_id: input.id,
    content: input.content,
    source: input.source ?? 'agent',
    rationale: input.rationale,
    impact: input.impact,
  }
  const task =
    input.kind === 'discovery'
      ? await add_discovery_for_directory(context.workspaceRoot, note)
      : await add_decision_for_directory(context.workspaceRoot, note)
  return { workspace: context.workspaceRoot, task: map_task(task) }
}
