import { Context, Effect, Layer, Schema } from 'effect'
import type { DbHandle } from '../../db/client'
import { getDbClientByPath } from '../../db/client'
import {
  DecodeError,
  DatabaseBusyError,
  JournalAppendError,
  JournalIdempotencyError,
  databaseBusyError,
} from '../domain/errors'
import {
  JournalAppendInput,
  JournalEntry,
  JournalMetadata,
} from '../domain/journal-entry'

type JournalError =
  | DecodeError
  | DatabaseBusyError
  | JournalAppendError
  | JournalIdempotencyError
type StoredJournalRow = {
  sequence: number
  id: string
  kind: string
  content: string
  source: string | null
  source_project_id: string | null
  source_session_id: string | null
  idempotency_key: string | null
  metadata: string
  payload_version: number
  created_at: string
}

export interface JournalRepositoryService {
  readonly append: (input: unknown) => Effect.Effect<JournalEntry, JournalError>
  readonly listPending: (
    afterSequence?: number,
    throughSequence?: number,
  ) => Effect.Effect<readonly JournalEntry[], JournalError>
  readonly latestBoundary: () => Effect.Effect<number | null, JournalError>
  readonly maxSequence: () => Effect.Effect<number | null, JournalError>
}

export class JournalRepository extends Context.Tag('JournalRepository')<
  JournalRepository,
  JournalRepositoryService
>() {}

const SELECT_COLUMNS = `sequence, id, kind, content, source, source_project_id,
  source_session_id, idempotency_key, metadata, payload_version, created_at`

export function makeJournalRepository(
  handle: DbHandle,
): JournalRepositoryService {
  return {
    append: (input) => appendEntry(handle, input),
    listPending: (after = 0, through) => listPending(handle, after, through),
    latestBoundary: () => latestBoundary(handle),
    maxSequence: () => maxSequence(handle),
  }
}

function maxSequence(
  handle: DbHandle,
): Effect.Effect<number | null, JournalError> {
  return Effect.try({
    try: () => {
      const row = handle.sqlite
        .query('SELECT MAX(sequence) AS sequence FROM memory_journal_entries')
        .get() as { sequence: number | null }
      return row.sequence
    },
    catch: (cause) =>
      databaseBusyError('read maximum journal sequence', cause) ??
      new JournalAppendError({ cause }),
  })
}

export function journalRepositoryLayer(
  dbPath: string,
): Layer.Layer<JournalRepository> {
  return Layer.sync(JournalRepository, () =>
    makeJournalRepository(getDbClientByPath(dbPath)),
  )
}

function appendEntry(
  handle: DbHandle,
  input: unknown,
): Effect.Effect<JournalEntry, JournalError> {
  return Effect.gen(function* () {
    const decoded = yield* decodeAppend(input)
    const row = yield* Effect.try({
      try: () => insertOrRead(handle, decoded),
      catch: (cause) =>
        databaseBusyError('append journal entry', cause) ??
        new JournalAppendError({ cause }),
    })
    return yield* decodeRow(row)
  })
}

function insertOrRead(
  handle: DbHandle,
  input: JournalAppendInput,
): StoredJournalRow {
  const id = input.id ?? crypto.randomUUID()
  const createdAt = input.createdAt ?? new Date().toISOString()
  const transaction = handle.sqlite.transaction(() => {
    if (input.idempotencyKey) {
      const existing = selectByIdempotency(handle, input.idempotencyKey)
      if (existing) return existing
    }
    handle.sqlite
      .query(
        `INSERT INTO memory_journal_entries
        (id, kind, content, source, source_project_id, source_session_id,
         idempotency_key, metadata, payload_version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.content,
        input.source ?? null,
        input.sourceProjectId ?? null,
        input.sourceSessionId ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.payloadVersion ?? 1,
        createdAt,
      )
    return handle.sqlite
      .query(
        `SELECT ${SELECT_COLUMNS} FROM memory_journal_entries WHERE id = ?`,
      )
      .get(id) as StoredJournalRow
  })
  return transaction.immediate()
}

function selectByIdempotency(
  handle: DbHandle,
  key: string,
): StoredJournalRow | null {
  return handle.sqlite
    .query(
      `SELECT ${SELECT_COLUMNS} FROM memory_journal_entries WHERE idempotency_key = ?`,
    )
    .get(key) as StoredJournalRow | null
}

function listPending(
  handle: DbHandle,
  after: number,
  through?: number,
): Effect.Effect<readonly JournalEntry[], JournalError> {
  return Effect.gen(function* () {
    const rows = yield* Effect.try({
      try: () =>
        through === undefined
          ? (handle.sqlite
              .query(
                `SELECT ${SELECT_COLUMNS} FROM memory_journal_entries
                 WHERE sequence > ? ORDER BY sequence ASC`,
              )
              .all(after) as StoredJournalRow[])
          : (handle.sqlite
              .query(
                `SELECT ${SELECT_COLUMNS} FROM memory_journal_entries
                 WHERE sequence > ? AND sequence <= ? ORDER BY sequence ASC`,
              )
              .all(after, through) as StoredJournalRow[]),
      catch: (cause) =>
        databaseBusyError('list journal entries', cause) ??
        new JournalAppendError({ cause }),
    })
    return yield* Effect.forEach(rows, decodeRow)
  })
}

function latestBoundary(
  handle: DbHandle,
): Effect.Effect<number | null, JournalError> {
  return Effect.try({
    try: () => {
      const row = handle.sqlite
        .query(
          `SELECT MAX(last_sequence) AS boundary FROM memory_consolidations
          WHERE status = 'completed'`,
        )
        .get() as { boundary: number | null }
      return row.boundary
    },
    catch: (cause) =>
      databaseBusyError('read consolidation boundary', cause) ??
      new JournalAppendError({ cause }),
  })
}

function decodeAppend(
  input: unknown,
): Effect.Effect<JournalAppendInput, DecodeError> {
  return Schema.decodeUnknown(JournalAppendInput)(input).pipe(
    Effect.mapError(
      (cause) => new DecodeError({ schema: 'JournalAppendInput', cause }),
    ),
  )
}

function decodeRow(
  row: StoredJournalRow,
): Effect.Effect<JournalEntry, DecodeError> {
  return Effect.gen(function* () {
    const metadata = yield* parseMetadata(row.metadata)
    return yield* Schema.decodeUnknown(JournalEntry)({
      sequence: row.sequence,
      id: row.id,
      kind: row.kind,
      content: row.content,
      source: row.source,
      sourceProjectId: row.source_project_id,
      sourceSessionId: row.source_session_id,
      idempotencyKey: row.idempotency_key,
      metadata,
      payloadVersion: row.payload_version,
      createdAt: row.created_at,
    }).pipe(
      Effect.mapError(
        (cause) => new DecodeError({ schema: 'JournalEntry', cause }),
      ),
    )
  })
}

function parseMetadata(
  value: string,
): Effect.Effect<JournalMetadata, DecodeError> {
  return Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: (cause) => new DecodeError({ schema: 'JournalMetadata', cause }),
  }).pipe(
    Effect.flatMap((metadata) =>
      Schema.decodeUnknown(JournalMetadata)(metadata).pipe(
        Effect.mapError(
          (cause) => new DecodeError({ schema: 'JournalMetadata', cause }),
        ),
      ),
    ),
  )
}
