import { Command } from 'commander'
import continuum, { isValidTaskType, TASK_TYPES } from '../../sdk'
import type {
  Task,
  TaskGraphQuery,
  TaskStatus,
  TaskStepStatus,
  TaskType,
} from '../../sdk/types'
import { parseIdList, readInput, readJsonInput, runCommand } from '../io'
import {
  TASK_STEP_JSON_SCHEMA,
  TASK_STEP_TEMPLATE,
  validateTaskStepsInput,
} from '../task-steps'

type TaskListOptions = {
  status?: string
  type?: string
  parent?: string
  includeDeleted?: boolean
  cursor?: string
  limit?: string
  sort?: string
  order?: string
}

type TaskGetOptions = {
  expand?: string
  tree?: boolean
  includeDeleted?: boolean
}

type TaskCreateOptions = {
  input?: string
  title?: string
  type?: string
  status?: string
  intent?: string
  description?: string
  plan?: string
  parent?: string
  blockedBy?: string | string[]
}

type TaskUpdateOptions = {
  patch?: string
  title?: string
  type?: string
  status?: string
  intent?: string
  description?: string
  plan?: string
  parent?: string
  blockedBy?: string | string[]
}

type TaskCompleteOptions = {
  outcome?: string
}

type TaskValidateOptions = {
  transition?: string
}

type TaskStepsAddOptions = {
  steps?: string
}

type TaskStepsTemplateOptions = {
  schema?: boolean
}

type TaskStepsUpdateOptions = {
  patch?: string
  title?: string
  description?: string
  status?: string
  position?: string
  summary?: string
  notes?: string
}

type TaskStepsCompleteOptions = {
  stepId?: string
  notes?: string
}

type TaskNoteAddOptions = {
  kind?: string
  content?: string
  rationale?: string
  impact?: string
  source?: string
}

