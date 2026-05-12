import { Command } from 'commander'
import { createMemoryCommand, endSessionIfActive } from './cli/commands/memory'
import { createTaskCommand } from './cli/commands/task'
import { createSetupCommand } from './cli/commands/setup'
import { createGuideCommand } from './cli/commands/guide'
import { createSummaryCommand } from './cli/commands/summary'
import { runCommand } from './cli/io'
import continuum from './sdk'
import {
  setActiveWorkspaceContext,
  clearActiveWorkspaceContext,
} from './workspace/context'
import { resolveWorkspaceContext } from './workspace/resolve'

const PREVIOUS_WORKSPACE_CONTEXT = Symbol('previous-workspace-context')

type MainOptions = {
  preserveProcessExitCode?: boolean
}

export async function main(options: MainOptions = {}): Promise<void> {
  const previousExitCode = process.exitCode
  process.exitCode = undefined
  const removeExitHandlers = installExitHandlers()
  const program = createProgram()

  try {
    await parseProgram(program)
  } catch (error) {
    if (error instanceof Error && error.name === 'CommanderError') {
      process.exitCode = 1
      return
    }
    throw error
  } finally {
    removeExitHandlers()
    clearActiveWorkspaceContext()
    if (!options.preserveProcessExitCode) {
      process.exitCode = previousExitCode
    }
  }
}

function createProgram(): Command {
  const program = new Command()
  program
    .name('continuum')
    .description('Continuum CLI - Task and memory management system')
    .version('0.1.1')
    .option('--json', 'Output JSON responses')
    .option('--cwd <path>', 'Run in target directory')
    .option('--quiet', 'Suppress non-JSON output')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .addHelpText(
      'after',
      '\nAgent workflow guide: continuum guide\nCurrent briefing: continuum summary',
    )

  addInitCommand(program)
  program.addCommand(createSetupCommand())
  program.addCommand(createGuideCommand())
  program.addCommand(createSummaryCommand())
  program.addCommand(createMemoryCommand())
  program.addCommand(createTaskCommand())
  program.exitOverride()
  registerWorkspaceHooks(program)

  return program
}

function addInitCommand(program: Command): void {
  program
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
}

function registerWorkspaceHooks(program: Command): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    let root = actionCommand as Command
    while (root.parent) {
      root = root.parent
    }
    const options = root.opts<{ cwd?: string }>()
    if (options.cwd) {
      process.chdir(options.cwd)
    }

    if (!isMemoryCommand(actionCommand)) {
      return
    }

    const previous = setActiveWorkspaceContext(
      resolveWorkspaceContext({ startDir: process.cwd() }),
    )
    ;(actionCommand as Command & { [PREVIOUS_WORKSPACE_CONTEXT]?: unknown })[
      PREVIOUS_WORKSPACE_CONTEXT
    ] = previous
  })

  program.hook('postAction', (_thisCommand, actionCommand) => {
    if (!isMemoryCommand(actionCommand)) {
      return
    }

    const command = actionCommand as Command & {
      [PREVIOUS_WORKSPACE_CONTEXT]?: ReturnType<
        typeof setActiveWorkspaceContext
      >
    }
    const previous = command[PREVIOUS_WORKSPACE_CONTEXT] ?? null
    if (previous) {
      setActiveWorkspaceContext(previous)
    } else {
      clearActiveWorkspaceContext()
    }
    delete command[PREVIOUS_WORKSPACE_CONTEXT]
  })
}

async function parseProgram(program: Command): Promise<void> {
  if (process.argv.length <= 2) {
    program.outputHelp()
    return
  }

  await program.parseAsync(process.argv)
}

function isMemoryCommand(command: Command): boolean {
  let current: Command | null = command
  while (current) {
    if (current.name() === 'memory') {
      return true
    }
    current = current.parent ?? null
  }
  return false
}

export async function handleSigint(
  options: { setExitCode?: boolean } = {},
): Promise<void> {
  try {
    const path = await endSessionIfActive({ consolidate: false })
    if (path) {
      console.log(`Session ended: ${path}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
  } finally {
    if (options.setExitCode !== false) {
      process.exitCode = 130
    }
  }
}

function installExitHandlers(): () => void {
  const sigintHandler = () => {
    void handleSigint()
  }

  process.once('SIGINT', sigintHandler)

  return () => {
    process.removeListener('SIGINT', sigintHandler)
  }
}
