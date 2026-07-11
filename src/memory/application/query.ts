import { getDbClientByPath } from '../../db/client'
import type { DbHandle } from '../../db/client'
import { Effect, Schema } from 'effect'
import {
  DatabaseQueryError,
  DatabaseBusyError,
  DecodeError,
  databaseBusyError,
} from '../domain/errors'
import { MemorySummarySchema } from '../domain/memory-summary'
import type { MemorySummary } from '../types'
import { appendRecallEvidence } from './query-recall'

export type MemoryEvidence = {
  type: 'journal' | 'consolidation' | 'recall-message' | 'recall-summary'
  provenance: 'raw' | 'derived'
  id: string
  content: string
  createdAt: string | null
  source: string
  tags: string[]
  current: boolean
}

export type MemoryQueryOptions = {
  source?: 'memory' | 'recall' | 'all'
  tier?: 'NOW' | 'MEMORY' | 'all'
  tags?: string[]
  afterDate?: Date
  limit?: number
}

export function listMemoryEvidence(
  dbPath: string,
  options: MemoryQueryOptions = {},
  handle?: DbHandle,
): Effect.Effect<
  MemoryEvidence[],
  DatabaseQueryError | DatabaseBusyError | DecodeError
> {
  return Effect.try({
    try: () => {
      const sqlite = (handle ?? getDbClientByPath(dbPath)).sqlite
      const evidence: MemoryEvidence[] = []
      const source = options.source ?? 'all'
      const tier = options.tier ?? 'all'

      if (source !== 'recall' && (tier === 'all' || tier === 'NOW')) {
        const boundary = (
          sqlite
            .query(
              "SELECT COALESCE(MAX(last_sequence), 0) boundary FROM memory_consolidations WHERE status='completed'",
            )
            .get() as { boundary: number }
        ).boundary
        const rows = sqlite
          .query(
            `SELECT id, content, created_at, source, metadata
         FROM memory_journal_entries WHERE sequence > ? ORDER BY sequence DESC`,
          )
          .all(boundary) as Array<Record<string, string | null>>
        for (const row of rows) {
          const metadata = decodeJson(
            JournalMetadata,
            row.metadata ?? '{}',
            'JournalMetadata',
          )
          evidence.push({
            type: 'journal',
            provenance: 'raw',
            id: row.id!,
            content: row.content!,
            createdAt: row.created_at,
            source: row.source ?? 'journal',
            tags: [...(metadata.tags ?? [])],
            current: true,
          })
        }
      }

      if (source !== 'recall' && tier !== 'NOW') {
        const rows = sqlite
          .query(
            `SELECT id, summary, completed_at FROM memory_consolidations
         WHERE status='completed' ORDER BY completed_at DESC`,
          )
          .all() as Array<{ id: string; summary: string; completed_at: string }>
        for (const row of rows) {
          const summary = decodeJson(
            MemorySummarySchema,
            row.summary,
            'MemorySummary',
          )
          evidence.push({
            type: 'consolidation',
            provenance: 'derived',
            id: row.id,
            content: flattenSummary(summary),
            createdAt: row.completed_at,
            source: 'journal consolidation',
            tags: [],
            current: true,
          })
        }
      }

      if (source !== 'memory' && tier === 'all')
        appendRecallEvidence(sqlite, evidence, false)
      return filterEvidence(evidence, options)
        .sort((a, b) => compareDates(b.createdAt, a.createdAt))
        .slice(0, options.limit ?? evidence.length)
    },
    catch: (cause) =>
      cause instanceof DecodeError
        ? cause
        : (databaseBusyError('list memory evidence', cause) ??
          new DatabaseQueryError({ operation: 'list memory evidence', cause })),
  })
}

export function searchMemoryEvidence(
  dbPath: string,
  query: string,
  options: MemoryQueryOptions = {},
  handle?: DbHandle,
): Effect.Effect<
  Array<MemoryEvidence & { score: number }>,
  DatabaseQueryError | DatabaseBusyError | DecodeError
> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const { limit, ...unlimitedOptions } = options
  return listMemoryEvidenceIncludingRecallHistory(
    dbPath,
    unlimitedOptions,
    handle,
  ).pipe(
    Effect.map((evidence) =>
      evidence
        .map((item) => ({
          ...item,
          score: terms.reduce(
            (score, term) => score + countOccurrences(item.content, term),
            0,
          ),
        }))
        .filter((item) => item.score > 0)
        .sort(
          (a, b) => b.score - a.score || compareDates(b.createdAt, a.createdAt),
        )
        .slice(0, limit ?? 20),
    ),
  )
}

function listMemoryEvidenceIncludingRecallHistory(
  dbPath: string,
  options: MemoryQueryOptions,
  handle?: DbHandle,
): Effect.Effect<
  MemoryEvidence[],
  DatabaseQueryError | DatabaseBusyError | DecodeError
> {
  const currentMemory =
    options.source === 'recall'
      ? Effect.succeed([] as MemoryEvidence[])
      : listMemoryEvidence(dbPath, { ...options, source: 'memory' }, handle)
  return currentMemory.pipe(
    Effect.flatMap((evidence) =>
      Effect.try({
        try: () => {
          if (
            options.source === 'memory' ||
            (options.tier !== undefined && options.tier !== 'all')
          )
            return evidence
          appendRecallEvidence(
            (handle ?? getDbClientByPath(dbPath)).sqlite,
            evidence,
            true,
          )
          return filterEvidence(evidence, options).sort((a, b) =>
            compareDates(b.createdAt, a.createdAt),
          )
        },
        catch: (cause) =>
          cause instanceof DecodeError
            ? cause
            : (databaseBusyError('list memory evidence history', cause) ??
              new DatabaseQueryError({
                operation: 'list memory evidence history',
                cause,
              })),
      }),
    ),
  )
}

const JournalMetadata = Schema.Struct({
  tags: Schema.optional(Schema.Array(Schema.String)),
})
function decodeJson<A, I>(
  schema: Schema.Schema<A, I>,
  value: string,
  name: string,
): A {
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(value))
  } catch (cause) {
    throw new DecodeError({ schema: name, cause })
  }
}

function filterEvidence(
  evidence: MemoryEvidence[],
  options: MemoryQueryOptions,
): MemoryEvidence[] {
  const after = options.afterDate?.getTime()
  return evidence.filter((item) => {
    if (after && (!item.createdAt || Date.parse(item.createdAt) < after))
      return false
    return (
      !options.tags?.length ||
      options.tags.every((tag) => item.tags.includes(tag))
    )
  })
}

function flattenSummary(summary: {
  readonly narrative: string
  readonly decisions: readonly string[]
  readonly discoveries: readonly string[]
  readonly patterns: readonly string[]
  readonly whatWorked: readonly string[]
  readonly whatFailed: readonly string[]
  readonly blockers: readonly string[]
  readonly openQuestions: readonly string[]
  readonly nextSteps: readonly string[]
  readonly tasks: readonly string[]
  readonly files: readonly string[]
}): string {
  return [
    summary.narrative,
    ...summary.decisions,
    ...summary.discoveries,
    ...summary.patterns,
    ...summary.whatWorked,
    ...summary.whatFailed,
    ...summary.blockers,
    ...summary.openQuestions,
    ...summary.nextSteps,
    ...summary.tasks,
    ...summary.files,
  ].join('\n')
}

function countOccurrences(content: string, term: string): number {
  return content.toLowerCase().split(term).length - 1
}

function compareDates(left: string | null, right: string | null): number {
  return Date.parse(left ?? '') - Date.parse(right ?? '') || 0
}
