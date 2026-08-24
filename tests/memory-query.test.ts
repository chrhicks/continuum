import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDbClientByPath } from '../src/db/client'
import {
  listMemoryEvidence,
  searchMemoryEvidence,
} from '../src/memory/application/query'
import { Effect, Result } from 'effect'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('canonical memory query', () => {
  test('orders globally, filters before limiting, and ranks before limiting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-query-'))
    roots.push(root)
    const dbPath = join(root, 'continuum.db')
    const db = getDbClientByPath(dbPath).sqlite
    db.query(
      `INSERT INTO memory_journal_entries
       (id, kind, content, metadata, created_at) VALUES (?, 'agent', ?, '{}', ?)`,
    ).run('journal-old', 'needle needle needle', '2026-07-01T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_journal_entries
       (id, kind, content, metadata, created_at) VALUES (?, 'agent', ?, '{}', ?)`,
    ).run('journal-new', 'needle current', '2026-07-10T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_recall_sources
       (id, harness, external_session_id, fingerprint, first_ingested_at, last_ingested_at)
       VALUES ('source', 'opencode', 'session', 'fp', ?, ?)`,
    ).run('2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_recall_messages
        (id, source_id, source_fingerprint, ordinal, role, content, created_at)
        VALUES ('recall', 'source', 'fp', 0, 'user', 'needle recall', ?)`,
    ).run('2026-07-11T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_recall_messages
       (id, source_id, source_fingerprint, ordinal, role, content, created_at)
       VALUES ('recall-history', 'source', 'older-fp', 0, 'user', 'historical exact phrase', ?)`,
    ).run('2026-06-01T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_recall_summaries
       (id, source_id, summary, summary_version, source_fingerprint, created_at)
       VALUES (?, 'source', ?, 1, ?, ?)`,
    ).run(
      'summary-current',
      JSON.stringify(memorySummary('current summary')),
      'fp',
      '2026-07-09T00:00:00.000Z',
    )
    db.query(
      `INSERT INTO memory_recall_summaries
       (id, source_id, summary, summary_version, source_fingerprint, created_at)
       VALUES (?, 'source', ?, 1, ?, ?)`,
    ).run(
      'summary-history',
      JSON.stringify(memorySummary('superseded summary')),
      'older-fp',
      '2026-06-01T00:00:00.000Z',
    )

    expect(
      (await Effect.runPromise(listMemoryEvidence(dbPath, { limit: 2 }))).map(
        (row) => row.id,
      ),
    ).toEqual(['recall', 'journal-new'])
    expect(
      (
        await Effect.runPromise(
          listMemoryEvidence(dbPath, {
            afterDate: new Date('2026-07-10T12:00:00.000Z'),
            limit: 1,
          }),
        )
      ).map((row) => row.id),
    ).toEqual(['recall'])
    expect(
      (
        await Effect.runPromise(
          searchMemoryEvidence(dbPath, 'needle', { limit: 1 }),
        )
      )[0]?.id,
    ).toBe('journal-old')
    expect(
      (
        await Effect.runPromise(
          searchMemoryEvidence(dbPath, 'historical exact'),
        )
      ).map((row) => row.id),
    ).toEqual(['recall-history'])
    const recallList = await Effect.runPromise(
      listMemoryEvidence(dbPath, { source: 'recall' }),
    )
    expect(recallList.map((row) => row.id).sort()).toEqual([
      'recall',
      'summary-current',
    ])
    const historicalSummary = await Effect.runPromise(
      searchMemoryEvidence(dbPath, 'superseded summary', { source: 'recall' }),
    )
    expect(historicalSummary[0]).toMatchObject({
      id: 'summary-history',
      current: false,
    })
    expect(historicalSummary[0]?.source).toContain('(historical)')
  })

  test('returns tagged decode failures for malformed persisted JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-query-decode-'))
    roots.push(root)
    const dbPath = join(root, 'continuum.db')
    getDbClientByPath(dbPath)
      .sqlite.query(
        `INSERT INTO memory_journal_entries
       (id, kind, content, metadata, created_at)
       VALUES ('bad-json', 'agent', 'evidence', '{', '2026-07-01')`,
      )
      .run()

    const result = await Effect.runPromise(
      Effect.result(listMemoryEvidence(dbPath)),
    )
    expect(Result.isFailure(result) && result.failure._tag).toBe('DecodeError')
  })
})

function memorySummary(narrative: string) {
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
