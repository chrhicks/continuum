import { Command } from 'commander'
import continuum, { isContinuumError, isValidTaskType } from '../../sdk'
import type { Task, TaskStatus, TaskType } from '../../sdk/types'

export function createTaskCommand(): Command {
  const taskCommand = new Command('task').description(
    'Task management commands',
  )

  taskCommand.action(() => {
    taskCommand.outputHelp()
  })

  taskCommand
    .command('init')
    .description('Initialize continuum database in current directory')
    .action(async () => {
      await handleTaskInit()
    })

  taskCommand
    .command('list')
    .description('List all tasks')
    .option('-s, --status <status>', 'Filter by status')
    .option('-t, --type <type>', 'Filter by type')
    .action(async (options: { status?: string; type?: string }) => {
      await handleTaskList(options)
    })

  taskCommand
    .command('view')
    .description('View task details')
    .alias('get')
    .argument('<task_id>', 'Task ID to view')
    .option('--tree', 'Include all child tasks (useful for epics)')
    .action(async (taskId: string, options: { tree?: boolean }) => {
      await handleTaskView(taskId, { tree: options.tree ?? false })
    })

  return taskCommand
}

async function handleTaskInit(): Promise<void> {
  const status = await continuum.task.init()

  if (!status.created) {
    console.log('Continuum is already initialized in this directory.')
    console.log(`Database: ${process.cwd()}/.continuum/continuum.db`)
    return
  }

  console.log('Initialized continuum in current directory.')
  console.log(`Database: ${process.cwd()}/.continuum/continuum.db`)
  console.log('')
  console.log('Next steps:')
  console.log('  continuum task list              List tasks')
  console.log('  continuum task view <task_id>    View task details')
}

async function handleTaskList(options: {
  status?: string
  type?: string
}): Promise<void> {
  const parsed = parseTaskListOptions(options)
  await listTaskOverview(parsed)
}

async function handleTaskView(
  taskId: string,
  options: { tree: boolean },
): Promise<void> {
  await viewTaskDetails(taskId, options)
}

function parseTaskListOptions(options: { status?: string; type?: string }): {
  status?: TaskStatus
  type?: TaskType
} {
  const parsed: { status?: TaskStatus; type?: TaskType } = {}

  if (options.status) {
    parsed.status = parseTaskStatus(options.status)
  }
  if (options.type) {
    parsed.type = parseTaskType(options.type)
  }

  return parsed
}

function parseTaskStatus(value: string): TaskStatus {
  const normalized = value.trim()
  const allowed: TaskStatus[] = [
    'open',
    'ready',
    'blocked',
    'completed',
    'cancelled',
  ]
  if (allowed.includes(normalized as TaskStatus)) {
    return normalized as TaskStatus
  }
  throw new Error(
    'Invalid status. Use: open, ready, blocked, completed, cancelled.',
  )
}

function parseTaskType(value: string): TaskType {
  const normalized = value.trim()
  if (isValidTaskType(normalized)) {
    return normalized as TaskType
  }
  throw new Error(
    'Invalid type. Use: epic, feature, bug, investigation, chore.',
  )
}

async function listTaskOverview(options: {
  status?: TaskStatus
  type?: TaskType
}): Promise<void> {
  try {
    const result = await continuum.task.list({
      status: options.status,
      limit: 1000,
    })
    const tasks = result.tasks

    const filtered = options.type
      ? tasks.filter((task) => task.type === options.type)
      : tasks

    if (filtered.length === 0) {
      console.log('No tasks found.')
      return
    }

    const idWidth = Math.max(12, ...filtered.map((task) => task.id.length))
    const typeWidth = Math.max(6, ...filtered.map((task) => task.type.length))
    const statusWidth = Math.max(
      11,
      ...filtered.map((task) => task.status.length),
    )

    console.log(
      'ID'.padEnd(idWidth) +
        '  ' +
        'Type'.padEnd(typeWidth) +
        '  ' +
        'Status'.padEnd(statusWidth) +
        '  ' +
        'Title',
    )
    console.log('-'.repeat(idWidth + typeWidth + statusWidth + 40))

    for (const task of filtered) {
      const id = task.id.padEnd(idWidth)
      const type = task.type.padEnd(typeWidth)
      const status = task.status.padEnd(statusWidth)
      const title =
        task.title.length > 50 ? `${task.title.slice(0, 47)}...` : task.title

      console.log(`${id}  ${type}  ${status}  ${title}`)
    }

    console.log(`\n${filtered.length} task(s)`)
  } catch (error) {
    if (isContinuumError(error) && error.code === 'NOT_INITIALIZED') {
      console.error(
        'Error: No .continuum directory found. Run continuum task init first.',
      )
      process.exit(1)
    }
    throw error
  }
}

