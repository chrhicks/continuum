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

type TaskUpdateInput = NonNullable<Parameters<typeof continuum.task.update>[1]>

export function registerCrudCommands(taskCommand: Command): void {
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
            const initStatus = await continuum.task.init()
            initCreated = initStatus.created
            const inputFromFile = await readJsonInput<
              Partial<{
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
            const priority =
              options.priority !== undefined
                ? parsePriority(options.priority)
                : parsePriorityValue(inputFromFile?.priority)
            const parentId = options.parent ?? inputFromFile?.parentId
            const blockedBy =
              parseIdList(options.blockedBy) ??
              parseIdList(inputFromFile?.blockedBy ?? undefined)

            const task = await continuum.task.create({
              title,
              type,
              status,
              priority,
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
            const patchFromFile = await readJsonInput<TaskUpdateInput>(
              options.patch,
            )
            const descriptionRaw = options.description
            const description = await readInput(descriptionRaw)
            const intentRaw = options.intent
            const intent = await readInput(intentRaw)
            const planRaw = options.plan
            const plan = await readInput(planRaw)
            const priorityFromPatch = parsePriorityValue(
              patchFromFile?.priority,
            )

            const update: TaskUpdateInput = {
              ...(patchFromFile ?? {}),
            }
            if (options.title !== undefined) update.title = options.title
            if (options.type !== undefined) {
              update.type = parseTaskType(options.type)
            }
            if (options.status !== undefined) {
              update.status = parseTaskStatus(options.status)
            }
            if (priorityFromPatch !== undefined) {
              update.priority = priorityFromPatch
            }
            if (options.priority !== undefined) {
              update.priority = parsePriority(options.priority)
            }
            if (intent !== undefined) update.intent = intent
            if (description !== undefined) update.description = description
            if (plan !== undefined) update.plan = plan
            if (options.parent !== undefined) update.parentId = options.parent
            const blockedBy = parseIdList(options.blockedBy)
            if (blockedBy !== undefined) update.blockedBy = blockedBy

            const task = await continuum.task.update(taskId, update)
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
