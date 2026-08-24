import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { migrateLegacyMemory } from '../src/memory/application/legacy-migrate'
import { consolidateMemory } from '../src/memory/application/consolidate'
import { getDbClientByPath } from '../src/db/client'
import { makeJournalRepository } from '../src/memory/repository/journal-repository'
import type { MemorySummary } from '../src/memory/types'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; memoryDir: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'continuum-legacy-'))
  roots.push(root)
  const memoryDir = join(root, '.continuum', 'memory')
  mkdirSync(memoryDir, { recursive: true })
  const fixtureDir = join(import.meta.dir, 'fixtures', 'legacy-memory')
  for (const name of readdirSync(fixtureDir)) {
    if (name.startsWith('OPENCODE-')) continue
    writeFileSync(join(memoryDir, name), readFileSync(join(fixtureDir, name)))
  }
  writeFileSync(
    join(memoryDir, 'NOW-cleared.md'),
    '---\nconsolidated: true\n---\n\n# Session\n',
  )
  writeFileSync(
    join(memoryDir, 'MEMORY.md'),
    '# Index\n\n[Daily](MEMORY-2026-07-10.md)\n',
  )
  const recallDir = join(root, '.continuum', 'recall', 'opencode')
  mkdirSync(recallDir, { recursive: true })
  for (const name of readdirSync(fixtureDir)) {
    if (!name.startsWith('OPENCODE-')) continue
    writeFileSync(join(recallDir, name), readFileSync(join(fixtureDir, name)))
  }
  return { root, memoryDir, dbPath: join(root, '.continuum', 'continuum.db') }
}

