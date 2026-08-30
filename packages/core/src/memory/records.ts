import type { Database } from 'bun:sqlite'
import { ContinuumError } from '../errors'
import {
  prepareWorkspaceResolution,
  registerWorkspaceInTransaction,
} from '../workspaces/workspaces'

export type MemoryRecord = {
  id: string
  kind: string
  content: string
  tags: string[]
  createdAt: string
  supersedes: string[]
  supersededBy: string[]
}

export type RecordMemoryInput = {
  workspace: string
  content: string
  kind?: string
  tags?: string[]
  supersedes?: string[]
}

export type ImportMemoryRecordInput = RecordMemoryInput & {
  id: string
  createdAt: string
}

type PreparedRecord = {
  workspace: string
  id: string
  kind: string
  content: string
  tags: string[]
  createdAt: string
  supersedes: string[]
  importMode: boolean
}

type StoredRecord = {
  rowid: number
  id: string
  workspace_id: string
  kind: string
  content: string
  created_at: string
}

export function prepareMemoryRecord(input: RecordMemoryInput): PreparedRecord {
  return prepareRecord(
    input,
    crypto.randomUUID(),
    new Date().toISOString(),
    false,
    'record memory',
  )
}

export function prepareImportedMemoryRecord(
  input: ImportMemoryRecordInput,
): PreparedRecord {
  const operation = 'import memory record'
  const id = input.id.trim()
  if (!id || id !== input.id) {
    throw validationError(
      'Imported record ID must be nonempty and canonical.',
      operation,
    )
  }
  if (!isCanonicalMemoryTimestamp(input.createdAt)) {
    throw validationError(
      'Imported record timestamp must use canonical UTC ISO format.',
      operation,
    )
  }
  return prepareRecord(input, id, input.createdAt, true, operation)
}

export function writeMemoryRecord(
  database: Database,
  input: PreparedRecord,
): MemoryRecord {
  const preparedWorkspace = prepareWorkspaceResolution(input.workspace)
  const operation = input.importMode ? 'import memory record' : 'record memory'

  try {
    return database
      .transaction(() => {
        const workspace = registerWorkspaceInTransaction(
          database,
          preparedWorkspace,
        )
        const existing = findStoredRecord(database, input.id)
        if (existing) {
          return acceptIdempotentImport(database, existing, workspace.id, input)
        }

        const supersededRows = input.supersedes.map((id) => {
          const record = findStoredRecord(database, id)
          if (!record) {
            throw new ContinuumError({
              code: 'NOT_FOUND',
              operation,
              message: 'A superseded memory record was not found.',
              context: { recordId: id },
            })
          }
          if (record.workspace_id !== workspace.id) {
            throw validationError(
              'Superseded memory records must belong to the same workspace.',
              operation,
              { recordId: id },
            )
          }
          return record
        })

        const inserted = database
          .query(
            `INSERT INTO memory_records
           (id, workspace_id, kind, content, created_at)
           VALUES (?, ?, ?, ?, ?)
           RETURNING rowid`,
          )
          .get(
            input.id,
            workspace.id,
            input.kind,
            input.content,
            input.createdAt,
          ) as { rowid: number }

        for (const tag of input.tags) {
          database
            .query(
              `INSERT INTO memory_record_tags (record_rowid, tag)
             VALUES (?, ?)`,
            )
            .run(inserted.rowid, tag)
        }
        for (const record of supersededRows) {
          database
            .query(
              `INSERT INTO memory_supersessions
             (record_rowid, superseded_record_rowid)
             VALUES (?, ?)`,
            )
            .run(inserted.rowid, record.rowid)
        }
        database
          .query(
            `INSERT INTO memory_fts (rowid, content, kind, tags)
           VALUES (?, ?, ?, ?)`,
          )
          .run(inserted.rowid, input.content, input.kind, input.tags.join(' '))

        return readMemoryRecord(database, inserted.rowid)
      })
      .immediate()
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation,
      message: 'Failed to store the memory record.',
      context: { workspacePath: input.workspace, recordId: input.id },
      cause,
    })
  }
}

function prepareRecord(
  input: RecordMemoryInput,
  id: string,
  createdAt: string,
  importMode: boolean,
  operation: string,
): PreparedRecord {
  if (typeof input.content !== 'string' || !input.content.trim()) {
    throw validationError('Memory content must not be empty.', operation)
  }

  const kind = (input.kind ?? 'observation').trim().toLowerCase()
  if (!kind) throw validationError('Memory kind must not be empty.', operation)

  const tags = normalizeTags(input.tags ?? [], operation)
  const supersedes = normalizeRecordIds(input.supersedes ?? [], operation)

  return {
    workspace: input.workspace,
    id,
    kind,
    content: input.content,
    tags,
    createdAt,
    supersedes,
    importMode,
  }
}

