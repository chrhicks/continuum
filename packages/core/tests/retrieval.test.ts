import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ContinuumError,
  createContinuum,
  createContinuumImporter,
} from '@continuum/core'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (process.platform !== 'win32') chmodSync(root, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('workspace memory retrieval', () => {
  test('browses current records and returns complete history relationships', () => {
    const context = testContext()
    const importer = context.importer()
    const old = importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'old-decision',
      createdAt: '2026-01-01T00:00:00.000Z',
      kind: 'decision',
      content: 'Use one database per checkout.',
      tags: ['storage', 'old'],
    })
    const replacement = importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'central-decision',
      createdAt: '2026-02-01T00:00:00.000Z',
      kind: 'decision',
      content: 'Use one central database for all workspaces.',
      tags: ['storage', 'current'],
      supersedes: [old.id],
    })
    const newest = importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'newest-observation',
      createdAt: '2026-03-01T00:00:00.000Z',
      content: 'The database belongs under XDG data home.',
      tags: ['storage'],
    })
    importer.close()

    const current = context.continuum.search({
      workspace: context.firstWorkspace,
    })
    expect(current.records.map(({ id }) => id)).toEqual([
      newest.id,
      replacement.id,
    ])
    expect(current.records[1]).toEqual({
      ...replacement,
      supersedes: [old.id],
      supersededBy: [],
    })

    const history = context.continuum.search({
      workspace: context.firstWorkspace,
      includeHistory: true,
    })
    expect(history.records.map(({ id }) => id)).toEqual([
      newest.id,
      replacement.id,
      old.id,
    ])
    expect(history.records[2]).toEqual({
      ...old,
      supersededBy: [replacement.id],
    })
    context.close()
  })

  test('uses deterministic chronological and relevance cursor pagination', () => {
    const context = testContext()
    const importer = context.importer()
    const chronologicalIds = ['alpha', 'echo', 'delta', 'charlie', 'bravo']
    for (const id of chronologicalIds) {
      importer.importRecord({
        workspace: context.firstWorkspace,
        id,
        createdAt: '2026-04-01T00:00:00.000Z',
        content: `Pagination anchor ${id}`,
        tags: ['pagination'],
      })
    }
    importer.close()

    const expected = [...chronologicalIds].sort().reverse()
    expect(
      collectPages(context, { workspace: context.firstWorkspace }, [2, 1, 3]),
    ).toEqual(expected)
    expect(
      collectPages(
        context,
        { workspace: context.firstWorkspace, query: 'pagination anchor' },
        [1, 2],
      ).sort(),
    ).toEqual([...chronologicalIds].sort())
    context.close()
  })

  test('ranks tag and kind anchors ahead of content and applies canonical filters', () => {
    const context = testContext()
    const importer = context.importer()
    importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'content-match',
      createdAt: '2026-05-01T00:00:00.000Z',
      kind: 'observation',
      content: 'quartzanchor appears in ordinary content',
      tags: ['ranking', 'database'],
    })
    importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'kind-match',
      createdAt: '2026-05-01T00:00:00.000Z',
      kind: 'quartzanchor',
      content: 'A kind-based match',
      tags: ['ranking', 'database', 'architecture'],
    })
    importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'tag-match',
      createdAt: '2026-05-01T00:00:00.000Z',
      kind: 'decision',
      content: 'A tag-based match',
      tags: ['quartzanchor', 'database', 'architecture'],
    })
    importer.close()

    const ranked = context.continuum.search({
      workspace: context.firstWorkspace,
      query: 'quartzanchor',
    })
    expect(ranked.records.map(({ id }) => id)).toEqual([
      'tag-match',
      'kind-match',
      'content-match',
    ])
    expect(ranked.records[0]?.content).toBe('A tag-based match')

    expect(
      context.continuum
        .search({
          workspace: context.firstWorkspace,
          tags: [' DATABASE ', 'architecture', 'database'],
          kinds: [' DECISION ', 'quartzanchor'],
        })
        .records.map(({ id }) => id)
        .sort(),
    ).toEqual(['kind-match', 'tag-match'])
    expect(
      context.continuum.search({
        workspace: context.firstWorkspace,
        tags: ['database', 'missing'],
      }).records,
    ).toEqual([])
    context.close()
  })

  test('treats punctuation, operators, paths, quotes, and shell text as ordinary FTS text', () => {
    const context = testContext()
    context.continuum.record({
      workspace: context.firstWorkspace,
      content:
        'Keep src/foo-bar.ts, $HOME, "quoted text", alpha beta, and $(rm -rf /) literal.',
    })

    for (const query of [
      'src/foo-bar.ts',
      '$HOME',
      '"quoted text"',
      'foo OR secret',
      'NEAR(alpha beta)',
      '$(rm -rf /)',
      '***',
      '"',
      '()',
    ]) {
      expect(() =>
        context.continuum.search({
          workspace: context.firstWorkspace,
          query,
        }),
      ).not.toThrow()
    }
    expect(
      context.continuum.search({
        workspace: context.firstWorkspace,
        query: 'src/foo-bar.ts',
      }).records,
    ).toHaveLength(1)
    expect(
      context.continuum.search({
        workspace: context.firstWorkspace,
        query: '$HOME',
      }).records,
    ).toHaveLength(1)
    expect(
      context.continuum.search({
        workspace: context.firstWorkspace,
        query: '"quoted text"',
      }).records,
    ).toHaveLength(1)
    expect(
      context.continuum.search({
        workspace: context.firstWorkspace,
        query: '***',
      }).records,
    ).toHaveLength(1)
    context.close()
  })

  test('binds opaque cursors to mode, workspace, and normalized criteria', () => {
    const context = testContext()
    const importer = context.importer()
    for (const [index, id] of ['one', 'two', 'three'].entries()) {
      importer.importRecord({
        workspace: context.firstWorkspace,
        id,
        createdAt: `2026-06-0${index + 1}T00:00:00.000Z`,
        content: `cursor anchor ${id}`,
        tags: ['cursor'],
      })
    }
    importer.importRecord({
      workspace: context.secondWorkspace,
      id: 'other-workspace',
      createdAt: '2026-06-01T00:00:00.000Z',
      content: 'Other evidence',
    })
    importer.close()

    const first = context.continuum.search({
      workspace: context.firstWorkspace,
      tags: [' CURSOR '],
      limit: 1,
    })
    expect(first.nextCursor).toEqual(expect.any(String))
    const cursor = first.nextCursor as string
    expect(
      context.continuum.search({
        workspace: context.firstWorkspace,
        tags: ['cursor'],
        limit: 2,
        cursor,
      }).records,
    ).toHaveLength(2)

    const ftsFirst = context.continuum.search({
      workspace: context.firstWorkspace,
      query: 'cursor anchor',
      limit: 1,
    })
    expect(ftsFirst.nextCursor).toEqual(expect.any(String))

    for (const input of [
      { cursor: 'not+base64' },
      { cursor: `${cursor}=` },
      { cursor, query: 'cursor' },
      { cursor, tags: ['different'] },
      { cursor, kinds: ['observation'] },
      { cursor, includeHistory: true },
      { cursor: ftsFirst.nextCursor as string, query: 'different query' },
    ]) {
      expect(() =>
        context.continuum.search({
          workspace: context.firstWorkspace,
          ...input,
        }),
      ).toThrow(ContinuumError)
    }
    expect(() =>
      context.continuum.search({
        workspace: context.secondWorkspace,
        tags: ['cursor'],
        cursor,
      }),
    ).toThrow(ContinuumError)

    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    decoded.v = 2
    const unsupported = Buffer.from(JSON.stringify(decoded)).toString(
      'base64url',
    )
    try {
      context.continuum.search({
        workspace: context.firstWorkspace,
        tags: ['cursor'],
        cursor: unsupported,
      })
    } catch (error) {
      expect(error).toMatchObject({
        code: 'VALIDATION_ERROR',
        operation: 'search memory',
      })
    }
    context.close()
  })

  test('continues a default summary through search and registers empty summaries', () => {
    const context = testContext()
    const importer = context.importer()
    for (let index = 0; index < 12; index += 1) {
      importer.importRecord({
        workspace: context.firstWorkspace,
        id: `summary-${index.toString().padStart(2, '0')}`,
        createdAt: `2026-07-${(index + 1).toString().padStart(2, '0')}T00:00:00.000Z`,
        content: `Summary evidence ${index}`,
      })
    }
    importer.close()

    const limited = context.continuum.summary({
      workspace: context.firstWorkspace,
      limit: 3,
    })
    expect(limited.records).toHaveLength(3)
    expect(limited.hasMore).toBe(true)

    const summary = context.continuum.summary({
      workspace: context.firstWorkspace,
    })
    expect(summary.workspace).toEqual({
      identity: { kind: 'path', value: context.firstWorkspace },
      aliases: [{ kind: 'path', value: context.firstWorkspace }],
    })
    expect(summary.records).toHaveLength(10)
    expect(summary.hasMore).toBe(true)
    const continuation = context.continuum.search({
      workspace: context.firstWorkspace,
      cursor: summary.nextCursor as string,
    })
    expect(continuation.records).toHaveLength(2)
    expect(continuation.hasMore).toBe(false)

    const empty = context.continuum.summary({
      workspace: context.secondWorkspace,
      limit: 5,
    })
    expect(empty.records).toEqual([])
    expect(empty.nextCursor).toBeNull()
    context.close()

    const database = context.openDatabase()
    expect(countRows(database, 'workspaces')).toBe(2)
    expect(countRows(database, 'workspace_aliases')).toBe(2)
    database.close()
  })

  test('gets exact records in request order and reports missing or isolated IDs', () => {
    const context = testContext()
    const importer = context.importer()
    const old = importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'get-old',
      createdAt: '2026-08-01T00:00:00.000Z',
      content: 'Historical evidence',
    })
    const replacement = importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'get-new',
      createdAt: '2026-08-02T00:00:00.000Z',
      content: 'Replacement evidence',
      supersedes: [old.id],
    })
    importer.importRecord({
      workspace: context.secondWorkspace,
      id: 'private-other-workspace',
      createdAt: '2026-08-03T00:00:00.000Z',
      content: 'Isolated evidence',
    })
    importer.close()

    const result = context.continuum.get({
      workspace: context.firstWorkspace,
      ids: [
        replacement.id,
        'missing',
        old.id,
        replacement.id,
        'private-other-workspace',
      ],
    })
    expect(result.records.map(({ id }) => id)).toEqual([replacement.id, old.id])
    expect(result.records[0]?.supersedes).toEqual([old.id])
    expect(result.records[1]?.supersededBy).toEqual([replacement.id])
    expect(result.missingIds).toEqual(['missing', 'private-other-workspace'])
    context.close()
  })

  test('search and get locate existing remotes without registering unknown paths', () => {
    const context = testContext()
    git(context.firstWorkspace, 'init', '--quiet')
    git(
      context.firstWorkspace,
      'remote',
      'add',
      'origin',
      'https://github.com/team/retrieval-memory.git',
    )
    git(context.secondWorkspace, 'init', '--quiet')
    git(
      context.secondWorkspace,
      'remote',
      'add',
      'origin',
      'git@github.com:team/retrieval-memory.git',
    )
    const record = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'Remote-owned memory',
    })
    const newer = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'A second remote-owned memory',
    })
    const unknown = makeDirectory(context.root, 'unknown')
    const firstPage = context.continuum.search({
      workspace: context.firstWorkspace,
      limit: 1,
    })

    expect(
      context.continuum
        .search({ workspace: context.secondWorkspace })
        .records.map(({ id }) => id)
        .sort(),
    ).toEqual([newer.id, record.id].sort())
    expect(
      context.continuum.get({
        workspace: context.secondWorkspace,
        ids: [record.id],
      }).records,
    ).toEqual([record])
    expect(() =>
      context.continuum.search({
        workspace: unknown,
        cursor: firstPage.nextCursor as string,
      }),
    ).toThrow(ContinuumError)
    expect(context.continuum.search({ workspace: unknown })).toEqual({
      records: [],
      hasMore: false,
      nextCursor: null,
    })
    expect(
      context.continuum.get({ workspace: unknown, ids: ['a', 'b', 'a'] }),
    ).toEqual({ records: [], missingIds: ['a', 'b'] })
    context.close()

    const database = context.openDatabase()
    expect(countRows(database, 'workspaces')).toBe(1)
    expect(
      database
        .query("SELECT value FROM workspace_aliases WHERE kind = 'path'")
        .all(),
    ).toEqual([{ value: context.firstWorkspace }])
    database.close()
  })

  test('surfaces retrieval identity conflicts without reassociating aliases', () => {
    const context = testContext()
    context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'Path-owned evidence',
    })
    git(context.secondWorkspace, 'init', '--quiet')
    git(
      context.secondWorkspace,
      'remote',
      'add',
      'origin',
      'https://github.com/team/conflicting-retrieval.git',
    )
    const remoteRecord = context.continuum.record({
      workspace: context.secondWorkspace,
      content: 'Remote-owned evidence',
    })
    git(context.firstWorkspace, 'init', '--quiet')
    git(
      context.firstWorkspace,
      'remote',
      'add',
      'origin',
      'git@github.com:team/conflicting-retrieval.git',
    )

    expect(() =>
      context.continuum.search({ workspace: context.firstWorkspace }),
    ).toThrow(ContinuumError)
    expect(() =>
      context.continuum.get({
        workspace: context.firstWorkspace,
        ids: [remoteRecord.id],
      }),
    ).toThrow(ContinuumError)
    context.close()

    const database = context.openDatabase()
    expect(countRows(database, 'workspaces')).toBe(2)
    expect(countRows(database, 'workspace_aliases')).toBe(3)
    database.close()
  })

  test('returns structured validation and database failures without relying on FTS for browse or get', () => {
    const context = testContext()
    const record = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'Canonical browsing survives a derived index failure.',
      tags: ['canonical'],
    })

    for (const invoke of [
      () =>
        context.continuum.search({
          workspace: context.firstWorkspace,
          limit: 0,
        }),
      () =>
        context.continuum.search({
          workspace: context.firstWorkspace,
          tags: [''],
        }),
      () =>
        context.continuum.get({ workspace: context.firstWorkspace, ids: [] }),
      () =>
        context.continuum.summary({
          workspace: context.firstWorkspace,
          limit: 101,
        }),
    ]) {
      let caught: unknown
      try {
        invoke()
      } catch (error) {
        caught = error
      }
      expect(caught).toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    context.close()

    const database = context.openDatabase()
    database.exec('DROP TABLE memory_fts')
    database.close()
    const reopened = createContinuum({ dataDirectory: context.dataDirectory })
    expect(() =>
      reopened.search({
        workspace: context.firstWorkspace,
        query: 'canonical',
      }),
    ).toThrow(ContinuumError)
    expect(
      reopened.search({ workspace: context.firstWorkspace }).records,
    ).toEqual([record])
    expect(
      reopened.get({ workspace: context.firstWorkspace, ids: [record.id] })
        .records,
    ).toEqual([record])
    reopened.close()
  })
})

