import { Effect, Schema } from 'effect'
import {
  DatabaseQueryError,
  DatabaseBusyError,
  DecodeError,
  databaseBusyError,
} from '../domain/errors'
import { JournalMetadata } from '../domain/journal-entry'
import { MemorySummarySchema } from '../domain/memory-summary'
import type { MemorySummary } from '../types'
import { appendRecallEvidence } from './query-recall'
import type { MemoryResourceOwner } from './resource-owner'

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

type StoredJournalEvidence = {
  id: string
  content: string
  created_at: string
  source: string | null
  metadata: string
}

export function listMemoryEvidence(
  owner: MemoryResourceOwner,
  options: MemoryQueryOptions = {},
): Effect.Effect<
  MemoryEvidence[],
  DatabaseQueryError | DatabaseBusyError | DecodeError
> {
  return Effect.try({
    try: () => {
      const sqlite = owner.handle.sqlite
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
          .all(boundary) as StoredJournalEvidence[]
        for (const row of rows) {
          const metadata = decodeJson(
            JournalMetadata,
            row.metadata ?? '{}',
            'JournalMetadata',
          )
          evidence.push({
            type: 'journal',
            provenance: 'raw',
            id: row.id,
            content: row.content,
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
            content: formatSummary(summary),
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
  owner: MemoryResourceOwner,
  query: string,
  options: MemoryQueryOptions = {},
): Effect.Effect<
  Array<MemoryEvidence & { score: number }>,
  DatabaseQueryError | DatabaseBusyError | DecodeError
> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const { limit, ...unlimitedOptions } = options
  return listMemoryEvidenceIncludingRecallHistory(owner, unlimitedOptions).pipe(
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
  owner: MemoryResourceOwner,
  options: MemoryQueryOptions,
): Effect.Effect<
  MemoryEvidence[],
  DatabaseQueryError | DatabaseBusyError | DecodeError
> {
  const currentMemory =
    options.source === 'recall'
      ? Effect.succeed([] as MemoryEvidence[])
      : listMemoryEvidence(owner, { ...options, source: 'memory' })
  return currentMemory.pipe(
    Effect.flatMap((evidence) =>
      Effect.try({
        try: () => {
          if (
            options.source === 'memory' ||
            (options.tier !== undefined && options.tier !== 'all')
          )
            return evidence
          appendRecallEvidence(owner.handle.sqlite, evidence, true)
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

function decodeJson<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string,
  name: string,
): S['Type'] {
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

function formatSummary(summary: {
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
  const lines = [summary.narrative]
  appendSummaryItems(lines, 'Decisions', summary.decisions)
  appendSummaryItems(lines, 'Discoveries', summary.discoveries)
  appendSummaryItems(lines, 'Patterns', summary.patterns)
  appendSummaryItems(lines, 'What Worked', summary.whatWorked)
  appendSummaryItems(lines, 'What Failed', summary.whatFailed)
  appendSummaryItems(lines, 'Blockers', summary.blockers)
  appendSummaryItems(lines, 'Open Questions', summary.openQuestions)
  appendSummaryItems(lines, 'Next Steps', summary.nextSteps)
  appendSummaryItems(lines, 'Tasks', summary.tasks)
  appendSummaryItems(lines, 'Files', summary.files)
  return lines.filter(Boolean).join('\n\n')
}

function appendSummaryItems(
  lines: string[],
  title: string,
  items: readonly string[],
): void {
  if (items.length === 0) return
  lines.push(`**${title}**\n${items.map((item) => `- ${item}`).join('\n')}`)
}

function countOccurrences(content: string, term: string): number {
  return content.toLowerCase().split(term).length - 1
}

function compareDates(left: string | null, right: string | null): number {
  return Date.parse(left ?? '') - Date.parse(right ?? '') || 0
}
