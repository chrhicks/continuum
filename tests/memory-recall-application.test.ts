import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect, Result } from 'effect'
import type { Database } from 'bun:sqlite'
import { getDbClientByPath } from '../src/db/client'
import { importCanonicalOpencodeRecall } from '../src/memory/application/recall-import'
import { makeRecallRepository } from '../src/memory/repository/recall-repository'
import type { OpencodeExtractionResult } from '../src/memory/opencode/extract'
import type { RecallSummaryResult } from '../src/memory/opencode/summary-schema'

const config = {
  apiUrl: 'test',
  apiKey: 'test',
  model: 'test',
  maxTokens: 1,
  timeoutMs: 1,
  maxChars: 1000,
  maxLines: 100,
  mergeMaxEstTokens: 1000,
}

const summary = (focus: string): RecallSummaryResult => ({
  focus,
  decisions: [],
  discoveries: [],
  patterns: [],
  tasks: [],
  files: [],
  blockers: [],
  open_questions: [],
  next_steps: [],
  confidence: 'high',
})

function extraction(text: string): OpencodeExtractionResult {
  return {
    dbPath: '/opencode.db',
    repoPath: '/repo',
    outDir: '/out',
    project: { id: 'project-1', worktree: '/repo' },
    sessions: [
      {
        session: {
          id: 'session-1',
          projectId: 'project-1',
          title: 'Recall title',
          time: { created: 1000, updated: 2000 },
        },
        messages: [],
        parts: [],
        messageBlocks: [
          {
            message: {
              id: 'user-1',
              sessionId: 'session-1',
              role: 'user',
              time: { created: 1100 },
            },
            parts: [
              {
                id: 'part-1',
                messageId: 'user-1',
                sessionId: 'session-1',
                type: 'text',
                text,
              },
            ],
          },
          {
            message: { id: 'tool-1', sessionId: 'session-1', role: 'tool' },
            parts: [
              {
                id: 'part-2',
                messageId: 'tool-1',
                sessionId: 'session-1',
                type: 'text',
                text: 'secret tool output',
              },
            ],
          },
          {
            message: {
              id: 'assistant-1',
              sessionId: 'session-1',
              role: 'assistant',
            },
            parts: [
              {
                id: 'part-3',
                messageId: 'assistant-1',
                sessionId: 'session-1',
                type: 'text',
                text: 'exact assistant evidence',
              },
            ],
          },
        ],
      },
    ],
  } as OpencodeExtractionResult
}

async function withRepository(
  run: (
    repository: ReturnType<typeof makeRecallRepository>,
    sqlite: Database,
  ) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-recall-'))
  try {
    const handle = getDbClientByPath(join(root, 'continuum.db'))
    await run(makeRecallRepository(handle), handle.sqlite)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function taggedErrorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && '_tag' in error
    ? String(error._tag)
    : undefined
}

describe('canonical recall application', () => {
  test('unchanged reimport skips summarization and retains provenance', async () =>
    withRepository(async (repository) => {
      let calls = 0
      const options = {
        repository,
        summaryConfig: config,
        extract: () => extraction('exact user evidence'),
        summarize: async () => {
          calls += 1
          return summary('summary evidence')
        },
      }
      const first = await Effect.runPromise(
        importCanonicalOpencodeRecall(options),
      )
      const second = await Effect.runPromise(
        importCanonicalOpencodeRecall(options),
      )
      expect(first.imported).toBe(1)
      expect(second.skippedExisting).toBe(1)
      expect(calls).toBe(1)
      const rows = await Effect.runPromise(repository.searchRows())
      expect(rows.map((row) => row.content).join(' ')).not.toContain(
        'secret tool output',
      )
      expect(
        rows.every(
          (row) =>
            row.sessionId === 'session-1' && row.projectId === 'project-1',
        ),
      ).toBe(true)
    }))

  test('changed sessions atomically refresh messages and summary', async () =>
    withRepository(async (repository, sqlite) => {
      await Effect.runPromise(
        importCanonicalOpencodeRecall({
          repository,
          summaryConfig: config,
          extract: () => extraction('old raw'),
          summarize: async () => summary('old summary'),
        }),
      )
      const changed = await Effect.runPromise(
        importCanonicalOpencodeRecall({
          repository,
          summaryConfig: config,
          extract: () => extraction('new raw'),
          summarize: async () => summary('new summary'),
        }),
      )
      expect(changed.changed).toBe(1)
      const content = (await Effect.runPromise(repository.searchRows()))
        .map((row) => row.content)
        .join(' ')
      expect(content).toContain('new raw')
      expect(content).toContain('new summary')
      expect(content).not.toContain('old raw')
      const history = sqlite
        .query(
          'SELECT content FROM memory_recall_messages ORDER BY source_fingerprint, ordinal',
        )
        .all() as Array<{ content: string }>
      expect(history.map((row) => row.content)).toContain('old raw')
      expect(history.map((row) => row.content)).toContain('new raw')
    }))

  test('failed changed summary leaves canonical rows untouched', async () =>
    withRepository(async (repository) => {
      await Effect.runPromise(
        importCanonicalOpencodeRecall({
          repository,
          summaryConfig: config,
          extract: () => extraction('stable raw'),
          summarize: async () => summary('stable summary'),
        }),
      )
      const failure = await Effect.runPromise(
        Effect.result(
          importCanonicalOpencodeRecall({
            repository,
            summaryConfig: config,
            extract: () => extraction('interrupted raw'),
            summarize: async () => {
              throw new Error('interrupted')
            },
          }),
        ),
      )
      expect(
        Result.isFailure(failure) && taggedErrorName(failure.failure),
      ).toBe('RecallSummaryError')
      const content = (await Effect.runPromise(repository.searchRows()))
        .map((row) => row.content)
        .join(' ')
      expect(content).toContain('stable raw')
      expect(content).not.toContain('interrupted raw')
    }))

  test('search rows preserve exact raw and derived summary evidence', async () =>
    withRepository(async (repository) => {
      await Effect.runPromise(
        importCanonicalOpencodeRecall({
          repository,
          summaryConfig: config,
          extract: () => extraction('needle exact/raw'),
          summarize: async () => summary('needle summary'),
        }),
      )
      const matches = (await Effect.runPromise(repository.searchRows())).filter(
        (row) => row.content.includes('needle'),
      )
      expect(matches.map((row) => row.evidence).sort()).toEqual([
        'raw',
        'summary',
      ])
    }))
})
