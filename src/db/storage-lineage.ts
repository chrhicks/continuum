import { randomUUID } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runMigrations } from './migrate'
import {
  fingerprintStorage,
  writeDurably,
  type DatabaseSnapshot,
  type StorageFingerprint,
} from './storage-snapshot'

const STORAGE_METADATA_VERSION = 1
const IDENTITY_TABLE = 'continuum_storage_identity'
const LINEAGE_TABLE = 'continuum_storage_lineage'

export type StorageLineage = {
  projectId: string
  sourceKind: 'legacy' | 'path-hash'
  sourcePath: string
  sourceFingerprint: StorageFingerprint
}

export function prepareMigratedSnapshot(
  source: DatabaseSnapshot,
  projectId: string,
  lineages: StorageLineage[],
  stagingDirectory: string,
): DatabaseSnapshot {
  return prepareSnapshot(source, projectId, lineages, stagingDirectory)
}

export function prepareInitializedSnapshot(
  projectId: string,
  stagingDirectory: string,
): DatabaseSnapshot {
  return prepareSnapshot(null, projectId, [], stagingDirectory)
}

export function hasEmbeddedStorageIdentity(
  databasePath: string,
  projectId: string,
): boolean {
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    sqlite.exec('PRAGMA busy_timeout = 5000')
    if (!hasTable(sqlite, IDENTITY_TABLE)) return false
    const row = sqlite
      .query(
        `SELECT 1 AS present
         FROM ${IDENTITY_TABLE}
         WHERE version = ? AND project_id = ?
         LIMIT 1`,
      )
      .get(STORAGE_METADATA_VERSION, projectId) as { present: number } | null
    return row?.present === 1
  } finally {
    sqlite.close()
  }
}

export function hasEmbeddedLineage(
  databasePath: string,
  expected: StorageLineage,
): boolean {
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    sqlite.exec('PRAGMA busy_timeout = 5000')
    if (!hasTable(sqlite, LINEAGE_TABLE)) return false
    const row = sqlite
      .query(
        `SELECT 1 AS present
         FROM ${LINEAGE_TABLE}
         WHERE version = ? AND project_id = ? AND source_kind = ?
           AND source_fingerprint = ? AND source_byte_length = ?
         LIMIT 1`,
      )
      .get(
        STORAGE_METADATA_VERSION,
        expected.projectId,
        expected.sourceKind,
        expected.sourceFingerprint.digest,
        expected.sourceFingerprint.byteLength,
      ) as { present: number } | null
    return row?.present === 1
  } finally {
    sqlite.close()
  }
}

function prepareSnapshot(
  source: DatabaseSnapshot | null,
  projectId: string,
  lineages: StorageLineage[],
  stagingDirectory: string,
): DatabaseSnapshot {
  mkdirSync(stagingDirectory, { recursive: true })
  const staging = join(
    stagingDirectory,
    `.lineage-${process.pid}-${randomUUID()}.tmp`,
  )
  if (source) writeDurably(staging, source.bytes)

  let sqlite: Database | null = null
  try {
    sqlite = new Database(staging, { create: true })
    runMigrations(sqlite)
    ensureStorageTables(sqlite)
    const insertIdentity = sqlite.query(
      `INSERT OR IGNORE INTO ${IDENTITY_TABLE}
       (version, project_id, recorded_at)
       VALUES (?, ?, ?)`,
    )
    const insertLineage = sqlite.query(
      `INSERT OR IGNORE INTO ${LINEAGE_TABLE}
       (version, project_id, source_kind, source_path, source_fingerprint,
        source_byte_length, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const recordedAt = new Date().toISOString()
    sqlite.run('BEGIN IMMEDIATE')
    try {
      insertIdentity.run(STORAGE_METADATA_VERSION, projectId, recordedAt)
      for (const lineage of lineages) {
        insertLineage.run(
          STORAGE_METADATA_VERSION,
          lineage.projectId,
          lineage.sourceKind,
          lineage.sourcePath,
          lineage.sourceFingerprint.digest,
          lineage.sourceFingerprint.byteLength,
          recordedAt,
        )
      }
      sqlite.run('COMMIT')
    } catch (cause) {
      sqlite.run('ROLLBACK')
      throw cause
    }
    const bytes = sqlite.serialize()
    return { bytes, fingerprint: fingerprintStorage(bytes) }
  } finally {
    sqlite?.close()
    if (existsSync(staging)) rmSync(staging, { force: true })
    rmSync(`${staging}-wal`, { force: true })
    rmSync(`${staging}-shm`, { force: true })
  }
}

function ensureStorageTables(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${IDENTITY_TABLE} (
      version INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (version, project_id)
    );
    CREATE TABLE IF NOT EXISTS ${LINEAGE_TABLE} (
      version INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('legacy', 'path-hash')),
      source_path TEXT NOT NULL,
      source_fingerprint TEXT NOT NULL,
      source_byte_length INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (project_id, source_kind, source_fingerprint)
    );
  `)
}

function hasTable(sqlite: Database, tableName: string): boolean {
  const table = sqlite
    .query(
      `SELECT 1 AS present
       FROM sqlite_master
       WHERE type = 'table' AND name = ?
       LIMIT 1`,
    )
    .get(tableName) as { present: number } | null
  return table?.present === 1
}
