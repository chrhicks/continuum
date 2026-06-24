import continuum, { isContinuumError } from '../../sdk'
import type { Task, TaskNote } from '../../sdk/types'

export type TaskSummary = {
  initialized: boolean
  error?: string
  active: Task[]
  ready: Task[]
  open: Task[]
  blocked: Task[]
  completed: Task[]
  nextTask: Task | null
}

export async function loadTaskSummary(limit: number): Promise<TaskSummary> {
  try {
    const [result, completedResult] = await Promise.all([
      continuum.task.list({
        limit: 1000,
        sort: 'priority',
        order: 'asc',
      }),
      continuum.task.list({
        status: 'completed',
        limit,
        sort: 'updatedAt',
        order: 'desc',
      }),
    ])
    const active = result.tasks
    const ready = active.filter((task) => task.status === 'ready')
    const open = active.filter((task) => task.status === 'open')
    const blocked = active.filter((task) => task.status === 'blocked')
    return {
      initialized: true,
      active,
      ready,
      open,
      blocked,
      completed: completedResult.tasks,
      nextTask: ready[0] ?? open[0] ?? blocked[0] ?? null,
    }
  } catch (error) {
    if (isContinuumError(error) && error.code === 'NOT_INITIALIZED') {
      return {
        initialized: false,
        error: error.message,
        active: [],
        ready: [],
        open: [],
        blocked: [],
        completed: [],
        nextTask: null,
      }
    }
    throw error
  }
}

export function renderTaskSummary(summary: TaskSummary, limit: number): string {
  const lines = ['## Tasks']
  if (!summary.initialized) {
    lines.push(`- not initialized: ${summary.error}`)
    lines.push('- initialize: continuum init')
    return lines.join('\n')
  }

  lines.push(
    `- active: ${summary.active.length} total; ${summary.ready.length} ready, ${summary.open.length} open, ${summary.blocked.length} blocked`,
  )
  if (summary.nextTask) {
    lines.push(`- next: ${formatTaskLine(summary.nextTask)}`)
    lines.push(
      `- inspect: continuum task get ${summary.nextTask.id} --expand parent,children,blockers`,
    )
    appendTaskDetails(lines, summary.nextTask)
  } else {
    lines.push(
      '- next: no active tasks; inspect memory or ask before creating work',
    )
  }
  appendTaskBucket(lines, 'Ready', summary.ready, limit)
  appendTaskBucket(lines, 'Open', summary.open, limit)
  appendTaskBucket(lines, 'Blocked', summary.blocked, limit)
  appendTaskBucket(lines, 'Recently Completed', summary.completed, limit)
  return lines.join('\n')
}

function appendTaskBucket(
  lines: string[],
  title: string,
  tasks: Task[],
  limit: number,
): void {
  if (tasks.length === 0) return
  lines.push('', `### ${title}`)
  for (const task of tasks.slice(0, limit)) {
    lines.push(`- ${formatTaskLine(task)}`)
  }
  if (tasks.length > limit) {
    lines.push(`- ...${tasks.length - limit} more`)
  }
}

function appendTaskDetails(lines: string[], task: Task): void {
  const step =
    task.steps.find((item) => item.status === 'in_progress') ??
    task.steps.find((item) => item.status === 'pending')
  const note = latestNote(task)
  if (step) {
    lines.push(`- next step: ${step.id} ${truncate(step.title, 90)}`)
  }
  if (note) {
    lines.push(`- latest ${note.kind}: ${truncate(note.content, 120)}`)
  }
}

function formatTaskLine(task: Task): string {
  const steps = formatSteps(task)
  const blockers = task.blockedBy.length
    ? `; blocked by ${task.blockedBy.join(', ')}`
    : ''
  const parent = task.parentId ? `; parent ${task.parentId}` : ''
  return `${task.id} P${task.priority} ${task.type}/${task.status} ${truncate(
    task.title,
    90,
  )}${steps}${blockers}${parent}`
}

function formatSteps(task: Task): string {
  if (task.steps.length === 0) return ''
  const completed = task.steps.filter(
    (step) => step.status === 'completed',
  ).length
  return `; steps ${completed}/${task.steps.length}`
}

function latestNote(task: Task): (TaskNote & { kind: string }) | null {
  const notes = [
    ...task.discoveries.map((note) => ({ ...note, kind: 'discovery' })),
    ...task.decisions.map((note) => ({ ...note, kind: 'decision' })),
  ]
  return notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}
