import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { migrateDb } from '../src/db/migrate'
import { canonicalDbFilePath } from '../src/db/paths'
import { prepareInitializedSnapshot } from '../src/db/storage-lineage'
import {
  publishDatabaseSnapshot,
  readDatabaseSnapshot,
} from '../src/db/storage-snapshot'

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

  test('rejects an unrelated canonical replacement despite an existing receipt', async () => {
    const fixture = await legacyFixture()
    const legacy = new Database(fixture.legacyDb)
    insertMemory(legacy, 'legacy-only', 'legacy proof')
    legacy.close()
    expect(cli(fixture, ['init']).status).toBe(0)

    const canonical = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    const preserved = `${canonical}.preserved`
    renameSync(canonical, preserved)
    await migrateDb(canonical)
    const unrelated = new Database(canonical)
    insertMemory(unrelated, 'unrelated-only', 'unrelated canonical')
    unrelated.close()

    const summary = cli(fixture, ['summary'])
    expect(summary.status).not.toBe(0)
    expect(summary.stderr).toContain('divergent')
    expect(summary.stderr).not.toContain('may be removed')
    expect(memoryContents(canonical)).toContain('unrelated canonical')
    expect(memoryContents(preserved)).toContain('legacy proof')
    expect(memoryContents(fixture.legacyDb)).toContain('legacy proof')
  })

  test('rejects an unrelated replacement after the legacy database is removed', async () => {
    const fixture = await legacyFixture()
    const legacy = new Database(fixture.legacyDb)
    insertMemory(legacy, 'legacy-removed', 'legacy removed proof')
    legacy.close()
    expect(cli(fixture, ['init']).status).toBe(0)

    const preservedLegacy = `${fixture.legacyDb}.preserved`
    renameSync(fixture.legacyDb, preservedLegacy)
    const verified = cli(fixture, ['summary'])
    expect(verified.status).toBe(0)
    expect(verified.stdout).toContain('legacy removed proof')
    expect(verified.stderr).not.toContain('may be removed')

    const canonical = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    const preservedCanonical = `${canonical}.preserved`
    renameSync(canonical, preservedCanonical)
    const workspaceIdentity = JSON.parse(
      readFileSync(
        join(fixture.workspace, '.continuum', 'workspace.json'),
        'utf8',
      ),
    ) as { id: string }
    publishDatabaseSnapshot(
      canonical,
      prepareInitializedSnapshot(workspaceIdentity.id, dirname(canonical)),
    )
    const unrelated = new Database(canonical)
    insertMemory(unrelated, 'unrelated-after-removal', 'unrelated replacement')
    unrelated.close()

    const conflicted = cli(fixture, ['summary'])
    expect(conflicted.status).not.toBe(0)
    expect(conflicted.stderr).toContain('divergent')
    expect(conflicted.stderr).not.toContain('may be removed')
    expect(memoryContents(canonical)).toContain('unrelated replacement')
    expect(memoryContents(preservedCanonical)).toContain('legacy removed proof')
    expect(memoryContents(preservedLegacy)).toContain('legacy removed proof')
  })

  test('adopts embedded lineage after interruption before receipt publication', async () => {
    const fixture = await legacyFixture()
    const legacy = new Database(fixture.legacyDb)
    insertMemory(legacy, 'legacy-only', 'restart-safe migration')
    legacy.close()
    expect(cli(fixture, ['init']).status).toBe(0)

    const canonical = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    const receipt = join(dirname(canonical), 'legacy-migration-receipt.json')
    rmSync(receipt)

    const summary = cli(fixture, ['summary'])
    expect(summary.status).toBe(0)
    expect(summary.stdout).toContain('restart-safe migration')
    expect(summary.stderr).toContain('may be removed')
    expect(existsSync(receipt)).toBe(true)

    const sqlite = new Database(canonical, { readonly: true })
    const lineage = sqlite
      .query(
        `SELECT source_kind, source_fingerprint
         FROM continuum_storage_lineage
         WHERE source_kind = 'legacy'`,
      )
      .get() as {
      source_kind: string
      source_fingerprint: string
    } | null
    sqlite.close()
    expect(lineage?.source_kind).toBe('legacy')
    expect(lineage?.source_fingerprint).toHaveLength(64)
  })

  test('upgrades path-hash canonical storage once without overwriting it', async () => {
    const fixture = await legacyFixture()
    rmSync(fixture.legacyDb)
    const oldCanonical = pathHashCanonicalDbPath(
      fixture.workspace,
      fixture.dataHome,
    )
    mkdirSync(dirname(oldCanonical), { recursive: true })
    await migrateDb(oldCanonical)
    const old = new Database(oldCanonical)
    insertMemory(old, 'old-canonical', 'path hash data')
    old.close()

    const upgraded = cli(fixture, [
      'memory',
      'append',
      'agent',
      'stable-only write',
    ])
    expect(upgraded.status).toBe(0)
    const stableCanonical = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    expect(stableCanonical).not.toBe(oldCanonical)
    expect(memoryContents(stableCanonical)).toContain('path hash data')
    expect(memoryContents(stableCanonical)).toContain('stable-only write')
    expect(memoryContents(oldCanonical)).toContain('path hash data')
    expect(memoryContents(oldCanonical)).not.toContain('stable-only write')

    const retried = cli(fixture, ['summary'])
    expect(retried.status).toBe(0)
    expect(retried.stdout).toContain('path hash data')
    expect(
      canonicalDbFilePath(fixture.workspace, { dataHome: fixture.dataHome }),
    ).toBe(stableCanonical)
  })

  test('upgrades a path-hash receipt into embedded legacy lineage', async () => {
    const fixture = await legacyFixture()
    const legacy = new Database(fixture.legacyDb)
    insertMemory(legacy, 'legacy-receipt', 'legacy receipt proof')
    legacy.close()
    const source = readDatabaseSnapshot(fixture.legacyDb)

    const oldCanonical = pathHashCanonicalDbPath(
      fixture.workspace,
      fixture.dataHome,
    )
    publishDatabaseSnapshot(oldCanonical, source)
    const old = new Database(oldCanonical)
    insertMemory(old, 'canonical-newer', 'newer canonical write')
    old.close()
    const oldDestination = readDatabaseSnapshot(oldCanonical)
    writeFileSync(
      join(dirname(oldCanonical), 'legacy-migration-receipt.json'),
      `${JSON.stringify(
        {
          version: 1,
          projectId: createHash('sha256')
            .update(fixture.workspace)
            .digest('hex'),
          workspacePath: fixture.workspace,
          sourcePath: fixture.legacyDb,
          destinationPath: oldCanonical,
          sourceFingerprint: source.fingerprint,
          destinationFingerprint: oldDestination.fingerprint,
          migratedAt: new Date().toISOString(),
          method: 'sqlite-serialize-snapshot',
        },
        null,
        2,
      )}\n`,
    )

    const summary = cli(fixture, ['summary'])
    expect(summary.status).toBe(0)
    expect(summary.stdout).toContain('legacy receipt proof')
    expect(summary.stdout).toContain('newer canonical write')
    expect(summary.stderr).toContain('may be removed')

    const stableCanonical = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    expect(memoryContents(stableCanonical)).toContain('newer canonical write')
    expect(memoryContents(oldCanonical)).toContain('newer canonical write')
    const stableReceipt = JSON.parse(
      readFileSync(
        join(dirname(stableCanonical), 'legacy-migration-receipt.json'),
        'utf8',
      ),
    ) as { version: number }
    expect(stableReceipt.version).toBe(2)
  })

  test('keeps canonical task and memory data visible after workspace rename', async () => {
    const fixture = await legacyFixture()
    const legacy = new Database(fixture.legacyDb)
    insertTask(legacy, 'rename-task', 'Rename-safe task')
    insertMemory(legacy, 'rename-memory', 'rename-safe memory')
    legacy.close()
    expect(cli(fixture, ['init']).status).toBe(0)
    const before = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })

    const renamedWorkspace = join(fixture.root, 'renamed-workspace')
    renameSync(fixture.workspace, renamedWorkspace)
    fixture.workspace = renamedWorkspace
    fixture.legacyDb = join(renamedWorkspace, '.continuum', 'continuum.db')

    const after = canonicalDbFilePath(renamedWorkspace, {
      dataHome: fixture.dataHome,
    })
    expect(after).toBe(before)
    const summary = cli(fixture, ['summary'])
    expect(summary.status).toBe(0)
    expect(summary.stdout).toContain('Rename-safe task')
    expect(summary.stdout).toContain('rename-safe memory')
  })
})

type Fixture = {
  root: string
  workspace: string
  dataHome: string
  home: string
  legacyDb: string
}

function pathHashCanonicalDbPath(workspace: string, dataHome: string): string {
  const id = createHash('sha256').update(workspace).digest('hex')
  return join(dataHome, 'continuum', 'projects', id, 'continuum.db')
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
