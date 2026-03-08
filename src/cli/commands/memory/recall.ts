import { Command } from 'commander'
import { handleRecallImport, handleRecallSearch } from './recall-basic-handlers'
import { registerRecallSubcommands } from './recall-subcommands'

export function registerRecallCommands(memoryCommand: Command): void {
  registerRecallSubcommands(memoryCommand, {
    onImport: (options) => handleRecallImport(options),
    onIndex: () => {
      throw new Error('Recall indexing is no longer part of the supported CLI.')
    },
    onDiff: () => {
      throw new Error('Recall diff is no longer part of the supported CLI.')
    },
    onSync: () => {
      throw new Error('Recall sync is no longer part of the supported CLI.')
    },
    onSearch: (query, options) => handleRecallSearch(query, options),
  })
}
