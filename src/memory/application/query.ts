import { Effect } from 'effect'
import {
  DatabaseQueryError,
  DatabaseBusyError,
  DecodeError,
  databaseBusyError,
} from '../domain/errors'
import {
  loadConsolidationEvidence,
  loadJournalEvidence,
} from './query-memory-sources'
import {
  loadCurrentRecallEvidence,
  loadRecallHistoryEvidence,
} from './query-recall'
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

export type MemoryEvidenceQueryOperation = 'list' | 'search'

export type MemoryEvidenceQueryPlan = {
  operation: MemoryEvidenceQueryOperation
  source: NonNullable<MemoryQueryOptions['source']>
  tier: NonNullable<MemoryQueryOptions['tier']>
  sources: {
    journal: boolean
    consolidation: boolean
    currentRecall: boolean
    recallHistory: boolean
  }
}

type MemoryQueryFailure = DatabaseQueryError | DatabaseBusyError | DecodeError

export function buildMemoryEvidenceQueryPlan(
  operation: MemoryEvidenceQueryOperation,
  options: MemoryQueryOptions = {},
): MemoryEvidenceQueryPlan {
  const source = options.source ?? 'all'
  const tier = options.tier ?? 'all'
  const includesMemory = source !== 'recall'
  const includesRecall = source !== 'memory' && tier === 'all'

  return {
    operation,
    source,
    tier,
    sources: {
      journal: includesMemory && tier !== 'MEMORY',
      consolidation: includesMemory && tier !== 'NOW',
      currentRecall: includesRecall,
      recallHistory: includesRecall && operation === 'search',
    },
  }
}

export function listMemoryEvidence(
  owner: MemoryResourceOwner,
  options: MemoryQueryOptions = {},
): Effect.Effect<MemoryEvidence[], MemoryQueryFailure> {
  const plan = buildMemoryEvidenceQueryPlan('list', options)
  return executeMemoryEvidenceQueryPlan(owner, plan, options)
}

export function searchMemoryEvidence(
  owner: MemoryResourceOwner,
  query: string,
  options: MemoryQueryOptions = {},
): Effect.Effect<
  Array<MemoryEvidence & { score: number }>,
  MemoryQueryFailure
> {
  const plan = buildMemoryEvidenceQueryPlan('search', options)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  return executeMemoryEvidenceQueryPlan(owner, plan, options).pipe(
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
        .slice(0, options.limit ?? 20),
    ),
  )
}

function executeMemoryEvidenceQueryPlan(
  owner: MemoryResourceOwner,
  plan: MemoryEvidenceQueryPlan,
  options: MemoryQueryOptions,
): Effect.Effect<MemoryEvidence[], MemoryQueryFailure> {
  return loadSelectedMemorySources(owner, plan).pipe(
    Effect.flatMap((memoryEvidence) =>
      loadSelectedRecallSources(owner, plan).pipe(
        Effect.map((recallEvidence) =>
          selectEvidence([...memoryEvidence, ...recallEvidence], plan, options),
        ),
      ),
    ),
  )
}

function loadSelectedMemorySources(
  owner: MemoryResourceOwner,
  plan: MemoryEvidenceQueryPlan,
): Effect.Effect<MemoryEvidence[], MemoryQueryFailure> {
  return Effect.try({
    try: () => [
      ...(plan.sources.journal ? loadJournalEvidence(owner.handle.sqlite) : []),
      ...(plan.sources.consolidation
        ? loadConsolidationEvidence(owner.handle.sqlite)
        : []),
    ],
    catch: (cause) => queryFailure('list memory evidence', cause),
  })
}

function loadSelectedRecallSources(
  owner: MemoryResourceOwner,
  plan: MemoryEvidenceQueryPlan,
): Effect.Effect<MemoryEvidence[], MemoryQueryFailure> {
  return Effect.try({
    try: () => [
      ...(plan.sources.currentRecall
        ? loadCurrentRecallEvidence(owner.handle.sqlite)
        : []),
      ...(plan.sources.recallHistory
        ? loadRecallHistoryEvidence(owner.handle.sqlite)
        : []),
    ],
    catch: (cause) =>
      queryFailure(
        plan.operation === 'search'
          ? 'list memory evidence history'
          : 'list memory evidence',
        cause,
      ),
  })
}

function selectEvidence(
  evidence: MemoryEvidence[],
  plan: MemoryEvidenceQueryPlan,
  options: MemoryQueryOptions,
): MemoryEvidence[] {
  const after = options.afterDate?.getTime()
  const selected = evidence
    .filter((item) => {
      if (after && (!item.createdAt || Date.parse(item.createdAt) < after))
        return false
      return (
        !options.tags?.length ||
        options.tags.every((tag) => item.tags.includes(tag))
      )
    })
    .sort((a, b) => compareDates(b.createdAt, a.createdAt))

  return plan.operation === 'list'
    ? selected.slice(0, options.limit ?? evidence.length)
    : selected
}

function queryFailure(operation: string, cause: unknown): MemoryQueryFailure {
  return cause instanceof DecodeError
    ? cause
    : (databaseBusyError(operation, cause) ??
        new DatabaseQueryError({ operation, cause }))
}

function countOccurrences(content: string, term: string): number {
  return content.toLowerCase().split(term).length - 1
}

function compareDates(left: string | null, right: string | null): number {
  return Date.parse(left ?? '') - Date.parse(right ?? '') || 0
}