function normalizeTags(tags: string[], operation: string): string[] {
  const normalized = tags.map((tag) => tag.trim().toLowerCase())
  if (normalized.some((tag) => !tag)) {
    throw validationError('Memory tags must not be empty.', operation)
  }
  return [...new Set(normalized)].sort()
}

function normalizeRecordIds(ids: string[], operation: string): string[] {
  const normalized = ids.map((id) => id.trim())
  if (normalized.some((id) => !id)) {
    throw validationError('Superseded record IDs must not be empty.', operation)
  }
  return [...new Set(normalized)].sort()
}

function acceptIdempotentImport(
  database: Database,
  existing: StoredRecord,
  workspaceId: string,
  input: PreparedRecord,
): MemoryRecord {
  if (!input.importMode) {
    throw recordIdCollision(input.id, 'record memory')
  }

  const existingRecord = readMemoryRecord(database, existing.rowid)
  const matches =
    existing.workspace_id === workspaceId &&
    existingRecord.kind === input.kind &&
    existingRecord.content === input.content &&
    existingRecord.createdAt === input.createdAt &&
    arraysEqual(existingRecord.tags, input.tags) &&
    arraysEqual(existingRecord.supersedes, input.supersedes)

  if (!matches) throw recordIdCollision(input.id, 'import memory record')
  return existingRecord
}

function recordIdCollision(id: string, operation: string): ContinuumError {
  return validationError(
    'A different memory record already uses this record ID.',
    operation,
    { recordId: id },
  )
}

function findStoredRecord(database: Database, id: string): StoredRecord | null {
  return database
    .query(
      `SELECT rowid, id, workspace_id, kind, content, created_at
       FROM memory_records WHERE id = ?`,
    )
    .get(id) as StoredRecord | null
}

function readMemoryRecord(database: Database, rowid: number): MemoryRecord {
  const record = readMemoryRecords(database, [rowid]).get(rowid)
  if (!record) {
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'read memory record',
      message: 'A stored memory record could not be read.',
    })
  }
  return record
}

export function readMemoryRecords(
  database: Database,
  rowids: number[],
): Map<number, MemoryRecord> {
  if (rowids.length === 0) return new Map()

  const placeholders = rowids.map(() => '?').join(', ')
  const rows = database
    .query(
      `SELECT rowid, id, workspace_id, kind, content, created_at
       FROM memory_records
       WHERE rowid IN (${placeholders})`,
    )
    .all(...rowids) as StoredRecord[]
  const records = new Map<number, MemoryRecord>()
  for (const row of rows) {
    records.set(row.rowid, {
      id: row.id,
      kind: row.kind,
      content: row.content,
      tags: [],
      createdAt: row.created_at,
      supersedes: [],
      supersededBy: [],
    })
  }

  const tags = database
    .query(
      `SELECT record_rowid, tag
       FROM memory_record_tags
       WHERE record_rowid IN (${placeholders})
       ORDER BY record_rowid, tag`,
    )
    .all(...rowids) as Array<{ record_rowid: number; tag: string }>
  for (const tag of tags) records.get(tag.record_rowid)?.tags.push(tag.tag)

  const supersedes = database
    .query(
      `SELECT s.record_rowid, old.id
       FROM memory_supersessions s
       JOIN memory_records old ON old.rowid = s.superseded_record_rowid
       WHERE s.record_rowid IN (${placeholders})
       ORDER BY s.record_rowid, old.id`,
    )
    .all(...rowids) as Array<{ record_rowid: number; id: string }>
  for (const relationship of supersedes) {
    records.get(relationship.record_rowid)?.supersedes.push(relationship.id)
  }

  const supersededBy = database
    .query(
      `SELECT s.superseded_record_rowid, replacement.id
       FROM memory_supersessions s
       JOIN memory_records replacement ON replacement.rowid = s.record_rowid
       WHERE s.superseded_record_rowid IN (${placeholders})
       ORDER BY s.superseded_record_rowid, replacement.id`,
    )
    .all(...rowids) as Array<{
    superseded_record_rowid: number
    id: string
  }>
  for (const relationship of supersededBy) {
    records
      .get(relationship.superseded_record_rowid)
      ?.supersededBy.push(relationship.id)
  }

  return records
}

export function isCanonicalMemoryTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false
  }
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function validationError(
  message: string,
  operation = 'record memory',
  context?: Record<string, string>,
): ContinuumError {
  return new ContinuumError({
    code: 'VALIDATION_ERROR',
    operation,
    message,
    context,
  })
}
