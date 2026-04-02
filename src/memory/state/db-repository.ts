import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { configureSqlite } from '../../db/sqlite'
import type { MemorySource } from '../types'
import type { MemoryStateRepository } from './repository'
import {
  createInMemoryMemoryStateRepository,
  createMemoryCheckpointKey,
} from './repository'
import type { MemoryCheckpoint, MemoryCheckpointInput } from './types'
import { readCheckpointFile } from './file-repository'

type StoredCheckpointRow = {
  key: string
  source: MemorySource
  scope: string
  cursor: string | null
  fingerprint: string | null
  record_count: number | null
  updated_at: string
  metadata: string
}

const INITIALIZE_SQL = `
CREATE TABLE IF NOT EXISTS memory_checkpoints (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  cursor TEXT,
  fingerprint TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_memory_checkpoints_source ON memory_checkpoints(source);
CREATE INDEX IF NOT EXISTS idx_memory_checkpoints_source_scope ON memory_checkpoints(source, scope);
`

const contextCache = new Map<string, DbRepositoryContext>()

type DbRepositoryContext = {
  sqlite: Database
}

export function createDbMemoryStateRepository(options: {
  dbPath: string
  legacyFilePath?: string | null
}): MemoryStateRepository {
  const context = getContext(options.dbPath, options.legacyFilePath ?? null)

  return {
    getCheckpoint(source, scope) {
      const row = context.sqlite
        .query(
          'SELECT key, source, scope, cursor, fingerprint, record_count, updated_at, metadata FROM memory_checkpoints WHERE key = ?',
        )
        .get(
          createMemoryCheckpointKey(source, scope),
        ) as StoredCheckpointRow | null
      return row ? normalizeCheckpointRow(row) : null
    },

    putCheckpoint(input) {
      const checkpoint = normalizeCheckpointInput(input)
      context.sqlite
        .query(
          `INSERT INTO memory_checkpoints (
             key, source, scope, cursor, fingerprint, record_count, updated_at, metadata
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             source = excluded.source,
             scope = excluded.scope,
             cursor = excluded.cursor,
             fingerprint = excluded.fingerprint,
             record_count = excluded.record_count,
             updated_at = excluded.updated_at,
             metadata = excluded.metadata`,
        )
        .run(
          checkpoint.key,
          checkpoint.source,
          checkpoint.scope,
          checkpoint.cursor,
          checkpoint.fingerprint,
          checkpoint.recordCount,
          checkpoint.updatedAt,
          JSON.stringify(checkpoint.metadata),
        )
      return checkpoint
    },

    listCheckpoints(source) {
      const rows = source
        ? (context.sqlite
            .query(
              'SELECT key, source, scope, cursor, fingerprint, record_count, updated_at, metadata FROM memory_checkpoints WHERE source = ? ORDER BY key ASC',
            )
            .all(source) as StoredCheckpointRow[])
        : (context.sqlite
            .query(
              'SELECT key, source, scope, cursor, fingerprint, record_count, updated_at, metadata FROM memory_checkpoints ORDER BY key ASC',
            )
            .all() as StoredCheckpointRow[])
      return rows.map((row) => normalizeCheckpointRow(row))
    },

    deleteCheckpoint(source, scope) {
      context.sqlite
        .query('DELETE FROM memory_checkpoints WHERE key = ?')
        .run(createMemoryCheckpointKey(source, scope))
    },
  }
}

function getContext(
  dbPath: string,
  legacyFilePath: string | null,
): DbRepositoryContext {
  const existing = contextCache.get(dbPath)
  if (existing) {
    return existing
  }

  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  configureSqlite(sqlite)
  sqlite.exec(INITIALIZE_SQL)
  migrateLegacyCheckpointFile(sqlite, legacyFilePath)

  const context = { sqlite }
  contextCache.set(dbPath, context)
  return context
}

function migrateLegacyCheckpointFile(
  sqlite: Database,
  legacyFilePath: string | null,
): void {
  if (!legacyFilePath || !existsSync(legacyFilePath)) {
    return
  }

  const legacyCheckpoints = readCheckpointFile(legacyFilePath)
  if (legacyCheckpoints.length === 0) {
    rmSync(legacyFilePath, { force: true })
    return
  }

  const repository = createInMemoryMemoryStateRepository(
    listStoredCheckpoints(sqlite).map((row) => normalizeCheckpointRow(row)),
  )
  let migrated = 0

  for (const checkpoint of legacyCheckpoints) {
    if (repository.getCheckpoint(checkpoint.source, checkpoint.scope)) {
      continue
    }
    repository.putCheckpoint(checkpoint)
    sqlite
      .query(
        `INSERT INTO memory_checkpoints (
           key, source, scope, cursor, fingerprint, record_count, updated_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO NOTHING`,
      )
      .run(
        checkpoint.key,
        checkpoint.source,
        checkpoint.scope,
        checkpoint.cursor,
        checkpoint.fingerprint,
        checkpoint.recordCount,
        checkpoint.updatedAt,
        JSON.stringify(checkpoint.metadata),
      )
    migrated += 1
  }

  if (migrated > 0 || legacyCheckpoints.length > 0) {
    rmSync(legacyFilePath, { force: true })
  }
}

function listStoredCheckpoints(sqlite: Database): StoredCheckpointRow[] {
  return sqlite
    .query(
      'SELECT key, source, scope, cursor, fingerprint, record_count, updated_at, metadata FROM memory_checkpoints ORDER BY key ASC',
    )
    .all() as StoredCheckpointRow[]
}

function normalizeCheckpointInput(
  input: MemoryCheckpointInput,
): MemoryCheckpoint {
  return {
    key: createMemoryCheckpointKey(input.source, input.scope),
    source: input.source,
    scope: input.scope,
    cursor: typeof input.cursor === 'string' ? input.cursor : null,
    fingerprint:
      typeof input.fingerprint === 'string' ? input.fingerprint : null,
    recordCount:
      typeof input.recordCount === 'number' &&
      Number.isFinite(input.recordCount)
        ? input.recordCount
        : 0,
    updatedAt:
      typeof input.updatedAt === 'string' && input.updatedAt.trim().length > 0
        ? input.updatedAt
        : new Date().toISOString(),
    metadata: input.metadata ? { ...input.metadata } : {},
  }
}

function normalizeCheckpointRow(row: StoredCheckpointRow): MemoryCheckpoint {
  return {
    key: row.key,
    source: row.source,
    scope: row.scope,
    cursor: row.cursor,
    fingerprint: row.fingerprint,
    recordCount:
      typeof row.record_count === 'number' && Number.isFinite(row.record_count)
        ? row.record_count
        : 0,
    updatedAt:
      typeof row.updated_at === 'string' && row.updated_at.trim().length > 0
        ? row.updated_at
        : new Date().toISOString(),
    metadata: parseMetadata(row.metadata),
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    // Ignore invalid legacy metadata and fall back to an empty object.
  }
  return {}
}
