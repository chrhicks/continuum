import { Command } from 'commander'
import { createMemoryCommand, endSessionIfActive } from './cli/commands/memory'
import { createTaskCommand } from './cli/commands/task'
import { createLoopCommand } from './cli/commands/loop'

let exitHandlersInstalled = false

export async function main(): Promise<void> {
  installExitHandlers()

  const program = new Command()
  program
    .name('continuum')
    .description('Continuum CLI - Task and memory management system')
    .version('0.1.0')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .addCommand(createMemoryCommand())
    .addCommand(createTaskCommand())
    .addCommand(createLoopCommand())

  program.exitOverride()

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
  }
}

function installExitHandlers(): void {
  if (exitHandlersInstalled) {
    return
  }
  exitHandlersInstalled = true
  process.once('SIGINT', () => {
    try {
      const path = endSessionIfActive({ consolidate: false })
      if (path) {
        console.log(`Session ended: ${path}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(message)
    } finally {
      exitHandlersInstalled = false
      process.exitCode = 130
    }
  })
}
