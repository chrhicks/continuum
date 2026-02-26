import { Command } from 'commander'

type ConsolidateOptions = {
  dryRun?: boolean
}

type SearchOptions = {
  tier?: string
  tags?: string
  after?: string
}

type LogOptions = {
  tail?: string
}

type RecoverOptions = {
  hours?: string
  consolidate?: boolean
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
}

export function registerMemorySubcommands(
  memoryCommand: Command,
  sessionCommand: Command,
  handlers: MemorySubcommandHandlers,
): void {
  sessionCommand
    .command('append')
    .description('Append message to current session')
    .argument('<kind>')
    .argument('<text...>')
    .action((kind: string, textParts: string[]) =>
      handlers.onSessionAppend(kind, textParts),
    )

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

  memoryCommand
    .command('append')
    .description('Append message to current session')
    .argument('<kind>')
    .argument('<text...>')
    .action((kind: string, textParts: string[]) =>
      handlers.onAppend(kind, textParts),
    )

  memoryCommand
    .command('search')
    .description('Search memory content')
    .argument('<query...>')
    .option('--tier <tier>', 'Search tier: NOW, RECENT, MEMORY, or all')
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--after <date>', 'Only search entries on or after a date')
    .action((queryParts: string[], options: SearchOptions) => {
      const query = queryParts.join(' ').trim()
      if (!query) {
        throw new Error('Missing search query.')
      }
      return handlers.onSearch(query, options)
    })

  memoryCommand
    .command('log')
    .description('View consolidation log')
    .option('--tail <lines>', 'Show last N lines')
    .action((options: LogOptions) => handlers.onLog(options))

  memoryCommand
    .command('recover')
    .description('Recover stale NOW sessions')
    .option('--hours <hours>', 'Maximum age in hours')
    .option('--consolidate', 'Consolidate recovered sessions')
    .action((options: RecoverOptions) => handlers.onRecover(options))

  memoryCommand
    .command('validate')
    .description('Validate memory structure')
    .action(() => handlers.onValidate())
}
