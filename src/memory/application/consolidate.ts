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

type ProjectionStatus = { stale: false } | { stale: true; error: unknown }

type NoPendingConsolidationResult =
  | { status: 'no-pending'; dryRun: true }
  | { status: 'no-pending'; dryRun: false }
  | { status: 'no-pending'; dryRun: false; projection: ProjectionStatus }

export type ConsolidateMemoryResult =
  | NoPendingConsolidationResult
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
      projection: ProjectionStatus
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
    const dryRun = options.dryRun ?? false
    const boundary = (yield* journal.latestBoundary()) ?? 0
    const snapshot = yield* journal.maxSequence()
    const entries =
      snapshot === null || snapshot <= boundary
        ? []
        : yield* journal.listPending(boundary, snapshot)
    const first = entries[0]
    const last = entries.at(-1)
    if (!first || !last)
      return yield* finishWithoutPending({
        journal,
        consolidations,
        memoryDir: owner.memoryDir,
        boundary,
        dryRun,
        dependencies,
      })
    const config =
      dependencies.config ?? (yield* loadMemoryConfig(owner.memoryDir))
    const summary = yield* Effect.tryPromise({
      try: () => (dependencies.summarize ?? defaultSummarizer(config))(entries),
      catch: (cause) => new ConsolidationSummarizationError({ cause }),
    })
    const firstSequence = first.sequence
    const lastSequence = last.sequence
    if (dryRun)
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
    const projection = yield* regenerateProjectionStatus({
      journal,
      consolidations,
      memoryDir: owner.memoryDir,
      config,
      publish: dependencies.publish ?? publishMemoryProjections,
    })
    return {
      status: 'completed',
      dryRun: false,
      consolidation,
      entryCount: entries.length,
      projection,
    } as const
  })
}

function finishWithoutPending(options: {
  journal: JournalRepositoryService
  consolidations: ConsolidationRepositoryService
  memoryDir: string
  boundary: number
  dryRun: boolean
  dependencies: ConsolidateMemoryDependencies
}): Effect.Effect<NoPendingConsolidationResult, unknown> {
  if (options.dryRun)
    return Effect.succeed({ status: 'no-pending', dryRun: true })
  if (options.boundary === 0)
    return Effect.succeed({ status: 'no-pending', dryRun: false })
  return Effect.gen(function* () {
    const config =
      options.dependencies.config ??
      (yield* loadMemoryConfig(options.memoryDir))
    const projection = yield* regenerateProjectionStatus({
      journal: options.journal,
      consolidations: options.consolidations,
      memoryDir: options.memoryDir,
      config,
      publish: options.dependencies.publish ?? publishMemoryProjections,
    })
    return { status: 'no-pending', dryRun: false, projection } as const
  })
}

function regenerateProjectionStatus(options: {
  journal: JournalRepositoryService
  consolidations: ConsolidationRepositoryService
  memoryDir: string
  config: MemoryConfig
  publish: typeof publishMemoryProjections
}): Effect.Effect<ProjectionStatus> {
  return Effect.result(regenerateProjections(options)).pipe(
    Effect.map((result) =>
      result._tag === 'Success'
        ? ({ stale: false } as const)
        : ({ stale: true, error: result.failure } as const),
    ),
  )
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
