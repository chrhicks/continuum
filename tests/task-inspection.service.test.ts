import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContinuumError } from '../src/task/error'
import {
  load_task_view_for_directory,
  validate_task_transition_for_directory,
} from '../src/task/task-inspection.service'
import {
  create_task_for_directory,
  delete_task_for_directory,
  update_task_for_directory,
} from '../src/task/tasks.service'
import { init_project } from '../src/task/util'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('task inspection use cases', () => {
  test('loads direct and expanded task views with explicit option behavior', async () => {
    const workspace = await initializedWorkspace()
    const parent = await createTask(workspace, 'Parent')
    const blocker = await createTask(workspace, 'Blocker')
    const task = await create_task_for_directory(workspace, {
      title: 'Inspected task',
      type: 'feature',
      intent: 'Exercise task view expansion.',
      description: 'Load one task and its relationships.',
      plan: 'Inspect direct and expanded views.',
      parent_id: parent.id,
      blocked_by: [blocker.id],
    })
    const activeChild = await create_task_for_directory(workspace, {
      title: 'Active child',
      type: 'chore',
      description: 'Visible by default.',
      plan: 'Remain active.',
      parent_id: task.id,
    })
    const deletedChild = await create_task_for_directory(workspace, {
      title: 'Deleted child',
      type: 'chore',
      description: 'Visible only when requested.',
      plan: 'Delete this fixture.',
      parent_id: task.id,
    })
    await delete_task_for_directory(workspace, deletedChild.id)

    const direct = await load_task_view_for_directory(workspace, task.id)
    expect(direct?.task.id).toBe(task.id)
    expect(direct?.parent).toBeUndefined()
    expect(direct?.children).toBeUndefined()
    expect(direct?.blockers).toBeUndefined()

    const expanded = await load_task_view_for_directory(workspace, task.id, {
      parent: true,
      children: true,
      blockers: true,
    })
    expect(expanded?.parent?.id).toBe(parent.id)
    expect(expanded?.children?.map((child) => child.id)).toEqual([
      activeChild.id,
    ])
    expect(expanded?.blockers?.map((item) => item.id)).toEqual([blocker.id])

    const withDeleted = await load_task_view_for_directory(workspace, task.id, {
      children: true,
      includeDeleted: true,
    })
    expect(withDeleted?.children?.map((child) => child.id).sort()).toEqual(
      [activeChild.id, deletedChild.id].sort(),
    )
    expect(
      await load_task_view_for_directory(workspace, 'tkt-missing'),
    ).toBeNull()
  })

  test('reports readiness fields and completed-transition blockers', async () => {
    const workspace = await initializedWorkspace()
    const blocker = await createTask(workspace, 'Open blocker')
    const task = await create_task_for_directory(workspace, {
      title: 'Transition candidate',
      type: 'feature',
      intent: 'Exercise transition readiness.',
      description: 'A plan is intentionally missing.',
      blocked_by: [blocker.id],
    })

    expect(
      await validate_task_transition_for_directory(workspace, task.id, 'ready'),
    ).toEqual({ missingFields: ['plan'], openBlockers: [] })
    expect(
      await validate_task_transition_for_directory(
        workspace,
        task.id,
        'completed',
      ),
    ).toEqual({ missingFields: ['plan'], openBlockers: [blocker.id] })

    await update_task_for_directory(workspace, blocker.id, {
      status: 'completed',
    })
    expect(
      await validate_task_transition_for_directory(
        workspace,
        task.id,
        'completed',
      ),
    ).toEqual({ missingFields: ['plan'], openBlockers: [] })

    try {
      await validate_task_transition_for_directory(
        workspace,
        'tkt-missing',
        'completed',
      )
      throw new Error('Expected TASK_NOT_FOUND')
    } catch (error) {
      expect(error).toBeInstanceOf(ContinuumError)
      if (error instanceof ContinuumError) {
        expect(error.code).toBe('TASK_NOT_FOUND')
      }
    }
  })
})

async function initializedWorkspace(): Promise<string> {
  const workspace = mkdtempSync(join(tmpdir(), 'continuum-task-inspection-'))
  roots.push(workspace)
  await init_project({ directory: workspace })
  return workspace
}

async function createTask(workspace: string, title: string) {
  return create_task_for_directory(workspace, {
    title,
    type: 'chore',
    description: `${title} description.`,
    plan: `${title} plan.`,
  })
}