function formatTaskCompact(task: Task, indent: string = ''): string {
  const lines: string[] = []

  const header = `${indent}[${task.id}] ${task.type}/${task.status} ${task.title}`
  lines.push(header)

  if (task.intent) {
    lines.push(`${indent}  Intent: ${task.intent}`)
  }

  if (task.blockedBy.length > 0) {
    lines.push(`${indent}  Blocked by: ${task.blockedBy.join(', ')}`)
  }

  if (task.steps.length > 0) {
    const stepMarkers = task.steps
      .map((step) => {
        if (step.status === 'completed') return 'x'
        if (step.status === 'in_progress') return '>'
        if (step.status === 'skipped') return '~'
        return '.'
      })
      .join('')
    const stepNames = task.steps
      .map((step) => step.title || `Step ${step.id}`)
      .join(' -> ')
    lines.push(`${indent}  Steps: [${stepMarkers}] ${stepNames}`)
  }

  if (task.discoveries.length > 0) {
    lines.push(`${indent}  Discoveries: ${task.discoveries.length}`)
  }

  if (task.decisions.length > 0) {
    lines.push(`${indent}  Decisions: ${task.decisions.length}`)
  }

  if (task.outcome) {
    const truncated =
      task.outcome.length > 80
        ? `${task.outcome.slice(0, 77)}...`
        : task.outcome
    lines.push(`${indent}  Outcome: ${truncated}`)
  }

  return lines.join('\n')
}

async function viewTaskDetails(
  taskId: string,
  options: { tree: boolean },
): Promise<void> {
  try {
    const task = await continuum.task.get(taskId)

    if (!task) {
      console.error(`Error: Task '${taskId}' not found.`)
      process.exit(1)
    }

    if (options.tree) {
      console.log('='.repeat(70))
      console.log(
        `${task.type.toUpperCase()}: ${task.title} [${task.id}] (${task.status})`,
      )
      console.log('='.repeat(70))

      if (task.intent) {
        console.log(`Intent: ${task.intent}`)
      }

      if (task.description) {
        console.log(`Description: ${task.description}`)
      }

      if (task.plan) {
        console.log('')
        console.log('Plan:')
        console.log(task.plan)
      }

      const childrenResult = await continuum.task.list({
        parentId: task.id,
        limit: 1000,
      })
      const children = childrenResult.tasks

      if (children.length > 0) {
        console.log('')
        console.log(`CHILDREN (${children.length}):`)
        console.log('')

        for (let i = 0; i < children.length; i += 1) {
          const child = children[i]
          console.log(`[${i + 1}] ${formatTaskCompact(child, '    ').trim()}`)
          console.log('')
        }
      }

      const completed = children.filter(
        (child) => child.status === 'completed',
      ).length
      const ready = children.filter((child) => child.status === 'ready').length
      const open = children.filter((child) => child.status === 'open').length
      const blocked = children.filter(
        (child) => child.blockedBy.length > 0 && child.status !== 'completed',
      ).length

      if (children.length > 0) {
        console.log('-'.repeat(70))
        console.log(
          `Summary: ${completed}/${children.length} completed, ${ready} ready, ${open} open${
            blocked > 0 ? `, ${blocked} blocked` : ''
          }`,
        )
      }

      console.log('')
      return
    }

    console.log('='.repeat(60))
    console.log(task.title)
    console.log('='.repeat(60))
    console.log('')

    console.log(`ID:      ${task.id}`)
    console.log(`Type:    ${task.type}`)
    console.log(`Status:  ${task.status}`)
    console.log(`Created: ${formatTaskDate(task.createdAt)}`)
    console.log(`Updated: ${formatTaskDate(task.updatedAt)}`)

    if (task.parentId) {
      console.log(`Parent:  ${task.parentId}`)
    }

    if (task.blockedBy.length > 0) {
      console.log(`Blocked by: ${task.blockedBy.join(', ')}`)
    }

    if (task.intent) {
      console.log('')
      console.log('Intent:')
      console.log(task.intent)
    }

    if (task.description) {
      console.log('')
      console.log('Description:')
      console.log(task.description)
    }

    if (task.plan) {
      console.log('')
      console.log('Plan:')
      console.log(task.plan)
    }

    if (task.steps.length > 0) {
      console.log('')
      console.log('Steps:')
      for (const step of task.steps) {
        const marker =
          step.status === 'completed'
            ? '[x]'
            : step.status === 'in_progress'
              ? '[>]'
              : step.status === 'skipped'
                ? '[~]'
                : '[ ]'
        console.log(`  ${marker} ${step.title || `Step ${step.id}`}`)
        if (step.summary) {
          console.log(`      ${step.summary}`)
        }
        if (step.notes) {
          console.log(`      Notes: ${step.notes}`)
        }
      }
    }

    if (task.discoveries.length > 0) {
      console.log('')
      console.log('Discoveries:')
      for (const discovery of task.discoveries) {
        console.log(`  - ${discovery.content}`)
        console.log(`    ${formatTaskDate(discovery.createdAt)}`)
      }
    }

    if (task.decisions.length > 0) {
      console.log('')
      console.log('Decisions:')
      for (const decision of task.decisions) {
        console.log(`  - ${decision.content}`)
        if (decision.rationale) {
          console.log(`    Rationale: ${decision.rationale}`)
        }
        console.log(`    ${formatTaskDate(decision.createdAt)}`)
      }
    }

    if (task.outcome) {
      console.log('')
      console.log('Outcome:')
      console.log(task.outcome)
    }

    console.log('')
  } catch (error) {
    if (isContinuumError(error) && error.code === 'NOT_INITIALIZED') {
      console.error(
        'Error: No .continuum directory found. Run continuum task init first.',
      )
      process.exit(1)
    }
    throw error
  }
}

function formatTaskDate(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