describe('legacy memory migration', () => {
  test('dry-run inventories hierarchy without creating or changing the database', () => {
    const paths = fixture()
    const result = migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: true,
    })

    expect(existsSync(paths.dbPath)).toBe(false)
    expect(
      result.items.find((item) => item.path.endsWith('NOW-cleared.md'))?.result,
    ).toBe('skip')
    const recent = result.items.filter((item) =>
      item.path.includes('RECENT.md#'),
    )
    expect(recent.map((item) => item.result).sort()).toEqual(['import', 'skip'])
    expect(
      result.items.find((item) => item.path.endsWith('MEMORY.md'))?.detail,
    ).toContain('reference-only')
    expect(
      result.items.find((item) => item.kind === 'opencode-summary')?.detail,
    ).toContain('summary-only')
  })

  test('imports once, records every artifact, and preserves source files', () => {
    const paths = fixture()
    const sourcePath = join(paths.memoryDir, 'MEMORY-2026-07-10.md')
    const original = readFileSync(sourcePath, 'utf8')

    migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: false,
      handle: getDbClientByPath(paths.dbPath),
    })
    const repeated = migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: false,
      handle: getDbClientByPath(paths.dbPath),
    })

    expect(repeated.alreadyCompleted).toBe(true)
    expect(repeated.items).toEqual([])
    expect(readFileSync(sourcePath, 'utf8')).toBe(original)
    const sqlite = new Database(paths.dbPath)
    expect(
      (
        sqlite
          .query('SELECT COUNT(*) AS count FROM memory_journal_entries')
          .get() as { count: number }
      ).count,
    ).toBe(4)
    expect(
      (
        sqlite
          .query('SELECT COUNT(*) AS count FROM memory_consolidations')
          .get() as { count: number }
      ).count,
    ).toBe(2)
    expect(
      (
        sqlite
          .query('SELECT COUNT(*) AS count FROM memory_recall_messages')
          .get() as { count: number }
      ).count,
    ).toBe(2)
    expect(
      (
        sqlite
          .query('SELECT COUNT(*) AS count FROM memory_recall_summaries')
          .get() as { count: number }
      ).count,
    ).toBe(1)
    expect(
      (
        sqlite
          .query('SELECT COUNT(*) AS count FROM memory_legacy_migrations')
          .get() as { count: number }
      ).count,
    ).toBe(9)
    const runs = sqlite
      .query(
        `SELECT status, artifact_count, imported_count
         FROM memory_legacy_migration_runs ORDER BY id`,
      )
      .all()
    expect(runs).toEqual([
      { status: 'completed', artifact_count: 9, imported_count: 6 },
    ])
    const keys = sqlite
      .query(
        "SELECT idempotency_key FROM memory_journal_entries WHERE source='legacy-markdown' ORDER BY idempotency_key",
      )
      .all() as Array<{ idempotency_key: string }>
    expect(new Set(keys.map((row) => row.idempotency_key)).size).toBe(4)
    expect(keys.every((row) => row.idempotency_key.includes('legacy:2:'))).toBe(
      true,
    )
    const legacySummary = sqlite
      .query('SELECT summary, model FROM memory_recall_summaries')
      .get() as { summary: string; model: string }
    expect(legacySummary.model).toBe('legacy-markdown-summary-only')
    expect(legacySummary.summary).not.toContain('session_id:')
    expect(legacySummary.summary).not.toContain('# Session Summary:')
    expect(legacySummary.summary).toContain('Canonical migration.')
    const fingerprints = sqlite
      .query(
        `SELECT s.fingerprint source, m.source_fingerprint message,
                r.source_fingerprint summary
         FROM memory_recall_sources s
         JOIN memory_recall_messages m ON m.source_id=s.id
         JOIN memory_recall_summaries r ON r.source_id=s.id
         LIMIT 1`,
      )
      .get() as { source: string; message: string; summary: string }
    expect(fingerprints.message).toBe(fingerprints.source)
    expect(fingerprints.summary).toBe(fingerprints.source)
    sqlite.close()
  })

  test('does not reimport generated projections after consolidation', async () => {
    const paths = fixture()
    const handle = getDbClientByPath(paths.dbPath)
    migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: false,
      handle,
    })

    const journal = makeJournalRepository(handle)
    const consolidated = await Effect.runPromise(
      consolidateMemory({
        dbPath: paths.dbPath,
        memoryDir: paths.memoryDir,
        journal,
        summarize: async () => summary('migrated NOW entries'),
      }),
    )
    expect(consolidated.status).toBe('completed')
    const before = counts(handle.sqlite)

    const repeated = migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: false,
      handle,
    })
    const preview = migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: true,
    })

    expect(repeated).toEqual({
      dryRun: false,
      alreadyCompleted: true,
      items: [],
    })
    expect(preview).toEqual({
      dryRun: true,
      alreadyCompleted: true,
      items: [],
    })
    expect(counts(handle.sqlite)).toEqual(before)
    expect(before.runs).toBe(1)
  })

  test('keeps every uncleared NOW after the completed legacy prefix', async () => {
    const paths = fixture()
    writeFileSync(
      join(paths.memoryDir, 'MEMORY-2026-07-09.md'),
      '# Consolidated Memory\n\n## Earlier daily session\n\nEarlier decision.\n',
    )
    writeFileSync(
      join(paths.memoryDir, 'RECENT.md'),
      `${readFileSync(join(paths.memoryDir, 'RECENT.md'), 'utf8')}\n\n---\n\n## Session 2026-07-12 12:00 (5m)\n\nAnother RECENT-only discovery.\n`,
    )
    const handle = getDbClientByPath(paths.dbPath)

    migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: false,
      handle,
    })
    migrateLegacyMemory({
      workspaceRoot: paths.root,
      memoryDir: paths.memoryDir,
      dbPath: paths.dbPath,
      dryRun: false,
      handle,
    })

    const journal = makeJournalRepository(handle)
    const boundary = await Effect.runPromise(journal.latestBoundary())
    const pending = await Effect.runPromise(journal.listPending(boundary ?? 0))
    expect(boundary).toBe(4)
    expect(pending).toHaveLength(2)
    if (boundary === null) throw new Error('Expected consolidation boundary')
    expect(pending.every((entry) => entry.sequence > boundary)).toBe(true)
    expect(
      pending.every((entry) =>
        entry.content.includes(
          'The same legacy note exists in two source files.',
        ),
      ),
    ).toBe(true)

    const migratedRows = handle.sqlite
      .query(
        `SELECT sequence, json_extract(metadata, '$.legacyKind') AS kind
         FROM memory_journal_entries ORDER BY sequence`,
      )
      .all()
    expect(migratedRows).toEqual([
      { sequence: 1, kind: 'daily-memory' },
      { sequence: 2, kind: 'daily-memory' },
      { sequence: 3, kind: 'recent' },
      { sequence: 4, kind: 'recent' },
      { sequence: 5, kind: 'now' },
      { sequence: 6, kind: 'now' },
    ])

    const result = await Effect.runPromise(
      consolidateMemory({
        dbPath: paths.dbPath,
        memoryDir: paths.memoryDir,
        journal,
        summarize: async () => summary('migrated NOW entries'),
        publish: () => {},
      }),
    )
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.entryCount).toBe(2)
    expect(result.consolidation.firstSequence).toBe(5)
    expect(result.consolidation.lastSequence).toBe(6)
    expect(await Effect.runPromise(journal.latestBoundary())).toBe(6)
    expect(await Effect.runPromise(journal.listPending(6))).toEqual([])
  })
})

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

function counts(sqlite: Database): {
  journal: number
  consolidations: number
  runs: number
} {
  const count = (table: string): number =>
    (
      sqlite.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number
      }
    ).count
  return {
    journal: count('memory_journal_entries'),
    consolidations: count('memory_consolidations'),
    runs: count('memory_legacy_migration_runs'),
  }
}
