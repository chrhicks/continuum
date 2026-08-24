import { Effect } from 'effect'
import { getDbClientByPath } from '../../db/client'
import { dirname } from 'node:path'
import type { JournalEntry } from '../domain/journal-entry'
import { publishNowProjection } from '../projection/now-projection'
import { ProjectionPublicationError } from '../domain/errors'
import { withProjectionPublicationLock } from '../projection/publication-lock'
import {
  makeJournalRepository,
  type JournalRepositoryService,
} from '../repository/journal-repository'

type AppendMemoryInput = {
  kind: string
  content: string
  idempotencyKey?: string
  source?: string
  sourceProjectId?: string
  sourceSessionId?: string
  metadata?: {
    tags?: string[]
    taskIds?: string[]
    filePaths?: string[]
    toolNames?: string[]
    operationIds?: string[]
  }
}

export type AppendMemoryResult = {
  entry: JournalEntry
  projection: { stale: false } | { stale: true; error: unknown }
}

export type AppendMemoryOptions = {
  dbPath: string
  nowPath: string
  input: AppendMemoryInput
  repository?: JournalRepositoryService
  publish?: (path: string, entries: readonly JournalEntry[]) => void
}

export function appendMemory(
  options: AppendMemoryOptions,
): Effect.Effect<AppendMemoryResult, unknown> {
  const repository =
    options.repository ??
    makeJournalRepository(getDbClientByPath(options.dbPath))
  return Effect.gen(function* () {
    const entry = yield* repository.append(options.input)
    const projection = yield* Effect.result(
      withProjectionPublicationLock(
        dirname(options.nowPath),
        Effect.gen(function* () {
          const boundary = (yield* repository.latestBoundary()) ?? 0
          const pending = yield* repository.listPending(boundary)
          yield* Effect.try({
            try: () =>
              (options.publish ?? publishNowProjection)(
                options.nowPath,
                pending,
              ),
            catch: (cause) =>
              new ProjectionPublicationError({ path: options.nowPath, cause }),
          })
        }),
      ),
    )
    return {
      entry,
      projection:
        projection._tag === 'Success'
          ? ({ stale: false } as const)
          : ({ stale: true, error: projection.failure } as const),
    }
  })
}
