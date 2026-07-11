import { Command } from 'commander'
import { handleRecallImport, handleRecallStatus } from './recall-basic-handlers'
import { registerRecallSubcommands } from './recall-subcommands'

export function registerRecallCommands(memoryCommand: Command): void {
  registerRecallSubcommands(memoryCommand, {
    onStatus: handleRecallStatus,
    onImport: handleRecallImport,
  })
}
