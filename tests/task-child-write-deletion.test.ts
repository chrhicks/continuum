import { describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type DbClient } from '../src/db/client'
import { tasks } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import { isContinuumError } from '../src/task/error'
import { add_decision, add_discovery } from '../src/task/notes.repository'
import {
  add_steps,
  complete_step,
  update_step,
} from '../src/task/steps.repository'
import {
  create_task,
  get_task,
  require_task,
} from '../src/task/tasks.repository'

const DELETED_AT = '2026-09-06T12:00:00.000Z'

type ChildMutation = {
  name: string
  seed?: (db: DbClient, taskId: string) => Promise<unknown>
  run: (db: DbClient, taskId: string) => Promise<unknown>
}

const childMutations: ChildMutation[] = [
  {
    name: 'add_discovery',
    run: (db, taskId) =>
      add_discovery(db, { task_id: taskId, content: 'stale discovery' }),
  },
  {
    name: 'add_decision',
    run: (db, taskId) =>
      add_decision(db, { task_id: taskId, content: 'stale decision' }),
  },
  {
    name: 'add_steps',
    run: (db, taskId) =>
      add_steps(db, {
        task_id: taskId,
        steps: [{ title: 'stale step', description: 'must not persist' }],
      }),
  },
  {
    name: 'complete_step',
    seed: seedStep,
    run: (db, taskId) => complete_step(db, { task_id: taskId, step_id: 1 }),
  },
  {
    name: 'update_step',
    seed: seedStep,
    run: (db, taskId) =>
      update_step(db, {
        task_id: taskId,
        step_id: 1,
        title: 'stale title',
      }),
  },
]

describe('task child writes after concurrent deletion', () => {
  for (const mutation of childMutations) {
    test(`${mutation.name} rejects without persisting its stale update`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'continuum-child-write-'))
      const handle = createClient(join(directory, 'continuum.db'))
      try {
        runMigrations(handle.sqlite)
        const task = await create_task(handle.db, {
          title: mutation.name,
          type: 'bug',
          description: 'Concurrent deletion regression target.',
        })
        await mutation.seed?.(handle.db, task.id)
        const before = await require_task(handle.db, task.id)
        const racingDb = deleteBeforeNextUpdate(
          handle.db,
          handle.sqlite,
          task.id,
        )

        await expectTaskNotFound(() => mutation.run(racingDb, task.id))

        expect(await get_task(handle.db, task.id)).toEqual({
          ...before,
          status: 'deleted',
          updated_at: DELETED_AT,
        })
      } finally {
        handle.sqlite.close()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})

async function seedStep(db: DbClient, taskId: string): Promise<unknown> {
  return add_steps(db, {
    task_id: taskId,
    steps: [{ title: 'live step', description: 'seeded before deletion' }],
  })
}

function deleteBeforeNextUpdate(
  db: DbClient,
  sqlite: Database,
  taskId: string,
): DbClient {
  let deleted = false
  return new Proxy(db, {
    get(target, property) {
      if (property === 'update') {
        return (table: typeof tasks) => {
          if (!deleted) {
            sqlite
              .query('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
              .run('deleted', DELETED_AT, taskId)
            deleted = true
          }
          return target.update(table)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function expectTaskNotFound(run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
    throw new Error('Expected TASK_NOT_FOUND')
  } catch (error) {
    expect(isContinuumError(error)).toBe(true)
    if (isContinuumError(error)) {
      expect(error.code).toBe('TASK_NOT_FOUND')
    }
  }
}
