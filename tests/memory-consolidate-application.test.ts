import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Deferred, Effect, Result } from 'effect'
import { createClient, getDbClientByPath } from '../src/db/client'
import { appendMemory } from '../src/memory/application/append'
import { consolidateMemory } from '../src/memory/application/consolidate'
import { ConsolidationConflictError } from '../src/memory/domain/errors'
import { makeConsolidationRepository } from '../src/memory/repository/consolidation-repository'
import { makeJournalRepository } from '../src/memory/repository/journal-repository'
import type { MemorySummary } from '../src/memory/types'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function target(): { dbPath: string; memoryDir: string; nowPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'continuum-consolidate-'))
  directories.push(root)
  const memoryDir = join(root, '.continuum', 'memory')
  return {
    dbPath: join(root, '.continuum', 'continuum.db'),
    memoryDir,
    nowPath: join(memoryDir, 'NOW.md'),
  }
}

function summary(narrative: string): MemorySummary {
  return {
    narrative,
    decisions: [],
    discoveries: [],
    patterns: [],
    whatWorked: [],
    whatFailed: [],
    blockers: [],
    openQuestions: [],
    nextSteps: [],
    tasks: [],
    files: [],
    confidence: null,
  }
}

async function append(
  paths: ReturnType<typeof target>,
  content: string,
): Promise<void> {
  await Effect.runPromise(
    appendMemory({
      ...paths,
      input: { kind: 'user', content },
    }),
  )
}

describe('memory consolidate application', () => {
  test('returns no pending without writing projections', async () => {
    const paths = target()
    const result = await Effect.runPromise(consolidateMemory(paths))
    expect(result.status).toBe('no-pending')
    expect(existsSync(paths.nowPath)).toBe(false)
  })

  test('dry run summarizes the snapshot without database or file writes', async () => {
    const paths = target()
    await append(paths, 'pending')
    rmSync(paths.nowPath)
    const result = await Effect.runPromise(
      consolidateMemory({
        ...paths,
        dryRun: true,
        summarize: async () => summary('preview'),
      }),
    )
    expect(result.status).toBe('preview')
    expect(existsSync(paths.nowPath)).toBe(false)
    expect(count(paths.dbPath, 'memory_consolidations')).toBe(0)
  })

  test('excludes entries appended after the range snapshot', async () => {
    const paths = target()
    await append(paths, 'first')
    const result = await Effect.runPromise(
      consolidateMemory({
        ...paths,
        summarize: async () => {
          await append(paths, 'later')
          return summary('first only')
        },
      }),
    )
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.consolidation.lastSequence).toBe(1)
    expect(readFileSync(paths.nowPath, 'utf8')).toContain('later')
    expect(readFileSync(paths.nowPath, 'utf8')).not.toContain('first')
  })

  test('rejects an overlapping completion raced through two connections', async () => {
    const paths = target()
    await append(paths, 'first')
    const firstHandle = createClient(paths.dbPath)
    const secondHandle = createClient(paths.dbPath)
    const firstStarted = Effect.runSync(Deferred.make<void>())
    const releaseFirst = Effect.runSync(Deferred.make<void>())
    try {
      const first = Effect.runPromise(
        consolidateMemory({
          ...paths,
          journal: makeJournalRepository(firstHandle),
          consolidations: makeConsolidationRepository(firstHandle),
          summarize: async () => {
            await Effect.runPromise(Deferred.succeed(firstStarted, undefined))
            await Effect.runPromise(Deferred.await(releaseFirst))
            return summary('stale overlap')
          },
        }),
      )
      await Effect.runPromise(Deferred.await(firstStarted))
      await append(paths, 'second')
      const second = await Effect.runPromise(
        consolidateMemory({
          ...paths,
          journal: makeJournalRepository(secondHandle),
          consolidations: makeConsolidationRepository(secondHandle),
          summarize: async () => summary('winning range'),
        }),
      )
      expect(second.status).toBe('completed')
      await Effect.runPromise(Deferred.succeed(releaseFirst, undefined))
      const conflicted = await first
      expect(conflicted.status).toBe('conflict')
      if (conflicted.status !== 'conflict') return
      expect(conflicted.error).toBeInstanceOf(ConsolidationConflictError)
      expect(count(paths.dbPath, 'memory_consolidations')).toBe(1)
    } finally {
      firstHandle.sqlite.close()
      secondHandle.sqlite.close()
    }
  })

  test('does not alter source rows and failed summaries create no completion', async () => {
    const paths = target()
    await append(paths, 'immutable')
    const before = journalRows(paths.dbPath)
    const failure = await Effect.runPromise(
      Effect.result(
        consolidateMemory({
          ...paths,
          summarize: async () => {
            throw new Error('summary failed')
          },
        }),
      ),
    )
    expect(Result.isFailure(failure) && taggedErrorName(failure.failure)).toBe(
      'ConsolidationSummarizationError',
    )
    expect(journalRows(paths.dbPath)).toEqual(before)
    expect(count(paths.dbPath, 'memory_consolidations')).toBe(0)
  })

  test('persists an exact range idempotently', async () => {
    const paths = target()
    const repository = makeConsolidationRepository(
      getDbClientByPath(paths.dbPath),
    )
    const input = {
      expectedBoundary: 0,
      firstSequence: 1,
      lastSequence: 2,
      summary: summary('stored'),
    }
    const first = await Effect.runPromise(repository.complete(input))
    const retry = await Effect.runPromise(repository.complete(input))
    expect(retry).toEqual(first)
    expect(count(paths.dbPath, 'memory_consolidations')).toBe(1)
  })

  test('regenerates projections from previously persisted summaries', async () => {
    const paths = target()
    await append(paths, 'first source')
    await Effect.runPromise(
      consolidateMemory({
        ...paths,
        summarize: async () => summary('persisted first summary'),
      }),
    )
    rmSync(paths.memoryDir, { recursive: true, force: true })
    const journal = makeJournalRepository(getDbClientByPath(paths.dbPath))
    await Effect.runPromise(
      journal.append({ kind: 'user', content: 'second source' }),
    )
    await Effect.runPromise(
      consolidateMemory({
        ...paths,
        summarize: async () => summary('second summary'),
      }),
    )
    expect(readFileSync(join(paths.memoryDir, 'MEMORY.md'), 'utf8')).toContain(
      'persisted first summary',
    )
  })

  test('reports stale projection after canonical completion', async () => {
    const paths = target()
    await append(paths, 'durable')
    const result = await Effect.runPromise(
      consolidateMemory({
        ...paths,
        summarize: async () => summary('saved'),
        publish: () => {
          throw new Error('disk full')
        },
      }),
    )
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.projection.stale).toBe(true)
    expect(count(paths.dbPath, 'memory_consolidations')).toBe(1)
  })
})

function taggedErrorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && '_tag' in error
    ? String(error._tag)
    : undefined
}

function count(dbPath: string, table: string): number {
  const db = new Database(dbPath)
  const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number
  }
  db.close()
  return row.count
}

function journalRows(dbPath: string): unknown[] {
  const db = new Database(dbPath)
  const rows = db
    .query('SELECT * FROM memory_journal_entries ORDER BY sequence')
    .all()
  db.close()
  return rows
}
