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

describe('immutable memory records', () => {
  test('preserves complete content and writes canonical tags and FTS data', () => {
    const context = testContext()
    const content =
      '  # SQLite decision\n\nKeep `$HOME` and "quoted text" exactly.  \n'
    const record = context.continuum.record({
      workspace: context.firstWorkspace,
      content,
      kind: ' Architecture Decision ',
      tags: [' SQLite ', 'DECISION', 'sqlite', ' Agent-Memory '],
    })
    context.continuum.close()

    expect(record).toEqual({
      id: expect.any(String),
      kind: 'architecture decision',
      content,
      tags: ['agent-memory', 'decision', 'sqlite'],
      createdAt: expect.any(String),
      supersedes: [],
      supersededBy: [],
    })
    expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false)

    const database = context.openDatabase()
    expect(
      database
        .query('SELECT kind, content FROM memory_records WHERE id = ?')
        .get(record.id),
    ).toEqual({ kind: 'architecture decision', content })
    expect(
      database
        .query(
          `SELECT content, kind, tags FROM memory_fts
           WHERE rowid = (SELECT rowid FROM memory_records WHERE id = ?)`,
        )
        .get(record.id),
    ).toEqual({
      content,
      kind: 'architecture decision',
      tags: 'agent-memory decision sqlite',
    })
    expect(
      database
        .query("SELECT rowid FROM memory_fts WHERE memory_fts MATCH 'sqlite'")
        .all(),
    ).toHaveLength(1)
    database.close()
  })

  test('defaults kind and rejects invalid canonical input before writing', () => {
    const context = testContext()
    const record = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'A useful observation',
    })

    for (const input of [
      { content: '   ' },
      { content: 'content', kind: '   ' },
      { content: 'content', tags: ['valid', '   '] },
      { content: 'content', supersedes: ['   '] },
    ]) {
      expect(() =>
        context.continuum.record({
          workspace: context.firstWorkspace,
          ...input,
        }),
      ).toThrow(ContinuumError)
    }
    context.continuum.close()

    expect(record.kind).toBe('observation')
    const database = context.openDatabase()
    expect(countRows(database, 'memory_records')).toBe(1)
    expect(countRows(database, 'memory_record_tags')).toBe(0)
    expect(countRows(database, 'memory_supersessions')).toBe(0)
    expect(countRows(database, 'memory_fts')).toBe(1)
    database.close()
  })

  test('adds one, many, and chained supersession relationships without rewriting evidence', () => {
    const context = testContext()
    const first = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'Use the checkout database.',
      tags: ['storage'],
    })
    const second = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'Use one database for each workspace.',
      tags: ['storage'],
    })
    const replacement = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'Use one central database containing isolated workspaces.',
      kind: 'Decision',
      tags: ['Storage', 'Decision'],
      supersedes: [second.id, first.id, first.id],
    })
    const final = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'The central database belongs under XDG data home.',
      supersedes: [replacement.id],
    })
    context.continuum.close()

    expect(replacement.supersedes).toEqual([first.id, second.id].sort())
    expect(replacement.supersededBy).toEqual([])
    expect(final.supersedes).toEqual([replacement.id])

    const database = context.openDatabase()
    expect(
      database
        .query('SELECT id, content FROM memory_records ORDER BY rowid LIMIT 2')
        .all(),
    ).toEqual([
      { id: first.id, content: 'Use the checkout database.' },
      { id: second.id, content: 'Use one database for each workspace.' },
    ])
    expect(countRows(database, 'memory_records')).toBe(4)
    expect(countRows(database, 'memory_supersessions')).toBe(3)
    expect(
      database
        .query(
          `SELECT replacement.id
           FROM memory_supersessions s
           JOIN memory_records old ON old.rowid = s.superseded_record_rowid
           JOIN memory_records replacement ON replacement.rowid = s.record_rowid
           WHERE old.id = ?`,
        )
        .get(first.id),
    ).toEqual({ id: replacement.id })

    expect(() =>
      database
        .query('UPDATE memory_records SET content = ? WHERE id = ?')
        .run('rewritten', first.id),
    ).toThrow('memory records are immutable')
    expect(() =>
      database.query('DELETE FROM memory_records WHERE id = ?').run(first.id),
    ).toThrow('memory records are immutable')
    expect(() =>
      database
        .query(
          `DELETE FROM memory_supersessions
           WHERE superseded_record_rowid =
             (SELECT rowid FROM memory_records WHERE id = ?)`,
        )
        .run(first.id),
    ).toThrow('memory supersessions are immutable')
    database.close()
  })

  test('rejects missing and cross-workspace supersession without partial writes', () => {
    const context = testContext()
    const missingWorkspace = makeDirectory(context.root, 'missing-workspace')
    const existing = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'First workspace evidence',
      tags: ['first'],
    })
    git(context.firstWorkspace, 'init', '--quiet')
    git(
      context.firstWorkspace,
      'remote',
      'add',
      'origin',
      'https://github.com/team/failed-record.git',
    )

    expect(() =>
      context.continuum.record({
        workspace: context.secondWorkspace,
        content: 'Must not cross workspace boundaries',
        tags: ['second'],
        supersedes: [existing.id],
      }),
    ).toThrow(ContinuumError)
    try {
      context.continuum.record({
        workspace: missingWorkspace,
        content: 'Must not reference missing evidence',
        tags: ['missing'],
        supersedes: ['missing-record'],
      })
    } catch (error) {
      expect(error).toMatchObject({
        code: 'NOT_FOUND',
        operation: 'record memory',
        context: { recordId: 'missing-record' },
      })
    }
    expect(() =>
      context.continuum.record({
        workspace: context.firstWorkspace,
        content: 'A failed write must not attach the new Git alias.',
        supersedes: ['missing-record'],
      }),
    ).toThrow(ContinuumError)
    context.continuum.close()

    const database = context.openDatabase()
    expect(countRows(database, 'workspaces')).toBe(1)
    expect(countRows(database, 'workspace_aliases')).toBe(1)
    expect(
      database
        .query(
          `SELECT value FROM workspace_aliases
           WHERE value IN (?, ?)`,
        )
        .all(context.secondWorkspace, missingWorkspace),
    ).toEqual([])
    expect(
      database
        .query("SELECT value FROM workspace_aliases WHERE kind = 'git'")
        .all(),
    ).toEqual([])
    expect(countRows(database, 'memory_records')).toBe(1)
    expect(countRows(database, 'memory_record_tags')).toBe(1)
    expect(countRows(database, 'memory_supersessions')).toBe(0)
    expect(countRows(database, 'memory_fts')).toBe(1)
    database.close()
  })

  test('rolls back a new workspace when derived FTS maintenance fails', () => {
    const context = testContext()
    context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'Existing evidence remains canonical.',
      tags: ['existing'],
    })
    context.continuum.close()

    const brokenDatabase = context.openDatabase()
    brokenDatabase.exec('DROP TABLE memory_fts')
    brokenDatabase.close()

    const continuum = createContinuum({ dataDirectory: context.dataDirectory })
    expect(() =>
      continuum.record({
        workspace: context.secondWorkspace,
        content: 'This transaction must roll back.',
        tags: ['rollback'],
      }),
    ).toThrow(ContinuumError)
    continuum.close()

    const database = context.openDatabase()
    expect(countRows(database, 'workspaces')).toBe(1)
    expect(countRows(database, 'workspace_aliases')).toBe(1)
    expect(
      database
        .query('SELECT value FROM workspace_aliases WHERE value = ?')
        .get(context.secondWorkspace),
    ).toBeNull()
    expect(countRows(database, 'memory_records')).toBe(1)
    expect(countRows(database, 'memory_record_tags')).toBe(1)
    expect(countRows(database, 'memory_supersessions')).toBe(0)
    database.close()
  })

  test('preserves legacy ID and time with idempotent collision-safe imports', () => {
    const context = testContext()
    const importedInput = {
      workspace: context.firstWorkspace,
      id: 'legacy-record-17',
      createdAt: '2026-08-21T15:40:22.342Z',
      kind: ' User Preference ',
      content: 'Preserve this legacy content exactly.\n',
      tags: ['Legacy', 'PREFERENCE', 'legacy'],
    }

    const importer = createContinuumImporter({
      dataDirectory: context.dataDirectory,
    })
    const firstImport = importer.importRecord(importedInput)
    expect(importer.importRecord(importedInput)).toEqual(firstImport)
    const replacement = context.continuum.record({
      workspace: context.firstWorkspace,
      content: 'The current preference replaces the legacy preference.',
      supersedes: [firstImport.id],
    })
    expect(importer.importRecord(importedInput)).toEqual({
      ...firstImport,
      supersededBy: [replacement.id],
    })

    expect(() =>
      importer.importRecord({
        ...importedInput,
        content: 'Different content must not overwrite evidence.',
      }),
    ).toThrow(ContinuumError)
    expect(() =>
      importer.importRecord({
        ...importedInput,
        workspace: context.secondWorkspace,
      }),
    ).toThrow(ContinuumError)
    expect(() => importer.importRecord({ ...importedInput, id: ' ' })).toThrow(
      ContinuumError,
    )
    expect(() =>
      importer.importRecord({ ...importedInput, createdAt: 'not-a-date' }),
    ).toThrow(ContinuumError)
    expect(() =>
      importer.importRecord({
        ...importedInput,
        createdAt: '2026-08-22T01:00:00+05:00',
      }),
    ).toThrow(ContinuumError)
    importer.close()
    context.continuum.close()

    expect(firstImport).toEqual({
      id: importedInput.id,
      kind: 'user preference',
      content: importedInput.content,
      tags: ['legacy', 'preference'],
      createdAt: importedInput.createdAt,
      supersedes: [],
      supersededBy: [],
    })
    const database = context.openDatabase()
    expect(countRows(database, 'workspaces')).toBe(1)
    expect(countRows(database, 'workspace_aliases')).toBe(1)
    expect(
      database
        .query('SELECT value FROM workspace_aliases WHERE value = ?')
        .get(context.secondWorkspace),
    ).toBeNull()
    expect(countRows(database, 'memory_records')).toBe(2)
    expect(countRows(database, 'memory_fts')).toBe(2)
    expect(
      database
        .query('SELECT created_at FROM memory_records WHERE id = ?')
        .get(importedInput.id),
    ).toEqual({ created_at: importedInput.createdAt })
    database.close()
  })

  test('requires imported timestamps to preserve canonical chronological order', () => {
    const context = testContext()
    const importer = createContinuumImporter({
      dataDirectory: context.dataDirectory,
    })
    const earlier = importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'earlier-record',
      createdAt: '2026-08-21T20:00:00.000Z',
      content: 'Earlier evidence',
    })
    const later = importer.importRecord({
      workspace: context.firstWorkspace,
      id: 'later-record',
      createdAt: '2026-08-21T23:00:00.000Z',
      content: 'Later evidence',
    })

    for (const createdAt of [
      '2026-08-22T01:00:00+05:00',
      '2026-08-21T23:00:00Z',
      '2026-08-21 23:00:00.000Z',
      '+010000-01-01T00:00:00.000Z',
    ]) {
      expect(() =>
        importer.importRecord({
          workspace: context.secondWorkspace,
          id: `invalid-${createdAt}`,
          createdAt,
          content: 'Noncanonical evidence',
        }),
      ).toThrow(ContinuumError)
    }
    importer.close()
    context.continuum.close()

    expect(earlier.createdAt).toBe('2026-08-21T20:00:00.000Z')
    expect(later.createdAt).toBe('2026-08-21T23:00:00.000Z')
    const database = context.openDatabase()
    expect(
      database
        .query('SELECT id FROM memory_records ORDER BY created_at, id')
        .all(),
    ).toEqual([{ id: earlier.id }, { id: later.id }])
    expect(countRows(database, 'workspaces')).toBe(1)
    expect(countRows(database, 'workspace_aliases')).toBe(1)
    database.close()
  })
})

function testContext(): {
  root: string
  dataDirectory: string
  firstWorkspace: string
  secondWorkspace: string
  continuum: ReturnType<typeof createContinuum>
  openDatabase(): Database
} {
  const root = mkdtempSync(join(tmpdir(), 'continuum-records-'))
  temporaryRoots.push(root)
  const dataDirectory = join(root, 'data')
  const firstWorkspace = makeDirectory(root, 'first-workspace')
  const secondWorkspace = makeDirectory(root, 'second-workspace')
  return {
    root,
    dataDirectory,
    firstWorkspace,
    secondWorkspace,
    continuum: createContinuum({ dataDirectory }),
    openDatabase: () => new Database(join(dataDirectory, 'continuum.db')),
  }
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
