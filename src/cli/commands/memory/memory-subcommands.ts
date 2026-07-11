import { Command } from 'commander'

export type SearchOptions = {
  tier?: string
  source?: string
  tags?: string
  after?: string
  limit?: string
}

type Handlers = {
  onAppend: (
    kind: string,
    text: string[],
    command: Command,
  ) => void | Promise<void>
  onConsolidate: (dryRun: boolean, command: Command) => void | Promise<void>
  onMigrate: (dryRun: boolean, command: Command) => void | Promise<void>
  onSearch: (
    query: string,
    options: SearchOptions,
    command: Command,
  ) => void | Promise<void>
}

export function registerMemorySubcommands(
  memory: Command,
  handlers: Handlers,
): void {
  memory
    .command('append')
    .description('Append an immutable journal entry to canonical SQLite memory')
    .argument('<kind>', 'Entry kind: user, agent, or tool')
    .argument('<text...>')
    .action(
      (kind: string, text: string[], _options: unknown, command: Command) =>
        handlers.onAppend(kind, text, command),
    )

  memory
    .command('consolidate')
    .description('Consolidate pending journal entries without deleting them')
    .option('--dry-run', 'Preview without writing')
    .action((options: { dryRun?: boolean }, command: Command) =>
      handlers.onConsolidate(options.dryRun ?? false, command),
    )

  memory
    .command('search')
    .description('Search canonical journal, consolidation, and recall evidence')
    .argument('<query...>')
    .option('--tier <tier>', 'NOW, MEMORY, or all', 'all')
    .option('--source <source>', 'memory, recall, or all', 'all')
    .option('--tags <tags>', 'Journal tags (comma-separated)')
    .option('--after <date>', 'Evidence on or after this date')
    .option('--limit <n>', 'Maximum results')
    .action((parts: string[], options: SearchOptions, command: Command) =>
      handlers.onSearch(parts.join(' ').trim(), options, command),
    )

  memory
    .command('migrate')
    .description('Import legacy Markdown into canonical SQLite memory')
    .option('--dry-run', 'Inventory without writing')
    .action((options: { dryRun?: boolean }, command: Command) =>
      handlers.onMigrate(options.dryRun ?? false, command),
    )
}