type ExpandOptions = {
  parent: boolean
  children: boolean
  blockers: boolean
}

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
    .action(async (_options: unknown, command: Command) => {
      await runCommand(
        command,
        async () => {
          const status = await continuum.task.init()
          return { status }
        },
        ({ status }) => {
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
          console.log('  continuum task get <task_id>     View task details')
        },
      )
    })

  taskCommand
    .command('list')
    .description('List all tasks')
    .option('-s, --status <status>', 'Filter by status')
    .option('-t, --type <type>', 'Filter by type')
    .option('--parent <task_id>', 'Filter by parent task')
    .option('--include-deleted', 'Include deleted tasks')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <limit>', 'Limit results')
    .option('--sort <sort>', 'Sort by createdAt or updatedAt')
    .option('--order <order>', 'Sort order asc or desc')
    .action(async (options: TaskListOptions, command: Command) => {
      await runCommand(
        command,
        async () => {
          const parsed = parseTaskListOptions(options)
          return continuum.task.list(parsed)
        },
        (result) => {
          renderTaskList(result.tasks)
          if (result.nextCursor) {
            console.log(`Next cursor: ${result.nextCursor}`)
          }
        },
      )
    })

  taskCommand
    .command('get')
    .alias('view')
    .description('View task details')
    .argument('<task_id>', 'Task ID to view')
    .option('--tree', 'Include all child tasks (compact view)')
    .option('--expand <items>', 'Comma-separated: parent,children,blockers,all')
    .option('--include-deleted', 'Include deleted children in tree/expand')
    .action(
      async (taskId: string, options: TaskGetOptions, command: Command) => {
        await runCommand(
          command,
          async () => {
            const task = await continuum.task.get(taskId)
            if (!task) {
              throw new Error(`Task '${taskId}' not found.`)
            }
            const expand = parseExpandOptions(options.expand, options.tree)
            const parent =
              expand.parent && task.parentId
                ? await continuum.task.get(task.parentId)
                : null
            const children = expand.children
              ? (
                  await continuum.task.list({
                    parentId: task.id,
                    includeDeleted: options.includeDeleted,
                    limit: 1000,
                  })
                ).tasks
              : undefined
            const blockers = expand.blockers
              ? (
                  await Promise.all(
                    task.blockedBy.map((id) => continuum.task.get(id)),
                  )
                ).filter((item): item is Task => Boolean(item))
              : undefined
            return { task, parent, children, blockers }
          },
          (result) => {
            if (options.tree) {
              renderTaskTree(result.task, result.children ?? [])
              return
            }
            renderTaskDetails(result.task)
            if (result.parent) {
              console.log(`Parent:  ${result.parent.id} ${result.parent.title}`)
            }
            if (result.blockers && result.blockers.length > 0) {
              console.log('')
              console.log('Blockers:')
              for (const blocker of result.blockers) {
                console.log(`- ${blocker.id} ${blocker.title}`)
              }
            }
            if (result.children && result.children.length > 0) {
              console.log('')
              console.log(`Children (${result.children.length}):`)
              for (const child of result.children) {
                console.log(`- ${child.id} ${child.title}`)
              }
            }
            console.log('')
          },
        )
      },
    )

  taskCommand
    .command('create')
    .description('Create a task')
    .option('--input <path>', 'JSON input (use @file or @-)')
    .option('--title <title>', 'Task title')
    .option('--type <type>', 'Task type')
    .option('--status <status>', 'Initial status')
    .option('--intent <intent>', 'Task intent')
    .option('--description <description>', 'Task description (@file or @-)')
    .option('--plan <plan>', 'Task plan (@file or @-)')
    .option('--parent <task_id>', 'Parent task ID')
    .option('--blocked-by <ids...>', 'Comma-separated blocker IDs')
    .action(
      async (options: TaskCreateOptions, command: Command): Promise<void> => {
        let initCreated = false
        await runCommand(
          command,
          async () => {
            const initStatus = await continuum.task.init()
            initCreated = initStatus.created
            const inputFromFile = await readJsonInput<
              Partial<{
                title: string
                type: TaskType
                status: TaskStatus
                intent: string | null
                description: string
                plan: string | null
                parentId: string | null
                blockedBy: string[] | null
              }>
            >(options.input)
            const title = options.title ?? inputFromFile?.title
            const typeValue = options.type ?? inputFromFile?.type
            const descriptionRaw =
              options.description ?? inputFromFile?.description
            const description = await readInput(descriptionRaw)
            const intentRaw =
              options.intent ?? inputFromFile?.intent ?? undefined
            const intent = await readInput(intentRaw)
            const planRaw = options.plan ?? inputFromFile?.plan ?? undefined
            const plan = await readInput(planRaw)

            if (!title?.trim()) {
              throw new Error('Missing required field: title')
            }
            if (!typeValue?.trim()) {
              throw new Error('Missing required field: type')
            }
            const type = parseTaskType(typeValue)
            const status = options.status
              ? parseTaskStatus(options.status)
              : inputFromFile?.status
            const parentId = options.parent ?? inputFromFile?.parentId
            const blockedBy =
              parseIdList(options.blockedBy) ??
              parseIdList(inputFromFile?.blockedBy ?? undefined)

            const task = await continuum.task.create({
              title,
              type,
              status,
              intent: intent ?? null,
              description: description ?? '',
              plan: plan ?? null,
              parentId: parentId ?? null,
              blockedBy: blockedBy ?? null,
            })
            return { task }
          },
          ({ task }) => {
            if (initCreated) {
              console.log(
                `Initialized continuum in current directory and created task ${task.id}`,
              )
              return
            }
            console.log(`Created task ${task.id}`)
          },
        )
      },
    )

  taskCommand
    .command('update')
    .description('Update a task')
    .argument('<task_id>', 'Task ID to update')
    .option('--patch <path>', 'JSON patch input (use @file or @-)')
    .option('--title <title>', 'Task title')
    .option('--type <type>', 'Task type')
    .option('--status <status>', 'Task status')
    .option('--intent <intent>', 'Task intent')
    .option('--description <description>', 'Task description (@file or @-)')
    .option('--plan <plan>', 'Task plan (@file or @-)')
    .option('--parent <task_id>', 'Parent task ID')
    .option('--blocked-by <ids...>', 'Comma-separated blocker IDs')
    .action(
      async (
        taskId: string,
        options: TaskUpdateOptions,
        command: Command,
      ): Promise<void> => {
        await runCommand(
          command,
          async () => {
            const patchFromFile = await readJsonInput<Record<string, unknown>>(
              options.patch,
            )
            const descriptionRaw = options.description
            const description = await readInput(descriptionRaw)
            const intentRaw = options.intent
            const intent = await readInput(intentRaw)
            const planRaw = options.plan
            const plan = await readInput(planRaw)

            const update: Record<string, unknown> = {
              ...(patchFromFile ?? {}),
            }
            if (options.title !== undefined) update.title = options.title
            if (options.type !== undefined) {
              update.type = parseTaskType(options.type)
            }
            if (options.status !== undefined) {
              update.status = parseTaskStatus(options.status)
            }
            if (intent !== undefined) update.intent = intent
            if (description !== undefined) update.description = description
            if (plan !== undefined) update.plan = plan
            if (options.parent !== undefined) update.parentId = options.parent
            const blockedBy = parseIdList(options.blockedBy)
            if (blockedBy !== undefined) update.blockedBy = blockedBy

            const task = await continuum.task.update(taskId, update as any)
            return { task }
          },
          ({ task }) => {
            console.log(`Updated task ${task.id}`)
          },
        )
      },
    )

  taskCommand
    .command('complete')
    .description('Complete a task')
    .argument('<task_id>', 'Task ID to complete')
    .option('--outcome <outcome>', 'Outcome summary (@file or @-)')
    .action(
      async (
        taskId: string,
        options: TaskCompleteOptions,
        command: Command,
      ) => {
        await runCommand(
          command,
          async () => {
            const outcome = await readInput(options.outcome)
            if (!outcome?.trim()) {
              throw new Error('Missing required field: outcome')
            }
            const task = await continuum.task.complete(taskId, { outcome })
            return { task }
          },
          ({ task }) => {
            console.log(`Completed task ${task.id}`)
          },
        )
      },
    )

  taskCommand
    .command('delete')
    .description('Delete a task')
    .argument('<task_id>', 'Task ID to delete')
    .action(async (taskId: string, command: Command) => {
      await runCommand(
        command,
        async () => {
          await continuum.task.delete(taskId)
          return { deleted: true }
        },
        () => {
          console.log(`Deleted task ${taskId}`)
        },
      )
    })

  taskCommand
    .command('validate')
    .description('Validate a status transition')
    .argument('<task_id>', 'Task ID to validate')
    .option('--transition <status>', 'Target status')
    .action(
      async (
        taskId: string,
        options: TaskValidateOptions,
        command: Command,
      ) => {
        await runCommand(
          command,
          async () => {
            if (!options.transition) {
              throw new Error('Missing required option: --transition')
            }
            const status = parseTaskStatus(options.transition)
            const result = await continuum.task.validateTransition(
              taskId,
              status,
            )
            return { taskId, status, ...result }
          },
          (result) => {
            if (
              result.missingFields.length === 0 &&
              result.openBlockers.length === 0
            ) {
              console.log('Transition is valid.')
              return
            }
            if (result.missingFields.length > 0) {
              console.log('Missing fields:')
              for (const field of result.missingFields) {
                console.log(`- ${field}`)
              }
            }
            if (result.openBlockers.length > 0) {
              console.log('Open blockers:')
              for (const blocker of result.openBlockers) {
                console.log(`- ${blocker}`)
              }
            }
          },
        )
      },
    )

  taskCommand
    .command('graph')
    .description('Query task graph relationships')
    .argument('<query>', 'ancestors, descendants, or children')
    .argument('<task_id>', 'Task ID to query')
    .action(async (query: string, taskId: string, command: Command) => {
      await runCommand(
        command,
        async () => {
          const parsed = parseTaskGraphQuery(query)
          const result = await continuum.task.graph(parsed, taskId)
          return { query: parsed, taskId, taskIds: result.taskIds }
        },
        (result) => {
          if (result.taskIds.length === 0) {
            console.log('No tasks found.')
            return
          }
          for (const id of result.taskIds) {
            console.log(id)
          }
        },
      )
    })

  const templatesCommand = new Command('templates').description(
    'Template helpers',
  )
  templatesCommand
    .command('list')
    .description('List available task templates')
    .action(async (_options: unknown, command: Command) => {
      await runCommand(
        command,
        async () => ({ templates: TASK_TYPES }),
        ({ templates }) => {
          console.log('Templates:')
          for (const template of templates) {
            console.log(`- ${template}`)
          }
        },
      )
    })
  taskCommand.addCommand(templatesCommand)

  const stepsCommand = new Command('steps')
    .alias('step')
    .description('Manage task steps')
  stepsCommand
    .command('template')
    .description('Print steps JSON template')
    .option('--schema', 'Print JSON schema')
    .action(
      async (
        options: TaskStepsTemplateOptions,
        command: Command,
      ): Promise<void> => {
        await runCommand(
          command,
          async () => ({
            template: TASK_STEP_TEMPLATE,
            schema: TASK_STEP_JSON_SCHEMA,
          }),
          ({ template, schema }) => {
            const payload = options.schema ? schema : template
            console.log(JSON.stringify(payload, null, 2))
          },
        )
      },
    )
  stepsCommand
    .command('add')
    .description('Add steps to a task')
    .argument('<task_id>', 'Task ID')
    .option('--steps <steps>', 'Steps JSON array (inline JSON, @file, or @-)')
    .action(
      async (
        taskId: string,
        options: TaskStepsAddOptions,
        command: Command,
      ) => {
        await runCommand(
          command,
          async () => {
            const rawSteps = await readJsonInput<unknown>(options.steps)
            if (rawSteps === undefined) {
              throw new Error('Missing required option: --steps')
            }
            const steps = validateTaskStepsInput(rawSteps)
            const task = await continuum.task.steps.add(taskId, { steps })
            return { task }
          },
          ({ task }) => {
            console.log(`Updated steps for ${task.id}`)
          },
        )
      },
    )

  stepsCommand
    .command('update')
    .description('Update a task step')
    .argument('<task_id>', 'Task ID')
    .argument('<step_id>', 'Step ID')
    .option('--patch <path>', 'Patch JSON object (use @file or @-)')
    .option('--title <title>', 'Step title')
    .option('--description <description>', 'Step description (@file or @-)')
    .option('--status <status>', 'Step status')
    .option('--position <position>', 'Step position')
    .option('--summary <summary>', 'Step summary (@file or @-)')
    .option('--notes <notes>', 'Step notes (@file or @-)')
    .action(
      async (
        taskId: string,
        stepId: string,
        options: TaskStepsUpdateOptions,
        command: Command,
      ) => {
        await runCommand(
          command,
          async () => {
            const patchFromFile = await readJsonInput<Record<string, unknown>>(
              options.patch,
            )
            const description = await readInput(options.description)
            const summary = await readInput(options.summary)
            const notes = await readInput(options.notes)
            const update: Record<string, unknown> = {
              ...(patchFromFile ?? {}),
            }
            if (options.title !== undefined) update.title = options.title
            if (description !== undefined) update.description = description
            if (options.status !== undefined) {
              update.status = parseTaskStepStatus(options.status)
            }
            if (options.position !== undefined) {
              update.position = parsePosition(options.position)
            }
            if (summary !== undefined) update.summary = summary
            if (notes !== undefined) update.notes = notes
            const task = await continuum.task.steps.update(
              taskId,
              stepId,
              update as any,
            )
            return { task }
          },
          ({ task }) => {
            console.log(`Updated steps for ${task.id}`)
          },
        )
      },
    )

  stepsCommand
    .command('complete')
    .description('Complete a step')
    .argument('<task_id>', 'Task ID')
    .option('--step-id <step_id>', 'Step ID (defaults to current step)')
    .option('--notes <notes>', 'Completion notes (@file or @-)')
    .action(
      async (
        taskId: string,
        options: TaskStepsCompleteOptions,
        command: Command,
      ) => {
        await runCommand(
          command,
          async () => {
            const notes = await readInput(options.notes)
            const result = await continuum.task.steps.complete(taskId, {
              stepId: options.stepId,
              notes,
            })
            return result
          },
          ({ task, warnings }) => {
            if (warnings && warnings.length > 0) {
              for (const warning of warnings) {
                console.log(`Warning: ${warning}`)
              }
              return
            }
            console.log(`Updated steps for ${task.id}`)
          },
        )
      },
    )

  stepsCommand
    .command('list')
    .description('List task steps')
    .argument('<task_id>', 'Task ID')
    .action(async (taskId: string, _options: unknown, command: Command) => {
      await runCommand(
        command,
        async () => {
          const task = await continuum.task.get(taskId)
          if (!task) {
            throw new Error(`Task '${taskId}' not found.`)
          }
          return { taskId: task.id, steps: task.steps }
        },
        (result) => {
          if (result.steps.length === 0) {
            console.log('No steps found.')
            return
          }
          for (const step of result.steps) {
            const marker =
              step.status === 'completed'
                ? '[x]'
                : step.status === 'in_progress'
                  ? '[>]'
                  : step.status === 'skipped'
                    ? '[~]'
                    : '[ ]'
            console.log(`${marker} ${step.id} ${step.title}`)
          }
        },
      )
    })
  taskCommand.addCommand(stepsCommand)

  const noteCommand = new Command('note').description('Manage task notes')
  noteCommand
    .command('add')
    .description('Add a discovery or decision')
    .argument('<task_id>', 'Task ID')
    .option('--kind <kind>', 'discovery or decision')
    .option('--content <content>', 'Note content (inline text, @file, or @-)')
    .option('--rationale <rationale>', 'Decision rationale (@file or @-)')
    .option('--impact <impact>', 'Impact summary (@file or @-)')
    .option('--source <source>', 'user, agent, or system (default: agent)')
    .action(
      async (taskId: string, options: TaskNoteAddOptions, command: Command) => {
        await runCommand(
          command,
          async () => {
            if (!options.kind) {
              throw new Error('Missing required option: --kind')
            }
            const kind = parseNoteKind(options.kind)
            const content = await readInput(options.content)
            if (!content?.trim()) {
              throw new Error('Missing required field: content')
            }
            const rationale = await readInput(options.rationale)
            const impact = await readInput(options.impact)
            const source = parseNoteSource(options.source)
            const task = await continuum.task.notes.add(taskId, {
              kind,
              content,
              rationale: rationale ?? undefined,
              impact: impact ?? undefined,
              source,
            })
            return { task }
          },
          ({ task }) => {
            console.log(`Updated notes for ${task.id}`)
          },
        )
      },
    )
  taskCommand.addCommand(noteCommand)

  return taskCommand
}

