import { Effect, Result } from 'effect'
import type { MemoryConfig } from '../config'
import { loadMemoryConfig } from '../config'
import type { JournalEntry } from '../domain/journal-entry'
import {
  ConsolidationConflictError,
  ConsolidationSummarizationError,
  ProjectionPublicationError,
} from '../domain/errors'
import { mechanicalSummary, summarizeNow } from '../summarize'
import type { MemorySummary } from '../types'
import {
  makeConsolidationRepository,
  type CompletedConsolidation,
  type ConsolidationRepositoryService,
} from '../repository/consolidation-repository'
import {
  makeJournalRepository,
  type JournalRepositoryService,
} from '../repository/journal-repository'
import type { MemoryResourceOwner } from './resource-owner'
import { publishMemoryProjections } from '../projection/consolidation-projections'
import { withProjectionPublicationLock } from '../projection/publication-lock'

export type ConsolidateMemoryResult =
  | { status: 'no-pending'; dryRun: boolean }
  | {
      status: 'preview'
      dryRun: true
      firstSequence: number
      lastSequence: number
      entryCount: number
      summary: MemorySummary
    }
  | {
      status: 'conflict'
      dryRun: false
      error: ConsolidationConflictError
    }
  | {
      status: 'completed'
      dryRun: false
      consolidation: CompletedConsolidation
      entryCount: number
      projection: { stale: false } | { stale: true; error: unknown }
    }

export type ConsolidateMemoryOptions = {
  dryRun?: boolean
}

export type ConsolidateMemoryDependencies = {
  config?: MemoryConfig
  summarize?: (entries: readonly JournalEntry[]) => Promise<MemorySummary>
  publish?: typeof publishMemoryProjections
}

export function consolidateMemory(
  owner: MemoryResourceOwner,
  options: ConsolidateMemoryOptions = {},
  dependencies: ConsolidateMemoryDependencies = {},
): Effect.Effect<ConsolidateMemoryResult, unknown> {
  const journal = makeJournalRepository(owner.handle)
  const consolidations = makeConsolidationRepository(owner.handle)
  return Effect.gen(function* () {
    const boundary = (yield* journal.latestBoundary()) ?? 0
    const snapshot = yield* journal.maxSequence()
    if (snapshot === null || snapshot <= boundary)
      return { status: 'no-pending', dryRun: options.dryRun ?? false } as const
    const entries = yield* journal.listPending(boundary, snapshot)
    if (entries.length === 0)
      return { status: 'no-pending', dryRun: options.dryRun ?? false } as const
    const first = entries[0]
    const last = entries.at(-1)
    if (!first || !last)
      return { status: 'no-pending', dryRun: options.dryRun ?? false } as const
    const config =
      dependencies.config ?? (yield* loadMemoryConfig(owner.memoryDir))
    const summary = yield* Effect.tryPromise({
      try: () => (dependencies.summarize ?? defaultSummarizer(config))(entries),
      catch: (cause) => new ConsolidationSummarizationError({ cause }),
    })
    const firstSequence = first.sequence
    const lastSequence = last.sequence
    if (options.dryRun)
      return {
        status: 'preview',
        dryRun: true,
        firstSequence,
        lastSequence,
        entryCount: entries.length,
        summary,
      } as const
    const completion = yield* Effect.result(
      consolidations.complete({
        expectedBoundary: boundary,
        firstSequence,
        lastSequence,
        summary,
        model: config.consolidation?.model,
      }),
    )
    if (Result.isFailure(completion)) {
      if (completion.failure instanceof ConsolidationConflictError)
        return {
          status: 'conflict',
          dryRun: false,
          error: completion.failure,
        } as const
      return yield* Effect.fail(completion.failure)
    }
    const consolidation = completion.success
    const projection = yield* Effect.result(
      regenerateProjections({
        journal,
        consolidations,
        memoryDir: owner.memoryDir,
        config,
        publish: dependencies.publish ?? publishMemoryProjections,
      }),
    )
    return {
      status: 'completed',
      dryRun: false,
      consolidation,
      entryCount: entries.length,
      projection:
        projection._tag === 'Success'
          ? ({ stale: false } as const)
          : ({ stale: true, error: projection.failure } as const),
    } as const
  })
}

function defaultSummarizer(config: MemoryConfig) {
  return async (entries: readonly JournalEntry[]): Promise<MemorySummary> => {
    const body = entries.map(renderSummaryEntry).join('\n\n')
    return config.consolidation
      ? summarizeNow(body, config.consolidation)
      : mechanicalSummary(body)
  }
}

function renderSummaryEntry(entry: JournalEntry): string {
  if (entry.kind === 'user') return `## User: ${entry.content}`
  if (entry.kind === 'agent') return `## Agent: ${entry.content}`
  if (entry.kind === 'tool') return `[Tool: ${entry.content}]`
  return `## ${entry.kind}: ${entry.content}`
}

function regenerateProjections(options: {
  journal: JournalRepositoryService
  consolidations: ConsolidationRepositoryService
  memoryDir: string
  config: MemoryConfig
  publish: typeof publishMemoryProjections
}): Effect.Effect<void, unknown> {
  return withProjectionPublicationLock(
    options.memoryDir,
    Effect.gen(function* () {
      const completed = yield* options.consolidations.listCompleted()
      const models = yield* Effect.forEach(completed, (consolidation) =>
        options.journal
          .listPending(
            consolidation.firstSequence - 1,
            consolidation.lastSequence,
          )
          .pipe(Effect.map((entries) => ({ consolidation, entries }))),
      )
      const boundary = completed.reduce(
        (maximum, item) => Math.max(maximum, item.lastSequence),
        0,
      )
      const pending = yield* options.journal.listPending(boundary)
      yield* Effect.try({
        try: () =>
          options.publish({
            memoryDir: options.memoryDir,
            pending,
            completed: models,
            config: options.config,
          }),
        catch: (cause) => cause,
      })
    }),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ProjectionPublicationError({ path: options.memoryDir, cause }),
    ),
  )
}
