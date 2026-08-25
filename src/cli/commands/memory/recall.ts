import { Command } from 'commander'
import { handleRecallImport, handleRecallStatus } from './recall-basic-handlers'
import { registerRecallSubcommands } from './recall-subcommands'
import type { CliInvocation } from '../../memory-access'

export function registerRecallCommands(
  memoryCommand: Command,
  invocation: CliInvocation,
): void {
  registerRecallSubcommands(memoryCommand, {
    onStatus: (command) => handleRecallStatus(command, invocation),
    onImport: (options, command) =>
      handleRecallImport(options, command, invocation),
  })
}
