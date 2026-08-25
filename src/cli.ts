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
import type { CliInvocation } from './cli/memory-access'
import continuum from './sdk'
import { resolveFrom, resolveWorkspaceContext } from './workspace/resolve'

type MainOptions = {
  preserveProcessExitCode?: boolean
}

export async function main(options: MainOptions = {}): Promise<void> {
  const previousExitCode = process.exitCode
  process.exitCode = undefined
  const invocation = { cwd: process.cwd() }
  const program = createProgram(invocation)

  try {
    await parseProgram(program)
  } catch (error) {
    if (error instanceof Error && error.name === 'CommanderError') {
      process.exitCode = 1
      return
    }
    throw error
  } finally {
    if (!options.preserveProcessExitCode) {
      process.exitCode = previousExitCode
    }
  }
}

function createProgram(invocation: CliInvocation): Command {
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
  program.addCommand(createSummaryCommand(invocation))
  program.addCommand(createMcpCommand())
  program.addCommand(createBackupCommand())
  program.addCommand(createRuntimeCommand())
  program.addCommand(createWorkspaceCommand())
  program.addCommand(createMemoryCommand(invocation))
  program.addCommand(createTaskCommand())
  program.exitOverride()
  registerWorkspaceHooks(program, invocation)

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
              `Database: ${resolveWorkspaceContext().storageAuthority.dbPath}`,
            )
            return
          }
          console.log('Initialized continuum for current workspace.')
          console.log(
            `Database: ${resolveWorkspaceContext().storageAuthority.dbPath}`,
          )
          console.log('')
          console.log('Next steps:')
          console.log('  continuum task list              List tasks')
          console.log('  continuum task get <task_id>     View task details')
        },
      )
    })
}

function registerWorkspaceHooks(
  program: Command,
  invocation: CliInvocation,
): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    let root = actionCommand as Command
    while (root.parent) root = root.parent
    const options = root.opts<{ cwd?: string }>()
    if (options.cwd && !usesExplicitMemoryAccess(actionCommand)) {
      process.chdir(resolveFrom(invocation.cwd, options.cwd))
    }
  })
}

async function parseProgram(program: Command): Promise<void> {
  if (process.argv.length <= 2) {
    program.outputHelp()
    return
  }

  await program.parseAsync(process.argv)
}

function usesExplicitMemoryAccess(command: Command): boolean {
  let current: Command | null = command
  while (current) {
    if (current.name() === 'memory' || current.name() === 'summary') return true
    current = current.parent ?? null
  }
  return false
}
