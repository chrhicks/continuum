import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'
import { dbFilePath } from './paths'
import { runMigrations } from './migrate'

export type DbClient = ReturnType<typeof drizzle>

export interface DbHandle {
  db: DbClient
  sqlite: Database
}

const clientCache = new Map<string, DbHandle>()
const migratedPaths = new Set<string>()

export function createClient(dbPath: string): DbHandle {
  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

export async function getDbClient(
  directory: string,
  options: { migrate?: boolean } = {},
): Promise<DbHandle> {
  const dbPath = dbFilePath(directory)
  let client = clientCache.get(dbPath)

  if (!client) {
    client = createClient(dbPath)
    clientCache.set(dbPath, client)
  }

  const shouldMigrate = options.migrate !== false
  if (shouldMigrate && !migratedPaths.has(dbPath)) {
    runMigrations(client.db)
    migratedPaths.add(dbPath)
  }

  return client
}
