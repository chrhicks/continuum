import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { migrateDb } from '../src/db/migrate'
import { canonicalDbFilePath } from '../src/db/paths'

const repoRoot = process.cwd()
const cliPath = join(repoRoot, 'bin', 'continuum')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('XDG canonical database migration', () => {
  test('migrates WAL-visible task and memory data and keeps new writes off legacy storage', async () => {
    const fixture = await legacyFixture()
    const source = new Database(fixture.legacyDb)
    source.exec('PRAGMA journal_mode = WAL')
    insertTask(source, 'tkt-legacy', 'Legacy migration task')
    insertMemory(source, 'mem-legacy', 'legacy memory needle')
    expect(existsSync(`${fixture.legacyDb}-wal`)).toBe(true)

    const initialized = cli(fixture, ['init'])
    source.close()
    expect(initialized.status).toBe(0)

    const canonical = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    expect(existsSync(canonical)).toBe(true)
    expect(existsSync(fixture.legacyDb)).toBe(true)
    const receipt = JSON.parse(
      readFileSync(
        join(canonical, '..', 'legacy-migration-receipt.json'),
        'utf8',
      ),
    ) as {
      sourceFingerprint: { algorithm: string; digest: string }
      method: string
    }
    expect(receipt.method).toBe('sqlite-serialize-snapshot')
    expect(receipt.sourceFingerprint.algorithm).toBe('sha256')
    expect(receipt.sourceFingerprint.digest).toHaveLength(64)

    const summary = cli(fixture, ['summary'])
    expect(summary.status).toBe(0)
    expect(summary.stdout).toContain('Legacy migration task')
    expect(summary.stdout).toContain('legacy memory needle')
    expect(summary.stderr).toContain('may be removed')

    expect(
      cli(fixture, ['memory', 'append', 'agent', 'new XDG-only memory']).status,
    ).toBe(0)
    expect(memoryContents(canonical)).toContain('new XDG-only memory')
    expect(memoryContents(fixture.legacyDb)).not.toContain(
      'new XDG-only memory',
    )
  })

  test('refuses to call a changed legacy source removable', async () => {
    const fixture = await legacyFixture()
    const source = new Database(fixture.legacyDb)
    insertMemory(source, 'mem-before', 'before migration')
    source.close()
    expect(cli(fixture, ['init']).status).toBe(0)

    const changed = new Database(fixture.legacyDb)
    insertMemory(changed, 'mem-after', 'legacy changed after migration')
    changed.close()

    const summary = cli(fixture, ['summary'])
    expect(summary.status).not.toBe(0)
    expect(summary.stderr).toContain('changed since migration')
    expect(summary.stderr).not.toContain('may be removed')
  })

  test('fails safely when legacy and canonical databases diverge without a receipt', async () => {
    const fixture = await legacyFixture()
    const legacy = new Database(fixture.legacyDb)
    insertMemory(legacy, 'legacy-only', 'legacy only')
    legacy.close()

    const canonical = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    mkdirSync(join(canonical, '..'), { recursive: true })
    await migrateDb(canonical)
    const destination = new Database(canonical)
    insertMemory(destination, 'destination-only', 'destination only')
    destination.close()

    const initialized = cli(fixture, ['init'])
    expect(initialized.status).not.toBe(0)
    expect(initialized.stderr).toContain('divergent')
    expect(memoryContents(canonical)).toContain('destination only')
    expect(memoryContents(fixture.legacyDb)).toContain('legacy only')
  })
})

type Fixture = {
  root: string
  workspace: string
  dataHome: string
  home: string
  legacyDb: string
}

async function legacyFixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'continuum-xdg-migration-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const home = join(root, 'home')
  const dataHome = join(root, 'xdg-data')
  const legacyDb = join(workspace, '.continuum', 'continuum.db')
  mkdirSync(join(workspace, '.git'), { recursive: true })
  mkdirSync(join(workspace, '.continuum'), { recursive: true })
  mkdirSync(home, { recursive: true })
  await migrateDb(legacyDb)
  return { root, workspace, dataHome, home, legacyDb }
}

function cli(fixture: Fixture, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    'bun',
    ['run', cliPath, '--cwd', fixture.workspace, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: fixture.home,
        XDG_DATA_HOME: fixture.dataHome,
      },
    },
  )
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

function insertMemory(sqlite: Database, id: string, content: string): void {
  sqlite
    .query(
      `INSERT INTO memory_journal_entries
       (id, kind, content, metadata, payload_version, created_at)
       VALUES (?, 'agent', ?, '{}', 1, ?)`,
    )
    .run(id, content, new Date().toISOString())
}

function memoryContents(dbPath: string): string[] {
  const sqlite = new Database(dbPath, { readonly: true })
  try {
    return (
      sqlite
        .query('SELECT content FROM memory_journal_entries')
        .all() as Array<{
        content: string
      }>
    ).map((row) => row.content)
  } finally {
    sqlite.close()
  }
}
