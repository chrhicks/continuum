import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import continuum from 'continuum'
import { getDbClient } from '../src/db/client'
import type { Task, TaskStatus } from '../src/sdk/types'

type SortKey = 'priority' | 'createdAt' | 'updatedAt'
type SortOrder = 'asc' | 'desc'
type SeedSpec = {
  title: string
  priority: number
  status: TaskStatus
  createdAt: string
  updatedAt: string
}
type SeededTask = SeedSpec & { id: string }

const seedSpecs: SeedSpec[] = [
  {
    title: 'Alpha',
    priority: 1,
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T06:00:00.000Z',
  },
  {
    title: 'Bravo',
    priority: 1,
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T05:00:00.000Z',
  },
  {
    title: 'Charlie',
    priority: 1,
    status: 'open',
    createdAt: '2026-01-01T01:00:00.000Z',
    updatedAt: '2026-01-01T04:00:00.000Z',
  },
  {
    title: 'Delta',
    priority: 2,
    status: 'ready',
    createdAt: '2026-01-01T02:00:00.000Z',
    updatedAt: '2026-01-01T03:00:00.000Z',
  },
  {
    title: 'Echo',
    priority: 2,
    status: 'blocked',
    createdAt: '2026-01-01T03:00:00.000Z',
    updatedAt: '2026-01-01T03:00:00.000Z',
  },
  {
    title: 'Foxtrot',
    priority: 3,
    status: 'open',
    createdAt: '2026-01-01T04:00:00.000Z',
    updatedAt: '2026-01-01T01:00:00.000Z',
  },
  {
    title: 'Completed',
    priority: 0,
    status: 'completed',
    createdAt: '2026-01-01T05:00:00.000Z',
    updatedAt: '2026-01-01T07:00:00.000Z',
  },
  {
    title: 'Cancelled',
    priority: 0,
    status: 'cancelled',
    createdAt: '2026-01-01T06:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
  {
    title: 'Deleted',
    priority: 0,
    status: 'deleted',
    createdAt: '2026-01-01T07:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
  },
]

async function withTempCwd(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-task-pagination-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run(root)
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

async function seedTasks(root: string): Promise<SeededTask[]> {
  const seeded: SeededTask[] = []
  for (const spec of seedSpecs) {
    const task = await continuum.task.create({
      title: spec.title,
      type: 'chore',
      description: `${spec.title} pagination fixture`,
      priority: spec.priority,
      status: spec.status === 'deleted' ? undefined : spec.status,
    })
    if (spec.status === 'deleted') await continuum.task.delete(task.id)
    seeded.push({ ...spec, id: task.id })
  }

  const { sqlite } = await getDbClient(root)
  const updateTimes = sqlite.query(
    'UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?',
  )
  for (const task of seeded) {
    updateTimes.run(task.createdAt, task.updatedAt, task.id)
  }
  return seeded
}

function compareValues(left: string | number, right: string | number): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function expectedIds(
  tasks: SeededTask[],
  sort: SortKey,
  order: SortOrder,
): string[] {
  const direction = order === 'asc' ? 1 : -1
  return tasks
    .filter(
      ({ status }) => !['completed', 'cancelled', 'deleted'].includes(status),
    )
    .sort((left, right) => {
      const primary = compareValues(left[sort], right[sort])
      const secondary =
        sort === 'priority' ? compareValues(left.createdAt, right.createdAt) : 0
      return (
        direction * (primary || secondary || compareValues(left.id, right.id))
      )
    })
    .map(({ id }) => id)
}

async function traversePages(
  sort: SortKey,
  order: SortOrder,
): Promise<{ tasks: Task[]; pageSizes: number[]; cursors: string[] }> {
  const tasks: Task[] = []
  const pageSizes: number[] = []
  const cursors: string[] = []
  let cursor: string | undefined

  for (let page = 0; page < 10; page += 1) {
    const result = await continuum.task.list({
      cursor,
      limit: 2,
      sort,
      order,
    })
    tasks.push(...result.tasks)
    pageSizes.push(result.tasks.length)
    if (!result.nextCursor) return { tasks, pageSizes, cursors }
    cursors.push(result.nextCursor)
    cursor = result.nextCursor
  }

  throw new Error(`Pagination did not terminate for ${sort} ${order}`)
}

describe('task list cursor pagination', () => {
  test('traverses every supported ordering without gaps or duplicates', async () => {
    await withTempCwd(async (root) => {
      await continuum.task.init()
      const seeded = await seedTasks(root)
      const eligibleCount = 6
      const tieIds = seeded
        .filter(({ title }) => title === 'Alpha' || title === 'Bravo')
        .map(({ id }) => id)
        .sort(compareValues)

      expect(
        expectedIds(seeded, 'priority', 'asc').filter((id) =>
          tieIds.includes(id),
        ),
      ).toEqual(tieIds)
      expect(
        expectedIds(seeded, 'priority', 'desc').filter((id) =>
          tieIds.includes(id),
        ),
      ).toEqual([...tieIds].reverse())

      for (const sort of ['priority', 'createdAt', 'updatedAt'] as const) {
        for (const order of ['asc', 'desc'] as const) {
          const traversal = await traversePages(sort, order)
          const ids = traversal.tasks.map(({ id }) => id)

          expect(ids, `${sort} ${order} order`).toEqual(
            expectedIds(seeded, sort, order),
          )
          expect(new Set(ids).size, `${sort} ${order} uniqueness`).toBe(
            eligibleCount,
          )
          expect(traversal.pageSizes, `${sort} ${order} page sizes`).toEqual([
            2, 2, 2,
          ])
          expect(
            traversal.cursors,
            `${sort} ${order} intermediate cursors`,
          ).toHaveLength(2)
        }
      }
    })
  })
})