function testContext(): {
  root: string
  dataDirectory: string
  firstWorkspace: string
  secondWorkspace: string
  continuum: ReturnType<typeof createContinuum>
  importer(): ReturnType<typeof createContinuumImporter>
  openDatabase(): Database
  close(): void
} {
  const root = mkdtempSync(join(tmpdir(), 'continuum-retrieval-'))
  temporaryRoots.push(root)
  const dataDirectory = join(root, 'data')
  const firstWorkspace = makeDirectory(root, 'first-workspace')
  const secondWorkspace = makeDirectory(root, 'second-workspace')
  const continuum = createContinuum({ dataDirectory })
  return {
    root,
    dataDirectory,
    firstWorkspace,
    secondWorkspace,
    continuum,
    importer: () => createContinuumImporter({ dataDirectory }),
    openDatabase: () => new Database(join(dataDirectory, 'continuum.db')),
    close: () => continuum.close(),
  }
}

function collectPages(
  context: ReturnType<typeof testContext>,
  input: Parameters<typeof context.continuum.search>[0],
  limits: number[],
): string[] {
  const ids: string[] = []
  let cursor: string | undefined
  let page = 0
  do {
    const result = context.continuum.search({
      ...input,
      limit: limits[page % limits.length],
      cursor,
    })
    ids.push(...result.records.map(({ id }) => id))
    cursor = result.nextCursor ?? undefined
    page += 1
    if (!result.hasMore) break
  } while (page < 20)
  return ids
}

function makeDirectory(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}

function git(cwd: string, ...args: string[]): void {
  const process = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (process.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(process.stderr))
  }
}

function countRows(database: Database, table: string): number {
  return Number(
    (
      database.query(`SELECT COUNT(*) count FROM ${table}`).get() as {
        count: number
      }
    ).count,
  )
}
