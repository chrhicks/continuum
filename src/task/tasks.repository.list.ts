import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { DbClient } from '../db/client'
import { tasks } from '../db/schema'
import { row_to_task } from './tasks.repository.parse'
import type {
  ListTaskFilters,
  ListTasksResult,
  Task,
  TaskStatus,
} from './types'

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
