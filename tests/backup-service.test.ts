import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { configureBackup, readBackupConfig } from '../src/backup/config'
import {
  databaseObjectKey,
  decodeBackupManifest,
  encodeJson,
  headObjectKey,
  manifestObjectKey,
  type BackupHead,
} from '../src/backup/contracts'
import type { BackupObjectStore } from '../src/backup/object-store'
import { createBackup, listBackups, restoreBackup } from '../src/backup/service'
import { canonicalDbFilePath } from '../src/db/paths'
import { migrateDb } from '../src/db/migrate'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const WRITER_ID = '22222222-2222-4222-8222-222222222222'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('R2 backup service', () => {
  test('uploads a WAL-aware immutable generation and walks lineage', async () => {
    const fixture = await createFixture()
    const firstConnection = new Database(fixture.dbPath)
    firstConnection.exec('PRAGMA journal_mode = WAL')
    insertTask(firstConnection, 'tkt-first', 'first snapshot')
    expect(await tableExists(firstConnection, 'tasks')).toBe(true)

    const first = createBackup(fixture.workspace, fixture.store, fixedDate(1))
    firstConnection.close()
    expect(first.parentGeneration).toBeNull()
    expect(fixture.store.keys().some((key) => /(?:-wal|-shm)$/.test(key))).toBe(
      false,
    )
    expect(snapshotTaskIds(fixture.store, first.generation)).toContain(
      'tkt-first',
    )

    const secondConnection = new Database(fixture.dbPath)
    insertTask(secondConnection, 'tkt-second', 'second snapshot')
    secondConnection.close()
    const second = createBackup(fixture.workspace, fixture.store, fixedDate(2))
    expect(second.parentGeneration).toBe(first.generation)

    const inventory = listBackups(fixture.workspace, fixture.store)
    expect(inventory.map((item) => item.generation)).toEqual([
      second.generation,
      first.generation,
    ])
    expect(inventory[0]?.database.digest).toBe(second.digest)
  })

  test('leaves interrupted uploads unreferenced and reports a stale head', async () => {
    const fixture = await createFixture()
    fixture.store.failNextPut((key) => key.endsWith('/manifest.json'))
    expect(() =>
      createBackup(fixture.workspace, fixture.store, fixedDate(1)),
    ).toThrow('simulated upload interruption')
    expect(fixture.store.get(headObjectKey(PROJECT_ID))).toBeNull()
    expect(fixture.store.keys().some((key) => key.endsWith('.sqlite'))).toBe(
      true,
    )

    const first = createBackup(fixture.workspace, fixture.store, fixedDate(2))
    const conflictingGeneration = generationFor(9)
    fixture.store.replaceOnHeadRead(2, {
      formatVersion: 1,
      projectId: PROJECT_ID,
      generation: conflictingGeneration,
      manifestKey: manifestObjectKey(PROJECT_ID, conflictingGeneration),
      writerId: WRITER_ID,
      updatedAt: fixedDate(9).toISOString(),
    })
    expect(() =>
      createBackup(fixture.workspace, fixture.store, fixedDate(3)),
    ).toThrow('head changed during upload')
    expect(first.generation).not.toBe(conflictingGeneration)
    expect(() => listBackups(fixture.workspace, fixture.store)).toThrow(
      'manifest is missing',
    )
  })

  test('rejects writer conflicts before uploading a generation', async () => {
    const fixture = await createFixture()
    const generation = generationFor(1)
    const conflict: BackupHead = {
      formatVersion: 1,
      projectId: PROJECT_ID,
      generation,
      manifestKey: manifestObjectKey(PROJECT_ID, generation),
      writerId: '33333333-3333-4333-8333-333333333333',
      updatedAt: fixedDate(1).toISOString(),
    }
    fixture.store.put(
      headObjectKey(PROJECT_ID),
      encodeJson(conflict),
      'application/json',
    )
    expect(() =>
      createBackup(fixture.workspace, fixture.store, fixedDate(2)),
    ).toThrow('writer conflict')
    expect(fixture.store.keys()).toHaveLength(1)
  })

  test('restores through checksum and SQLite validation without overwriting', async () => {
    const fixture = await createFixture()
    const sqlite = new Database(fixture.dbPath)
    insertTask(sqlite, 'tkt-restore', 'restore me')
    sqlite.close()
    const backup = createBackup(fixture.workspace, fixture.store, fixedDate(1))
    const output = join(fixture.root, 'recovery', 'restored.sqlite')

    const restored = restoreBackup(fixture.workspace, fixture.store, {
      generation: backup.generation,
      outputPath: output,
    })
    expect(restored.outputPath).toBe(output)
    expect(readTaskIds(output)).toContain('tkt-restore')
    const divergent = new Database(output)
    insertTask(divergent, 'tkt-local', 'local divergence')
    divergent.close()
    expect(() =>
      restoreBackup(fixture.workspace, fixture.store, {
        generation: backup.generation,
        outputPath: output,
      }),
    ).toThrow('divergent')
    expect(readTaskIds(output)).toEqual(['tkt-local', 'tkt-restore'])

    const remoteKey = databaseObjectKey(PROJECT_ID, backup.generation)
    fixture.store.put(
      remoteKey,
      new Uint8Array([1, 2, 3]),
      'application/octet-stream',
    )
    expect(() =>
      restoreBackup(fixture.workspace, fixture.store, {
        generation: backup.generation,
        outputPath: join(fixture.root, 'corrupt.sqlite'),
      }),
    ).toThrow('checksum mismatch')
  })

  test('restores a valid snapshot created by a different application version', async () => {
    const fixture = await createFixture()
    const backup = createBackup(fixture.workspace, fixture.store, fixedDate(1))
    const manifestKey = manifestObjectKey(PROJECT_ID, backup.generation)
    const manifestBytes = fixture.store.get(manifestKey)
    if (!manifestBytes) throw new Error('missing test manifest')
    const manifest = decodeBackupManifest(manifestBytes)
    fixture.store.put(
      manifestKey,
      encodeJson({
        ...manifest,
        metadata: { ...manifest.metadata, applicationVersion: '0.0.0' },
      }),
      'application/json',
    )
    const output = join(fixture.root, 'recovery', 'historical.sqlite')

    expect(
      restoreBackup(fixture.workspace, fixture.store, {
        generation: backup.generation,
        outputPath: output,
      }).outputPath,
    ).toBe(output)
  })

  test('keeps portable identity explicit and configuration idempotent', async () => {
    const fixture = await createFixture()
    const existing = configureBackup({
      workspaceRoot: fixture.workspace,
      bucket: 'continuum-test-backups',
      projectId: PROJECT_ID,
      writerId: WRITER_ID,
    })
    expect(existing).toEqual(readBackupConfig(fixture.workspace))
    expect(() =>
      configureBackup({
        workspaceRoot: fixture.workspace,
        bucket: 'another-continuum-bucket',
      }),
    ).toThrow('already configured')
  })
})

