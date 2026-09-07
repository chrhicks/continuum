import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import continuum from 'continuum'
import { isContinuumError } from '../src/task/error'
import { get_task_for_directory } from '../src/task/tasks.service'
import type { StepStatus } from '../src/task/types'

async function withTempCwd(run: () => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-step-cursor-'))
  const previous = process.cwd()
  try {
    process.chdir(root)
    await run()
  } finally {
    process.chdir(previous)
    rmSync(root, { recursive: true, force: true })
  }
}

async function currentStep(taskId: string): Promise<number | null> {
  const task = await get_task_for_directory(process.cwd(), taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  return task.current_step
}

async function expectErrorCode(
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await run()
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(isContinuumError(error)).toBe(true)
    if (isContinuumError(error)) expect(error.code).toBe(code)
  }
}

async function createTwoStepTask(title: string) {
  const task = await continuum.task.create({
    title,
    type: 'bug',
    description: 'Verify current step cursor behavior.',
  })
  const withSteps = await continuum.task.steps.add(task.id, {
    steps: [
      { title: 'Step 1', description: 'Current step.', position: 1 },
      { title: 'Step 2', description: 'Next step.', position: 2 },
    ],
  })
  const [first, second] = withSteps.steps
  if (!first || !second) throw new Error('Missing test steps')
  return { task, first, second }
}

describe('task step current cursor', () => {
  test('direct terminal updates advance default completion', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()

      for (const status of ['completed', 'skipped'] satisfies StepStatus[]) {
        const { task, first, second } = await createTwoStepTask(
          `Direct ${status} update`,
        )

        await continuum.task.steps.update(task.id, first.id, { status })
        expect(await currentStep(task.id)).toBe(Number(second.id))

        const completed = await continuum.task.steps.complete(task.id)
        expect(completed.warnings ?? []).toHaveLength(0)
        expect(
          completed.task.steps.find((step) => step.id === second.id)?.status,
        ).toBe('completed')
        expect(await currentStep(task.id)).toBeNull()
      }
    })
  })

  test('direct terminal updates clear the cursor without a pending step', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()

      for (const status of ['completed', 'skipped'] satisfies StepStatus[]) {
        const task = await continuum.task.create({
          title: `Direct ${status} final step`,
          type: 'bug',
          description: 'Clear the current step after a terminal update.',
        })
        const withStep = await continuum.task.steps.add(task.id, {
          steps: [{ title: 'Only step', description: 'No successor.' }],
        })
        const [step] = withStep.steps
        if (!step) throw new Error('Missing test step')

        await continuum.task.steps.update(task.id, step.id, { status })
        expect(await currentStep(task.id)).toBeNull()
        await expectErrorCode(
          () => continuum.task.steps.complete(task.id),
          'ITEM_NOT_FOUND',
        )
      }
    })
  })

  test('SDK collection patches reconcile terminal current steps', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()

      for (const status of ['completed', 'skipped'] satisfies StepStatus[]) {
        const task = await continuum.task.create({
          title: `Collection ${status} update`,
          type: 'bug',
          description: 'Reconcile collection-patched steps.',
        })
        const withSteps = await continuum.task.update(task.id, {
          steps: {
            add: [
              { title: 'Step 1', description: 'Current step.', position: 1 },
              { title: 'Step 2', description: 'Next step.', position: 2 },
            ],
          },
        })
        const [first, second] = withSteps.steps
        if (!first || !second) throw new Error('Missing test steps')

        await continuum.task.update(task.id, {
          steps: { update: [{ id: first.id, status }] },
        })
        expect(await currentStep(task.id)).toBe(Number(second.id))

        const completed = await continuum.task.steps.complete(task.id)
        expect(completed.warnings ?? []).toHaveLength(0)
        expect(
          completed.task.steps.find((step) => step.id === second.id)?.status,
        ).toBe('completed')
      }
    })
  })

  test('non-terminal current steps survive unrelated mutations', async () => {
    await withTempCwd(async () => {
      await continuum.task.init()
      const { task, first, second } = await createTwoStepTask(
        'Preserve in-progress cursor',
      )
      const withThird = await continuum.task.steps.add(task.id, {
        steps: [{ title: 'Step 3', description: 'Explicit completion.' }],
      })
      const third = withThird.steps.find(
        (step) => step.id !== first.id && step.id !== second.id,
      )
      if (!third) throw new Error('Missing third step')

      await continuum.task.steps.update(task.id, first.id, {
        status: 'in_progress',
      })
      await continuum.task.update(task.id, {
        steps: { update: [{ id: second.id, status: 'skipped' }] },
      })
      await continuum.task.steps.complete(task.id, { stepId: third.id })

      expect(await currentStep(task.id)).toBe(Number(first.id))
    })
  })
})
