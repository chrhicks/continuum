import { Command } from 'commander'
import { registerMemoryHandlers } from './memory/handlers'
import { registerRecallCommands } from './memory/recall'
import type { CliInvocation } from '../memory-access'

export function createMemoryCommand(invocation: CliInvocation): Command {
  const memory = new Command('memory').description('Canonical memory commands')
  memory.addHelpText('after', '\nAgent memory guide: continuum guide memory')
  memory.action(() => memory.outputHelp())
  registerMemoryHandlers(memory, invocation)
  registerRecallCommands(memory, invocation)
  return memory
}
