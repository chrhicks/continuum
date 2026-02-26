import { Command } from 'commander'
import { initMemory } from '../../memory/init'
import {
  resolveCurrentSessionPath,
  startSession,
  endSession,
} from '../../memory/session'
import { consolidateNow } from '../../memory/consolidate'
import {
  logConsolidationResult,
  registerMemoryHandlers,
} from './memory/handlers'
import { registerRecallCommands } from './memory/recall'

export function createMemoryCommand(): Command {
  const memoryCommand = new Command('memory').description(
    'Memory management commands',
  )

  memoryCommand.action(() => {
    memoryCommand.outputHelp()
  })

  memoryCommand
    .command('init')
    .description('Initialize memory system')
    .action(() => {
      initMemory()
      console.log('Memory initialized at .continuum/memory/')
    })

  const sessionCommand = new Command('session').description(
    'Session management commands',
  )

  sessionCommand.action(() => {
    sessionCommand.outputHelp()
  })

  sessionCommand
    .command('start')
    .description('Start a new session')
    .action(() => {
      const info = startSession()
      console.log(`Session started: ${info.sessionId}`)
      console.log(`NOW file: ${info.filePath}`)
    })

  sessionCommand
    .command('end')
    .description('End the current session')
    .option('--consolidate', 'Consolidate after ending session')
    .action(async (options: { consolidate?: boolean }) => {
      const path = endSession()
      console.log(`Session ended: ${path}`)
      if (options.consolidate) {
        const result = await consolidateNow()
        logConsolidationResult(result)
      }
    })

  memoryCommand.addCommand(sessionCommand)

  registerMemoryHandlers(memoryCommand, sessionCommand, endSessionIfActive)

  registerRecallCommands(memoryCommand)

  return memoryCommand
}

export async function endSessionIfActive(options: {
  consolidate: boolean
}): Promise<string | null> {
  if (!resolveCurrentSessionPath({ allowFallback: true })) {
    return null
  }
  const path = endSession()
  if (options.consolidate) {
    const result = await consolidateNow()
    logConsolidationResult(result)
  }
  return path
}
