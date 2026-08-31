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
  const unsafeSidecars = [
    { path: `${sourcePath}-wal`, field: 'sourceWal' },
    { path: `${sourcePath}-journal`, field: 'sourceJournal' },
  ]
  for (const sidecar of unsafeSidecars) {
    if (existsSync(sidecar.path) && statSync(sidecar.path).size > 0) {
      throw sourceValidationError(
        sourcePath,
        'The legacy source must be checkpointed before import.',
        sidecar.field,
      )
    }
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
    const createdAt = normalizeLegacyTimestamp(row.created_at)
    if (!createdAt) {
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
      createdAt,
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

function normalizeLegacyTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    )
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const fraction = match[7]
  const offset = match[8] as string
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (fraction !== undefined && /[^0]/.test(fraction.slice(3)))
  ) {
    return null
  }
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3))
    const offsetMinute = Number(offset.slice(4, 6))
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      return null
    }
  }

  const canonicalFraction = (fraction ?? '').slice(0, 3).padEnd(3, '0')
  const parseable = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${canonicalFraction}${offset}`
  const date = new Date(parseable)
  if (Number.isNaN(date.getTime())) return null
  const canonical = date.toISOString()
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical)
    ? canonical
    : null
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
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
