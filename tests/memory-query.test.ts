import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDbClientByPath } from '../src/db/client'
import {
  buildMemoryEvidenceQueryPlan,
  listMemoryEvidence,
  searchMemoryEvidence,
  type MemoryQueryOptions,
} from '../src/memory/application/query'
import { Effect, Result } from 'effect'
import {
  memoryResourceOwner,
  type MemoryResourceOwner,
} from '../src/memory/application/resource-owner'

const roots: string[] = []
type PlannedSource =
  | 'journal'
  | 'consolidation'
  | 'currentRecall'
  | 'recallHistory'

function owner(workspaceRoot: string, dbPath: string): MemoryResourceOwner {
  return memoryResourceOwner(
    { workspaceRoot, memoryDir: join(workspaceRoot, 'memory'), dbPath },
    getDbClientByPath(dbPath),
  )
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('canonical memory query', () => {
  test('orders globally, filters before limiting, and ranks before limiting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-query-'))
    roots.push(root)
    const dbPath = join(root, 'continuum.db')
    const resourceOwner = owner(root, dbPath)
    const db = resourceOwner.handle.sqlite
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
      (
        await Effect.runPromise(listMemoryEvidence(resourceOwner, { limit: 2 }))
      ).map((row) => row.id),
    ).toEqual(['recall', 'journal-new'])
    expect(
      (
        await Effect.runPromise(
          listMemoryEvidence(resourceOwner, {
            afterDate: new Date('2026-07-10T12:00:00.000Z'),
            limit: 1,
          }),
        )
      ).map((row) => row.id),
    ).toEqual(['recall'])
    expect(
      (
        await Effect.runPromise(
          searchMemoryEvidence(resourceOwner, 'needle', { limit: 1 }),
        )
      )[0]?.id,
    ).toBe('journal-old')
    expect(
      (
        await Effect.runPromise(
          searchMemoryEvidence(resourceOwner, 'historical exact'),
        )
      ).map((row) => row.id),
    ).toEqual(['recall-history'])
    const recallList = await Effect.runPromise(
      listMemoryEvidence(resourceOwner, { source: 'recall' }),
    )
    expect(recallList.map((row) => row.id).sort()).toEqual([
      'recall',
      'summary-current',
    ])
    const historicalSummary = await Effect.runPromise(
      searchMemoryEvidence(resourceOwner, 'superseded summary', {
        source: 'recall',
      }),
    )
    expect(historicalSummary[0]).toMatchObject({
      id: 'summary-history',
      current: false,
    })
    expect(historicalSummary[0]?.source).toContain('(historical)')
  })

  test('makes the complete source and tier selection matrix explicit', () => {
    const cases: Array<{
      options: MemoryQueryOptions
      list: PlannedSource[]
      search: PlannedSource[]
    }> = [
      {
        options: { source: 'all', tier: 'all' },
        list: ['journal', 'consolidation', 'currentRecall'],
        search: ['journal', 'consolidation', 'currentRecall', 'recallHistory'],
      },
      {
        options: { source: 'all', tier: 'NOW' },
        list: ['journal'],
        search: ['journal'],
      },
      {
        options: { source: 'all', tier: 'MEMORY' },
        list: ['consolidation'],
        search: ['consolidation'],
      },
      {
        options: { source: 'memory', tier: 'all' },
        list: ['journal', 'consolidation'],
        search: ['journal', 'consolidation'],
      },
      {
        options: { source: 'memory', tier: 'NOW' },
        list: ['journal'],
        search: ['journal'],
      },
      {
        options: { source: 'memory', tier: 'MEMORY' },
        list: ['consolidation'],
        search: ['consolidation'],
      },
      {
        options: { source: 'recall', tier: 'all' },
        list: ['currentRecall'],
        search: ['currentRecall', 'recallHistory'],
      },
      {
        options: { source: 'recall', tier: 'NOW' },
        list: [],
        search: [],
      },
      {
        options: { source: 'recall', tier: 'MEMORY' },
        list: [],
        search: [],
      },
    ]

    for (const { options, list, search } of cases) {
      expect(planSources('list', options)).toEqual(list)
      expect(planSources('search', options)).toEqual(search)
    }
    expect(buildMemoryEvidenceQueryPlan('search')).toEqual(
      buildMemoryEvidenceQueryPlan('search', {
        source: 'all',
        tier: 'all',
      }),
    )
  })

  test('executes list and search plans across memory and recall sources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-query-plan-'))
    roots.push(root)
    const dbPath = join(root, 'continuum.db')
    const resourceOwner = owner(root, dbPath)
    const db = resourceOwner.handle.sqlite

    db.query(
      `INSERT INTO memory_journal_entries
       (id, kind, content, metadata, created_at)
       VALUES ('journal-consolidated', 'agent', 'matrix old', '{}', ?)`,
    ).run('2026-07-01T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_consolidations
       (id, first_sequence, last_sequence, status, summary, created_at, completed_at)
       VALUES ('consolidation', 1, 1, 'completed', ?, ?, ?)`,
    ).run(
      JSON.stringify(memorySummary('matrix consolidation')),
      '2026-07-01T12:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
    )
    db.query(
      `INSERT INTO memory_journal_entries
       (id, kind, content, metadata, created_at)
       VALUES ('journal-current', 'agent', 'matrix journal', '{}', ?)`,
    ).run('2026-07-04T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_recall_sources
       (id, harness, external_session_id, fingerprint, first_ingested_at, last_ingested_at)
       VALUES ('matrix-source', 'opencode', 'matrix-session', 'current-fp', ?, ?)`,
    ).run('2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_recall_messages
       (id, source_id, source_fingerprint, ordinal, role, content, created_at)
       VALUES ('recall-current', 'matrix-source', 'current-fp', 0, 'user', 'matrix current recall', ?)`,
    ).run('2026-07-03T00:00:00.000Z')
    db.query(
      `INSERT INTO memory_recall_messages
       (id, source_id, source_fingerprint, ordinal, role, content, created_at)
       VALUES ('recall-history', 'matrix-source', 'older-fp', 0, 'user', 'matrix historical recall', ?)`,
    ).run('2026-06-30T00:00:00.000Z')

    expect(
      await listedIds(resourceOwner, { source: 'memory', tier: 'NOW' }),
    ).toEqual(['journal-current'])
    expect(
      await listedIds(resourceOwner, { source: 'memory', tier: 'MEMORY' }),
    ).toEqual(['consolidation'])
    expect(
      await listedIds(resourceOwner, { source: 'all', tier: 'all' }),
    ).toEqual(['journal-current', 'recall-current', 'consolidation'])
    expect(
      await searchedIds(resourceOwner, { source: 'all', tier: 'all' }),
    ).toEqual([
      'journal-current',
      'recall-current',
      'consolidation',
      'recall-history',
    ])
    expect(
      await searchedIds(resourceOwner, { source: 'memory', tier: 'all' }),
    ).toEqual(await listedIds(resourceOwner, { source: 'memory', tier: 'all' }))
    expect(
      await listedIds(resourceOwner, { source: 'recall', tier: 'NOW' }),
    ).toEqual([])
    expect(
      await searchedIds(resourceOwner, { source: 'recall', tier: 'MEMORY' }),
    ).toEqual([])
  })

  test('returns tagged decode failures for malformed persisted JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-query-decode-'))
    roots.push(root)
    const dbPath = join(root, 'continuum.db')
    const resourceOwner = owner(root, dbPath)
    resourceOwner.handle.sqlite
      .query(
        `INSERT INTO memory_journal_entries
       (id, kind, content, metadata, created_at)
       VALUES ('bad-json', 'agent', 'evidence', '{', '2026-07-01')`,
      )
      .run()

    const result = await Effect.runPromise(
      Effect.result(listMemoryEvidence(resourceOwner)),
    )
    expect(Result.isFailure(result) && result.failure._tag).toBe('DecodeError')
  })
})

function planSources(
  operation: 'list' | 'search',
  options: MemoryQueryOptions,
): PlannedSource[] {
  const { journal, consolidation, currentRecall, recallHistory } =
    buildMemoryEvidenceQueryPlan(operation, options).sources
  return [
    ...(journal ? (['journal'] as const) : []),
    ...(consolidation ? (['consolidation'] as const) : []),
    ...(currentRecall ? (['currentRecall'] as const) : []),
    ...(recallHistory ? (['recallHistory'] as const) : []),
  ]
}

async function listedIds(
  resourceOwner: MemoryResourceOwner,
  options: MemoryQueryOptions,
): Promise<string[]> {
  return (
    await Effect.runPromise(listMemoryEvidence(resourceOwner, options))
  ).map((item) => item.id)
}

async function searchedIds(
  resourceOwner: MemoryResourceOwner,
  options: MemoryQueryOptions,
): Promise<string[]> {
  return (
    await Effect.runPromise(
      searchMemoryEvidence(resourceOwner, 'matrix', options),
    )
  ).map((item) => item.id)
}

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
