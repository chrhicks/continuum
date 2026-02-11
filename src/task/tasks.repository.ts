import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { tasks } from '../db/schema'
import { randomId } from './db.utils'
import { ContinuumError } from './error'
import { validate_blocker_list } from './validation'
import type {
  AddDecisionInput,
  AddDiscoveryInput,
  AddStepsInput,
  CompleteStepInput,
  CompleteTaskInput,
  CreateTaskInput,
  Decision,
  Discovery,
  ListTaskFilters,
  ListTasksResult,
  Step,
  Task,
  TaskStatus,
  TaskType,
  UpdateStepInput,
  UpdateTaskInput,
} from './types'

type TaskRow = typeof tasks.$inferSelect

function parse_json_array<T>(
  value: string | null,
  defaultValue: T[] = [],
): T[] {
  if (!value) return defaultValue
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}

function parse_blocked_by(value: string | null): string[] {
  return parse_json_array<string>(value).filter(
    (item) => typeof item === 'string',
  )
}

function parse_steps(value: string | null): Step[] {
  const steps = parse_json_array<Step>(value)
  return steps.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description ?? step.details ?? '',
    position: step.position ?? 0,
    summary: step.summary,
    details: step.details,
    status: step.status ?? 'pending',
    notes: step.notes ?? null,
  }))
}

function parse_discoveries(value: string | null): Discovery[] {
  const discoveries = parse_json_array<Discovery>(value)
  return discoveries.map((discovery) => ({
    id: discovery.id,
    content: discovery.content,
    source: discovery.source ?? 'system',
    impact: discovery.impact ?? null,
    created_at: discovery.created_at,
  }))
}

function parse_decisions(value: string | null): Decision[] {
  const decisions = parse_json_array<Decision>(value)
  return decisions.map((decision) => ({
    id: decision.id,
    content: decision.content,
    rationale: decision.rationale ?? null,
    source: decision.source ?? 'system',
    impact: decision.impact ?? null,
    created_at: decision.created_at,
  }))
}

function encode_cursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify({ sortValue, id }), 'utf-8').toString(
    'base64',
  )
}

function decode_cursor(
  cursor: string | undefined,
): { sortValue: string; id: string } | null {
  if (!cursor) return null
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf-8')
    const parsed = JSON.parse(raw) as { sortValue?: string; id?: string }
    if (!parsed.sortValue || !parsed.id) return null
    return { sortValue: parsed.sortValue, id: parsed.id }
  } catch {
    return null
  }
}

function normalize_id(id: number | string, label: string): number {
  const value = typeof id === 'string' ? Number(id) : id
  if (!Number.isFinite(value)) {
    throw new ContinuumError('ITEM_NOT_FOUND', `${label} ${id} not found`)
  }
  return value
}

function row_to_task(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    type: row.type as TaskType,
    status: row.status as TaskStatus | 'deleted',
    intent: row.intent ?? null,
    description: row.description ?? null,
    plan: row.plan ?? null,
    steps: parse_steps(row.steps),
    current_step: row.current_step ?? null,
    discoveries: parse_discoveries(row.discoveries),
    decisions: parse_decisions(row.decisions),
    outcome: row.outcome ?? null,
    completed_at: row.completed_at ?? null,
    parent_id: row.parent_id ?? null,
    blocked_by: parse_blocked_by(row.blocked_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function task_exists(db: DbClient, task_id: string): Promise<boolean> {
  const row = await db
    .select({ count: sql<number>`count(1)` })
    .from(tasks)
    .where(and(eq(tasks.id, task_id), ne(tasks.status, 'deleted')))
    .get()
  return (row?.count ?? 0) > 0
}

async function validate_blockers(
  db: DbClient,
  blockers: string[],
): Promise<string[]> {
  if (blockers.length === 0) return []
  const unique = Array.from(new Set(blockers))
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.id, unique), ne(tasks.status, 'deleted')))
    .all()

  const found = new Set(rows.map((row) => row.id))
  return unique.filter((id) => !found.has(id))
}

