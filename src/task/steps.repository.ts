import type { DbClient } from '../db/client'
import { ContinuumError } from './error'
import { reconcile_current_step } from './step-cursor'
import { require_task, update_live_task } from './tasks.repository'
import type {
  AddStepsInput,
  CompleteStepInput,
  CompleteStepResult,
  Step,
  Task,
  UpdateStepInput,
} from './types'

export async function add_steps(
  db: DbClient,
  input: AddStepsInput,
): Promise<Task> {
  const task = await require_task(db, input.task_id)

  const existingSteps = task.steps
  const maxId = existingSteps.reduce((max, s) => Math.max(max, s.id), 0)

  const newSteps: Step[] = input.steps.map((s, i) => ({
    id: maxId + i + 1,
    title: s.title,
    description: s.description ?? s.details ?? '',
    position: s.position ?? 0,
    summary: s.summary,
    details: s.details,
    status: s.status ?? 'pending',
    notes: s.notes ?? null,
  }))

  const allSteps = [...existingSteps, ...newSteps]

  return update_live_task(db, input.task_id, {
    steps: JSON.stringify(allSteps),
    current_step: reconcile_current_step(allSteps, task.current_step),
    updated_at: new Date().toISOString(),
  })
}

export async function complete_step(
  db: DbClient,
  input: CompleteStepInput,
): Promise<CompleteStepResult> {
  const task = await require_task(db, input.task_id)

  const stepId = input.step_id ?? task.current_step
  if (stepId === null) {
    throw new ContinuumError(
      'ITEM_NOT_FOUND',
      'No step to complete (no current_step set)',
      ['Add steps first using step_add, or specify step_id explicitly'],
    )
  }

  const stepIndex = task.steps.findIndex((s) => s.id === stepId)
  if (stepIndex === -1) {
    throw new ContinuumError('ITEM_NOT_FOUND', `Step ${stepId} not found`)
  }

  const existingStep = requireStep(task.steps, stepIndex, stepId)
  if (existingStep.status === 'completed') {
    return {
      task,
      warnings: [`Step ${existingStep.id} already completed; no changes made.`],
    }
  }

  const updatedSteps = [...task.steps]
  updatedSteps[stepIndex] = {
    id: existingStep.id,
    title: existingStep.title,
    description: existingStep.description ?? existingStep.details ?? '',
    position: existingStep.position ?? 0,
    summary: existingStep.summary,
    details: existingStep.details,
    status: 'completed',
    notes: input.notes ?? existingStep.notes,
  }

  const updatedTask = await update_live_task(db, input.task_id, {
    steps: JSON.stringify(updatedSteps),
    current_step: reconcile_current_step(updatedSteps, task.current_step),
    updated_at: new Date().toISOString(),
  })

  return { task: updatedTask }
}

export async function update_step(
  db: DbClient,
  input: UpdateStepInput,
): Promise<Task> {
  const task = await require_task(db, input.task_id)

  const stepIndex = task.steps.findIndex((s) => s.id === input.step_id)
  if (stepIndex === -1) {
    throw new ContinuumError(
      'ITEM_NOT_FOUND',
      `Step ${input.step_id} not found`,
    )
  }

  const existingStep = requireStep(task.steps, stepIndex, input.step_id)
  const updatedSteps = [...task.steps]
  const description =
    input.description !== undefined
      ? input.description
      : input.details !== undefined
        ? input.details
        : (existingStep.description ?? existingStep.details ?? '')
  const details =
    input.details !== undefined ? input.details : existingStep.details

  updatedSteps[stepIndex] = {
    id: existingStep.id,
    title: input.title ?? existingStep.title,
    description,
    position:
      input.position !== undefined ? input.position : existingStep.position,
    summary: input.summary ?? existingStep.summary,
    details,
    status: input.status ?? existingStep.status,
    notes: input.notes !== undefined ? input.notes : existingStep.notes,
  }

  return update_live_task(db, input.task_id, {
    steps: JSON.stringify(updatedSteps),
    current_step: reconcile_current_step(updatedSteps, task.current_step),
    updated_at: new Date().toISOString(),
  })
}

function requireStep(steps: Step[], index: number, id: number): Step {
  const step = steps[index]
  if (!step) {
    throw new ContinuumError('ITEM_NOT_FOUND', `Step ${id} not found`)
  }
  return step
}
