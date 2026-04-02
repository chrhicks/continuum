import { Command } from 'commander'
import { createMemoryCommand, endSessionIfActive } from './cli/commands/memory'
import { createTaskCommand } from './cli/commands/task'
import { createSetupCommand } from './cli/commands/setup'
import { runCommand } from './cli/io'
import continuum from './sdk'
import {
  setActiveWorkspaceContext,
  clearActiveWorkspaceContext,
} from './workspace/context'
import { resolveWorkspaceContext } from './workspace/resolve'

const PREVIOUS_WORKSPACE_CONTEXT = Symbol('previous-workspace-context')

export async function main(): Promise<void> {
  const removeExitHandlers = installExitHandlers()

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

  program.addCommand(createSetupCommand())
  program.addCommand(createMemoryCommand())
  program.addCommand(createTaskCommand())

  program.exitOverride()

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

  if (process.argv.length <= 2) {
    program.outputHelp()
    return
  }

  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof Error && error.name === 'CommanderError') {
      process.exitCode = 1
      return
    }
    throw error
  } finally {
    removeExitHandlers()
    clearActiveWorkspaceContext()
  }
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
