import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as schema from './schema'
import type { DbClient } from './client'

function migrationsFolder(): string {
  return new URL('../../drizzle', import.meta.url).pathname
}

export function runMigrations(db: DbClient): void {
  migrate(db, { migrationsFolder: migrationsFolder() })
}

export async function migrateDb(dbPath: string): Promise<void> {
  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsFolder() })
  sqlite.close()
}

function readArg(name: string, args: string[]): string | null {
  const index = args.indexOf(name)
  if (index === -1) return null
  return args[index + 1] ?? null
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dbPath =
    readArg('--db', args) ?? `${process.cwd()}/.continuum/continuum.db`
  await migrateDb(dbPath)
}

if (import.meta.main) {
  await main()
}
