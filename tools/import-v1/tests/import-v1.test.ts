import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
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

  test('normalizes valid legacy timestamp instants and preserves chronological order', () => {
    const context = testContext('timestamps')
    createLegacySource(context.source, [
      {
        ...validRow(1, 'timestamp-canonical'),
        createdAt: '2026-01-02T03:00:00.123Z',
      },
      {
        ...validRow(2, 'timestamp-no-milliseconds'),
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        ...validRow(3, 'timestamp-positive-offset'),
        createdAt: '2026-01-02T03:00:00+02:00',
      },
      {
        ...validRow(4, 'timestamp-negative-offset'),
        createdAt: '2026-01-02T03:00:00-02:00',
      },
      {
        ...validRow(5, 'timestamp-short-fraction'),
        createdAt: '2026-01-02T02:00:00.1Z',
      },
    ])

    expect(importV1(context).processed).toBe(5)
    expect(importV1(context).processed).toBe(5)

    const continuum = createContinuum({ dataDirectory: context.dataDirectory })
    const exact = continuum.get({
      workspace: context.workspace,
      ids: [
        'timestamp-canonical',
        'timestamp-no-milliseconds',
        'timestamp-positive-offset',
        'timestamp-negative-offset',
        'timestamp-short-fraction',
      ],
    })
    expect(exact.records.map(({ createdAt }) => createdAt)).toEqual([
      '2026-01-02T03:00:00.123Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T01:00:00.000Z',
      '2026-01-02T05:00:00.000Z',
      '2026-01-02T02:00:00.100Z',
    ])
    expect(
      continuum
        .search({ workspace: context.workspace })
        .records.map(({ id }) => id),
    ).toEqual([
      'timestamp-negative-offset',
      'timestamp-canonical',
      'timestamp-short-fraction',
      'timestamp-positive-offset',
      'timestamp-no-milliseconds',
    ])
    continuum.close()
    expect(targetCount(context.dataDirectory)).toBe(5)
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

  test('reports and reads a safe symlink source by its canonical path', async () => {
    const context = testContext('canonical-symlink')
    const canonicalSource = join(context.root, 'canonical-legacy.db')
    createLegacySource(canonicalSource, [validRow(1, 'canonical-source')])
    symlinkSync(canonicalSource, context.source)
    const sourceHash = await hashFile(canonicalSource)
    const sourceMtime = statSync(canonicalSource).mtimeMs

    expect(importV1(context)).toEqual({
      source: canonicalSource,
      workspace: context.workspace,
      processed: 1,
    })
    expect(await hashFile(canonicalSource)).toBe(sourceHash)
    expect(statSync(canonicalSource).mtimeMs).toBe(sourceMtime)
    expect(sourceSidecars(canonicalSource)).toEqual([])
    expect(sourceSidecars(context.source)).toEqual([])
    expect(targetCount(context.dataDirectory)).toBe(1)
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
      ...[
        ['ambiguous local timestamp', '2026-01-01T01:00:00'],
        ['non-ISO timestamp', 'January 1, 2026 01:00 UTC'],
        ['invalid calendar timestamp', '2026-02-30T01:00:00Z'],
        ['invalid hour timestamp', '2026-01-01T24:00:00Z'],
        ['invalid offset timestamp', '2026-01-01T01:00:00+14:01'],
        ['excessive offset timestamp', '2026-01-01T01:00:00-15:00'],
        ['lossy fraction timestamp', '2026-01-01T01:00:00.1234Z'],
        ['extended year timestamp', '+010000-01-01T00:00:00.000Z'],
      ].map(([name, createdAt]) =>
        invalidRowCase(name as string, { createdAt }, 'created_at'),
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

  test('rejects direct, symlinked, and hard-linked unsafe sources without mutation', async () => {
    const direct = testContext('uncheckpointed-direct')
    createLegacySource(direct.source, [validRow(1, 'direct-wal-record')])
    const directWal = `${direct.source}-wal`
    writeFileSync(directWal, 'synthetic uncheckpointed WAL sentinel')
    await expectSourceFilesUnchanged(direct, [direct.source, directWal], () =>
      importV1(direct),
    )

    const symlinked = testContext('uncheckpointed-symlink')
    const realSource = join(symlinked.root, 'real-legacy.db')
    createLegacySource(realSource, [validRow(1, 'symlink-wal-record')])
    symlinkSync(realSource, symlinked.source)
    const realWal = `${realSource}-wal`
    writeFileSync(realWal, 'synthetic real-path WAL sentinel')
    const symlinkFailure = await expectSourceFilesUnchanged(
      symlinked,
      [realSource, realWal],
      () => importV1(symlinked),
    )
    expect(symlinkFailure.context).toMatchObject({ sourcePath: realSource })
    expect(existsSync(`${symlinked.source}-shm`)).toBe(false)

    const hardLinked = testContext('hard-linked-source')
    const canonicalSource = join(hardLinked.root, 'canonical-legacy.db')
    createLegacySource(canonicalSource, [validRow(1, 'hard-link-record')])
    linkSync(canonicalSource, hardLinked.source)
    const hardLinkFailure = await expectSourceFilesUnchanged(
      hardLinked,
      [canonicalSource, hardLinked.source],
      () => importV1(hardLinked),
    )
    expect(hardLinkFailure.message).toBe(
      'The legacy source must be a stable copy with a single filesystem name.',
    )
  })

  test('rejects every reserved target database path and file alias before opening', async () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const context = testContext(`reserved-${suffix || 'database'}`)
      mkdirSync(context.dataDirectory)
      const reserved = `${targetPath(context.dataDirectory)}${suffix}`
      createLegacySource(reserved, [validRow(1, `reserved-${suffix || 'db'}`)])
      await expectSourceFilesUnchanged(
        { ...context, source: reserved },
        [reserved],
        () => importV1({ ...context, source: reserved }),
      )
    }

    const symlinked = testContext('reserved-symlink')
    mkdirSync(symlinked.dataDirectory)
    const reservedSymlink = `${targetPath(symlinked.dataDirectory)}-shm`
    symlinkSync(symlinked.source, reservedSymlink)
    createLegacySource(symlinked.source, [validRow(1, 'reserved-symlink')])
    await expectSourceFilesUnchanged(symlinked, [symlinked.source], () =>
      importV1(symlinked),
    )
    expect(statSync(reservedSymlink).ino).toBe(statSync(symlinked.source).ino)

    const hardLinked = testContext('reserved-hard-link')
    createLegacySource(hardLinked.source, [validRow(1, 'reserved-hard-link')])
    mkdirSync(hardLinked.dataDirectory)
    const reservedHardLink = `${targetPath(hardLinked.dataDirectory)}-journal`
    linkSync(hardLinked.source, reservedHardLink)
    await expectSourceFilesUnchanged(
      hardLinked,
      [hardLinked.source, reservedHardLink],
      () => importV1(hardLinked),
    )
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

async function expectSourceFilesUnchanged(
  context: ImportV1OptionsWithRoot,
  paths: string[],
  operation: () => unknown,
): Promise<ContinuumError> {
  const beforeEntries = readdirSync(context.root, { recursive: true }).sort()
  const before = await Promise.all(
    paths.map(async (path) => ({
      path,
      hash: await hashFile(path),
      mtimeMs: statSync(path).mtimeMs,
    })),
  )

  let caught: unknown
  try {
    operation()
  } catch (cause) {
    caught = cause
  }
  expect(caught).toBeInstanceOf(ContinuumError)
  expect(caught).toMatchObject({
    code: 'VALIDATION_ERROR',
    operation: 'import v1',
  })
  expect(JSON.stringify(caught)).not.toContain('synthetic')
  expect(readdirSync(context.root, { recursive: true }).sort()).toEqual(
    beforeEntries,
  )
  for (const file of before) {
    expect(await hashFile(file.path)).toBe(file.hash)
    expect(statSync(file.path).mtimeMs).toBe(file.mtimeMs)
  }
  return caught as ContinuumError
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