export async function has_open_blockers(
  db: DbClient,
  task: Task,
): Promise<string[]> {
  if (task.blocked_by.length === 0) return []
  const rows = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(inArray(tasks.id, task.blocked_by), ne(tasks.status, 'deleted')))
    .all()

  const open = new Set(['open', 'ready', 'blocked'])
  return rows.filter((row) => open.has(row.status)).map((row) => row.id)
}

export async function create_task(
  db: DbClient,
  input: CreateTaskInput,
): Promise<Task> {
  const id = randomId('tkt')
  const created_at = new Date().toISOString()
  const updated_at = created_at
  const completed_at = input.status === 'completed' ? created_at : null
  const blocked_by = input.blocked_by ?? []

  validate_blocker_list(id, blocked_by)

  if (input.parent_id) {
    const parentExists = await task_exists(db, input.parent_id)
    if (!parentExists) {
      throw new ContinuumError('PARENT_NOT_FOUND', 'Parent task not found', [
        'Verify parent_id and try again.',
      ])
    }
  }

  const missingBlockers = await validate_blockers(db, blocked_by)
  if (missingBlockers.length > 0) {
    throw new ContinuumError(
      'BLOCKER_NOT_FOUND',
      `Blocking tasks not found: ${missingBlockers.join(', ')}`,
      [`Missing blocked_by IDs: ${missingBlockers.join(', ')}`],
    )
  }

  await db
    .insert(tasks)
    .values({
      id,
      title: input.title,
      type: input.type,
      status: input.status ?? 'open',
      intent: input.intent ?? null,
      description: input.description ?? null,
      plan: input.plan ?? null,
      steps: '[]',
      current_step: null,
      discoveries: '[]',
      decisions: '[]',
      outcome: null,
      completed_at,
      parent_id: input.parent_id ?? null,
      blocked_by: JSON.stringify(blocked_by),
      created_at,
      updated_at,
    })
    .run()

  const row = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!row) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found after create')
  }

  return row_to_task(row)
}

