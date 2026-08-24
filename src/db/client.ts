import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'
import { canonicalDbFilePath } from './paths'
import { prepareCanonicalDatabase } from './storage'
import { hasCurrentMigrationState, runMigrations } from './migrate'
import { configureSqlite } from './sqlite'
import { readOnlyUnavailable } from './storage-errors'

export type DbClient = ReturnType<typeof drizzle>

export interface DbHandle {
  db: DbClient
  sqlite: Database
}

const clientCache = new Map<string, DbHandle>()
const readOnlyClientCache = new Map<string, DbHandle>()
const migratedPaths = new Set<string>()

export function createClient(dbPath: string): DbHandle {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  configureSqlite(sqlite)
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

export function createReadOnlyClient(dbPath: string): DbHandle {
  if (!existsSync(dbPath)) {
    throw readOnlyUnavailable(
      `Continuum database is missing: ${dbPath}. Run \`continuum init\` with write approval before using read-only tools.`,
    )
  }
  let sqlite: Database
  try {
    sqlite = new Database(dbPath, { readonly: true })
  } catch (cause) {
    throw readOnlyUnavailable(
      `Continuum database cannot be opened read-only: ${dbPath}`,
      cause,
    )
  }
  try {
    if (!hasCurrentMigrationState(sqlite)) {
      throw readOnlyUnavailable(
        `Continuum database requires migration: ${dbPath}. Run \`continuum init\` with write approval before using read-only tools.`,
      )
    }
    return { db: drizzle(sqlite, { schema }), sqlite }
  } catch (cause) {
    sqlite.close()
    throw cause
  }
}

export function getReadOnlyDbClientByPath(dbPath: string): DbHandle {
  let client = readOnlyClientCache.get(dbPath)
  if (!client) {
    client = createReadOnlyClient(dbPath)
    readOnlyClientCache.set(dbPath, client)
  }
  return client
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
  await prepareCanonicalDatabase(directory)
  const dbPath = canonicalDbFilePath(directory)
  return getDbClientByPath(dbPath, options)
}
