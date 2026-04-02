import { Command } from 'commander'

type ConsolidateOptions = {
  dryRun?: boolean
}

type SearchOptions = {
  tier?: string
  source?: string
  tags?: string
  after?: string
  mode?: string
  limit?: string
  summaryDir?: string
}

type LogOptions = {
  tail?: string
}

type RecoverOptions = {
  hours?: string
  consolidate?: boolean
}

export type CollectOptions = {
  source?: string
  db?: string
  repo?: string
  out?: string
  project?: string
  session?: string
  task?: string
  status?: string
  limit?: string
  summarize?: boolean
  import?: boolean
  summaryModel?: string
  summaryApiUrl?: string
  summaryApiKey?: string
  summaryMaxTokens?: string
  summaryTimeoutMs?: string
  summaryMaxChars?: string
  summaryMaxLines?: string
  summaryMergeMaxEstTokens?: string
}

type SessionAppendHandler = MemorySubcommandHandlers['onSessionAppend']
type AppendHandler = MemorySubcommandHandlers['onAppend']
type SearchHandler = MemorySubcommandHandlers['onSearch']

function registerSessionSubcommands(
  sessionCommand: Command,
  onSessionAppend: SessionAppendHandler,
): void {
  sessionCommand
    .command('append')
    .description('Append message to current session')
    .argument('<kind>')
    .argument('<text...>')
    .action((kind: string, textParts: string[]) =>
      onSessionAppend(kind, textParts),
    )
}

function registerBasicMemorySubcommands(
  memoryCommand: Command,
  handlers: Pick<
    MemorySubcommandHandlers,
    'onStatus' | 'onList' | 'onConsolidate'
  >,
): void {
  memoryCommand
    .command('status')
    .description('Show memory status')
    .action(() => handlers.onStatus())

  memoryCommand
    .command('list')
    .description('List memory files')
    .action(() => handlers.onList())

  memoryCommand
    .command('consolidate')
    .description('Consolidate memory files')
    .option('--dry-run', 'Preview consolidation without writing files')
    .action((options: ConsolidateOptions) => handlers.onConsolidate(options))
}

function registerAppendSubcommand(
  memoryCommand: Command,
  onAppend: AppendHandler,
): void {
  memoryCommand
    .command('append')
    .description('Append message to current session')
    .argument('<kind>')
    .argument('<text...>')
    .action((kind: string, textParts: string[]) => onAppend(kind, textParts))
}

function registerSearchSubcommand(
  memoryCommand: Command,
  onSearch: SearchHandler,
): void {
  memoryCommand
    .command('search')
    .description('Search memory content')
    .argument('<query...>')
    .option('--tier <tier>', 'Search tier: NOW, RECENT, MEMORY, or all')
    .option('--source <source>', 'Search source: memory, recall, or all', 'all')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--after <date>', 'Only search entries on or after a date')
    .option(
      '--mode <mode>',
      'Recall mode for recall results: bm25, semantic, auto',
      'auto',
    )
    .option('--limit <limit>', 'Maximum results to return')
    .option(
      '--summary-dir <dir>',
      'Directory containing opencode recall summaries',
    )
    .action((queryParts: string[], options: SearchOptions) => {
      const query = queryParts.join(' ').trim()
      if (!query) {
        throw new Error('Missing search query.')
      }
      return onSearch(query, options)
    })
}

function registerLogSubcommand(
  memoryCommand: Command,
  onLog: MemorySubcommandHandlers['onLog'],
): void {
  memoryCommand
    .command('log')
    .description('View consolidation log')
    .option('--tail <lines>', 'Show last N lines')
    .action((options: LogOptions) => onLog(options))
}

function registerRecoverSubcommand(
  memoryCommand: Command,
  onRecover: MemorySubcommandHandlers['onRecover'],
): void {
  memoryCommand
    .command('recover')
    .description('Recover stale NOW sessions')
    .option('--hours <hours>', 'Maximum age in hours')
    .option('--consolidate', 'Consolidate recovered sessions')
    .action((options: RecoverOptions) => onRecover(options))
}

function registerCollectSubcommand(
  memoryCommand: Command,
  onCollect: MemorySubcommandHandlers['onCollect'],
): void {
  memoryCommand
    .command('collect')
    .description(
      'Collect memory source data into local artifacts or consolidated memory',
    )
    .option(
      '--source <source>',
      'Collector source: opencode or task',
      'opencode',
    )
    .option('--db <path>', 'OpenCode sqlite database path')
    .option('--repo <path>', 'Repo path to match OpenCode project worktree')
    .option('--out <dir>', 'Output directory for generated artifacts')
    .option('--project <id>', 'Limit to a single OpenCode project id')
    .option('--session <id>', 'Limit to a single OpenCode session id')
    .option('--task <id>', 'Limit to a single task id when source=task')
    .option(
      '--status <statuses>',
      'Task statuses to collect when source=task (comma-separated)',
    )
    .option('--limit <n>', 'Limit sessions processed')
    .option('--summarize', 'Generate OpenCode session summary docs')
    .option('--no-summarize', 'Skip summary generation even when configured')
    .option(
      '--import',
      'Import generated summaries into memory after collection (default for task source)',
    )
    .option('--summary-model <id>', 'LLM model id for summary generation')
    .option('--summary-api-url <url>', 'LLM API URL for summary generation')
    .option('--summary-api-key <key>', 'LLM API key for summary generation')
    .option('--summary-max-tokens <n>', 'Max tokens per summary LLM call')
    .option(
      '--summary-timeout-ms <n>',
      'Summary request timeout in milliseconds',
    )
    .option('--summary-max-chars <n>', 'Max chars per summary chunk')
    .option('--summary-max-lines <n>', 'Max lines per summary chunk')
    .option(
      '--summary-merge-max-est-tokens <n>',
      'Estimated token budget for merging multiple summary chunks',
    )
    .action((options: CollectOptions) => onCollect(options))
}

function registerValidateSubcommand(
  memoryCommand: Command,
  onValidate: MemorySubcommandHandlers['onValidate'],
): void {
  memoryCommand
    .command('validate')
    .description('Validate memory structure')
    .action(() => onValidate())
}

type MemorySubcommandHandlers = {
  onSessionAppend: (kind: string, textParts: string[]) => void | Promise<void>
  onStatus: () => void
  onList: () => void
  onConsolidate: (options: ConsolidateOptions) => void | Promise<void>
  onAppend: (kind: string, textParts: string[]) => void | Promise<void>
  onSearch: (query: string, options: SearchOptions) => void | Promise<void>
  onLog: (options: LogOptions) => void
  onRecover: (options: RecoverOptions) => void | Promise<void>
  onValidate: () => void
  onCollect: (options: CollectOptions) => void | Promise<void>
}

export function registerMemorySubcommands(
  memoryCommand: Command,
  sessionCommand: Command,
  handlers: MemorySubcommandHandlers,
): void {
  registerSessionSubcommands(sessionCommand, handlers.onSessionAppend)
  registerBasicMemorySubcommands(memoryCommand, handlers)
  registerAppendSubcommand(memoryCommand, handlers.onAppend)
  registerSearchSubcommand(memoryCommand, handlers.onSearch)
  registerLogSubcommand(memoryCommand, handlers.onLog)
  registerRecoverSubcommand(memoryCommand, handlers.onRecover)
  registerCollectSubcommand(memoryCommand, handlers.onCollect)
  registerValidateSubcommand(memoryCommand, handlers.onValidate)
}
