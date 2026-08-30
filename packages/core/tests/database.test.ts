import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContinuum, resolveContinuumDataPaths } from '@continuum/core'
import { openContinuumDatabase } from '../src/database/database'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (process.platform !== 'win32') chmodSync(root, 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('central Continuum database', () => {
  test('resolves XDG and explicit data directories without eagerly creating them', () => {
    const root = temporaryRoot()
    const xdg = join(root, 'xdg')
    const configured = join(root, 'configured')

    expect(
      resolveContinuumDataPaths({
        environment: { XDG_DATA_HOME: xdg },
        homeDirectory: join(root, 'home'),
      }),
    ).toEqual({
      dataDirectory: join(xdg, 'continuum'),
      databasePath: join(xdg, 'continuum', 'continuum.db'),
    })
    expect(
      resolveContinuumDataPaths({
        environment: { CONTINUUM_DATA_DIR: configured },
      }),
    ).toEqual({
      dataDirectory: configured,
      databasePath: join(configured, 'continuum.db'),
    })
    expect(
      resolveContinuumDataPaths({
        environment: {},
        homeDirectory: join(root, 'home'),
      }),
    ).toEqual({
      dataDirectory: join(root, 'home', '.local', 'share', 'continuum'),
      databasePath: join(
        root,
        'home',
        '.local',
        'share',
        'continuum',
        'continuum.db',
      ),
    })

    const continuum = createContinuum({ dataDirectory: configured })
    expect(existsSync(configured)).toBe(false)
    continuum.close()
    expect(existsSync(configured)).toBe(false)
  })

  test('opens, configures, migrates, and reopens one private SQLite database', () => {
    const root = temporaryRoot()
    const workspace = makeDirectory(root, 'workspace')
    const dataDirectory = join(root, 'data')

    const first = createContinuum({ dataDirectory })
    first.resolveWorkspace(workspace)
    first.close()

    const dataPaths = resolveContinuumDataPaths({ dataDirectory })
    const databasePath = dataPaths.databasePath
    const database = openContinuumDatabase(dataPaths)
    expect(pragmaNumber(database, 'user_version')).toBe(3)
    expect(pragmaNumber(database, 'foreign_keys')).toBe(1)
    expect(pragmaNumber(database, 'busy_timeout', 'timeout')).toBe(5_000)
    expect(pragmaText(database, 'journal_mode')).toBe('wal')
    expect(pragmaNumber(database, 'synchronous')).toBe(1)
    expect(tableNames(database)).toEqual(
      expect.arrayContaining([
        'memory_fts',
        'memory_record_tags',
        'memory_records',
        'memory_supersessions',
        'workspace_aliases',
        'workspaces',
      ]),
    )

    const storedWorkspace = database
      .query('SELECT id FROM workspaces LIMIT 1')
      .get() as { id: string }
    database
      .query(
        `INSERT INTO memory_records
         (id, workspace_id, kind, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'record-1',
        storedWorkspace.id,
        'decision',
        'SQLite is canonical',
        '2026-01-01T00:00:00.000Z',
      )
    expect(() =>
      database
        .query('UPDATE memory_records SET content = ? WHERE id = ?')
        .run('rewritten', 'record-1'),
    ).toThrow('memory records are immutable')
    expect(() =>
      database
        .query(
          'INSERT INTO memory_record_tags (record_rowid, tag) VALUES (?, ?)',
        )
        .run(1, 'Not-Normalized'),
    ).toThrow()
    database
      .query('INSERT INTO memory_record_tags (record_rowid, tag) VALUES (?, ?)')
      .run(1, 'sqlite')
    database
      .query(
        `INSERT INTO memory_fts(rowid, content, kind, tags)
         VALUES (?, ?, ?, ?)`,
      )
      .run(1, 'SQLite is canonical', 'decision', 'storage sqlite')
    expect(
      database
        .query("SELECT rowid FROM memory_fts WHERE memory_fts MATCH 'sqlite'")
        .all(),
    ).toEqual([{ rowid: 1 }])
    database.close()

    const second = createContinuum({ dataDirectory })
    second.resolveWorkspace(workspace)
    second.close()

    const reopened = new Database(databasePath)
    expect(countRows(reopened, 'workspaces')).toBe(1)
    expect(countRows(reopened, 'workspace_aliases')).toBe(1)
    reopened.close()

    if (process.platform !== 'win32') {
      expect(statSync(dataDirectory).mode & 0o777).toBe(0o700)
      expect(statSync(databasePath).mode & 0o777).toBe(0o600)
    }
  })

  test('backfills canonical version-one records into the full-text index', () => {
    const root = temporaryRoot()
    const workspace = makeDirectory(root, 'legacy-schema-workspace')
    const dataDirectory = join(root, 'data')
    const dataPaths = resolveContinuumDataPaths({ dataDirectory })

    const continuum = createContinuum({ dataDirectory })
    continuum.resolveWorkspace(workspace)
    continuum.close()

    const versionOne = new Database(dataPaths.databasePath)
    const storedWorkspace = versionOne
      .query('SELECT id FROM workspaces LIMIT 1')
      .get() as { id: string }
    versionOne
      .query(
        `INSERT INTO memory_records
         (id, workspace_id, kind, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'pre-fts-record',
        storedWorkspace.id,
        'decision',
        'Backfill preserves a concrete migration anchor.',
        '2026-01-01T00:00:00.000Z',
      )
    const record = versionOne
      .query('SELECT rowid FROM memory_records WHERE id = ?')
      .get('pre-fts-record') as { rowid: number }
    versionOne
      .query('INSERT INTO memory_record_tags (record_rowid, tag) VALUES (?, ?)')
      .run(record.rowid, 'migration-anchor')
    versionOne.exec('DROP TABLE memory_fts')
    versionOne.exec('PRAGMA user_version = 1')
    versionOne.close()

    const migrated = openContinuumDatabase(dataPaths)
    expect(pragmaNumber(migrated, 'user_version')).toBe(3)
    expect(
      migrated
        .query(
          `SELECT rowid FROM memory_fts
           WHERE memory_fts MATCH 'migration'`,
        )
        .all(),
    ).toEqual([{ rowid: record.rowid }])
    expect(
      migrated
        .query('SELECT content, kind, tags FROM memory_fts WHERE rowid = ?')
        .get(record.rowid),
    ).toEqual({
      content: 'Backfill preserves a concrete migration anchor.',
      kind: 'decision',
      tags: 'migration-anchor',
    })
    migrated.close()

    const reopened = createContinuum({ dataDirectory })
    expect(
      reopened.search({ workspace, query: 'migration-anchor' }).records,
    ).toEqual([
      {
        id: 'pre-fts-record',
        kind: 'decision',
        content: 'Backfill preserves a concrete migration anchor.',
        tags: ['migration-anchor'],
        createdAt: '2026-01-01T00:00:00.000Z',
        supersedes: [],
        supersededBy: [],
      },
    ])
    reopened.close()
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'continuum-database-'))
  temporaryRoots.push(root)
  return root
}

function makeDirectory(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}

function pragmaNumber(
  database: Database,
  name: string,
  column: string = name,
): number {
  return Number(
    (database.query(`PRAGMA ${name}`).get() as Record<string, number>)[column],
  )
}

function pragmaText(database: Database, name: string): string {
  return String(
    (database.query(`PRAGMA ${name}`).get() as Record<string, string>)[name],
  )
}

function tableNames(database: Database): string[] {
  return (
    database
      .query(
        `SELECT name FROM sqlite_master
         WHERE type IN ('table', 'view') ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
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
