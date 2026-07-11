export type LegacyMigrationItem = {
  path: string
  kind:
    | 'now'
    | 'daily-memory'
    | 'recent'
    | 'memory-index'
    | 'opencode-summary'
    | 'opencode-normalized'
  result: 'import' | 'skip' | 'ambiguity'
  detail: string
}

export type LegacyMigrationResult = {
  dryRun: boolean
  alreadyCompleted: boolean
  items: LegacyMigrationItem[]
}
