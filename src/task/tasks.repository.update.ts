import { tasks } from '../db/schema'
import { patch_collection } from './collection-patch'
import { normalize_priority } from './tasks.repository.parse'
import type {
  CollectionPatch,
  Decision,
  DecisionInput,
  DecisionPatch,
  Discovery,
  DiscoveryInput,
  DiscoveryPatch,
  Step,
  StepInput,
  StepPatch,
  Task,
  UpdateTaskInput,
} from './types'

function patch_task_collection<
  TItem extends { id: number },
  TAdd,
  TUpdate extends { id: number | string },
>(
  current: TItem[],
  patch: CollectionPatch<TAdd, TUpdate> | undefined,
  options: {
    label: string
    apply_update: (current: TItem, update: TUpdate) => TItem
    apply_add: (item: TAdd, index: number, nextId: number) => TItem
  },
): { items: TItem[]; deleted_ids: Set<number>; serialized: string } {
  const collection = patch_collection<TItem, TAdd, TUpdate>(
    current,
    patch,
    options,
  )
  return {
    ...collection,
    serialized: JSON.stringify(collection.items),
  }
}

export function apply_core_updates(
  updates: Partial<typeof tasks.$inferInsert>,
  input: UpdateTaskInput,
): void {
  if (input.title !== undefined) updates.title = input.title
  if (input.type !== undefined) updates.type = input.type
  if (input.status !== undefined) {
    updates.status = input.status
    updates.completed_at =
      input.status === 'completed' ? new Date().toISOString() : null
  }
  if (input.priority !== undefined) {
    updates.priority = normalize_priority(input.priority)
  }
  if (input.intent !== undefined) updates.intent = input.intent
  if (input.description !== undefined) updates.description = input.description
  if (input.plan !== undefined) updates.plan = input.plan
  if (input.parent_id !== undefined) updates.parent_id = input.parent_id
  if (input.blocked_by !== undefined) {
    updates.blocked_by = JSON.stringify(input.blocked_by ?? [])
  }
}

export function build_steps_update(
  currentTask: Task,
  patch: CollectionPatch<StepInput, StepPatch>,
): {
  steps: string
  current_step: number | null
} {
  const collection = patch_task_collection<Step, StepInput, StepPatch>(
    currentTask.steps,
    patch,
    {
      label: 'Step',
      apply_update: (existing, update) => {
        const description =
          update.description !== undefined
            ? update.description
            : update.details !== undefined
              ? update.details
              : (existing.description ?? existing.details ?? '')
        const details =
          update.details !== undefined ? update.details : existing.details
        return {
          id: existing.id,
          title: update.title ?? existing.title,
          description,
          position:
            update.position !== undefined ? update.position : existing.position,
          summary: update.summary ?? existing.summary,
          details,
          status: update.status ?? existing.status,
          notes: update.notes !== undefined ? update.notes : existing.notes,
        }
      },
      apply_add: (step, index, maxId) => ({
        id: maxId + index + 1,
        title: step.title,
        description: step.description ?? step.details ?? '',
        position: step.position ?? 0,
        summary: step.summary,
        details: step.details,
        status: step.status ?? 'pending',
        notes: step.notes ?? null,
      }),
    },
  )

  let currentStep = currentTask.current_step

  if (currentStep !== null && collection.deleted_ids.has(currentStep)) {
    currentStep = null
  }

  const normalized = collection.items.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description ?? step.details ?? '',
    position: step.position ?? 0,
    summary: step.summary,
    details: step.details,
    status: step.status ?? 'pending',
    notes: step.notes ?? null,
  }))

  if (currentStep === null && normalized.length > 0) {
    const firstPending = normalized.find((step) => step.status === 'pending')
    currentStep = firstPending?.id ?? null
  }

  return {
    steps: JSON.stringify(normalized),
    current_step: currentStep,
  }
}

export function build_discoveries_update(
  currentTask: Task,
  patch: CollectionPatch<DiscoveryInput, DiscoveryPatch>,
): string {
  const collection = patch_task_collection<
    Discovery,
    DiscoveryInput,
    DiscoveryPatch
  >(currentTask.discoveries, patch, {
    label: 'Discovery',
    apply_update: (current, update) => ({
      id: current.id,
      content: update.content ?? current.content,
      source: update.source ?? current.source ?? 'system',
      impact:
        update.impact !== undefined ? update.impact : (current.impact ?? null),
      created_at: current.created_at,
    }),
    apply_add: (item, index, maxId) => ({
      id: maxId + index + 1,
      content: item.content,
      source: item.source ?? 'system',
      impact: item.impact ?? null,
      created_at: new Date().toISOString(),
    }),
  })

  return collection.serialized
}

export function build_decisions_update(
  currentTask: Task,
  patch: CollectionPatch<DecisionInput, DecisionPatch>,
): string {
  const collection = patch_task_collection<
    Decision,
    DecisionInput,
    DecisionPatch
  >(currentTask.decisions, patch, {
    label: 'Decision',
    apply_update: (current, update) => ({
      id: current.id,
      content: update.content ?? current.content,
      rationale:
        update.rationale !== undefined ? update.rationale : current.rationale,
      source: update.source ?? current.source ?? 'system',
      impact:
        update.impact !== undefined ? update.impact : (current.impact ?? null),
      created_at: current.created_at,
    }),
    apply_add: (item, index, maxId) => ({
      id: maxId + index + 1,
      content: item.content,
      rationale: item.rationale ?? null,
      source: item.source ?? 'system',
      impact: item.impact ?? null,
      created_at: new Date().toISOString(),
    }),
  })

  return collection.serialized
}
