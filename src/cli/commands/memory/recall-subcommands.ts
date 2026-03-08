import { Command } from 'commander'

export type RecallImportOptions = {
  summaryDir?: string
  out?: string
  db?: string
  project?: string
  session?: string
  dryRun?: boolean
}

export type RecallIndexOptions = {
  db?: string
  dataRoot?: string
  index?: string
  project?: string
  session?: string
  verbose?: boolean
}

export type RecallDiffOptions = {
  index?: string
  dataRoot?: string
  repo?: string
  summaryDir?: string
  summaries?: string
  limit?: string
  json?: boolean
  report?: string | boolean
  plan?: string | boolean
  project?: string
  includeGlobal?: boolean
}

export type RecallSyncOptions = {
  plan?: string
  ledger?: string
  log?: string
  dataRoot?: string
  command?: string
  cwd?: string
  dryRun?: boolean
  failFast?: boolean
  limit?: string
  processedVersion?: string
  verbose?: boolean
}

export type RecallSearchOptions = {
  mode?: string
  summaryDir?: string
  limit?: string
}

type RecallSubcommandHandlers = {
  onImport: (options: RecallImportOptions) => void | Promise<void>
  onIndex: (options: RecallIndexOptions) => void | Promise<void>
  onDiff: (options: RecallDiffOptions) => void | Promise<void>
  onSync: (options: RecallSyncOptions) => void | Promise<void>
  onSearch: (
    query: string,
    options: RecallSearchOptions,
  ) => void | Promise<void>
}

export function registerRecallSubcommands(
  memoryCommand: Command,
  handlers: RecallSubcommandHandlers,
): void {
  const recallCommand = new Command('recall').description(
    'Recall compatibility aliases for import and recall-only search',
  )

  recallCommand.action(() => {
    recallCommand.outputHelp()
  })

  recallCommand
    .command('import')
    .description('Import OpenCode recall summaries into memory')
    .option(
      '--summary-dir <dir>',
      'Directory containing opencode recall summaries',
    )
    .option('--out <dir>', 'Alias for --summary-dir')
    .option('--db <path>', 'OpenCode sqlite database path')
    .option('--project <id>', 'Filter by OpenCode project id')
    .option('--session <id>', 'Filter by OpenCode session id')
    .option('--dry-run', 'Preview import without writing files')
    .action((options: RecallImportOptions) => handlers.onImport(options))

  recallCommand
    .command('search')
    .description(
      'Search recall summaries (compatibility alias for memory search --source recall)',
    )
    .argument('<query...>')
    .option(
      '--mode <mode>',
      'Search mode: bm25, semantic (tf-idf), auto',
      'auto',
    )
    .option(
      '--summary-dir <dir>',
      'Directory containing opencode recall summaries',
    )
    .option('--limit <limit>', 'Maximum results to return', '5')
    .action((queryParts: string[], options: RecallSearchOptions) => {
      const query = queryParts.join(' ').trim()
      if (!query) {
        throw new Error('Missing search query.')
      }
      return handlers.onSearch(query, options)
    })

  memoryCommand.addCommand(recallCommand)
}
