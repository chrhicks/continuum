import { map_create_input, map_task, map_update_input } from '../sdk/mappers'
import type {
  CreateTaskInput,
  Task,
  TaskStep,
  TaskStepInput,
  UpdateTaskInput,
} from '../sdk/types'
import {
  add_decision_for_directory,
  add_discovery_for_directory,
  add_steps_for_directory,
  complete_step_for_directory,
  complete_task_for_directory,
  create_task_for_directory,
  delete_task_for_directory,
  update_step_for_directory,
  update_task_for_directory,
} from '../task/tasks.service'
import { parseStepId } from './task-tool-util'
import { resolveMcpWorkspace } from './tools'

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
