import { Command } from 'commander'

export type RecallImportOptions = {
  db?: string
  project?: string
  session?: string
  dryRun?: boolean
  after?: string
  limit?: string
}

type Handlers = {
  onStatus: (command: Command) => void | Promise<void>
  onImport: (
    options: RecallImportOptions,
    command: Command,
  ) => void | Promise<void>
}

export function registerRecallSubcommands(
  memory: Command,
  handlers: Handlers,
): void {
  const recall = new Command('recall').description(
    'Inspect or manually import OpenCode recall evidence',
  )
  recall.action(() => recall.outputHelp())
  recall
    .command('status')
    .description('Show canonical recall inventory')
    .action((_options: unknown, command: Command) => handlers.onStatus(command))
  recall
    .command('import')
    .description('Import OpenCode sessions into canonical memory')
    .option('--db <path>', 'OpenCode SQLite database path')
    .option('--project <id>', 'Filter by OpenCode project id')
    .option('--session <id>', 'Filter by OpenCode session id')
    .option('--after <date>', 'Sessions created on or after this date')
    .option('--limit <n>', 'Maximum sessions to inspect')
    .option('--dry-run', 'Classify sessions without writes or LLM calls')
    .action((options: RecallImportOptions, command: Command) =>
      handlers.onImport(options, command),
    )
  memory.addCommand(recall)
}
