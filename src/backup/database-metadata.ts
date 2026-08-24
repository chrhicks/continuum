import { Database } from 'bun:sqlite'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackupDatabaseMetadata } from './contracts'
import { readDatabaseSnapshot } from '../db/storage-snapshot'

const REQUIRED_TABLES = [
  '__drizzle_migrations',
  'memory_journal_entries',
  'tasks',
] as const

export function inspectSnapshotMetadata(
  bytes: Uint8Array,
): BackupDatabaseMetadata {
  return withSnapshotFile(bytes, (path) => {
    readDatabaseSnapshot(path)
    const sqlite = new Database(path, { readonly: true })
    try {
      const migration = sqlite
        .query(
          `SELECT hash, created_at
           FROM __drizzle_migrations
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get() as { hash: string; created_at: number } | null
      const tables = (
        sqlite
          .query(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name`,
          )
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
      assertRequiredTables(tables)
      return {
        applicationVersion: readApplicationVersion(),
        migrationCreatedAt: migration?.created_at ?? null,
        migrationHash: migration?.hash ?? null,
        tables,
      }
    } finally {
      sqlite.close()
    }
  })
}

export function assertSnapshotMetadata(
  expected: BackupDatabaseMetadata,
  actual: BackupDatabaseMetadata,
): void {
  if (
    expected.migrationCreatedAt !== actual.migrationCreatedAt ||
    expected.migrationHash !== actual.migrationHash
  ) {
    throw new Error(
      'Backup migration metadata does not match the SQLite snapshot',
    )
  }
  if (expected.tables.join('\n') !== actual.tables.join('\n')) {
    throw new Error('Backup table metadata does not match the SQLite snapshot')
  }
}

function withSnapshotFile<T>(
  bytes: Uint8Array,
  operation: (path: string) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), 'continuum-snapshot-'))
  chmodSync(directory, 0o700)
  const path = join(directory, 'continuum.sqlite')
  try {
    writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' })
    return operation(path)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function assertRequiredTables(tables: readonly string[]): void {
  const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table))
  if (missing.length > 0) {
    throw new Error(
      `SQLite snapshot is missing expected tables: ${missing.join(', ')}`,
    )
  }
}

function readApplicationVersion(): string {
  const path = new URL('../../package.json', import.meta.url)
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error('Unable to read Continuum application version')
  }
  return value.version
}
