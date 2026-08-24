import { Effect, Schema } from 'effect'
import type { DbHandle } from '../../db/client'
import {
  ConsolidationConflictError,
  ConsolidationPersistenceError,
  DatabaseBusyError,
  DecodeError,
  databaseBusyError,
} from '../domain/errors'
import { MemorySummarySchema } from '../domain/memory-summary'
import type { MemorySummary } from '../types'

export type CompletedConsolidation = {
  id: string
  firstSequence: number
  lastSequence: number
  summary: MemorySummary
  summaryVersion: number
  model: string | null
  createdAt: string
  completedAt: string
}

type ConsolidationError =
  | ConsolidationConflictError
  | ConsolidationPersistenceError
  | DatabaseBusyError
  | DecodeError

export interface ConsolidationRepositoryService {
  readonly complete: (input: {
    expectedBoundary: number
    firstSequence: number
    lastSequence: number
    summary: MemorySummary
    model?: string
  }) => Effect.Effect<CompletedConsolidation, ConsolidationError>
  readonly listCompleted: () => Effect.Effect<
    readonly CompletedConsolidation[],
    ConsolidationError
  >
}

export function makeConsolidationRepository(
  handle: DbHandle,
): ConsolidationRepositoryService {
  return {
    complete: Effect.fn('ConsolidationRepository.complete')(function* (input) {
      return yield* complete(handle, input)
    }),
    listCompleted: Effect.fn('ConsolidationRepository.listCompleted')(
      function* () {
        return yield* listCompleted(handle)
      },
    ),
  }
}

function complete(
  handle: DbHandle,
  input: {
    expectedBoundary: number
    firstSequence: number
    lastSequence: number
    summary: MemorySummary
    model?: string
  },
): Effect.Effect<CompletedConsolidation, ConsolidationError> {
  return Effect.try({
    try: () => {
      const transaction = handle.sqlite.transaction(() => {
        const existing = selectRange(
          handle,
          input.firstSequence,
          input.lastSequence,
        )
        if (existing) return existing
        const actualBoundary = selectLatestBoundary(handle)
        if (actualBoundary !== input.expectedBoundary) {
          throw new ConsolidationConflictError({
            expectedBoundary: input.expectedBoundary,
            actualBoundary,
          })
        }
        const now = new Date().toISOString()
        const id = crypto.randomUUID()
        handle.sqlite
          .query(
            `INSERT INTO memory_consolidations
             (id, first_sequence, last_sequence, status, summary,
              summary_version, model, created_at, completed_at)
             VALUES (?, ?, ?, 'completed', ?, 1, ?, ?, ?)`,
          )
          .run(
            id,
            input.firstSequence,
            input.lastSequence,
            JSON.stringify(input.summary),
            input.model ?? null,
            now,
            now,
          )
        const inserted = selectRange(
          handle,
          input.firstSequence,
          input.lastSequence,
        )
        if (!inserted) throw new Error('Inserted consolidation was not found')
        return inserted
      })
      return decodeRow(transaction.immediate())
    },
    catch: (cause) =>
      cause instanceof ConsolidationConflictError
        ? cause
        : cause instanceof DecodeError
          ? cause
          : (databaseBusyError('persist consolidation', cause) ??
            new ConsolidationPersistenceError({ cause })),
  })
}

function selectLatestBoundary(handle: DbHandle): number {
  const row = handle.sqlite
    .query(
      `SELECT COALESCE(MAX(last_sequence), 0) AS boundary
       FROM memory_consolidations WHERE status = 'completed'`,
    )
    .get() as { boundary: number }
  return row.boundary
}

function listCompleted(
  handle: DbHandle,
): Effect.Effect<readonly CompletedConsolidation[], ConsolidationError> {
  return Effect.try({
    try: () =>
      (
        handle.sqlite
          .query(
            `SELECT id, first_sequence, last_sequence, summary, summary_version,
                  model, created_at, completed_at
           FROM memory_consolidations WHERE status = 'completed'
           ORDER BY first_sequence ASC, last_sequence ASC`,
          )
          .all() as StoredRow[]
      ).map(decodeRow),
    catch: (cause) =>
      cause instanceof DecodeError
        ? cause
        : (databaseBusyError('list consolidations', cause) ??
          new ConsolidationPersistenceError({ cause })),
  })
}

type StoredRow = {
  id: string
  first_sequence: number
  last_sequence: number
  summary: string
  summary_version: number
  model: string | null
  created_at: string
  completed_at: string
}

function selectRange(
  handle: DbHandle,
  first: number,
  last: number,
): StoredRow | null {
  return handle.sqlite
    .query(
      `SELECT id, first_sequence, last_sequence, summary, summary_version,
              model, created_at, completed_at
       FROM memory_consolidations
       WHERE status = 'completed' AND first_sequence = ? AND last_sequence = ?`,
    )
    .get(first, last) as StoredRow | null
}

function decodeRow(row: StoredRow): CompletedConsolidation {
  let summary: MemorySummary
  try {
    const decoded = Schema.decodeUnknownSync(MemorySummarySchema)(
      JSON.parse(row.summary),
    )
    summary = {
      ...decoded,
      decisions: [...decoded.decisions],
      discoveries: [...decoded.discoveries],
      patterns: [...decoded.patterns],
      whatWorked: [...decoded.whatWorked],
      whatFailed: [...decoded.whatFailed],
      blockers: [...decoded.blockers],
      openQuestions: [...decoded.openQuestions],
      nextSteps: [...decoded.nextSteps],
      tasks: [...decoded.tasks],
      files: [...decoded.files],
    }
  } catch (cause) {
    throw new DecodeError({ schema: 'MemorySummary', field: 'summary', cause })
  }
  return {
    id: row.id,
    firstSequence: row.first_sequence,
    lastSequence: row.last_sequence,
    summary,
    summaryVersion: row.summary_version,
    model: row.model,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}
