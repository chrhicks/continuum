import { Command } from 'commander'
import continuum, { TASK_TYPES } from '../../sdk'
import type { Task } from '../../sdk/types'
import { runCommand } from '../io'
import { registerCrudCommands } from './task/crud'
import {
  parseExpandOptions,
  parseTaskGraphQuery,
  parseTaskListOptions,
  parseTaskStatus,
  type TaskListOptionsInput,
} from './task/parse'
import { registerNoteCommands } from './task/notes'
import {
  renderTaskDetails,
  renderTaskList,
  renderTaskTree,
} from './task/render'
import { registerStepsCommands } from './task/steps'

type TaskGetOptions = {
  expand?: string
  tree?: boolean
  includeDeleted?: boolean
}

type TaskValidateOptions = {
  transition?: string
}

export function createTaskCommand(): Command {
  const taskCommand = new Command('task').description(
    'Task management commands',
  )

  taskCommand.action(() => {
    taskCommand.outputHelp()
  })

  taskCommand
    .command('list')
    .description('List tasks (excludes completed/cancelled by default)')
    .option('-s, --status <status>', 'Filter by status')
    .option('-t, --type <type>', 'Filter by type')
    .option('--parent <task_id>', 'Filter by parent task')
    .option('--include-deleted', 'Include deleted tasks')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--limit <limit>', 'Limit results')
    .option('--sort <sort>', 'Sort by createdAt, updatedAt, or priority')
    .option('--order <order>', 'Sort order asc or desc')
    .action(async (options: TaskListOptionsInput, command: Command) => {
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

  registerCrudCommands(taskCommand)

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
    .action(
      async (
        query: string,
        taskId: string,
        _options: unknown,
        command: Command,
      ) => {
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
      },
    )

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

  registerStepsCommands(taskCommand)
  registerNoteCommands(taskCommand)

  return taskCommand
}
