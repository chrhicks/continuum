import { Database } from 'bun:sqlite'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { configureSqlite } from './sqlite'

const MIGRATIONS_TABLE = '__drizzle_migrations'

function migrationsFolder(): string {
  return new URL('../../drizzle', import.meta.url).pathname
}

export function runMigrations(sqlite: Database): void {
  applyMigrations(sqlite)
}

export async function migrateDb(dbPath: string): Promise<void> {
  const sqlite = new Database(dbPath)
  configureSqlite(sqlite)
  try {
    applyMigrations(sqlite)
  } finally {
    sqlite.close()
  }
}

function applyMigrations(sqlite: Database): void {
  const migrations = readMigrationFiles({
    migrationsFolder: migrationsFolder(),
  })
  if (migrations.length === 0) {
    return
  }

  const latestMigrationMillis = Math.max(
    ...migrations.map((migration) => migration.folderMillis),
  )

  if (isMigrationStateCurrent(sqlite, latestMigrationMillis)) {
    return
  }

  sqlite.run('BEGIN IMMEDIATE')
  try {
    ensureMigrationsTable(sqlite)
    const lastAppliedMillis = readLastAppliedMigrationMillis(sqlite)

    for (const migration of migrations) {
      if (
        lastAppliedMillis !== null &&
        Number(lastAppliedMillis) >= migration.folderMillis
      ) {
        continue
      }

      for (const statement of migration.sql) {
        if (statement.trim().length === 0) {
          continue
        }
        sqlite.run(statement)
      }

      sqlite
        .query(
          `INSERT INTO "${MIGRATIONS_TABLE}" (hash, created_at) VALUES (?, ?)`,
        )
        .run(migration.hash, migration.folderMillis)
    }
    sqlite.run('COMMIT')
  } catch (error) {
    sqlite.run('ROLLBACK')
    throw error
  }
}

function isMigrationStateCurrent(
  sqlite: Database,
  latestMigrationMillis: number,
): boolean {
  if (!hasMigrationsTable(sqlite)) {
    return false
  }

  const lastAppliedMillis = readLastAppliedMigrationMillis(sqlite)
  return (
    lastAppliedMillis !== null &&
    Number(lastAppliedMillis) >= latestMigrationMillis
  )
}

function hasMigrationsTable(sqlite: Database): boolean {
  const row = sqlite
    .query(
      `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(MIGRATIONS_TABLE) as { present: number } | null
  return row?.present === 1
}

function ensureMigrationsTable(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `)
}

function readLastAppliedMigrationMillis(sqlite: Database): number | null {
  const row = sqlite
    .query(
      `SELECT created_at FROM "${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { created_at: number | null } | null
  return row?.created_at ?? null
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
