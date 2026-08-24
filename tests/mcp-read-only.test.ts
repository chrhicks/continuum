import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { canonicalDbFilePath } from '../src/db/paths'

const repoRoot = process.cwd()
const continuumBin = join(repoRoot, 'bin', 'continuum')
const migrationsFolder = join(repoRoot, 'drizzle')
const roots: string[] = []

const readToolNames = [
  'continuum_memory_search',
  'continuum_recall_status',
  'continuum_runtime',
  'continuum_summary',
  'continuum_task_get',
  'continuum_task_graph',
  'continuum_task_list',
  'continuum_task_steps_list',
  'continuum_task_validate',
]

const storageReadCalls = (workspace: string, taskId: string) => [
  { name: 'continuum_summary', arguments: { workspace } },
  {
    name: 'continuum_memory_search',
    arguments: { workspace, query: 'readonly' },
  },
  { name: 'continuum_recall_status', arguments: { workspace } },
  { name: 'continuum_task_list', arguments: { workspace } },
  {
    name: 'continuum_task_get',
    arguments: {
      workspace,
      id: taskId,
      expand: ['parent', 'children', 'blockers'],
    },
  },
  {
    name: 'continuum_task_validate',
    arguments: { workspace, id: taskId, transition: 'completed' },
  },
  {
    name: 'continuum_task_graph',
    arguments: { workspace, id: taskId, query: 'children' },
  },
  {
    name: 'continuum_task_steps_list',
    arguments: { workspace, id: taskId },
  },
]

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('MCP read-only storage contract', () => {
  test('all advertised read tools preserve current storage bytes and metadata', async () => {
    const fixture = makeFixture('current')
    const client = await connect(fixture)
    try {
      const tools = await client.listTools()
      expect(
        tools.tools
          .filter((tool) => tool.annotations?.readOnlyHint)
          .map((tool) => tool.name)
          .sort(),
      ).toEqual(readToolNames)
      expect(
        tools.tools
          .filter((tool) => !readToolNames.includes(tool.name))
          .every((tool) => tool.annotations?.readOnlyHint === false),
      ).toBe(true)

      await expectSuccess(client, 'continuum_init', {
        workspace: fixture.workspace,
      })
      await expectSuccess(client, 'continuum_memory_append', {
        workspace: fixture.workspace,
        kind: 'agent',
        content: 'readonly storage evidence',
        tags: ['readonly'],
      })
      const created = await expectSuccess(client, 'continuum_task_create', {
        workspace: fixture.workspace,
        task: {
          title: 'Read-only task',
          type: 'chore',
          description: 'Exercise every read-only task tool.',
          plan: 'Read without writes.',
        },
      })
      const taskId = (created.structuredContent as { task: { id: string } })
        .task.id
      const before = snapshotFixture(fixture)

      const runtime = await client.callTool({
        name: 'continuum_runtime',
        arguments: { workspace: fixture.workspace },
      })
      expect(runtime.isError).not.toBe(true)
      for (const call of storageReadCalls(fixture.workspace, taskId)) {
        const result = await client.callTool(call)
        expect(result.isError, call.name).not.toBe(true)
      }

      expect(snapshotFixture(fixture)).toEqual(before)
    } finally {
      await client.close()
    }
  }, 20_000)

  test('migration-pending storage fails closed without changing any file', async () => {
    const fixture = makeFixture('migration-pending')
    const initializer = await connect(fixture)
    await expectSuccess(initializer, 'continuum_init', {
      workspace: fixture.workspace,
    })
    await initializer.close()

    const dbPath = canonicalDbFilePath(fixture.workspace, {
      dataHome: fixture.dataHome,
    })
    rmSync(dbPath)
    createMigrationPendingDatabase(dbPath)
    const before = snapshotFixture(fixture)
    const client = await connect(fixture)
    try {
      for (const call of storageReadCalls(fixture.workspace, 'tkt-missing')) {
        const result = await client.callTool(call)
        expect(result.isError, call.name).toBe(true)
        expect(result.content[0]).toMatchObject({
          type: 'text',
          text: expect.stringContaining('requires migration'),
        })
      }
      expect(snapshotFixture(fixture)).toEqual(before)
    } finally {
      await client.close()
    }
  }, 20_000)

  test('runtime inspection and failed reads do not initialize missing storage', async () => {
    const fixture = makeFixture('uninitialized')
    const before = snapshotFixture(fixture)
    const client = await connect(fixture)
    try {
      const runtime = await client.callTool({
        name: 'continuum_runtime',
        arguments: { workspace: fixture.workspace },
      })
      expect(runtime.isError).not.toBe(true)
      for (const call of storageReadCalls(fixture.workspace, 'tkt-missing')) {
        const result = await client.callTool(call)
        expect(result.isError, call.name).toBe(true)
        expect(result.content[0]).toMatchObject({
          type: 'text',
          text: expect.stringContaining('not initialized'),
        })
      }
      expect(snapshotFixture(fixture)).toEqual(before)
    } finally {
      await client.close()
    }
  }, 20_000)

  test('legacy workspace storage is not adopted or migrated by reads', async () => {
    const fixture = makeFixture('legacy')
    mkdirSync(join(fixture.workspace, '.continuum'), { recursive: true })
    writeFileSync(
      join(fixture.workspace, '.continuum', 'continuum.db'),
      'legacy storage must remain untouched',
    )
    const before = snapshotFixture(fixture)
    const client = await connect(fixture)
    try {
      for (const call of storageReadCalls(fixture.workspace, 'tkt-missing')) {
        const result = await client.callTool(call)
        expect(result.isError, call.name).toBe(true)
        expect(result.content[0]).toMatchObject({
          type: 'text',
          text: expect.stringContaining(
            'workspace storage metadata requires initialization',
          ),
        })
      }
      expect(snapshotFixture(fixture)).toEqual(before)
    } finally {
      await client.close()
    }
  }, 20_000)

  test('read tools do not recreate a missing canonical database', async () => {
    const fixture = makeFixture('missing-database')
    mkdirSync(join(fixture.workspace, '.continuum'), { recursive: true })
    writeFileSync(
      join(fixture.workspace, '.continuum', 'workspace.json'),
      '{"version":1,"id":"00000000-0000-4000-8000-000000000001"}\n',
    )
    const before = snapshotFixture(fixture)
    const client = await connect(fixture)
    try {
      for (const call of storageReadCalls(fixture.workspace, 'tkt-missing')) {
        const result = await client.callTool(call)
        expect(result.isError, call.name).toBe(true)
        expect(result.content[0]).toMatchObject({
          type: 'text',
          text: expect.stringContaining('database is missing'),
        })
      }
      expect(snapshotFixture(fixture)).toEqual(before)
    } finally {
      await client.close()
    }
  }, 20_000)
})

