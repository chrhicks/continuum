import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { tasks } from '../db/schema'
import { randomId } from './db.utils'
import { ContinuumError } from './error'
import { normalize_priority, row_to_task } from './tasks.repository.parse'
import {
  apply_core_updates,
  build_decisions_update,
  build_discoveries_update,
  build_steps_update,
} from './tasks.repository.update'
import { validate_blocker_list } from './validation'
import type {
  CompleteTaskInput,
  CreateTaskInput,
  ListTaskFilters,
  ListTasksResult,
  Task,
  UpdateTaskInput,
} from './types'
export { list_tasks, list_tasks_by_statuses } from './tasks.repository.list'

async function task_exists(db: DbClient, task_id: string): Promise<boolean> {
  const row = await db
    .select({ count: sql<number>`count(1)` })
    .from(tasks)
    .where(and(eq(tasks.id, task_id), ne(tasks.status, 'deleted')))
    .get()
  return (row?.count ?? 0) > 0
}

export async function require_task(
  db: DbClient,
  task_id: string,
): Promise<Task> {
  const task = await get_task(db, task_id)
  if (!task || task.status === 'deleted') {
    throw new ContinuumError('TASK_NOT_FOUND', 'Task not found')
  }

  return task
}

export async function update_live_task(
  db: DbClient,
  task_id: string,
  updates: Partial<typeof tasks.$inferInsert>,
): Promise<Task> {
  await db
    .update(tasks)
    .set(updates)
    .where(and(eq(tasks.id, task_id), ne(tasks.status, 'deleted')))
    .run()

  return require_task(db, task_id)
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

async function validate_parent_assignment(
  db: DbClient,
  parent_id: string | null | undefined,
  task_id?: string,
): Promise<void> {
  if (!parent_id) return
  const parentExists = await task_exists(db, parent_id)
  if (!parentExists) {
    throw new ContinuumError('PARENT_NOT_FOUND', 'Parent task not found', [
      'Verify parent_id and try again.',
    ])
  }
  if (!task_id) return

  const visited = new Set<string>()
  let ancestor_id: string | null = parent_id
  while (ancestor_id && !visited.has(ancestor_id)) {
    if (ancestor_id === task_id) {
      throw new ContinuumError(
        'INVALID_PARENT',
        'Parent assignment would create a cycle',
        ['Choose a task that is not this task or one of its descendants.'],
      )
    }
    visited.add(ancestor_id)
    const ancestor = await db
      .select({ parent_id: tasks.parent_id })
      .from(tasks)
      .where(eq(tasks.id, ancestor_id))
      .get()
    ancestor_id = ancestor?.parent_id ?? null
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
  await validate_parent_assignment(db, input.parent_id)

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
  const task = await require_task(db, task_id)
  const updates: Partial<typeof tasks.$inferInsert> = {}

  if (input.parent_id !== undefined) {
    await validate_parent_assignment(db, input.parent_id, task_id)
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

  apply_core_updates(updates, input)

  if (input.steps) {
    const next = build_steps_update(task, input.steps)
    updates.steps = next.steps
    updates.current_step = next.current_step
  }

  if (input.discoveries) {
    updates.discoveries = build_discoveries_update(task, input.discoveries)
  }

  if (input.decisions) {
    updates.decisions = build_decisions_update(task, input.decisions)
  }

  if (Object.keys(updates).length === 0) {
    throw new ContinuumError('NO_CHANGES_MADE', 'No fields to update')
  }

  updates.updated_at = new Date().toISOString()

  return update_live_task(db, task_id, updates)
}

export async function get_task(
  db: DbClient,
  task_id: string,
): Promise<Task | null> {
  const row = await db.select().from(tasks).where(eq(tasks.id, task_id)).get()
  return row ? row_to_task(row) : null
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

export async function complete_task(
  db: DbClient,
  input: CompleteTaskInput,
): Promise<Task> {
  const task = await require_task(db, input.task_id)

  const openBlockers = await has_open_blockers(db, task)
  if (openBlockers.length > 0) {
    throw new ContinuumError(
      'HAS_BLOCKERS',
      `Task has unresolved blockers: ${openBlockers.join(', ')}`,
      [`Complete blockers first: ${openBlockers.join(', ')}`],
    )
  }

  const now = new Date().toISOString()
  return update_live_task(db, input.task_id, {
    status: 'completed',
    outcome: input.outcome,
    completed_at: now,
    updated_at: now,
  })
}
