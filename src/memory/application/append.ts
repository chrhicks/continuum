import { Effect } from 'effect'
import { join } from 'node:path'
import type { JournalEntry } from '../domain/journal-entry'
import { publishNowProjection } from '../projection/now-projection'
import { ProjectionPublicationError } from '../domain/errors'
import { withProjectionPublicationLock } from '../projection/publication-lock'
import { makeJournalRepository } from '../repository/journal-repository'
import type { MemoryResourceOwner } from './resource-owner'

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
  input: AppendMemoryInput
}

export type AppendMemoryDependencies = {
  publish?: (path: string, entries: readonly JournalEntry[]) => void
}

export function appendMemory(
  owner: MemoryResourceOwner,
  options: AppendMemoryOptions,
  dependencies: AppendMemoryDependencies = {},
): Effect.Effect<AppendMemoryResult, unknown> {
  const repository = makeJournalRepository(owner.handle)
  const nowPath = join(owner.memoryDir, 'NOW.md')
  return Effect.gen(function* () {
    const entry = yield* repository.append(options.input)
    const projection = yield* Effect.result(
      withProjectionPublicationLock(
        owner.memoryDir,
        Effect.gen(function* () {
          const boundary = (yield* repository.latestBoundary()) ?? 0
          const pending = yield* repository.listPending(boundary)
          yield* Effect.try({
            try: () =>
              (dependencies.publish ?? publishNowProjection)(nowPath, pending),
            catch: (cause) =>
              new ProjectionPublicationError({ path: nowPath, cause }),
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
