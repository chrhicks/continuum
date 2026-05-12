import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { Command } from 'commander'
import continuum, { isContinuumError } from '../../sdk'
import type { Task, TaskNote } from '../../sdk/types'
import { getWorkspaceContext, memoryPath } from '../../memory/paths'
import { getStatus } from '../../memory/status'
import { parseFrontmatter } from '../../utils/frontmatter'
import { parseOptionalPositiveInteger } from './shared'

type SummaryOptions = {
  limit?: string
  tasks?: boolean
  memory?: boolean
  memoryLines?: string
}

type TaskSummary = {
  initialized: boolean
  error?: string
  active: Task[]
  ready: Task[]
  open: Task[]
  blocked: Task[]
  completed: Task[]
  nextTask: Task | null
}

const DEFAULT_LIMIT = 5
const DEFAULT_MEMORY_LINES = 12

export function createSummaryCommand(): Command {
  return new Command('summary')
    .description('Show an agent-oriented briefing from tasks and memory')
    .option('--limit <n>', 'Max tasks per bucket', String(DEFAULT_LIMIT))
    .option(
      '--memory-lines <n>',
      'Max memory excerpt lines',
      String(DEFAULT_MEMORY_LINES),
    )
    .option('--no-tasks', 'Omit task summary')
    .option('--no-memory', 'Omit memory summary')
    .action(async (options: SummaryOptions) => {
      const limit = parseOptionalPositiveInteger(
        options.limit,
        DEFAULT_LIMIT,
        'Limit must be a positive integer.',
      )
      const memoryLines = parseOptionalPositiveInteger(
        options.memoryLines,
        DEFAULT_MEMORY_LINES,
        'Memory lines must be a positive integer.',
      )
      console.log(await renderSummary(options, limit, memoryLines))
    })
}

async function renderSummary(
  options: SummaryOptions,
  limit: number,
  memoryLines: number,
): Promise<string> {
  const context = getWorkspaceContext()
  const sections = [
    '# Continuum Summary',
    '',
    `Workspace: ${context.workspaceRoot}`,
  ]
  const taskSummary =
    options.tasks === false ? null : await loadTaskSummary(limit)

  if (taskSummary) {
    sections.push('', renderTaskSummary(taskSummary, limit))
  }
  if (options.memory !== false) {
    sections.push('', renderMemorySummary(memoryLines))
  }
  sections.push('', renderSuggestedCommands(taskSummary))
  return sections.join('\n')
}

async function loadTaskSummary(limit: number): Promise<TaskSummary> {
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

function renderTaskSummary(summary: TaskSummary, limit: number): string {
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

function renderMemorySummary(memoryLines: number): string {
  const status = getStatus()
  const lines = ['## Memory']
  lines.push(`- NOW: ${status.nowPath ? basename(status.nowPath) : 'none'}`)
  lines.push(`- NOW lines: ${status.nowLines}`)
  lines.push(`- RECENT lines: ${status.recentLines}`)
  lines.push(`- last consolidation: ${status.lastConsolidation ?? 'n/a'}`)

  if (status.nowPath) {
    appendExcerpt(lines, 'NOW tail', status.nowPath, memoryLines, 'tail')
  }
  appendExcerpt(
    lines,
    'RECENT excerpt',
    memoryPath('RECENT.md'),
    memoryLines,
    'head',
  )
  return lines.join('\n')
}

function appendExcerpt(
  lines: string[],
  title: string,
  path: string,
  limit: number,
  mode: 'head' | 'tail',
): void {
  const excerpt = readExcerpt(path, limit, mode)
  if (excerpt.length === 0) return
  lines.push('', `### ${title}`)
  for (const line of excerpt) {
    lines.push(`- ${line}`)
  }
}

function readExcerpt(
  path: string,
  limit: number,
  mode: 'head' | 'tail',
): string[] {
  if (!existsSync(path)) return []
  const parsed = parseFrontmatter(readFileSync(path, 'utf-8'))
  const lines = parsed.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('# Session:'))
  const slice = mode === 'head' ? lines.slice(0, limit) : lines.slice(-limit)
  return slice.map((line) => truncate(normalizeMemoryLine(line), 160))
}

function normalizeMemoryLine(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/^[-*]\s+/, '')
}

function renderSuggestedCommands(summary: TaskSummary | null): string {
  const lines = ['## Suggested Commands']
  lines.push('- continuum guide')
  lines.push('- continuum guide task')
  if (summary?.nextTask) {
    lines.push(
      `- continuum task get ${summary.nextTask.id} --expand parent,children,blockers`,
    )
  } else if (summary?.initialized === false) {
    lines.push('- continuum init')
  } else if (summary?.completed.length) {
    lines.push(
      '- continuum task list --status completed --sort updatedAt --order desc --limit 5',
    )
  } else {
    lines.push(
      '- continuum task list --status ready --sort priority --order asc',
    )
  }
  lines.push('- continuum memory search "<query>"')
  return lines.join('\n')
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}
