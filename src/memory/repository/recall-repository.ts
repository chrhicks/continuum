import { Effect } from 'effect'
import type { DbHandle } from '../../db/client'
import { getDbClientByPath } from '../../db/client'
import {
  DatabaseBusyError,
  RecallIngestionError,
  RecallSourceError,
  databaseBusyError,
} from '../domain/errors'
import type {
  RecallMessage,
  RecallSource,
  RecallSummary,
} from '../domain/recall'

export type RecallReplacement = {
  source: RecallSource
  messages: readonly RecallMessage[]
  summary: RecallSummary
}

export type RecallSearchRow = {
  evidence: 'raw' | 'summary'
  sourceId: string
  sessionId: string
  projectId: string | null
  title: string | null
  role: string | null
  ordinal: number | null
  content: string
  createdAt: string | null
}

export interface RecallRepositoryService {
  readonly findSource: (
    harness: string,
    sessionId: string,
  ) => Effect.Effect<RecallSource | null, RecallSourceError | DatabaseBusyError>
  readonly replace: (
    replacement: RecallReplacement,
  ) => Effect.Effect<void, RecallIngestionError | DatabaseBusyError>
  readonly searchRows: () => Effect.Effect<
    readonly RecallSearchRow[],
    RecallSourceError | DatabaseBusyError
  >
}

export function makeRecallRepository(
  handle: DbHandle,
): RecallRepositoryService {
  return {
    findSource: Effect.fn('RecallRepository.findSource')(
      function* (harness, sessionId) {
        return yield* findSource(handle, harness, sessionId)
      },
    ),
    replace: Effect.fn('RecallRepository.replace')(function* (replacement) {
      return yield* replaceRecall(handle, replacement)
    }),
    searchRows: Effect.fn('RecallRepository.searchRows')(function* () {
      return yield* searchRows(handle)
    }),
  }
}

export function recallRepositoryForPath(
  dbPath: string,
): RecallRepositoryService {
  return makeRecallRepository(getDbClientByPath(dbPath))
}

function findSource(
  handle: DbHandle,
  harness: string,
  sessionId: string,
): Effect.Effect<RecallSource | null, RecallSourceError | DatabaseBusyError> {
  return Effect.try({
    try: () => {
      const row = handle.sqlite
        .query(
          `SELECT id, harness, external_project_id, external_session_id, title,
          source_created_at, source_updated_at, fingerprint, first_ingested_at,
          last_ingested_at FROM memory_recall_sources
          WHERE harness = ? AND external_session_id = ?`,
        )
        .get(harness, sessionId) as StoredSource | null
      return row ? mapSource(row) : null
    },
    catch: (cause) =>
      databaseBusyError('read recall source', cause) ??
      new RecallSourceError({ cause }),
  })
}

function replaceRecall(
  handle: DbHandle,
  value: RecallReplacement,
): Effect.Effect<void, RecallIngestionError | DatabaseBusyError> {
  return Effect.try({
    try: () =>
      handle.sqlite
        .transaction(() => {
          const existing = handle.sqlite
            .query(
              'SELECT first_ingested_at FROM memory_recall_sources WHERE id = ?',
            )
            .get(value.source.id) as { first_ingested_at: string } | null
          handle.sqlite
            .query(
              `INSERT INTO memory_recall_sources
          (id, harness, external_project_id, external_session_id, title,
           source_created_at, source_updated_at, fingerprint, first_ingested_at,
           last_ingested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(harness, external_session_id) DO UPDATE SET
           external_project_id=excluded.external_project_id, title=excluded.title,
           source_created_at=excluded.source_created_at,
           source_updated_at=excluded.source_updated_at,
           fingerprint=excluded.fingerprint, last_ingested_at=excluded.last_ingested_at`,
            )
            .run(
              value.source.id,
              value.source.harness,
              value.source.externalProjectId,
              value.source.externalSessionId,
              value.source.title,
              value.source.sourceCreatedAt,
              value.source.sourceUpdatedAt,
              value.source.fingerprint,
              existing?.first_ingested_at ?? value.source.firstIngestedAt,
              value.source.lastIngestedAt,
            )
          handle.sqlite
            .query('DELETE FROM memory_recall_summaries WHERE source_id = ?')
            .run(value.source.id)
          const insertMessage = handle.sqlite.query(
            `INSERT OR IGNORE INTO memory_recall_messages
          (id, source_id, source_fingerprint, ordinal, role, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          for (const message of value.messages) {
            insertMessage.run(
              message.id,
              message.sourceId,
              message.sourceFingerprint,
              message.ordinal,
              message.role,
              message.content,
              message.createdAt,
            )
          }
          handle.sqlite
            .query(
              `INSERT INTO memory_recall_summaries
          (id, source_id, summary, summary_version, model, source_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              value.summary.id,
              value.summary.sourceId,
              JSON.stringify(value.summary.summary),
              value.summary.summaryVersion,
              value.summary.model,
              value.summary.sourceFingerprint,
              value.summary.createdAt,
            )
        })
        .immediate(),
    catch: (cause) =>
      databaseBusyError('persist recall import', cause) ??
      new RecallIngestionError({ cause }),
  })
}

function searchRows(
  handle: DbHandle,
): Effect.Effect<
  readonly RecallSearchRow[],
  RecallSourceError | DatabaseBusyError
> {
  return Effect.try({
    try: () =>
      (
        handle.sqlite
          .query(
            `SELECT 'raw' evidence, s.id source_id, s.external_session_id session_id,
         s.external_project_id project_id, s.title, m.role, m.ordinal,
         m.content, COALESCE(m.created_at, s.source_created_at) created_at
       FROM memory_recall_messages m JOIN memory_recall_sources s ON s.id=m.source_id
       WHERE m.source_fingerprint = s.fingerprint
       UNION ALL
        SELECT 'summary', s.id, s.external_session_id, s.external_project_id,
          s.title, NULL, NULL, r.summary, r.created_at
        FROM memory_recall_summaries r JOIN memory_recall_sources s ON s.id=r.source_id
        WHERE r.source_fingerprint = s.fingerprint`,
          )
          .all() as Record<string, unknown>[]
      ).map(mapSearchRow),
    catch: (cause) =>
      databaseBusyError('search recall evidence', cause) ??
      new RecallSourceError({ cause }),
  })
}

type StoredSource = {
  id: string
  harness: string
  external_project_id: string | null
  external_session_id: string
  title: string | null
  source_created_at: string | null
  source_updated_at: string | null
  fingerprint: string
  first_ingested_at: string
  last_ingested_at: string
}

function mapSource(row: StoredSource): RecallSource {
  return {
    id: row.id,
    harness: row.harness,
    externalProjectId: row.external_project_id,
    externalSessionId: row.external_session_id,
    title: row.title,
    sourceCreatedAt: row.source_created_at,
    sourceUpdatedAt: row.source_updated_at,
    fingerprint: row.fingerprint,
    firstIngestedAt: row.first_ingested_at,
    lastIngestedAt: row.last_ingested_at,
  }
}

function mapSearchRow(row: Record<string, unknown>): RecallSearchRow {
  return {
    evidence: row.evidence as 'raw' | 'summary',
    sourceId: String(row.source_id),
    sessionId: String(row.session_id),
    projectId: row.project_id as string | null,
    title: row.title as string | null,
    role: row.role as string | null,
    ordinal: row.ordinal as number | null,
    content: String(row.content),
    createdAt: row.created_at as string | null,
  }
}
