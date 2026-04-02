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

type ListCursor = {
  sortValue: string | number
  id: string
  secondarySortValue?: string | number
}

type WhereClause = ReturnType<typeof and> | ReturnType<typeof sql>
type TaskSortKey = NonNullable<ListTaskFilters['sort']>

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

function build_list_where(filters: ListTaskFilters): WhereClause[] {
  const where: WhereClause[] = []
  const includeDeleted =
    filters.includeDeleted === true || filters.status === 'deleted'

  if (!includeDeleted) {
    where.push(ne(tasks.status, 'deleted'))
  }

  if (!filters.status) {
    where.push(ne(tasks.status, 'cancelled'))
    where.push(ne(tasks.status, 'completed'))
  } else {
    where.push(eq(tasks.status, filters.status))
  }

  if (filters.type) {
    where.push(eq(tasks.type, filters.type))
  }

  if (filters.parent_id !== undefined) {
    where.push(
      filters.parent_id === null
        ? isNull(tasks.parent_id)
        : eq(tasks.parent_id, filters.parent_id),
    )
  }

  return where
}

function resolve_list_sort(filters: ListTaskFilters): {
  sortKey: TaskSortKey
  sortColumn:
    | typeof tasks.priority
    | typeof tasks.updated_at
    | typeof tasks.created_at
  sortOrder: 'asc' | 'desc'
  limit: number
  cursor: ListCursor | null
} {
  const sortKey = filters.sort ?? 'priority'
  const sortColumn =
    sortKey === 'priority'
      ? tasks.priority
      : sortKey === 'updatedAt'
        ? tasks.updated_at
        : tasks.created_at

  return {
    sortKey,
    sortColumn,
    sortOrder: filters.order === 'desc' ? 'desc' : 'asc',
    limit: filters.limit && filters.limit > 0 ? filters.limit : 50,
    cursor: decode_cursor(filters.cursor),
  }
}

function append_cursor_where(
  where: WhereClause[],
  cursor: ListCursor,
  sortOrder: 'asc' | 'desc',
  sortKey: TaskSortKey,
  sortColumn:
    | typeof tasks.priority
    | typeof tasks.updated_at
    | typeof tasks.created_at,
): void {
  const comparator = sortOrder === 'desc' ? '<' : '>'
  if (sortKey !== 'priority') {
    where.push(
      sql`(${sortColumn}, ${tasks.id}) ${sql.raw(comparator)} (${cursor.sortValue}, ${cursor.id})`,
    )
    return
  }

  if (cursor.secondarySortValue !== undefined) {
    where.push(
      sql`(${tasks.priority}, ${tasks.created_at}, ${tasks.id}) ${sql.raw(comparator)} (${cursor.sortValue}, ${cursor.secondarySortValue}, ${cursor.id})`,
    )
    return
  }

  where.push(
    sql`(${tasks.priority}, ${tasks.id}) ${sql.raw(comparator)} (${cursor.sortValue}, ${cursor.id})`,
  )
}

function build_next_cursor(
  sortKey: TaskSortKey,
  last: {
    id: string
    priority: number
    created_at: string | number
    updated_at: string | number
  },
): string {
  const sortValue =
    sortKey === 'priority'
      ? last.priority
      : sortKey === 'updatedAt'
        ? last.updated_at
        : last.created_at

  return encode_cursor(
    sortValue,
    last.id,
    sortKey === 'priority' ? last.created_at : undefined,
  )
}

export async function list_tasks(
  db: DbClient,
  filters: ListTaskFilters = {},
): Promise<ListTasksResult> {
  const where = build_list_where(filters)
  const { cursor, limit, sortColumn, sortKey, sortOrder } =
    resolve_list_sort(filters)

  if (cursor) {
    append_cursor_where(where, cursor, sortOrder, sortKey, sortColumn)
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
  return {
    tasks: mapped,
    nextCursor: build_next_cursor(sortKey, last),
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
