import { createHash, randomUUID } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeDurably, type DatabaseSnapshot } from './storage-snapshot'

type SqliteRow = Record<string, unknown>

export function containsSnapshotRows(
  candidate: DatabaseSnapshot,
  expected: DatabaseSnapshot,
  stagingDirectory: string,
): boolean {
  mkdirSync(stagingDirectory, { recursive: true })
  const prefix = `.lineage-proof-${process.pid}-${randomUUID()}`
  const candidatePath = join(stagingDirectory, `${prefix}-candidate.tmp`)
  const expectedPath = join(stagingDirectory, `${prefix}-expected.tmp`)
  let candidateDb: Database | null = null
  let expectedDb: Database | null = null
  try {
    writeDurably(candidatePath, candidate.bytes)
    writeDurably(expectedPath, expected.bytes)
    candidateDb = new Database(candidatePath, { safeIntegers: true })
    expectedDb = new Database(expectedPath, { safeIntegers: true })
    return containsDatabaseRows(candidateDb, expectedDb)
  } finally {
    candidateDb?.close()
    expectedDb?.close()
    removeDatabaseFiles(candidatePath)
    removeDatabaseFiles(expectedPath)
  }
}

function containsDatabaseRows(
  candidate: Database,
  expected: Database,
): boolean {
  const candidateTables = new Set(tableNames(candidate))
  for (const table of tableNames(expected)) {
    if (!candidateTables.has(table)) return false
    const columns = tableColumns(expected, table)
    const candidateColumns = new Set(tableColumns(candidate, table))
    if (columns.some((column) => !candidateColumns.has(column))) return false
    if (!containsTableRows(candidate, expected, table, columns)) return false
  }
  return true
}

function removeDatabaseFiles(path: string): void {
  rmSync(path, { force: true })
  rmSync(`${path}-wal`, { force: true })
  rmSync(`${path}-shm`, { force: true })
}

function containsTableRows(
  candidate: Database,
  expected: Database,
  table: string,
  columns: string[],
): boolean {
  const candidateRows = rowCounts(candidate, table, columns)
  const expectedRows = rowCounts(expected, table, columns)
  for (const [row, count] of expectedRows) {
    if ((candidateRows.get(row) ?? 0) < count) return false
  }
  return true
}

function rowCounts(
  sqlite: Database,
  table: string,
  columns: string[],
): Map<string, number> {
  const selection = columns.map(quoteIdentifier).join(', ')
  const rows = sqlite
    .query(`SELECT ${selection} FROM ${quoteIdentifier(table)}`)
    .all() as SqliteRow[]
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = JSON.stringify(columns.map((column) => valueKey(row[column])))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function tableNames(sqlite: Database): string[] {
  const rows = sqlite
    .query(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

function tableColumns(sqlite: Database, table: string): string[] {
  const rows = sqlite
    .query(`PRAGMA table_xinfo(${quoteIdentifier(table)})`)
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

function valueKey(value: unknown): [string, string | number] {
  if (value === null) return ['null', 0]
  if (value instanceof Uint8Array) {
    return [
      'blob',
      `${value.byteLength}:${createHash('sha256').update(value).digest('hex')}`,
    ]
  }
  if (typeof value === 'bigint') return ['integer', value.toString()]
  if (typeof value === 'number') return ['real', value.toString()]
  if (typeof value === 'string') return ['text', value]
  throw new TypeError(`Unsupported SQLite value: ${typeof value}`)
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
