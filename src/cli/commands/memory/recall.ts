import { Command } from 'commander'
import {
  handleRecallImport,
  handleRecallIndex,
  handleRecallSearch,
} from './recall-basic-handlers'
import { handleRecallDiff } from './recall-diff-handler'
import { handleRecallSync } from './recall-sync-handler'
import { registerRecallSubcommands } from './recall-subcommands'

export function registerRecallCommands(memoryCommand: Command): void {
  registerRecallSubcommands(memoryCommand, {
    onImport: (options) => handleRecallImport(options),
    onIndex: (options) => handleRecallIndex(options),
    onDiff: (options) => handleRecallDiff(options),
    onSync: (options) => handleRecallSync(options),
    onSearch: (query, options) => handleRecallSearch(query, options),
  })
}
