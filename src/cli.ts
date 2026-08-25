import { Command } from 'commander'
import { createMemoryCommand } from './cli/commands/memory'
import { createTaskCommand } from './cli/commands/task'
import { createSetupCommand } from './cli/commands/setup'
import { createGuideCommand } from './cli/commands/guide'
import { createSummaryCommand } from './cli/commands/summary'
import { createMcpCommand } from './cli/commands/mcp'
import { createBackupCommand } from './cli/commands/backup'
import { createRuntimeCommand } from './cli/commands/runtime'
import { createWorkspaceCommand } from './cli/commands/workspace'
import { runCommand } from './cli/io'
import continuum from './sdk'
import {
  setActiveWorkspaceContext,
  clearActiveWorkspaceContext,
} from './workspace/context'
import { resolveWorkspaceContext } from './workspace/resolve'
import { canonicalDbFilePath } from './db/paths'

const PREVIOUS_WORKSPACE_CONTEXT = Symbol('previous-workspace-context')

type MainOptions = {
  preserveProcessExitCode?: boolean
}

export async function main(options: MainOptions = {}): Promise<void> {
  const previousExitCode = process.exitCode
  process.exitCode = undefined
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
  program.addCommand(createMcpCommand())
  program.addCommand(createBackupCommand())
  program.addCommand(createRuntimeCommand())
  program.addCommand(createWorkspaceCommand())
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
            console.log(
              `Database: ${canonicalDbFilePath(resolveWorkspaceContext().workspaceRoot)}`,
            )
            return
          }
          console.log('Initialized continuum for current workspace.')
          console.log(
            `Database: ${canonicalDbFilePath(resolveWorkspaceContext().workspaceRoot)}`,
          )
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
      resolveWorkspaceContext({
        startDir: process.cwd(),
        access: 'deferred',
      }),
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
