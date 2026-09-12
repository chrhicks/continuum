import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import continuum from 'continuum'
import { graphMcpTasks } from '../src/mcp/task-read-tools'

const projectRoot = join(import.meta.dir, '..')

type GraphFixture = Awaited<ReturnType<typeof createGraphFixture>>

async function withTempCwd(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-terminal-graph-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run(root)
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
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

async function createGraphFixture() {
  const root = await createTask('Root')
  const completed = await createTask('Completed middle', root.id)
  const completedLeaf = await createTask('Completed leaf', completed.id)
  await continuum.task.update(completed.id, { status: 'completed' })

  const cancelled = await createTask('Cancelled middle', root.id)
  const cancelledLeaf = await createTask('Cancelled leaf', cancelled.id)
  await continuum.task.update(cancelled.id, { status: 'cancelled' })

  const deleted = await createTask('Deleted middle', root.id)
  const deletedLeaf = await createTask('Deleted leaf', deleted.id)
  await continuum.task.delete(deleted.id)

  return {
    root,
    completed,
    completedLeaf,
    cancelled,
    cancelledLeaf,
    deleted,
    deletedLeaf,
  }
}

function expectedChildren(fixture: GraphFixture): string[] {
  return [fixture.completed.id, fixture.cancelled.id]
}

function expectedDescendants(fixture: GraphFixture): string[] {
  return [
    fixture.completed.id,
    fixture.cancelled.id,
    fixture.completedLeaf.id,
    fixture.cancelledLeaf.id,
  ]
}

describe('task graph terminal nodes', () => {
  test('traverses completed and cancelled nodes while excluding deleted nodes', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const fixture = await createGraphFixture()

      expect(
        (await continuum.task.list()).tasks.map((task) => task.id),
      ).not.toContain(fixture.completed.id)
      expect(
        (await continuum.task.list()).tasks.map((task) => task.id),
      ).not.toContain(fixture.cancelled.id)
      expect(await continuum.task.graph('children', fixture.root.id)).toEqual({
        taskIds: expectedChildren(fixture),
      })
      expect(
        await continuum.task.graph('descendants', fixture.root.id),
      ).toEqual({ taskIds: expectedDescendants(fixture) })
      expect(
        await continuum.task.graph('ancestors', fixture.completedLeaf.id),
      ).toEqual({ taskIds: [fixture.completed.id, fixture.root.id] })
      expect(
        await continuum.task.graph('ancestors', fixture.cancelledLeaf.id),
      ).toEqual({ taskIds: [fixture.cancelled.id, fixture.root.id] })
      expect(
        await continuum.task.graph('ancestors', fixture.deletedLeaf.id),
      ).toEqual({ taskIds: [] })
    })
  })

  test('preserves terminal graph result shapes through MCP and CLI adapters', async () => {
    await withTempCwd(async (root) => {
      await continuum.task.init()
      const fixture = await createGraphFixture()

      expect(
        await graphMcpTasks({
          workspace: root,
          id: fixture.root.id,
          query: 'children',
        }),
      ).toEqual({
        workspace: root,
        id: fixture.root.id,
        query: 'children',
        taskIds: expectedChildren(fixture),
      })

      const cli = spawnSync(
        process.execPath,
        [
          join(projectRoot, 'bin', 'continuum'),
          '--cwd',
          root,
          '--json',
          'task',
          'graph',
          'descendants',
          fixture.root.id,
        ],
        { cwd: projectRoot, encoding: 'utf8', env: { ...process.env } },
      )
      expect(cli.stderr).toBe('')
      expect(JSON.parse(cli.stdout)).toMatchObject({
        ok: true,
        data: {
          query: 'descendants',
          taskId: fixture.root.id,
          taskIds: expectedDescendants(fixture),
        },
      })
      expect(cli.status).toBe(0)
    })
  })
})
