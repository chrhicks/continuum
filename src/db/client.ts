import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'
import { dbFilePath } from './paths'
import { runMigrations } from './migrate'
import { configureSqlite } from './sqlite'

export type DbClient = ReturnType<typeof drizzle>

export interface DbHandle {
  db: DbClient
  sqlite: Database
}

const clientCache = new Map<string, DbHandle>()
const migratedPaths = new Set<string>()

export function createClient(dbPath: string): DbHandle {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  configureSqlite(sqlite)
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

export function getDbClientByPath(
  dbPath: string,
  options: { migrate?: boolean } = {},
): DbHandle {
  let client = clientCache.get(dbPath)
  if (!client) {
    client = createClient(dbPath)
    clientCache.set(dbPath, client)
  }
  if (options.migrate !== false && !migratedPaths.has(dbPath)) {
    runMigrations(client.sqlite)
    migratedPaths.add(dbPath)
  }
  return client
}

export async function getDbClient(
  directory: string,
  options: { migrate?: boolean } = {},
): Promise<DbHandle> {
  const dbPath = dbFilePath(directory)
  return getDbClientByPath(dbPath, options)
}
