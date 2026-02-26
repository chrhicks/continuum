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
  registerNoteAddCommand(taskCommand)
  registerNotesFlushCommand(taskCommand)
}

function registerNoteAddCommand(taskCommand: Command): void {
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
      async (
        taskId: string,
        options: TaskNoteAddOptions,
        command: Command,
      ): Promise<void> => {
        await runCommand(
          command,
          async () => ({ task: await addTaskNote(taskId, options) }),
          ({ task }) => {
            console.log(`Updated notes for ${task.id}`)
          },
        )
      },
    )
  taskCommand.addCommand(noteCommand)
}

function registerNotesFlushCommand(taskCommand: Command): void {
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
        async () => await flushTaskNotes(taskId),
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

async function addTaskNote(
  taskId: string,
  options: TaskNoteAddOptions,
): Promise<Awaited<ReturnType<typeof continuum.task.notes.add>>> {
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
  return continuum.task.notes.add(taskId, {
    kind,
    content,
    rationale: rationale ?? undefined,
    impact: impact ?? undefined,
    source,
  })
}

async function flushTaskNotes(taskId: string): Promise<{
  taskId: string
  discoveriesFlushed: number
  decisionsFlushed: number
  flushed: boolean
}> {
  const task = await continuum.task.get(taskId)
  if (!task) {
    throw new Error(`Task '${taskId}' not found.`)
  }

  const discoveriesFlushed = task.discoveries.length
  const decisionsFlushed = task.decisions.length
  const total = discoveriesFlushed + decisionsFlushed
  if (total === 0) {
    return {
      taskId: task.id,
      discoveriesFlushed,
      decisionsFlushed,
      flushed: false,
    }
  }

  for (const note of task.discoveries) {
    await appendAgentMessage(formatDiscovery(task.id, note), {
      tags: [task.id],
    })
  }
  for (const note of task.decisions) {
    await appendAgentMessage(formatDecision(task.id, note), { tags: [task.id] })
  }

  return {
    taskId: task.id,
    discoveriesFlushed,
    decisionsFlushed,
    flushed: true,
  }
}
