import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import continuum from 'continuum'
import { isContinuumError } from '../src/task/error'

async function withTempCwd(run: () => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-sdk-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

describe('sdk flows', () => {
  test('smoke flow: init, create, list, delete', async () => {
    await withTempCwd(async () => {
      const init = await continuum.task.init()
      expect(init.initialized).toBe(true)
      expect(init.created).toBe(true)

      const listBefore = await continuum.task.list({ limit: 5 })
      expect(listBefore.tasks.length).toBe(0)

      const created = await continuum.task.create({
        title: 'SDK smoke task',
        type: 'chore',
        description: 'Smoke test task',
        plan: 'Plan: create, update, delete.',
      })
      expect(created.id.length).toBeGreaterThan(0)

      const fetched = await continuum.task.get(created.id)
      expect(fetched?.id).toBe(created.id)

      const updated = await continuum.task.update(created.id, {
        title: `${created.title} (updated)`,
      })
      expect(updated.title.includes('updated')).toBe(true)

      const listAfter = await continuum.task.list({ limit: 50 })
      expect(listAfter.tasks.some((task) => task.id === created.id)).toBe(true)

      await continuum.task.delete(created.id)
      const afterDelete = await continuum.task.get(created.id)
      expect(afterDelete?.status).toBe('deleted')

      const listNoDeleted = await continuum.task.list({ limit: 50 })
      expect(listNoDeleted.tasks.some((task) => task.id === created.id)).toBe(
        false,
      )

      const listWithDeleted = await continuum.task.list({
        includeDeleted: true,
        limit: 50,
      })
      expect(listWithDeleted.tasks.some((task) => task.id === created.id)).toBe(
        true,
      )
    })
  })

  test('lifecycle flow: steps, notes, complete with outcome', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()

      const task = await continuum.task.create({
        title: 'Lifecycle task',
        type: 'investigation',
        description: 'Validate SDK lifecycle flow.',
        plan: 'Plan: add steps, notes, complete.',
      })

      const withSteps = await continuum.task.update(task.id, {
        steps: {
          add: [
            {
              title: 'Add steps',
              description: 'Create steps via update.',
              position: 1,
            },
            {
              title: 'Complete steps',
              description: 'Mark steps complete.',
              position: 2,
            },
          ],
        },
      })
      expect(withSteps.steps.length).toBe(2)

      const completedSteps = await continuum.task.update(task.id, {
        steps: {
          update: withSteps.steps.map((step) => ({
            id: step.id,
            status: 'completed',
          })),
        },
      })
      expect(
        completedSteps.steps.every((step) => step.status === 'completed'),
      ).toBe(true)

      const noted = await continuum.task.update(task.id, {
        discoveries: {
          add: [
            {
              content: 'SDK update handles notes.',
              source: 'agent',
              impact: 'Single API for changes.',
            },
          ],
        },
        decisions: {
          add: [
            {
              content: 'Use complete() for outcomes.',
              rationale: 'Enforces blocker checks.',
              source: 'agent',
            },
          ],
        },
      })
      expect(noted.discoveries.length).toBe(1)
      expect(noted.decisions.length).toBe(1)

      const completed = await continuum.task.complete(task.id, {
        outcome: 'Lifecycle test completed successfully.',
      })
      expect(completed.status).toBe('completed')
      expect(completed.outcome).toBe('Lifecycle test completed successfully.')
      expect(completed.completedAt).not.toBeNull()
    })
  })

  test('completion enforces blockers', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()

      const blocker = await continuum.task.create({
        title: 'Blocker task',
        type: 'chore',
        description: 'Blocker task for completion check.',
        plan: 'Plan: complete blocker first.',
      })

      const blocked = await continuum.task.create({
        title: 'Blocked task',
        type: 'feature',
        description: 'Task blocked by another task.',
        intent: 'Verify blocker enforcement.',
        plan: 'Plan: wait on blocker.',
        blockedBy: [blocker.id],
      })

      let error: unknown = null
      try {
        await continuum.task.complete(blocked.id, {
          outcome: 'Attempted completion.',
        })
      } catch (err) {
        error = err
      }

      expect(isContinuumError(error)).toBe(true)
      if (isContinuumError(error)) {
        expect(error.code).toBe('HAS_BLOCKERS')
      }

      await continuum.task.update(blocker.id, { status: 'completed' })

      const completed = await continuum.task.complete(blocked.id, {
        outcome: 'Blockers resolved; task completed.',
      })
      expect(completed.status).toBe('completed')
    })
  })

  test('steps complete warns on duplicate completion', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()

      const task = await continuum.task.create({
        title: 'Duplicate completion warning',
        type: 'feature',
        description: 'Warn when completing the same step twice.',
      })

      const withSteps = await continuum.task.steps.add(task.id, {
        steps: [
          {
            title: 'Step 1',
            description: 'First step.',
            position: 1,
          },
        ],
      })
      const stepId = withSteps.steps[0]?.id
      if (!stepId) {
        throw new Error('Missing step id')
      }

      const first = await continuum.task.steps.complete(task.id, { stepId })
      expect(first.warnings ?? []).toHaveLength(0)

      const second = await continuum.task.steps.complete(task.id, { stepId })
      expect(second.warnings?.length).toBe(1)
      expect(second.warnings?.[0]).toContain('already completed')
    })
  })
})
