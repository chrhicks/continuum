import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { getDbClientByPath } from '../src/db/client'
import { migrateDb } from '../src/db/migrate'
import { makeJournalRepository } from '../src/memory/repository/journal-repository'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function tempDbPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'continuum-journal-'))
  directories.push(directory)
  return join(directory, 'continuum.db')
}

describe('memory journal migration', () => {
  test('upgrades 0000, 0001, and 0002 fixtures without changing rows', async () => {
    for (const level of [0, 1, 2]) {
      const path = tempDbPath()
      const sqlite = new Database(path)
      for (let index = 0; index <= level; index++) {
        const tag = [
          '0000_initial.sql',
          '0001_add_task_priority.sql',
          '0002_add_memory_checkpoints.sql',
        ][index]
        if (!tag) throw new Error(`Missing migration fixture ${index}`)
        sqlite.exec(
          readFileSync(join(import.meta.dir, '..', 'drizzle', tag), 'utf8'),
        )
      }
      sqlite.exec(`CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC);
        INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES ('fixture', ${[0, 1771951323000, 1772841600000][level]});
        INSERT INTO tasks (id, title, type, created_at, updated_at)
        VALUES ('fixture-${level}', 'Exact fixture', 'task', 'created', 'updated');`)
      if (level === 2)
        sqlite.exec(`INSERT INTO memory_checkpoints
          (key, source, scope, cursor, fingerprint, record_count, updated_at, metadata)
          VALUES ('task:fixture', 'task', 'fixture', 'c', 'f', 3, 'updated', '{"x":1}')`)
      sqlite.close()

      await migrateDb(path)
      const migrated = new Database(path)
      expect(
        migrated
          .query(
            'SELECT id, title, type, status, created_at, updated_at FROM tasks',
          )
          .get(),
      ).toEqual({
        id: `fixture-${level}`,
        title: 'Exact fixture',
        type: 'task',
        status: 'open',
        created_at: 'created',
        updated_at: 'updated',
      })
      if (level === 2)
        expect(
          migrated.query('SELECT * FROM memory_checkpoints').get(),
        ).toEqual({
          key: 'task:fixture',
          source: 'task',
          scope: 'fixture',
          cursor: 'c',
          fingerprint: 'f',
          record_count: 3,
          updated_at: 'updated',
          metadata: '{"x":1}',
        })
      migrated.close()
    }
  })

  test('upgrades an existing database additively and configures SQLite', async () => {
    const path = tempDbPath()
    const sqlite = new Database(path)
    sqlite.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL,
      type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', intent TEXT,
      description TEXT, plan TEXT, steps TEXT NOT NULL DEFAULT '[]', current_step INTEGER,
      discoveries TEXT NOT NULL DEFAULT '[]', decisions TEXT NOT NULL DEFAULT '[]',
      outcome TEXT, completed_at TEXT, parent_id TEXT, blocked_by TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO tasks (id, title, type, created_at, updated_at)
        VALUES ('task-1', 'Preserved', 'task', '2026-01-01', '2026-01-01');
       CREATE TABLE memory_checkpoints (key TEXT PRIMARY KEY, source TEXT NOT NULL,
        scope TEXT NOT NULL, cursor TEXT, fingerprint TEXT, record_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL, metadata TEXT NOT NULL);
       INSERT INTO memory_checkpoints
        (key, source, scope, cursor, fingerprint, record_count, updated_at, metadata)
        VALUES ('opencode:repo', 'opencode', 'repo', 'cursor-7', 'hash-7', 7,
          '2026-01-02', '{"kept":true}');`)
    sqlite.close()

    await migrateDb(path)
    await migrateDb(path)

    const migrated = new Database(path)
    expect(migrated.query('SELECT title FROM tasks').get()).toEqual({
      title: 'Preserved',
    })
    expect(
      migrated
        .query(
          `SELECT key, source, scope, cursor, fingerprint, record_count, updated_at, metadata
         FROM memory_checkpoints`,
        )
        .get(),
    ).toEqual({
      key: 'opencode:repo',
      source: 'opencode',
      scope: 'repo',
      cursor: 'cursor-7',
      fingerprint: 'hash-7',
      record_count: 7,
      updated_at: '2026-01-02',
      metadata: '{"kept":true}',
    })
    expect(
      migrated
        .query(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal_entries'`,
        )
        .get(),
    ).toEqual({ name: 'memory_journal_entries' })
    migrated.close()

    const configured = getDbClientByPath(path).sqlite
    expect(configured.query('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    })
    expect(configured.query('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'wal',
    })
    expect(configured.query('PRAGMA busy_timeout').get()).toEqual({
      timeout: 5000,
    })
    expect(configured.query('PRAGMA synchronous').get()).toEqual({
      synchronous: 1,
    })
  })
})

describe('memory journal repository', () => {
  test('returns the original entry for an idempotent retry', async () => {
    const repository = makeJournalRepository(getDbClientByPath(tempDbPath()))
    const input = {
      kind: 'decision',
      content: 'Use SQLite ordering',
      idempotencyKey: 'operation-1',
      source: 'opencode',
      sourceSessionId: 'session-1',
      metadata: { tags: ['database'] },
    }

    const first = await Effect.runPromise(repository.append(input))
    const retried = await Effect.runPromise(repository.append(input))

    expect(retried).toEqual(first)
    expect(await Effect.runPromise(repository.listPending())).toHaveLength(1)
  })

  test('orders concurrent appends by unique SQLite sequence', async () => {
    const repository = makeJournalRepository(getDbClientByPath(tempDbPath()))
    const entries = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        Effect.runPromise(
          repository.append({
            kind: 'note',
            content: `entry ${index}`,
            idempotencyKey: `concurrent-${index}`,
          }),
        ),
      ),
    )

    expect(new Set(entries.map((entry) => entry.sequence)).size).toBe(20)
    const listed = await Effect.runPromise(repository.listPending())
    expect(listed.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
    expect(await Effect.runPromise(repository.latestBoundary())).toBeNull()
  })
})
