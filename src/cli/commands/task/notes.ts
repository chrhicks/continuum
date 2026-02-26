import { Command } from 'commander'
import continuum from '../../../sdk'
import { appendAgentMessage } from '../../../memory/now-writer'
import { readInput, runCommand } from '../../io'
import { parseNoteKind, parseNoteSource } from './parse'
import { formatDecision, formatDiscovery } from './render'

type TaskNoteAddOptions = {
  kind?: string
  content?: string
  rationale?: string
  impact?: string
  source?: string
}

export function registerNoteCommands(taskCommand: Command): void {
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

  const notesCommand = new Command('notes').description(
    'Bulk task note operations',
  )
  notesCommand.action(() => {
    notesCommand.outputHelp()
  })
  notesCommand
    .command('flush')
    .description('Flush task discoveries and decisions to NOW memory')
    .argument('<task_id>', 'Task ID')
    .action(async (taskId: string, _options: unknown, command: Command) => {
      await runCommand(
        command,
        async () => {
          const task = await continuum.task.get(taskId)
          if (!task) {
            throw new Error(`Task '${taskId}' not found.`)
          }

          const discoveryCount = task.discoveries.length
          const decisionCount = task.decisions.length
          const total = discoveryCount + decisionCount

          if (total === 0) {
            return {
              taskId: task.id,
              discoveriesFlushed: 0,
              decisionsFlushed: 0,
              flushed: false,
            }
          }

          for (const note of task.discoveries) {
            await appendAgentMessage(formatDiscovery(task.id, note), {
              tags: [task.id],
            })
          }
          for (const note of task.decisions) {
            await appendAgentMessage(formatDecision(task.id, note), {
              tags: [task.id],
            })
          }

          return {
            taskId: task.id,
            discoveriesFlushed: discoveryCount,
            decisionsFlushed: decisionCount,
            flushed: true,
          }
        },
        ({ discoveriesFlushed, decisionsFlushed, flushed }) => {
          if (!flushed) {
            console.log('No notes to flush.')
            return
          }
          console.log(
            `Flushed ${discoveriesFlushed} discovery(s) and ${decisionsFlushed} decision(s) to NOW.`,
          )
        },
      )
    })
  taskCommand.addCommand(notesCommand)
}
