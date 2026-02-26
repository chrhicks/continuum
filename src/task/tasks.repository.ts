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
  CollectionPatch,
  CompleteStepInput,
  CompleteStepResult,
  CompleteTaskInput,
  CreateTaskInput,
  DecisionInput,
  DecisionPatch,
  Decision,
  DiscoveryInput,
  DiscoveryPatch,
  Discovery,
  ListTaskFilters,
  ListTasksResult,
  Step,
  StepInput,
  StepPatch,
  Task,
  TaskStatus,
  TaskType,
  UpdateStepInput,
  UpdateTaskInput,
} from './types'

type TaskRow = typeof tasks.$inferSelect

const DEFAULT_TASK_PRIORITY = 100

function normalize_priority(value?: number | null): number {
  if (value === null || value === undefined) return DEFAULT_TASK_PRIORITY
  return value
}

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

function encode_cursor(
  sortValue: string | number,
  id: string,
  secondarySortValue?: string | number,
): string {
  return Buffer.from(
    JSON.stringify({ sortValue, id, secondarySortValue }),
    'utf-8',
  ).toString('base64')
}

function decode_cursor(cursor: string | undefined): {
  sortValue: string | number
  id: string
  secondarySortValue?: string | number
} | null {
  if (!cursor) return null
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf-8')
    const parsed = JSON.parse(raw) as {
      sortValue?: string | number
      id?: string
      secondarySortValue?: string | number
    }
    if (parsed.sortValue === undefined || parsed.id === undefined) return null
    if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null
    return {
      sortValue: parsed.sortValue,
      id: parsed.id,
      secondarySortValue: parsed.secondarySortValue,
    }
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

function patch_collection<
  TItem extends { id: number },
  TAdd,
  TUpdate extends { id: number | string },
>(
  items: TItem[],
  patch: CollectionPatch<TAdd, TUpdate> | undefined,
  options: {
    label: string
    apply_update: (current: TItem, update: TUpdate) => TItem
    apply_add: (item: TAdd, index: number, nextId: number) => TItem
  },
): { items: TItem[]; deleted_ids: Set<number> } {
  const next = [...items]
  const deleted_ids = new Set<number>()

  if (!patch) {
    return { items: next, deleted_ids }
  }

  if (patch.delete && patch.delete.length > 0) {
    const deleteIds = new Set(
      patch.delete.map((id) => normalize_id(id, options.label)),
    )
    for (const itemId of deleteIds) {
      const exists = next.some((item) => item.id === itemId)
      if (!exists) {
        throw new ContinuumError(
          'ITEM_NOT_FOUND',
          `${options.label} ${itemId} not found`,
        )
      }
    }
    const filtered = next.filter((item) => !deleteIds.has(item.id))
    next.length = 0
    next.push(...filtered)
    for (const deletedId of deleteIds) {
      deleted_ids.add(deletedId)
    }
  }

  if (patch.update && patch.update.length > 0) {
    for (const update of patch.update) {
      const itemId = normalize_id(update.id, options.label)
      const index = next.findIndex((item) => item.id === itemId)
      if (index === -1) {
        throw new ContinuumError(
          'ITEM_NOT_FOUND',
          `${options.label} ${itemId} not found`,
        )
      }
      const current = next[index]!
      next[index] = options.apply_update(current, update)
    }
  }

  if (patch.add && patch.add.length > 0) {
    const maxId = next.reduce((max, item) => Math.max(max, item.id), 0)
    const added = patch.add.map((item, index) =>
      options.apply_add(item, index, maxId),
    )
    next.push(...added)
  }

  return { items: next, deleted_ids }
}

function row_to_task(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    type: row.type as TaskType,
    status: row.status as TaskStatus | 'deleted',
    priority: normalize_priority(row.priority ?? undefined),
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

async function validate_parent_exists(
  db: DbClient,
  parent_id: string | null | undefined,
): Promise<void> {
  if (!parent_id) return
  const parentExists = await task_exists(db, parent_id)
  if (!parentExists) {
    throw new ContinuumError('PARENT_NOT_FOUND', 'Parent task not found', [
      'Verify parent_id and try again.',
    ])
  }
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
  const priority = normalize_priority(input.priority)

  validate_blocker_list(id, blocked_by)
  await validate_parent_exists(db, input.parent_id)

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
      priority,
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
    await validate_parent_exists(db, input.parent_id)
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

  if (input.steps) {
    const currentTask = await ensure_task()
    const collection = patch_collection<Step, StepInput, StepPatch>(
      currentTask.steps,
      input.steps,
      {
        label: 'Step',
        apply_update: (existing, patch) => {
          const description =
            patch.description !== undefined
              ? patch.description
              : patch.details !== undefined
                ? patch.details
                : (existing.description ?? existing.details ?? '')
          const details =
            patch.details !== undefined ? patch.details : existing.details
          return {
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

    updates.steps = JSON.stringify(normalized)
    updates.current_step = currentStep
  }

  if (input.discoveries) {
    const currentTask = await ensure_task()
    const collection = patch_collection<
      Discovery,
      DiscoveryInput,
      DiscoveryPatch
    >(currentTask.discoveries, input.discoveries, {
      label: 'Discovery',
      apply_update: (current, patch) => ({
        id: current.id,
        content: patch.content ?? current.content,
        source: patch.source ?? current.source ?? 'system',
        impact:
          patch.impact !== undefined ? patch.impact : (current.impact ?? null),
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

    updates.discoveries = JSON.stringify(collection.items)
  }

  if (input.decisions) {
    const currentTask = await ensure_task()
    const collection = patch_collection<Decision, DecisionInput, DecisionPatch>(
      currentTask.decisions,
      input.decisions,
      {
        label: 'Decision',
        apply_update: (current, patch) => ({
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
        }),
        apply_add: (item, index, maxId) => ({
          id: maxId + index + 1,
          content: item.content,
          rationale: item.rationale ?? null,
          source: item.source ?? 'system',
          impact: item.impact ?? null,
          created_at: new Date().toISOString(),
        }),
      },
    )

    updates.decisions = JSON.stringify(collection.items)
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

  if (!filters.status) {
    where.push(ne(tasks.status, 'cancelled'))
    where.push(ne(tasks.status, 'completed'))
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

  const sortKey = filters.sort ?? 'priority'
  const sortColumn =
    sortKey === 'priority'
      ? tasks.priority
      : sortKey === 'updatedAt'
        ? tasks.updated_at
        : tasks.created_at
  const sortOrder = filters.order === 'desc' ? 'desc' : 'asc'
  const limit = filters.limit && filters.limit > 0 ? filters.limit : 50
  const cursor = decode_cursor(filters.cursor)

  if (cursor) {
    const comparator = sortOrder === 'desc' ? '<' : '>'
    if (sortKey === 'priority') {
      if (cursor.secondarySortValue !== undefined) {
        where.push(
          sql`(${tasks.priority}, ${tasks.created_at}, ${tasks.id}) ${sql.raw(comparator)} (${cursor.sortValue}, ${cursor.secondarySortValue}, ${cursor.id})`,
        )
      } else {
        where.push(
          sql`(${tasks.priority}, ${tasks.id}) ${sql.raw(comparator)} (${cursor.sortValue}, ${cursor.id})`,
        )
      }
    } else {
      where.push(
        sql`(${sortColumn}, ${tasks.id}) ${sql.raw(comparator)} (${cursor.sortValue}, ${cursor.id})`,
      )
    }
  }

  const orderFn = sortOrder === 'desc' ? desc : asc
  const baseQuery = db.select().from(tasks)
  const filteredQuery =
    where.length > 0 ? baseQuery.where(and(...where)) : baseQuery
  const orderedQuery =
    sortKey === 'priority'
      ? filteredQuery.orderBy(
          orderFn(tasks.priority),
          orderFn(tasks.created_at),
          orderFn(tasks.id),
        )
      : filteredQuery.orderBy(orderFn(sortColumn), orderFn(tasks.id))
  const rows = await orderedQuery.limit(limit + 1).all()

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  const mapped = slice.map(row_to_task)

  if (!hasMore) {
    return { tasks: mapped }
  }

  const last = slice[slice.length - 1]!
  const sortValue =
    sortKey === 'priority'
      ? last.priority
      : sortKey === 'updatedAt'
        ? last.updated_at
        : last.created_at
  const secondarySortValue =
    sortKey === 'priority' ? last.created_at : undefined

  return {
    tasks: mapped,
    nextCursor: encode_cursor(sortValue, last.id, secondarySortValue),
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
    .orderBy(asc(tasks.priority), asc(tasks.created_at), asc(tasks.id))
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
): Promise<CompleteStepResult> {
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

  return { task: (await get_task(db, input.task_id))! }
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
