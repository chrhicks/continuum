import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect, Redacted, Result } from 'effect'
import type { Database } from 'bun:sqlite'
import { getDbClientByPath } from '../src/db/client'
import {
  executeCanonicalRecallImport,
  importCanonicalOpencodeRecall,
  prepareCanonicalRecallImport,
  RecallImportExecutionError,
} from '../src/memory/application/recall-import'
import { makeRecallRepository } from '../src/memory/repository/recall-repository'
import type { OpencodeExtractionResult } from '../src/memory/opencode/extract'
import type { RecallSummaryResult } from '../src/memory/opencode/summary-schema'
import {
  memoryResourceOwner,
  type MemoryResourceOwner,
} from '../src/memory/application/resource-owner'

const config = {
  apiUrl: 'test',
  apiKey: Redacted.make('test'),
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

function extraction(
  text: string,
  sessionId = 'session-1',
): OpencodeExtractionResult {
  return {
    dbPath: '/opencode.db',
    repoPath: '/repo',
    outDir: '/out',
    project: { id: 'project-1', worktree: '/repo' },
    sessions: [
      {
        session: {
          id: sessionId,
          projectId: 'project-1',
          title: `Recall ${sessionId}`,
          time: { created: 1000, updated: 2000 },
        },
        messages: [],
        parts: [],
        messageBlocks: [
          {
            message: {
              id: `user-${sessionId}`,
              sessionId,
              role: 'user',
              time: { created: 1100 },
            },
            parts: [
              {
                id: `user-part-${sessionId}`,
                messageId: `user-${sessionId}`,
                sessionId,
                type: 'text',
                text,
              },
            ],
          },
          {
            message: { id: `tool-${sessionId}`, sessionId, role: 'tool' },
            parts: [
              {
                id: `tool-part-${sessionId}`,
                messageId: `tool-${sessionId}`,
                sessionId,
                type: 'text',
                text: 'secret tool output',
              },
            ],
          },
          {
            message: {
              id: `assistant-${sessionId}`,
              sessionId,
              role: 'assistant',
            },
            parts: [
              {
                id: `assistant-part-${sessionId}`,
                messageId: `assistant-${sessionId}`,
                sessionId,
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

function multipleExtraction(
  sessions: ReadonlyArray<{ id: string; text: string }>,
): OpencodeExtractionResult {
  const first = sessions[0]
  if (!first) return { ...extraction(''), sessions: [] }
  return {
    ...extraction(first.text, first.id),
    sessions: sessions.flatMap(({ id, text }) => extraction(text, id).sessions),
  }
}

async function withRepository(
  run: (
    owner: MemoryResourceOwner,
    repository: ReturnType<typeof makeRecallRepository>,
    sqlite: Database,
  ) => Promise<void>,
): Promise<void> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'continuum-recall-'))
  try {
    const dbPath = join(workspaceRoot, 'continuum.db')
    const handle = getDbClientByPath(dbPath)
    const owner = memoryResourceOwner(
      { workspaceRoot, memoryDir: join(workspaceRoot, 'memory'), dbPath },
      handle,
    )
    await run(owner, makeRecallRepository(handle), handle.sqlite)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
}

function taggedErrorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && '_tag' in error
    ? String(error._tag)
    : undefined
}

describe('canonical recall application', () => {
  test('unchanged reimport skips summarization and retains provenance', async () =>
    withRepository(async (owner, repository) => {
      let calls = 0
      const dependencies = {
        summaryConfig: config,
        extract: () => extraction('exact user evidence'),
        summarize: async () => {
          calls += 1
          return summary('summary evidence')
        },
      }
      const first = await Effect.runPromise(
        importCanonicalOpencodeRecall(owner, {}, dependencies),
      )
      const second = await Effect.runPromise(
        importCanonicalOpencodeRecall(owner, {}, dependencies),
      )
      expect(first.imported).toBe(1)
      expect(second.skippedExisting).toBe(1)
      expect(second.sessionOutcomes).toEqual([
        { sessionId: 'session-1', status: 'current' },
      ])
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

  test('returns ordered per-session outcomes for multiple imports', async () =>
    withRepository(async (owner) => {
      const dependencies = {
        summaryConfig: config,
        extract: () =>
          multipleExtraction([
            { id: 'session-second', text: 'second evidence' },
            { id: 'session-first', text: 'first evidence' },
          ]),
        summarize: async (session: { session: { id: string } }) =>
          summary(`summary ${session.session.id}`),
      }
      const first = await Effect.runPromise(
        importCanonicalOpencodeRecall(owner, {}, dependencies),
      )
      expect(first.sessionOutcomes).toEqual([
        { sessionId: 'session-second', status: 'imported' },
        { sessionId: 'session-first', status: 'imported' },
      ])
      expect(first.importedSessions).toEqual([
        'session-second',
        'session-first',
      ])
      expect(first.imported).toBe(2)

      const second = await Effect.runPromise(
        importCanonicalOpencodeRecall(owner, {}, dependencies),
      )
      expect(second.sessionOutcomes).toEqual([
        { sessionId: 'session-second', status: 'current' },
        { sessionId: 'session-first', status: 'current' },
      ])
      expect(second.skippedExisting).toBe(2)
    }))

  test('changed sessions atomically refresh messages and summary', async () =>
    withRepository(async (owner, repository, sqlite) => {
      await Effect.runPromise(
        importCanonicalOpencodeRecall(
          owner,
          {},
          {
            summaryConfig: config,
            extract: () => extraction('old raw'),
            summarize: async () => summary('old summary'),
          },
        ),
      )
      const changedDependencies = {
        summaryConfig: config,
        extract: () => extraction('new raw'),
        summarize: async () => summary('new summary'),
      }
      const preview = await Effect.runPromise(
        importCanonicalOpencodeRecall(
          owner,
          { dryRun: true },
          changedDependencies,
        ),
      )
      expect(preview.sessionOutcomes).toEqual([
        { sessionId: 'session-1', status: 'would-refresh' },
      ])
      expect(preview.changed).toBe(1)

      const changed = await Effect.runPromise(
        importCanonicalOpencodeRecall(owner, {}, changedDependencies),
      )
      expect(changed.changed).toBe(1)
      expect(changed.sessionOutcomes).toEqual([
        { sessionId: 'session-1', status: 'refreshed' },
      ])
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
    withRepository(async (owner, repository) => {
      await Effect.runPromise(
        importCanonicalOpencodeRecall(
          owner,
          {},
          {
            summaryConfig: config,
            extract: () => extraction('stable raw'),
            summarize: async () => summary('stable summary'),
          },
        ),
      )
      const failure = await Effect.runPromise(
        Effect.result(
          importCanonicalOpencodeRecall(
            owner,
            {},
            {
              summaryConfig: config,
              extract: () => extraction('interrupted raw'),
              summarize: async () => {
                throw new Error('interrupted')
              },
            },
          ),
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

  test('stops after a failed session while retaining earlier imports', async () =>
    withRepository(async (owner, repository) => {
      const attempted: string[] = []
      const prepared = await Effect.runPromise(
        prepareCanonicalRecallImport(
          owner,
          {},
          {
            summaryConfig: config,
            extract: () =>
              multipleExtraction([
                { id: 'session-imported', text: 'persisted evidence' },
                { id: 'session-failed', text: 'failed evidence' },
                { id: 'session-later', text: 'unattempted evidence' },
              ]),
            summarize: async (session) => {
              attempted.push(session.session.id)
              if (session.session.id === 'session-failed')
                throw new Error('interrupted')
              return summary(`summary ${session.session.id}`)
            },
          },
        ),
      )
      const failure = await Effect.runPromise(
        Effect.result(executeCanonicalRecallImport(prepared)),
      )
      expect(
        Result.isFailure(failure) && taggedErrorName(failure.failure),
      ).toBe('RecallImportExecutionError')
      if (
        Result.isFailure(failure) &&
        failure.failure instanceof RecallImportExecutionError
      ) {
        expect(failure.failure.completedOutcomes).toEqual([
          { sessionId: 'session-imported', status: 'imported' },
        ])
        expect(failure.failure.failedSessionId).toBe('session-failed')
        expect(failure.failure.unattemptedSessionIds).toEqual(['session-later'])
        expect(taggedErrorName(failure.failure.cause)).toBe(
          'RecallSummaryError',
        )
      }
      expect(attempted).toEqual(['session-imported', 'session-failed'])
      const rows = await Effect.runPromise(repository.searchRows())
      expect([...new Set(rows.map((row) => row.sessionId))]).toEqual([
        'session-imported',
      ])
    }))

  test('search rows preserve exact raw and derived summary evidence', async () =>
    withRepository(async (owner, repository) => {
      await Effect.runPromise(
        importCanonicalOpencodeRecall(
          owner,
          {},
          {
            summaryConfig: config,
            extract: () => extraction('needle exact/raw'),
            summarize: async () => summary('needle summary'),
          },
        ),
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
