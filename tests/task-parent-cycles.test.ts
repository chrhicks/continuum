import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import continuum from 'continuum'
import { getDbClient } from '../src/db/client'
import { isContinuumError } from '../src/task/error'

async function withTempCwd(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-parent-cycle-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run(root)
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

async function expectParentError(
  code: 'INVALID_PARENT' | 'PARENT_NOT_FOUND',
  run: () => Promise<unknown>,
): Promise<void> {
  let caught: unknown
  try {
    await run()
  } catch (error) {
    caught = error
  }
  expect(isContinuumError(caught)).toBe(true)
  if (isContinuumError(caught)) expect(caught.code).toBe(code)
}

async function createTask(title: string, parentId?: string) {
  return continuum.task.create({
    title,
    type: 'chore',
    description: `${title} description`,
    plan: `${title} plan`,
    parentId,
  })
}

describe('task parent cycles', () => {
  test('rejects self-parenting with a stable typed error', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const task = await createTask('Self parent')

      await expectParentError('INVALID_PARENT', () =>
        continuum.task.update(task.id, { parentId: task.id }),
      )

      expect((await continuum.task.get(task.id))?.parentId).toBeNull()
    })
  })

  test('rejects a descendant parent while allowing valid reparenting', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const root = await createTask('Root')
      const child = await createTask('Child', root.id)
      const descendant = await createTask('Descendant', child.id)
      const otherParent = await createTask('Other parent')

      await expectParentError('INVALID_PARENT', () =>
        continuum.task.update(root.id, { parentId: descendant.id }),
      )
      expect((await continuum.task.get(root.id))?.parentId).toBeNull()

      const reparented = await continuum.task.update(child.id, {
        parentId: otherParent.id,
      })
      expect(reparented.parentId).toBe(otherParent.id)

      await continuum.task.delete(root.id)
      await expectParentError('PARENT_NOT_FOUND', () =>
        continuum.task.update(child.id, { parentId: root.id }),
      )
      expect((await continuum.task.get(child.id))?.parentId).toBe(
        otherParent.id,
      )
    })
  })

  test('terminates graph walks with unique results over seeded cycles', async () => {
    await withTempCwd(async (root) => {
      await continuum.task.init()
      const first = await createTask('First')
      const second = await createTask('Second', first.id)
      const leaf = await createTask('Leaf', first.id)
      const { sqlite } = await getDbClient(root)
      sqlite
        .query('UPDATE tasks SET parent_id = ? WHERE id = ?')
        .run(second.id, first.id)

      expect(await continuum.task.graph('ancestors', first.id)).toEqual({
        taskIds: [second.id],
      })
      expect(await continuum.task.graph('ancestors', leaf.id)).toEqual({
        taskIds: [first.id, second.id],
      })
      expect(await continuum.task.graph('descendants', first.id)).toEqual({
        taskIds: [second.id, leaf.id],
      })
      expect(await continuum.task.graph('descendants', second.id)).toEqual({
        taskIds: [first.id, leaf.id],
      })

      expect((await continuum.task.get(first.id))?.parentId).toBe(second.id)
      expect((await continuum.task.get(second.id))?.parentId).toBe(first.id)
    })
  })
})