function parseTaskListOptions(options: TaskListOptions) {
  return {
    status: options.status ? parseTaskStatus(options.status) : undefined,
    type: options.type ? parseTaskType(options.type) : undefined,
    parentId: options.parent ? options.parent.trim() : undefined,
    includeDeleted: options.includeDeleted ?? false,
    cursor: options.cursor,
    limit: options.limit ? parseLimit(options.limit) : undefined,
    sort: options.sort ? parseSort(options.sort) : undefined,
    order: options.order ? parseOrder(options.order) : undefined,
  }
}

function parseTaskStatus(value: string): TaskStatus {
  const normalized = value.trim()
  const allowed: TaskStatus[] = [
    'open',
    'ready',
    'blocked',
    'completed',
    'cancelled',
    'deleted',
  ]
  if (allowed.includes(normalized as TaskStatus)) {
    return normalized as TaskStatus
  }
  throw new Error(
    'Invalid status. Use: open, ready, blocked, completed, cancelled, deleted.',
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

function parseTaskStepStatus(value: string): TaskStepStatus {
  const normalized = value.trim()
  const allowed: TaskStepStatus[] = [
    'pending',
    'in_progress',
    'completed',
    'skipped',
  ]
  if (allowed.includes(normalized as TaskStepStatus)) {
    return normalized as TaskStepStatus
  }
  throw new Error(
    'Invalid step status. Use: pending, in_progress, completed, skipped.',
  )
}

function parseTaskGraphQuery(value: string): TaskGraphQuery {
  const normalized = value.trim()
  const allowed: TaskGraphQuery[] = ['ancestors', 'descendants', 'children']
  if (allowed.includes(normalized as TaskGraphQuery)) {
    return normalized as TaskGraphQuery
  }
  throw new Error('Invalid query. Use: ancestors, descendants, children.')
}

function parseExpandOptions(value?: string, tree?: boolean): ExpandOptions {
  const defaults: ExpandOptions = {
    parent: false,
    children: false,
    blockers: false,
  }
  if (tree) {
    return { ...defaults, children: true }
  }
  if (!value) return defaults
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const expanded = { ...defaults }
  if (items.includes('all')) {
    expanded.parent = true
    expanded.children = true
    expanded.blockers = true
    return expanded
  }
  for (const item of items) {
    if (item === 'parent') expanded.parent = true
    if (item === 'children') expanded.children = true
    if (item === 'blockers') expanded.blockers = true
  }
  return expanded
}

function parseLimit(value: string): number {
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Limit must be a positive integer.')
  }
  return limit
}

function parseSort(value: string): 'createdAt' | 'updatedAt' {
  const normalized = value.trim()
  if (normalized === 'createdAt' || normalized === 'updatedAt') {
    return normalized
  }
  throw new Error('Invalid sort. Use: createdAt or updatedAt.')
}

function parseOrder(value: string): 'asc' | 'desc' {
  const normalized = value.trim()
  if (normalized === 'asc' || normalized === 'desc') {
    return normalized
  }
  throw new Error('Invalid order. Use: asc or desc.')
}

function parsePosition(value: string): number {
  const position = Number(value)
  if (!Number.isInteger(position)) {
    throw new Error('Position must be an integer.')
  }
  return position
}

function parseNoteKind(value: string): 'discovery' | 'decision' {
  const normalized = value.trim()
  if (normalized === 'discovery' || normalized === 'decision') {
    return normalized
  }
  throw new Error('Invalid kind. Use: discovery or decision.')
}

function parseNoteSource(value?: string): 'user' | 'agent' | 'system' {
  if (!value) return 'agent'
  const normalized = value.trim()
  if (
    normalized === 'user' ||
    normalized === 'agent' ||
    normalized === 'system'
  ) {
    return normalized
  }
  throw new Error('Invalid source. Use: user, agent, or system.')
}

function renderTaskList(tasks: Task[]): void {
  if (tasks.length === 0) {
    console.log('No tasks found.')
    return
  }

  const idWidth = Math.max(12, ...tasks.map((task) => task.id.length))
  const typeWidth = Math.max(6, ...tasks.map((task) => task.type.length))
  const statusWidth = Math.max(11, ...tasks.map((task) => task.status.length))

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

  for (const task of tasks) {
    const id = task.id.padEnd(idWidth)
    const type = task.type.padEnd(typeWidth)
    const status = task.status.padEnd(statusWidth)
    const title =
      task.title.length > 50 ? `${task.title.slice(0, 47)}...` : task.title

    console.log(`${id}  ${type}  ${status}  ${title}`)
  }

  console.log(`\n${tasks.length} task(s)`)
}

function renderTaskTree(task: Task, children: Task[]): void {
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

function renderTaskDetails(task: Task): void {
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

function formatTaskDate(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
