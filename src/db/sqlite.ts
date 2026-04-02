import type { Database } from 'bun:sqlite'

const DEFAULT_BUSY_TIMEOUT_MS = 5000

export function configureSqlite(sqlite: Database): void {
  sqlite.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`)
}
