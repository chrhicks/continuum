import { ContinuumError } from './error'
import type { CreateTaskInput, Task, TaskStatus } from './types'

export function validate_task_input(input: CreateTaskInput): string[] {
  const missing: string[] = []
  if (!input.title?.trim()) missing.push('title')

  switch (input.type) {
    case 'epic':
      if (!input.intent?.trim()) missing.push('intent')
      if (!input.description?.trim()) missing.push('description')
      break
    case 'feature':
    case 'bug':
      if (!input.intent?.trim()) missing.push('intent')
      if (!input.description?.trim()) missing.push('description')
      if (!input.plan?.trim()) missing.push('plan')
      break
    case 'investigation':
    case 'chore':
      if (!input.description?.trim()) missing.push('description')
      if (!input.plan?.trim()) missing.push('plan')
      break
  }

  return missing
}

export function validate_status_transition(
  task: Task,
  nextStatus: TaskStatus,
): string[] {
  const missing: string[] = []
  if (nextStatus === 'ready') {
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      if (!task.plan?.trim()) missing.push('plan')
    }
  }

  if (nextStatus === 'completed') {
    if (!task.description?.trim()) missing.push('description')
    if (['feature', 'bug', 'investigation', 'chore'].includes(task.type)) {
      if (!task.plan?.trim()) missing.push('plan')
    }
  }

  return missing
}

export function validate_blocker_list(task_id: string, blockers: string[]) {
  if (blockers.length === 0) return
  const seen = new Set<string>()
  for (const blocker of blockers) {
    if (blocker === task_id) {
      throw new ContinuumError('INVALID_BLOCKER', 'Task cannot block itself', [
        'Remove the task id from blocked_by.',
      ])
    }
    if (seen.has(blocker)) {
      throw new ContinuumError(
        'DUPLICATE_BLOCKERS',
        'blocked_by contains duplicate task ids',
        ['Remove duplicate ids from blocked_by.'],
      )
    }
    seen.add(blocker)
  }
}
