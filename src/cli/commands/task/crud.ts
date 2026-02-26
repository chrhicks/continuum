import { Command } from 'commander'
import continuum from '../../../sdk'
import type { TaskStatus, TaskType } from '../../../sdk/types'
import { parseIdList, readInput, readJsonInput, runCommand } from '../../io'
import {
  parsePriority,
  parsePriorityValue,
  parseTaskStatus,
  parseTaskType,
} from './parse'
import { renderNextSteps } from './render'

type TaskCreateOptions = {
  input?: string
  title?: string
  type?: string
  status?: string
  priority?: string
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
  priority?: string
  intent?: string
  description?: string
  plan?: string
  parent?: string
  blockedBy?: string | string[]
}

type TaskCompleteOptions = {
  outcome?: string
}

type TaskCreateInputFile = Partial<{
  title: string
  type: TaskType
  status: TaskStatus
  priority: number | null
  intent: string | null
  description: string
  plan: string | null
  parentId: string | null
  blockedBy: string[] | null
}>

type TaskUpdateInput = NonNullable<Parameters<typeof continuum.task.update>[1]>

export function registerCrudCommands(taskCommand: Command): void {
  registerCreateCommand(taskCommand)
  registerUpdateCommand(taskCommand)
  registerCompleteCommand(taskCommand)
  registerDeleteCommand(taskCommand)
}

function registerCreateCommand(taskCommand: Command): void {
  taskCommand
    .command('create')
    .description('Create a task')
    .option('--input <path>', 'JSON input (use @file or @-)')
    .option('--title <title>', 'Task title')
    .option('--type <type>', 'Task type')
    .option('--status <status>', 'Initial status')
    .option('--priority <priority>', 'Priority (lower is higher)')
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
            const payload = await buildCreateInput(options)
            initCreated = payload.initCreated
            const task = await continuum.task.create(payload.input)
            return { task }
          },
          ({ task }) => {
            if (initCreated) {
              console.log(
                `Initialized continuum in current directory and created task ${task.id}`,
              )
            } else {
              console.log(`Created task ${task.id}`)
            }
            renderNextSteps([
              `continuum task steps add ${task.id} --steps '[{"title":"...","description":"...","position":1}]'`,
              `continuum task note add ${task.id} --kind discovery --content "..."`,
            ])
          },
        )
      },
    )
}

function registerUpdateCommand(taskCommand: Command): void {
  taskCommand
    .command('update')
    .description('Update a task')
    .argument('<task_id>', 'Task ID to update')
    .option('--patch <path>', 'JSON patch input (use @file or @-)')
    .option('--title <title>', 'Task title')
    .option('--type <type>', 'Task type')
    .option('--status <status>', 'Task status')
    .option('--priority <priority>', 'Priority (lower is higher)')
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
            const update = await buildTaskUpdateInput(options)
            const task = await continuum.task.update(taskId, update)
            return { task }
          },
          ({ task }) => {
            console.log(`Updated task ${task.id}`)
          },
        )
      },
    )
}

function registerCompleteCommand(taskCommand: Command): void {
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
}

function registerDeleteCommand(taskCommand: Command): void {
  taskCommand
    .command('delete')
    .description('Delete a task')
    .argument('<task_id>', 'Task ID to delete')
    .action(async (taskId: string, _options: unknown, command: Command) => {
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
}

async function buildCreateInput(options: TaskCreateOptions): Promise<{
  initCreated: boolean
  input: Parameters<typeof continuum.task.create>[0]
}> {
  const initStatus = await continuum.task.init()
  const inputFromFile = await readJsonInput<TaskCreateInputFile>(options.input)
  const title = requireTextValue('title', options.title ?? inputFromFile?.title)
  const type = parseTaskType(
    requireTextValue('type', options.type ?? inputFromFile?.type),
  )
  const description = await readInput(
    options.description ?? inputFromFile?.description,
  )
  const intent = await readInput(
    options.intent ?? inputFromFile?.intent ?? undefined,
  )
  const plan = await readInput(options.plan ?? inputFromFile?.plan ?? undefined)

  return {
    initCreated: initStatus.created,
    input: {
      title,
      type,
      status: options.status
        ? parseTaskStatus(options.status)
        : inputFromFile?.status,
      priority:
        options.priority !== undefined
          ? parsePriority(options.priority)
          : parsePriorityValue(inputFromFile?.priority),
      intent: intent ?? null,
      description: description ?? '',
      plan: plan ?? null,
      parentId: options.parent ?? inputFromFile?.parentId ?? null,
      blockedBy:
        parseIdList(options.blockedBy) ??
        parseIdList(inputFromFile?.blockedBy ?? undefined) ??
        null,
    },
  }
}

function requireTextValue(field: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing required field: ${field}`)
  }
  return value
}

async function buildTaskUpdateInput(
  options: TaskUpdateOptions,
): Promise<TaskUpdateInput> {
  const patchFromFile = await readJsonInput<TaskUpdateInput>(options.patch)
  const description = await readInput(options.description)
  const intent = await readInput(options.intent)
  const plan = await readInput(options.plan)
  const update: TaskUpdateInput = { ...(patchFromFile ?? {}) }

  applyUpdateOptionOverrides(update, options)
  applyUpdateTextOverrides(update, { description, intent, plan })
  return update
}

function applyUpdateOptionOverrides(
  update: TaskUpdateInput,
  options: TaskUpdateOptions,
): void {
  if (options.title !== undefined) update.title = options.title
  if (options.type !== undefined) update.type = parseTaskType(options.type)
  if (options.status !== undefined)
    update.status = parseTaskStatus(options.status)

  const priorityFromPatch = parsePriorityValue(update.priority)
  if (priorityFromPatch !== undefined) update.priority = priorityFromPatch
  if (options.priority !== undefined)
    update.priority = parsePriority(options.priority)
  if (options.parent !== undefined) update.parentId = options.parent

  const blockedBy = parseIdList(options.blockedBy)
  if (blockedBy !== undefined) update.blockedBy = blockedBy
}

function applyUpdateTextOverrides(
  update: TaskUpdateInput,
  text: { description?: string; intent?: string; plan?: string },
): void {
  if (text.intent !== undefined) update.intent = text.intent
  if (text.description !== undefined) update.description = text.description
  if (text.plan !== undefined) update.plan = text.plan
}
