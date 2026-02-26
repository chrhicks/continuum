import { Command } from 'commander'
import continuum from '../../../sdk'
import { readInput, readJsonInput, runCommand } from '../../io'
import {
  TASK_STEP_JSON_SCHEMA,
  TASK_STEP_TEMPLATE,
  validateTaskStepsInput,
} from '../../task-steps'
import { parsePosition, parseTaskStepStatus } from './parse'
import { formatStepMarker, renderNextSteps } from './render'

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

type TaskStepUpdateInput = Parameters<typeof continuum.task.steps.update>[2]

export function registerStepsCommands(taskCommand: Command): void {
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
            renderNextSteps([
              `continuum task steps complete ${task.id} --notes "Done"`,
              `continuum task validate ${task.id} --transition completed`,
            ])
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
            const patchFromFile = await readJsonInput<TaskStepUpdateInput>(
              options.patch,
            )
            const description = await readInput(options.description)
            const summary = await readInput(options.summary)
            const notes = await readInput(options.notes)
            const update: TaskStepUpdateInput = {
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
              update,
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
            const marker = formatStepMarker(step.status)
            console.log(`${marker} ${step.id} ${step.title}`)
          }
        },
      )
    })

  taskCommand.addCommand(stepsCommand)
}
