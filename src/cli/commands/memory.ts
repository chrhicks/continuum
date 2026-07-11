import { Command } from 'commander'
import { registerMemoryHandlers } from './memory/handlers'
import { registerRecallCommands } from './memory/recall'

export function createMemoryCommand(): Command {
  const memory = new Command('memory').description('Canonical memory commands')
  memory.addHelpText('after', '\nAgent memory guide: continuum guide memory')
  memory.action(() => memory.outputHelp())
  registerMemoryHandlers(memory)
  registerRecallCommands(memory)
  return memory
}