type Fixture = {
  root: string
  workspace: string
  home: string
  dataHome: string
}

function makeFixture(name: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), `continuum-mcp-read-${name}-`))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const home = join(root, 'home')
  const dataHome = join(root, 'data')
  mkdirSync(join(workspace, '.git'), { recursive: true })
  mkdirSync(home, { recursive: true })
  mkdirSync(dataHome, { recursive: true })
  return { root, workspace, home, dataHome }
}

async function connect(fixture: Fixture): Promise<Client> {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      HOME: fixture.home,
      XDG_DATA_HOME: fixture.dataHome,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', continuumBin, 'mcp'],
    cwd: repoRoot,
    env,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'continuum-read-test', version: '1.0.0' })
  await client.connect(transport)
  return client
}

async function expectSuccess(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) {
    throw new Error(`${name} failed: ${JSON.stringify(result.content)}`)
  }
  return result
}

function createMigrationPendingDatabase(dbPath: string): void {
  mkdirSync(join(dbPath, '..'), { recursive: true })
  const sqlite = new Database(dbPath)
  const migrations = readMigrationFiles({ migrationsFolder })
  sqlite.exec(
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
  )
  for (const migration of migrations.slice(0, -1)) {
    for (const statement of migration.sql) sqlite.run(statement)
    sqlite
      .query(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      )
      .run(migration.hash, migration.folderMillis)
  }
  sqlite.close()
}

type SnapshotEntry = {
  type: 'directory' | 'file'
  bytes?: string
  mtimeMs: number
}

function snapshotFixture(fixture: Fixture): Record<string, SnapshotEntry> {
  return snapshotTrees([
    ['workspace', fixture.workspace],
    ['data', fixture.dataHome],
  ])
}

function snapshotTrees(
  rootsToSnapshot: Array<[string, string]>,
): Record<string, SnapshotEntry> {
  const snapshot: Record<string, SnapshotEntry> = {}
  for (const [label, root] of rootsToSnapshot) {
    walk(root, (path) => {
      const stat = statSync(path)
      const key = join(label, relative(root, path))
      snapshot[key] = stat.isDirectory()
        ? { type: 'directory', mtimeMs: stat.mtimeMs }
        : {
            type: 'file',
            bytes: readFileSync(path).toString('base64'),
            mtimeMs: stat.mtimeMs,
          }
    })
  }
  return snapshot
}

function walk(root: string, visit: (path: string) => void): void {
  if (!existsSync(root)) return
  visit(root)
  if (!statSync(root).isDirectory()) return
  for (const entry of readdirSync(root)) walk(join(root, entry), visit)
}