export async function update_task(
  db: DbClient,
  task_id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const updates: Partial<typeof tasks.$inferInsert> = {}
  let task: Task | null = null

  const ensure_task = async (): Promise<Task> => {
    if (!task) {
      task = await get_task(db, task_id)
    }
    if (!task) {
      throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
    }
    return task
  }

  if (input.parent_id !== undefined) {
    if (input.parent_id) {
      const parentExists = await task_exists(db, input.parent_id)
      if (!parentExists) {
        throw new ContinuumError('PARENT_NOT_FOUND', 'Parent task not found', [
          'Verify parent_id and try again.',
        ])
      }
    }
  }

  if (input.blocked_by !== undefined) {
    validate_blocker_list(task_id, input.blocked_by ?? [])
    const missingBlockers = await validate_blockers(db, input.blocked_by ?? [])
    if (missingBlockers.length > 0) {
      throw new ContinuumError(
        'BLOCKER_NOT_FOUND',
        `Blocking tasks not found: ${missingBlockers.join(', ')}`,
        [`Missing blocked_by IDs: ${missingBlockers.join(', ')}`],
      )
    }
  }

  if (input.title !== undefined) updates.title = input.title
  if (input.type !== undefined) updates.type = input.type
  if (input.status !== undefined) {
    updates.status = input.status
    updates.completed_at =
      input.status === 'completed' ? new Date().toISOString() : null
  }
  if (input.intent !== undefined) updates.intent = input.intent
  if (input.description !== undefined) updates.description = input.description
  if (input.plan !== undefined) updates.plan = input.plan
  if (input.parent_id !== undefined) updates.parent_id = input.parent_id
  if (input.blocked_by !== undefined) {
    updates.blocked_by = JSON.stringify(input.blocked_by ?? [])
  }

  if (input.steps) {
    const currentTask = await ensure_task()
    const existingSteps = [...currentTask.steps]
    let currentStep = currentTask.current_step

    if (input.steps.delete && input.steps.delete.length > 0) {
      const deleteIds = new Set(
        input.steps.delete.map((id) => normalize_id(id, 'Step')),
      )
      for (const stepId of deleteIds) {
        const exists = existingSteps.some((step) => step.id === stepId)
        if (!exists) {
          throw new ContinuumError('ITEM_NOT_FOUND', `Step ${stepId} not found`)
        }
      }
      const filtered = existingSteps.filter((step) => !deleteIds.has(step.id))
      existingSteps.length = 0
      existingSteps.push(...filtered)
      if (currentStep !== null && deleteIds.has(currentStep)) {
        currentStep = null
      }
    }

    if (input.steps.update && input.steps.update.length > 0) {
      for (const patch of input.steps.update) {
        const stepId = normalize_id(patch.id, 'Step')
        const index = existingSteps.findIndex((step) => step.id === stepId)
        if (index === -1) {
          throw new ContinuumError('ITEM_NOT_FOUND', `Step ${stepId} not found`)
        }
        const existing = existingSteps[index]!
        const description =
          patch.description !== undefined
            ? patch.description
            : patch.details !== undefined
              ? patch.details
              : (existing.description ?? existing.details ?? '')
        const details =
          patch.details !== undefined ? patch.details : existing.details
        existingSteps[index] = {
          id: existing.id,
          title: patch.title ?? existing.title,
          description,
          position:
            patch.position !== undefined ? patch.position : existing.position,
          summary: patch.summary ?? existing.summary,
          details,
          status: patch.status ?? existing.status,
          notes: patch.notes !== undefined ? patch.notes : existing.notes,
        }
      }
    }

    if (input.steps.add && input.steps.add.length > 0) {
      const maxId = existingSteps.reduce((max, s) => Math.max(max, s.id), 0)
      const newSteps: Step[] = input.steps.add.map((step, index) => ({
        id: maxId + index + 1,
        title: step.title,
        description: step.description ?? step.details ?? '',
        position: step.position ?? 0,
        summary: step.summary,
        details: step.details,
        status: step.status ?? 'pending',
        notes: step.notes ?? null,
      }))
      existingSteps.push(...newSteps)
    }

    const normalized = existingSteps.map((step) => ({
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

    updates.steps = JSON.stringify(normalized)
    updates.current_step = currentStep
  }

  if (input.discoveries) {
    const currentTask = await ensure_task()
    const existing = [...currentTask.discoveries]

    if (input.discoveries.delete && input.discoveries.delete.length > 0) {
      const deleteIds = new Set(
        input.discoveries.delete.map((id) => normalize_id(id, 'Discovery')),
      )
      for (const discoveryId of deleteIds) {
        const exists = existing.some((item) => item.id === discoveryId)
        if (!exists) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Discovery ${discoveryId} not found`,
          )
        }
      }
      const filtered = existing.filter((item) => !deleteIds.has(item.id))
      existing.length = 0
      existing.push(...filtered)
    }

    if (input.discoveries.update && input.discoveries.update.length > 0) {
      for (const patch of input.discoveries.update) {
        const discoveryId = normalize_id(patch.id, 'Discovery')
        const index = existing.findIndex((item) => item.id === discoveryId)
        if (index === -1) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Discovery ${discoveryId} not found`,
          )
        }
        const current = existing[index]!
        existing[index] = {
          id: current.id,
          content: patch.content ?? current.content,
          source: patch.source ?? current.source ?? 'system',
          impact:
            patch.impact !== undefined
              ? patch.impact
              : (current.impact ?? null),
          created_at: current.created_at,
        }
      }
    }

    if (input.discoveries.add && input.discoveries.add.length > 0) {
      const maxId = existing.reduce((max, item) => Math.max(max, item.id), 0)
      const newItems: Discovery[] = input.discoveries.add.map(
        (item, index) => ({
          id: maxId + index + 1,
          content: item.content,
          source: item.source ?? 'system',
          impact: item.impact ?? null,
          created_at: new Date().toISOString(),
        }),
      )
      existing.push(...newItems)
    }

    updates.discoveries = JSON.stringify(existing)
  }

  if (input.decisions) {
    const currentTask = await ensure_task()
    const existing = [...currentTask.decisions]

    if (input.decisions.delete && input.decisions.delete.length > 0) {
      const deleteIds = new Set(
        input.decisions.delete.map((id) => normalize_id(id, 'Decision')),
      )
      for (const decisionId of deleteIds) {
        const exists = existing.some((item) => item.id === decisionId)
        if (!exists) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Decision ${decisionId} not found`,
          )
        }
      }
      const filtered = existing.filter((item) => !deleteIds.has(item.id))
      existing.length = 0
      existing.push(...filtered)
    }

    if (input.decisions.update && input.decisions.update.length > 0) {
      for (const patch of input.decisions.update) {
        const decisionId = normalize_id(patch.id, 'Decision')
        const index = existing.findIndex((item) => item.id === decisionId)
        if (index === -1) {
          throw new ContinuumError(
            'ITEM_NOT_FOUND',
            `Decision ${decisionId} not found`,
          )
        }
        const current = existing[index]!
        existing[index] = {
          id: current.id,
          content: patch.content ?? current.content,
          rationale:
            patch.rationale !== undefined ? patch.rationale : current.rationale,
          source: patch.source ?? current.source ?? 'system',
          impact:
            patch.impact !== undefined
              ? patch.impact
              : (current.impact ?? null),
          created_at: current.created_at,
        }
      }
    }

    if (input.decisions.add && input.decisions.add.length > 0) {
      const maxId = existing.reduce((max, item) => Math.max(max, item.id), 0)
      const newItems: Decision[] = input.decisions.add.map((item, index) => ({
        id: maxId + index + 1,
        content: item.content,
        rationale: item.rationale ?? null,
        source: item.source ?? 'system',
        impact: item.impact ?? null,
        created_at: new Date().toISOString(),
      }))
      existing.push(...newItems)
    }

    updates.decisions = JSON.stringify(existing)
  }

  if (Object.keys(updates).length === 0) {
    throw new ContinuumError('NO_CHANGES_MADE', 'No fields to update')
  }

  updates.updated_at = new Date().toISOString()

  await db.update(tasks).set(updates).where(eq(tasks.id, task_id)).run()

  const row = await db.select().from(tasks).where(eq(tasks.id, task_id)).get()
  if (!row) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found after update')
  }

  return row_to_task(row)
}

export async function get_task(
  db: DbClient,
  task_id: string,
): Promise<Task | null> {
  const row = await db.select().from(tasks).where(eq(tasks.id, task_id)).get()
  return row ? row_to_task(row) : null
}

export async function list_tasks(
  db: DbClient,
  filters: ListTaskFilters = {},
): Promise<ListTasksResult> {
  const where: Array<ReturnType<typeof and> | ReturnType<typeof sql>> = []

  const includeDeleted =
    filters.includeDeleted === true || filters.status === 'deleted'

  if (!includeDeleted) {
    where.push(ne(tasks.status, 'deleted'))
  }

  if (filters.status) {
    where.push(eq(tasks.status, filters.status))
  }

  if (filters.type) {
    where.push(eq(tasks.type, filters.type))
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push(isNull(tasks.parent_id))
    } else {
      where.push(eq(tasks.parent_id, filters.parent_id))
    }
  }

  const sortColumn =
    filters.sort === 'updatedAt' ? tasks.updated_at : tasks.created_at
  const sortOrder = filters.order === 'desc' ? 'desc' : 'asc'
  const limit = filters.limit && filters.limit > 0 ? filters.limit : 50
  const cursor = decode_cursor(filters.cursor)

  if (cursor) {
    const comparator = sortOrder === 'desc' ? '<' : '>'
    where.push(
      sql`(${sortColumn}, ${tasks.id}) ${sql.raw(comparator)} (${cursor.sortValue}, ${cursor.id})`,
    )
  }

  const orderFn = sortOrder === 'desc' ? desc : asc
  const baseQuery = db.select().from(tasks)
  const filteredQuery =
    where.length > 0 ? baseQuery.where(and(...where)) : baseQuery
  const rows = await filteredQuery
    .orderBy(orderFn(sortColumn), orderFn(tasks.id))
    .limit(limit + 1)
    .all()

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  const mapped = slice.map(row_to_task)

  if (!hasMore) {
    return { tasks: mapped }
  }

  const last = slice[slice.length - 1]!
  const sortValue =
    sortColumn === tasks.updated_at ? last.updated_at : last.created_at

  return {
    tasks: mapped,
    nextCursor: encode_cursor(sortValue, last.id),
  }
}

export async function list_tasks_by_statuses(
  db: DbClient,
  filters: { statuses: TaskStatus[]; parent_id?: string | null },
): Promise<Task[]> {
  const where: Array<ReturnType<typeof and> | ReturnType<typeof sql>> = [
    ne(tasks.status, 'deleted'),
  ]

  if (filters.statuses.length > 0) {
    where.push(inArray(tasks.status, filters.statuses))
  }

  if (filters.parent_id !== undefined) {
    if (filters.parent_id === null) {
      where.push(isNull(tasks.parent_id))
    } else {
      where.push(eq(tasks.parent_id, filters.parent_id))
    }
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(asc(tasks.created_at))
    .all()

  return rows.map(row_to_task)
}

export async function delete_task(
  db: DbClient,
  task_id: string,
): Promise<void> {
  await db
    .update(tasks)
    .set({ status: 'deleted', updated_at: new Date().toISOString() })
    .where(eq(tasks.id, task_id))
    .run()

  const row = await db.select().from(tasks).where(eq(tasks.id, task_id)).get()
  if (!row) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }
}

export async function add_steps(
  db: DbClient,
  input: AddStepsInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

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

  let currentStep = task.current_step
  if (currentStep === null && allSteps.length > 0) {
    const firstPending = allSteps.find((s) => s.status === 'pending')
    currentStep = firstPending?.id ?? null
  }

  await db
    .update(tasks)
    .set({
      steps: JSON.stringify(allSteps),
      current_step: currentStep,
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}

export async function complete_step(
  db: DbClient,
  input: CompleteStepInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

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

  const existingStep = task.steps[stepIndex]!
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

  let nextStep: number | null = null
  for (const step of updatedSteps) {
    if (step.status === 'pending') {
      nextStep = step.id
      break
    }
  }

  await db
    .update(tasks)
    .set({
      steps: JSON.stringify(updatedSteps),
      current_step: nextStep,
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}

export async function update_step(
  db: DbClient,
  input: UpdateStepInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const stepIndex = task.steps.findIndex((s) => s.id === input.step_id)
  if (stepIndex === -1) {
    throw new ContinuumError(
      'ITEM_NOT_FOUND',
      `Step ${input.step_id} not found`,
    )
  }

  const existingStep = task.steps[stepIndex]!
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

  await db
    .update(tasks)
    .set({
      steps: JSON.stringify(updatedSteps),
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}

export async function add_discovery(
  db: DbClient,
  input: AddDiscoveryInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const maxId = task.discoveries.reduce((max, d) => Math.max(max, d.id), 0)
  const discovery: Discovery = {
    id: maxId + 1,
    content: input.content,
    source: input.source ?? 'system',
    impact: input.impact ?? null,
    created_at: new Date().toISOString(),
  }

  const discoveries = [...task.discoveries, discovery]

  await db
    .update(tasks)
    .set({
      discoveries: JSON.stringify(discoveries),
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}

export async function add_decision(
  db: DbClient,
  input: AddDecisionInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const maxId = task.decisions.reduce((max, d) => Math.max(max, d.id), 0)
  const decision: Decision = {
    id: maxId + 1,
    content: input.content,
    rationale: input.rationale ?? null,
    source: input.source ?? 'system',
    impact: input.impact ?? null,
    created_at: new Date().toISOString(),
  }

  const decisions = [...task.decisions, decision]

  await db
    .update(tasks)
    .set({
      decisions: JSON.stringify(decisions),
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}

export async function complete_task(
  db: DbClient,
  input: CompleteTaskInput,
): Promise<Task> {
  const task = await get_task(db, input.task_id)
  if (!task) {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  const openBlockers = await has_open_blockers(db, task)
  if (openBlockers.length > 0) {
    throw new ContinuumError(
      'HAS_BLOCKERS',
      `Task has unresolved blockers: ${openBlockers.join(', ')}`,
      [`Complete blockers first: ${openBlockers.join(', ')}`],
    )
  }

  const now = new Date().toISOString()
  await db
    .update(tasks)
    .set({
      status: 'completed',
      outcome: input.outcome,
      completed_at: now,
      updated_at: now,
    })
    .where(eq(tasks.id, input.task_id))
    .run()

  return (await get_task(db, input.task_id))!
}