type Fixture = {
  root: string
  workspace: string
  dbPath: string
  store: MemoryObjectStore
}

async function createFixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-r2-test-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(join(workspace, '.git'), { recursive: true })
  configureBackup({
    workspaceRoot: workspace,
    bucket: 'continuum-test-backups',
    projectId: PROJECT_ID,
    writerId: WRITER_ID,
    now: fixedDate(0),
  })
  const dbPath = canonicalDbFilePath(workspace)
  mkdirSync(dirname(dbPath), { recursive: true })
  await migrateDb(dbPath)
  return { root, workspace, dbPath, store: new MemoryObjectStore() }
}

class MemoryObjectStore implements BackupObjectStore {
  readonly #objects = new Map<string, Uint8Array>()
  #failure: ((key: string) => boolean) | null = null
  #headReads = 0
  #replaceRead: { count: number; head: BackupHead } | null = null

  get(key: string): Uint8Array | null {
    if (key === headObjectKey(PROJECT_ID)) {
      this.#headReads += 1
      if (this.#replaceRead?.count === this.#headReads) {
        const bytes = encodeJson(this.#replaceRead.head)
        this.#objects.set(key, bytes)
        return bytes.slice()
      }
    }
    return this.#objects.get(key)?.slice() ?? null
  }

  put(key: string, content: Uint8Array): void {
    if (this.#failure?.(key)) {
      this.#failure = null
      throw new Error('simulated upload interruption')
    }
    this.#objects.set(key, content.slice())
  }

  keys(): string[] {
    return [...this.#objects.keys()].sort()
  }

  failNextPut(predicate: (key: string) => boolean): void {
    this.#failure = predicate
  }

  replaceOnHeadRead(countFromNow: number, head: BackupHead): void {
    this.#replaceRead = { count: this.#headReads + countFromNow, head }
  }
}

function fixedDate(index: number): Date {
  return new Date(`2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`)
}

function generationFor(index: number): string {
  return `20260101T0000${String(index).padStart(2, '0')}000Z-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
}

function insertTask(sqlite: Database, id: string, title: string): void {
  const now = new Date().toISOString()
  sqlite
    .query(
      `INSERT INTO tasks
       (id, title, type, status, priority, steps, discoveries, decisions,
        blocked_by, created_at, updated_at)
       VALUES (?, ?, 'feature', 'ready', 10, '[]', '[]', '[]', '[]', ?, ?)`,
    )
    .run(id, title, now, now)
}

function readTaskIds(path: string): string[] {
  const sqlite = new Database(path, { readonly: true })
  try {
    return (
      sqlite.query('SELECT id FROM tasks ORDER BY id').all() as Array<{
        id: string
      }>
    ).map((row) => row.id)
  } finally {
    sqlite.close()
  }
}

function snapshotTaskIds(
  store: MemoryObjectStore,
  generation: string,
): string[] {
  const bytes = store.get(databaseObjectKey(PROJECT_ID, generation))
  if (!bytes) throw new Error('missing test snapshot')
  const directory = mkdtempSync(join(tmpdir(), 'continuum-r2-read-'))
  const path = join(directory, 'snapshot.sqlite')
  writeFileSync(path, bytes)
  try {
    return readTaskIds(path)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function tableExists(sqlite: Database, table: string): Promise<boolean> {
  return (
    sqlite.query(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(table) !==
    null
  )
}
