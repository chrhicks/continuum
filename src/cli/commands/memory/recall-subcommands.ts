import { Command } from 'commander'

const DEFAULT_SYNC_PROCESSED_VERSION = 1

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
    'Recall import commands',
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
    .command('index')
    .description('Build recall source index from OpenCode storage')
    .option('--db <path>', 'OpenCode sqlite database path')
    .option(
      '--data-root <path>',
      'Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    .option(
      '--index <path>',
      'Output index file (default: <data-root>/recall/opencode/source-index.json)',
    )
    .option('--project <id>', 'Limit to a single project id')
    .option('--session <id>', 'Limit to a single session id')
    .option('--verbose', 'Print progress details')
    .action((options: RecallIndexOptions) => handlers.onIndex(options))

  recallCommand
    .command('diff')
    .description('Compare recall summaries to source index')
    .option(
      '--index <path>',
      'Source index file (default: $XDG_DATA_HOME/continuum/recall/opencode/source-index.json)',
    )
    .option(
      '--data-root <path>',
      'Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    .option('--repo <path>', 'Repo root (default: cwd)')
    .option(
      '--summary-dir <dir>',
      'Summary dir (default: <repo>/.continuum/recall/opencode)',
    )
    .option('--summaries <dir>', 'Alias for --summary-dir')
    .option('--limit <n>', 'Limit items per section', '10')
    .option('--json', 'Output JSON report to stdout')
    .option(
      '--report <path>',
      'Write JSON report to file (default: <data-root>/recall/opencode/diff-report.json)',
    )
    .option('--no-report', 'Skip writing the report file')
    .option(
      '--plan <path>',
      'Write sync plan file (default: <data-root>/recall/opencode/sync-plan.json)',
    )
    .option('--no-plan', 'Skip writing the sync plan file')
    .option('--project <id>', 'Limit to a single project id')
    .option('--include-global', 'Include global sessions in scope')
    .action((options: RecallDiffOptions) => handlers.onDiff(options))

  recallCommand
    .command('sync')
    .description('Execute recall sync plan')
    .option(
      '--plan <path>',
      'Sync plan file (default: <data-root>/recall/opencode/sync-plan.json)',
    )
    .option(
      '--ledger <path>',
      'Ledger file (default: <data-root>/recall/opencode/state.json)',
    )
    .option(
      '--log <path>',
      'Append sync log to file (default: <data-root>/recall/opencode/sync-log.jsonl)',
    )
    .option(
      '--data-root <path>',
      'Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    .option(
      '--command <template>',
      'Command template (supports {session_id}, {project_id}, {key})',
    )
    .option('--cwd <path>', 'Working directory for commands (default: cwd)')
    .option('--dry-run', 'Skip execution and ledger updates')
    .option('--fail-fast', 'Stop on first failure')
    .option('--limit <n>', 'Limit number of items processed')
    .option(
      '--processed-version <n>',
      `Ledger processed version (default: ${DEFAULT_SYNC_PROCESSED_VERSION})`,
    )
    .option('--verbose', 'Print per-item results')
    .action((options: RecallSyncOptions) => handlers.onSync(options))

  recallCommand
    .command('search')
    .description('Search recall summaries')
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
