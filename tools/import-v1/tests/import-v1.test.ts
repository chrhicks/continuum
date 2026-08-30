import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ContinuumError,
  createContinuum,
  createContinuumImporter,
} from '@continuum/core'
import { importV1 } from '../src/import-v1'

type LegacyRow = {
  sequence: number
  id: string
  kind: string
  content: string
  metadata: string
  createdAt: string
}

const roots: string[] = []

beforeEachRootCleanup()

describe('legacy v1 importer', () => {
  test('preserves canonical journal evidence and ignores legacy extras', async () => {
    const context = testContext('preservation')
    const exactContent = '  Exact legacy evidence.\nSecond line.\n'
    createLegacySource(
      context.source,
      [
        {
          sequence: 2,
          id: 'legacy-second',
          kind: 'User',
          content: 'Second sequence evidence.',
          metadata: JSON.stringify({ ignored: 'not imported' }),
          createdAt: '2026-01-01T01:00:00.000Z',
        },
        {
          sequence: 1,
          id: 'legacy-first',
          kind: 'Agent',
          content: exactContent,
          metadata: JSON.stringify({
            tags: [' Alpha ', 'BETA', 'alpha'],
            ignored: { private: 'not imported' },
          }),
          createdAt: '2026-01-02T01:00:00.000Z',
        },
      ],
      true,
    )
    const sourceHash = await hashFile(context.source)
    const sourceMtime = statSync(context.source).mtimeMs
    chmodSync(context.source, 0o444)

    const result = importV1(context)

    expect(result).toEqual({
      source: context.source,
      workspace: context.workspace,
      processed: 2,
    })
    expect(await hashFile(context.source)).toBe(sourceHash)
    expect(statSync(context.source).mtimeMs).toBe(sourceMtime)
    expect(sourceSidecars(context.source)).toEqual([])
    expect(targetSidecars(context.dataDirectory)).toEqual([])

    const continuum = createContinuum({ dataDirectory: context.dataDirectory })
    const exact = continuum.get({
      workspace: context.workspace,
      ids: ['legacy-first', 'legacy-second'],
    })
    expect(exact.missingIds).toEqual([])
    expect(exact.records).toEqual([
      {
        id: 'legacy-first',
        kind: 'agent',
        content: exactContent,
        tags: ['alpha', 'beta'],
        createdAt: '2026-01-02T01:00:00.000Z',
        supersedes: [],
        supersededBy: [],
      },
      {
        id: 'legacy-second',
        kind: 'user',
        content: 'Second sequence evidence.',
        tags: [],
        createdAt: '2026-01-01T01:00:00.000Z',
        supersedes: [],
        supersededBy: [],
      },
    ])
    expect(
      continuum
        .search({
          workspace: context.workspace,
          query: 'alpha',
        })
        .records.map(({ id }) => id),
    ).toEqual(['legacy-first'])
    continuum.close()

    const target = new Database(targetPath(context.dataDirectory), {
      readonly: true,
      strict: true,
    })
    expect(
      target.query('SELECT id FROM memory_records ORDER BY rowid').all(),
    ).toEqual([{ id: 'legacy-first' }, { id: 'legacy-second' }])
    expect(countRows(target, 'memory_records')).toBe(2)
    expect(countRows(target, 'memory_fts')).toBe(2)
    for (const excluded of [
      'tasks',
      'memory_consolidations',
      'memory_recall_messages',
      'memory_checkpoints',
    ]) {
      expect(
        target
          .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(excluded),
      ).toBeNull()
    }
    target.close()
  })

  test('repeated identical runs are idempotent and empty sources stay lazy', () => {
    const context = testContext('idempotent')
    createLegacySource(context.source, [validRow(1, 'same-record')])

    expect(importV1(context).processed).toBe(1)
    expect(importV1(context).processed).toBe(1)
    expect(targetSidecars(context.dataDirectory)).toEqual([])
    expect(targetCount(context.dataDirectory)).toBe(1)

    const empty = testContext('empty')
    createLegacySource(empty.source, [])
    expect(importV1(empty)).toEqual({
      source: empty.source,
      workspace: empty.workspace,
      processed: 0,
    })
    expect(existsSync(empty.dataDirectory)).toBe(false)
  })

  test('keeps a safe resumable prefix when a target collision stops a run', () => {
    const context = testContext('collision')
    createLegacySource(context.source, [
      validRow(1, 'prefix-record'),
      validRow(2, 'collision-record'),
      validRow(3, 'unattempted-record'),
    ])
    const importer = createContinuumImporter({
      dataDirectory: context.dataDirectory,
    })
    importer.importRecord({
      workspace: context.workspace,
      id: 'collision-record',
      kind: 'agent',
      content: 'Different canonical evidence.',
      tags: ['legacy'],
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    importer.close()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => importV1(context)).toThrow(ContinuumError)
      expect(targetSidecars(context.dataDirectory)).toEqual([])
      const continuum = createContinuum({
        dataDirectory: context.dataDirectory,
      })
      const result = continuum.get({
        workspace: context.workspace,
        ids: ['prefix-record', 'collision-record', 'unattempted-record'],
      })
      expect(result.records.map(({ id }) => id)).toEqual([
        'prefix-record',
        'collision-record',
      ])
      expect(result.records[1]?.content).toBe('Different canonical evidence.')
      expect(result.missingIds).toEqual(['unattempted-record'])
      continuum.close()
      expect(targetCount(context.dataDirectory)).toBe(2)
    }
  })

  test('rejects a cross-workspace ID collision without overwriting evidence', () => {
    const context = testContext('cross-workspace')
    const otherWorkspace = join(context.root, 'other-workspace')
    mkdirSync(otherWorkspace)
    createLegacySource(context.source, [validRow(1, 'shared-id')])
    const importer = createContinuumImporter({
      dataDirectory: context.dataDirectory,
    })
    importer.importRecord({
      workspace: otherWorkspace,
      id: 'shared-id',
      kind: 'agent',
      content: 'Other workspace evidence.',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    importer.close()

    expect(() => importV1(context)).toThrow(ContinuumError)
    const continuum = createContinuum({ dataDirectory: context.dataDirectory })
    expect(
      continuum.get({ workspace: otherWorkspace, ids: ['shared-id'] })
        .records[0]?.content,
    ).toBe('Other workspace evidence.')
    expect(
      continuum.get({ workspace: context.workspace, ids: ['shared-id'] }),
    ).toEqual({ records: [], missingIds: ['shared-id'] })
    continuum.close()
    expect(targetCount(context.dataDirectory)).toBe(1)
  })

  test('validates every source row before creating target storage', async () => {
    const invalidCases: Array<{
      name: string
      create(path: string): void
      field: string
    }> = [
      {
        name: 'missing table',
        create(path) {
          const database = new Database(path, { create: true })
          database.exec('CREATE TABLE unrelated (id TEXT)')
          database.close()
        },
        field: 'memory_journal_entries',
      },
      {
        name: 'wrong schema',
        create(path) {
          createLegacySource(path, [], false, 'metadata INTEGER NOT NULL')
        },
        field: 'metadata',
      },
      invalidRowCase('blank content', { content: '   ' }, 'content'),
      invalidRowCase('trimmed ID', { id: ' padded-id ' }, 'id'),
      invalidRowCase('blank kind', { kind: ' ' }, 'kind'),
      invalidRowCase(
        'timestamp',
        { createdAt: '2026-01-01T01:00:00+01:00' },
        'created_at',
      ),
      invalidRowCase('metadata JSON', { metadata: '{private' }, 'metadata'),
      invalidRowCase('metadata object', { metadata: '[]' }, 'metadata'),
      invalidRowCase(
        'tags array',
        { metadata: JSON.stringify({ tags: 'private' }) },
        'tags',
      ),
      invalidRowCase(
        'tag text',
        { metadata: JSON.stringify({ tags: ['ok', 42] }) },
        'tags',
      ),
      invalidRowCase(
        'blank tag',
        { metadata: JSON.stringify({ tags: ['ok', ' '] }) },
        'tags',
      ),
      {
        name: 'duplicate ID',
        create(path) {
          createLegacySource(path, [
            validRow(1, 'duplicate'),
            validRow(2, 'duplicate'),
          ])
        },
        field: 'id',
      },
      {
        name: 'invalid sequence',
        create(path) {
          createLegacySource(path, [validRow(0, 'zero-sequence')])
        },
        field: 'sequence',
      },
    ]

    for (const invalid of invalidCases) {
      const context = testContext(
        `invalid-${invalid.name.replaceAll(' ', '-')}`,
      )
      invalid.create(context.source)
      const sourceHash = await hashFile(context.source)
      const sourceMtime = statSync(context.source).mtimeMs
      let caught: unknown
      try {
        importV1(context)
      } catch (cause) {
        caught = cause
      }
      expect(caught).toBeInstanceOf(ContinuumError)
      expect(caught).toMatchObject({
        code: 'VALIDATION_ERROR',
        operation: 'import v1',
        context: { field: invalid.field },
      })
      expect(JSON.stringify(caught)).not.toContain('private')
      expect(existsSync(context.dataDirectory)).toBe(false)
      expect(await hashFile(context.source)).toBe(sourceHash)
      expect(statSync(context.source).mtimeMs).toBe(sourceMtime)
      expect(sourceSidecars(context.source)).toEqual([])
    }
  })

  test('rejects an uncheckpointed source without touching its WAL', async () => {
    const context = testContext('uncheckpointed')
    createLegacySource(context.source, [validRow(1, 'wal-record')])
    const walPath = `${context.source}-wal`
    writeFileSync(walPath, 'synthetic uncheckpointed WAL sentinel')
    const sourceHash = await hashFile(context.source)
    const walHash = await hashFile(walPath)
    const sourceMtime = statSync(context.source).mtimeMs
    const walMtime = statSync(walPath).mtimeMs

    expect(() => importV1(context)).toThrow(ContinuumError)
    expect(existsSync(context.dataDirectory)).toBe(false)
    expect(await hashFile(context.source)).toBe(sourceHash)
    expect(await hashFile(walPath)).toBe(walHash)
    expect(statSync(context.source).mtimeMs).toBe(sourceMtime)
    expect(statSync(walPath).mtimeMs).toBe(walMtime)
    expect(existsSync(`${context.source}-shm`)).toBe(false)
  })

  test('rejects source and target aliases before opening either database', () => {
    const context = testContext('same-path')
    createLegacySource(context.source, [validRow(1, 'alias-record')])
    const dataDirectory = context.root
    const target = targetPath(dataDirectory)
    // Recreate the source at the target filename to exercise direct aliasing.
    rmSync(context.source)
    createLegacySource(target, [validRow(1, 'alias-record')])

    expect(() =>
      importV1({
        source: target,
        workspace: context.workspace,
        dataDirectory,
      }),
    ).toThrow(ContinuumError)
    expect(sourceSidecars(target)).toEqual([])

    const hardLink = testContext('hard-link')
    createLegacySource(hardLink.source, [validRow(1, 'hard-link-record')])
    mkdirSync(hardLink.dataDirectory)
    const linkedTarget = targetPath(hardLink.dataDirectory)
    linkSync(hardLink.source, linkedTarget)
    expect(() => importV1(hardLink)).toThrow(ContinuumError)
    expect(targetCountFromPath(linkedTarget, 'memory_journal_entries')).toBe(1)
  })
})

function beforeEachRootCleanup(): void {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

function testContext(name: string): ImportV1OptionsWithRoot {
  const root = mkdtempSync(join(tmpdir(), `continuum-import-v1-${name}-`))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  roots.push(root)
  return {
    root,
    source: join(root, 'legacy.db'),
    workspace,
    dataDirectory: join(root, 'data'),
  }
}

type ImportV1OptionsWithRoot = {
  root: string
  source: string
  workspace: string
  dataDirectory: string
}

function createLegacySource(
  path: string,
  rows: LegacyRow[],
  extras = false,
  metadataDefinition = 'metadata TEXT NOT NULL',
): void {
  const database = new Database(path, { create: true, strict: true })
  database.exec(`
    CREATE TABLE memory_journal_entries (
      sequence INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      source_project_id TEXT,
      source_session_id TEXT,
      idempotency_key TEXT,
      ${metadataDefinition},
      payload_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `)
  const insert = database.query(`
    INSERT INTO memory_journal_entries
      (sequence, id, kind, content, source, source_project_id,
       source_session_id, idempotency_key, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of rows) {
    insert.run(
      row.sequence,
      row.id,
      row.kind,
      row.content,
      'ignored-source',
      'ignored-project',
      'ignored-session',
      `ignored-${row.sequence}`,
      row.metadata,
      row.createdAt,
    )
  }
  if (extras) {
    database.exec(`
      CREATE TABLE tasks (id TEXT, content TEXT);
      INSERT INTO tasks VALUES ('task', 'excluded private task');
      CREATE TABLE memory_consolidations (id TEXT, summary TEXT);
      INSERT INTO memory_consolidations VALUES ('summary', 'excluded private summary');
      CREATE TABLE memory_recall_messages (id TEXT, content TEXT);
      INSERT INTO memory_recall_messages VALUES ('recall', 'excluded private recall');
      CREATE TABLE memory_checkpoints (key TEXT, metadata TEXT);
      INSERT INTO memory_checkpoints VALUES ('checkpoint', 'excluded private checkpoint');
    `)
  }
  database.close()
}

function validRow(sequence: number, id: string): LegacyRow {
  return {
    sequence,
    id,
    kind: 'agent',
    content: `Synthetic evidence ${sequence}.`,
    metadata: JSON.stringify({ tags: ['Legacy'] }),
    createdAt: `2026-01-${String(sequence).padStart(2, '0')}T00:00:00.000Z`,
  }
}

function invalidRowCase(
  name: string,
  changes: Partial<LegacyRow>,
  field: string,
): { name: string; create(path: string): void; field: string } {
  return {
    name,
    create(path) {
      createLegacySource(path, [
        validRow(1, `${name}-valid`),
        { ...validRow(2, `${name}-invalid`), ...changes },
      ])
    },
    field,
  }
}

async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(await Bun.file(path).arrayBuffer())
  return hasher.digest('hex')
}

function sourceSidecars(path: string): string[] {
  return [`${path}-wal`, `${path}-shm`].filter(existsSync)
}

function targetSidecars(dataDirectory: string): string[] {
  const path = targetPath(dataDirectory)
  return [`${path}-wal`, `${path}-shm`].filter(existsSync)
}

function targetPath(dataDirectory: string): string {
  return join(dataDirectory, 'continuum.db')
}

function targetCount(dataDirectory: string): number {
  return targetCountFromPath(targetPath(dataDirectory), 'memory_records')
}

function targetCountFromPath(path: string, table: string): number {
  const database = new Database(path, {
    readonly: true,
    strict: true,
  })
  const count = countRows(database, table)
  database.close()
  return count
}

function countRows(database: Database, table: string): number {
  return Number(
    (
      database.query(`SELECT count(*) AS count FROM ${table}`).get() as {
        count: number
      }
    ).count,
  )
}
