import { Database, constants } from 'bun:sqlite'
import { existsSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ContinuumError } from '@continuum/core'

export type ValidatedLegacyRecord = {
  sequence: number
  id: string
  kind: string
  content: string
  tags: string[]
  createdAt: string
}

type LegacyRow = {
  sequence: unknown
  id: unknown
  kind: unknown
  content: unknown
  metadata: unknown
  created_at: unknown
}

type TableColumn = {
  name: string
  type: string
  notnull: number
  pk: number
}

const journalTable = 'memory_journal_entries'

export function readValidatedLegacyRecords(
  sourcePath: string,
): ValidatedLegacyRecord[] {
  const walPath = `${sourcePath}-wal`
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    throw sourceValidationError(
      sourcePath,
      'The legacy source must be checkpointed before import.',
      'sourceWal',
    )
  }

  let database: Database
  try {
    const sourceUri = `${pathToFileURL(sourcePath).href}?immutable=1&mode=ro`
    database = new Database(
      sourceUri,
      constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI,
    )
  } catch (cause) {
    throw sourceDatabaseError(sourcePath, cause)
  }

  let transactionOpen = false
  let records: ValidatedLegacyRecord[] | undefined
  let failure: unknown

  try {
    database.exec('PRAGMA query_only = ON')
    database.exec('BEGIN')
    transactionOpen = true
    validateLegacySchema(database, sourcePath)
    const rows = database
      .query(
        `SELECT sequence, id, kind, content, metadata, created_at
         FROM memory_journal_entries
         ORDER BY sequence ASC`,
      )
      .all() as LegacyRow[]
    records = validateLegacyRows(rows, sourcePath)
    database.exec('COMMIT')
    transactionOpen = false
  } catch (cause) {
    failure =
      cause instanceof ContinuumError
        ? cause
        : sourceDatabaseError(sourcePath, cause)
  }

  if (transactionOpen) {
    try {
      database.exec('ROLLBACK')
    } catch (cause) {
      failure ??= sourceDatabaseError(sourcePath, cause)
    }
  }
  try {
    database.close()
  } catch (cause) {
    failure ??= new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'import v1',
      message: 'Failed to close the legacy Continuum database.',
      context: { sourcePath },
      cause,
    })
  }

  if (failure) throw failure
  return records as ValidatedLegacyRecord[]
}

function validateLegacySchema(database: Database, sourcePath: string): void {
  const table = database
    .query('SELECT type FROM sqlite_master WHERE name = ?')
    .get(journalTable) as { type: string } | null
  if (table?.type !== 'table') {
    throw sourceValidationError(
      sourcePath,
      'The legacy database does not contain the required journal table.',
      'memory_journal_entries',
    )
  }

  const columns = database
    .query('PRAGMA table_info(memory_journal_entries)')
    .all() as TableColumn[]
  const byName = new Map(columns.map((column) => [column.name, column]))
  const requiredTextColumns = [
    'id',
    'kind',
    'content',
    'metadata',
    'created_at',
  ]
  const sequence = byName.get('sequence')
  if (sequence?.type.trim().toUpperCase() !== 'INTEGER' || sequence.pk !== 1) {
    throw sourceValidationError(
      sourcePath,
      'The legacy journal sequence column has an unsupported schema.',
      'sequence',
    )
  }
  for (const name of requiredTextColumns) {
    const column = byName.get(name)
    if (column?.type.trim().toUpperCase() !== 'TEXT' || column.notnull !== 1) {
      throw sourceValidationError(
        sourcePath,
        'A required legacy journal column has an unsupported schema.',
        name,
      )
    }
  }
}

function validateLegacyRows(
  rows: LegacyRow[],
  sourcePath: string,
): ValidatedLegacyRecord[] {
  const records: ValidatedLegacyRecord[] = []
  const ids = new Set<string>()
  let previousSequence = 0

  for (const row of rows) {
    const sequence = validateSequence(
      row.sequence,
      previousSequence,
      sourcePath,
    )
    previousSequence = sequence

    if (
      typeof row.id !== 'string' ||
      !row.id ||
      row.id.trim() !== row.id ||
      ids.has(row.id)
    ) {
      throw sourceValidationError(
        sourcePath,
        'A legacy journal record has an invalid or duplicate ID.',
        'id',
        sequence,
      )
    }
    ids.add(row.id)

    if (typeof row.kind !== 'string' || !row.kind.trim()) {
      throw sourceValidationError(
        sourcePath,
        'A legacy journal record has an invalid kind.',
        'kind',
        sequence,
      )
    }
    if (typeof row.content !== 'string' || !row.content.trim()) {
      throw sourceValidationError(
        sourcePath,
        'A legacy journal record has invalid content.',
        'content',
        sequence,
      )
    }
    if (
      typeof row.created_at !== 'string' ||
      !isCanonicalTimestamp(row.created_at)
    ) {
      throw sourceValidationError(
        sourcePath,
        'A legacy journal record has an invalid creation timestamp.',
        'created_at',
        sequence,
      )
    }

    const tags = parseTags(row.metadata, sourcePath, sequence)
    records.push({
      sequence,
      id: row.id,
      kind: row.kind,
      content: row.content,
      tags,
      createdAt: row.created_at,
    })
  }

  return records
}

function validateSequence(
  value: unknown,
  previous: number,
  sourcePath: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value <= previous
  ) {
    throw sourceValidationError(
      sourcePath,
      'A legacy journal record has an invalid sequence.',
      'sequence',
    )
  }
  return value
}

function parseTags(
  metadataValue: unknown,
  sourcePath: string,
  sequence: number,
): string[] {
  if (typeof metadataValue !== 'string') {
    throw sourceValidationError(
      sourcePath,
      'A legacy journal record has invalid metadata.',
      'metadata',
      sequence,
    )
  }

  let metadata: unknown
  try {
    metadata = JSON.parse(metadataValue)
  } catch {
    throw sourceValidationError(
      sourcePath,
      'A legacy journal record has invalid metadata.',
      'metadata',
      sequence,
    )
  }
  if (!isObject(metadata)) {
    throw sourceValidationError(
      sourcePath,
      'Legacy journal metadata must be an object.',
      'metadata',
      sequence,
    )
  }

  const tags = metadata.tags
  if (tags === undefined) return []
  if (!Array.isArray(tags)) {
    throw sourceValidationError(
      sourcePath,
      'Legacy journal tags must be an array.',
      'tags',
      sequence,
    )
  }
  if (tags.some((tag) => typeof tag !== 'string' || !tag.trim())) {
    throw sourceValidationError(
      sourcePath,
      'Legacy journal tags must contain nonempty text.',
      'tags',
      sequence,
    )
  }
  return tags as string[]
}

function isCanonicalTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false
  }
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sourceValidationError(
  sourcePath: string,
  message: string,
  field: string,
  sequence?: number,
): ContinuumError {
  return new ContinuumError({
    code: 'VALIDATION_ERROR',
    operation: 'import v1',
    message,
    context: {
      sourcePath,
      field,
      ...(sequence === undefined ? {} : { sequence: String(sequence) }),
    },
  })
}

function sourceDatabaseError(
  sourcePath: string,
  cause: unknown,
): ContinuumError {
  return new ContinuumError({
    code: 'DATABASE_ERROR',
    operation: 'import v1',
    message: 'Failed to read the legacy Continuum database.',
    context: { sourcePath },
    cause,
  })
}
