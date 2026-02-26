import type {
  Task,
  TaskDecision,
  TaskDiscovery,
  TaskStepStatus,
} from '../../../sdk/types'

export function formatDiscovery(taskId: string, note: TaskDiscovery): string {
  const lines = [`[Discovery from ${taskId}] ${note.content}`]
  if (note.impact) {
    lines.push(`Impact: ${note.impact}`)
  }
  return lines.join('\n')
}

export function formatDecision(taskId: string, note: TaskDecision): string {
  const lines = [`[Decision from ${taskId}] ${note.content}`]
  if (note.rationale) {
    lines.push(`Rationale: ${note.rationale}`)
  }
  if (note.impact) {
    lines.push(`Impact: ${note.impact}`)
  }
  return lines.join('\n')
}

export function renderNextSteps(steps: string[]): void {
  if (steps.length === 0) return
  console.log('')
  console.log('Next steps:')
  for (const step of steps) {
    console.log(`  ${step}`)
  }
}

export function renderTaskList(tasks: Task[]): void {
  if (tasks.length === 0) {
    console.log('No tasks found.')
    return
  }

  const idWidth = Math.max(12, ...tasks.map((task) => task.id.length))
  const priorityWidth = Math.max(
    8,
    ...tasks.map((task) => String(task.priority).length),
  )
  const typeWidth = Math.max(6, ...tasks.map((task) => task.type.length))
  const statusWidth = Math.max(11, ...tasks.map((task) => task.status.length))

  console.log(
    'ID'.padEnd(idWidth) +
      '  ' +
      'Priority'.padEnd(priorityWidth) +
      '  ' +
      'Type'.padEnd(typeWidth) +
      '  ' +
      'Status'.padEnd(statusWidth) +
      '  ' +
      'Title',
  )
  console.log(
    '-'.repeat(idWidth + priorityWidth + typeWidth + statusWidth + 50),
  )

  for (const task of tasks) {
    const id = task.id.padEnd(idWidth)
    const priority = String(task.priority).padEnd(priorityWidth)
    const type = task.type.padEnd(typeWidth)
    const status = task.status.padEnd(statusWidth)
    const title =
      task.title.length > 50 ? `${task.title.slice(0, 47)}...` : task.title

    console.log(`${id}  ${priority}  ${type}  ${status}  ${title}`)
  }

  console.log(`\n${tasks.length} task(s)`)
}

export function renderTaskTree(task: Task, children: Task[]): void {
  console.log('='.repeat(70))
  console.log(
    `${task.type.toUpperCase()}: ${task.title} [${task.id}] (${task.status}, priority ${task.priority})`,
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
}

export function renderTaskDetails(task: Task): void {
  console.log('='.repeat(60))
  console.log(task.title)
  console.log('='.repeat(60))
  console.log('')

  console.log(`ID:      ${task.id}`)
  console.log(`Type:    ${task.type}`)
  console.log(`Status:  ${task.status}`)
  console.log(`Priority: ${task.priority}`)
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
      const marker = formatStepMarker(step.status)
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
}

function formatTaskCompact(task: Task, indent: string = ''): string {
  const lines: string[] = []

  const header = `${indent}[${task.id}] P${task.priority} ${task.type}/${task.status} ${task.title}`
  lines.push(header)

  if (task.intent) {
    lines.push(`${indent}  Intent: ${task.intent}`)
  }

  if (task.blockedBy.length > 0) {
    lines.push(`${indent}  Blocked by: ${task.blockedBy.join(', ')}`)
  }

  if (task.steps.length > 0) {
    const stepMarkers = task.steps
      .map((step) => formatStepMarker(step.status, true))
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

function formatTaskDate(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatStepMarker(
  status: TaskStepStatus,
  compact = false,
): string {
  if (status === 'completed') {
    return compact ? 'x' : '[x]'
  }
  if (status === 'in_progress') {
    return compact ? '>' : '[>]'
  }
  if (status === 'skipped') {
    return compact ? '~' : '[~]'
  }
  return compact ? '.' : '[ ]'
}
