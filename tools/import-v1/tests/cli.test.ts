import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..', '..', '..')
const executable = join(repositoryRoot, 'tools', 'import-v1', 'src', 'index.ts')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('legacy v1 importer CLI', () => {
  test('imports through relative paths and returns one compact JSON result', async () => {
    const context = cliContext('success')
    createSource(context.source, [
      {
        sequence: 1,
        id: 'cli-record',
        content: 'CLI synthetic evidence.',
        metadata: JSON.stringify({ tags: ['CLI'] }),
      },
    ])

    const first = await runImporter(
      [
        '--source',
        'legacy.db',
        '--workspace',
        'workspace',
        '--data-dir',
        'target-data',
      ],
      context.root,
    )
    expect(first.exitCode).toBe(0)
    expect(first.stderr).toBe('')
    expect(first.stdout.endsWith('\n')).toBe(true)
    expect(first.stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(first.stdout)).toEqual({
      source: context.source,
      workspace: context.workspace,
      processed: 1,
    })
    expect(existsSync(join(context.dataDirectory, 'continuum.db'))).toBe(true)
    expect(targetSidecars(context.dataDirectory)).toEqual([])
    expect(sourceSidecars(context.source)).toEqual([])

    const second = await runImporter(
      ['--source', context.source, '--workspace', context.workspace],
      context.root,
      { CONTINUUM_DATA_DIR: context.dataDirectory },
    )
    expect(second.exitCode).toBe(0)
    expect(JSON.parse(second.stdout).processed).toBe(1)
    expect(second.stderr).toBe('')
    expect(countTargetRecords(context.dataDirectory)).toBe(1)
  })

  test('returns safe structured validation failures without creating target storage', async () => {
    const context = cliContext('failure')
    const secret = 'SYNTHETIC PRIVATE CONTENT MUST NOT LEAK'
    createSource(context.source, [
      {
        sequence: 1,
        id: 'invalid-record',
        content: secret,
        metadata: '{invalid private metadata',
      },
    ])

    const result = await runImporter(
      [
        '--source',
        context.source,
        '--workspace',
        context.workspace,
        '--data-dir',
        context.dataDirectory,
      ],
      context.root,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.endsWith('\n')).toBe(true)
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        operation: 'import v1',
        message: 'A legacy journal record has invalid metadata.',
        context: {
          sourcePath: context.source,
          field: 'metadata',
          sequence: '1',
        },
      },
    })
    expect(result.stderr).not.toContain(secret)
    expect(result.stderr).not.toContain('invalid private metadata')
    expect(existsSync(context.dataDirectory)).toBe(false)
    expect(sourceSidecars(context.source)).toEqual([])
  })

  test('rejects missing, duplicate, unknown, and positional arguments safely', async () => {
    const context = cliContext('arguments')
    createSource(context.source, [])
    const cases = [
      [],
      ['--source', context.source],
      ['--workspace', context.workspace],
      [
        '--source',
        context.source,
        '--source',
        context.source,
        '--workspace',
        context.workspace,
      ],
      ['--unknown', 'value'],
      ['positional'],
      ['--source', '--workspace', context.workspace],
    ]

    for (const arguments_ of cases) {
      const result = await runImporter(arguments_, context.root, {
        CONTINUUM_DATA_DIR: context.dataDirectory,
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          operation: 'import v1',
        },
      })
      expect(existsSync(context.dataDirectory)).toBe(false)
    }
  })
})

type CliContext = {
  root: string
  source: string
  workspace: string
  dataDirectory: string
}

function cliContext(name: string): CliContext {
  const root = mkdtempSync(join(tmpdir(), `continuum-import-cli-${name}-`))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  roots.push(root)
  return {
    root,
    source: join(root, 'legacy.db'),
    workspace,
    dataDirectory: join(root, 'target-data'),
  }
}

function createSource(
  path: string,
  rows: Array<{
    sequence: number
    id: string
    content: string
    metadata: string
  }>,
): void {
  const database = new Database(path, { create: true, strict: true })
  database.exec(`
    CREATE TABLE memory_journal_entries (
      sequence INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `)
  const insert = database.query(`
    INSERT INTO memory_journal_entries
      (sequence, id, kind, content, metadata, created_at)
    VALUES (?, ?, 'agent', ?, ?, '2026-01-01T00:00:00.000Z')
  `)
  for (const row of rows) {
    insert.run(row.sequence, row.id, row.content, row.metadata)
  }
  database.close()
}

async function runImporter(
  arguments_: string[],
  cwd: string,
  environment: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, executable, ...arguments_], {
    cwd,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      ...environment,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { exitCode, stdout, stderr }
}

function countTargetRecords(dataDirectory: string): number {
  const database = new Database(join(dataDirectory, 'continuum.db'), {
    readonly: true,
  })
  const row = database
    .query('SELECT count(*) AS count FROM memory_records')
    .get() as { count: number }
  database.close()
  return Number(row.count)
}

function sourceSidecars(path: string): string[] {
  return [`${path}-wal`, `${path}-shm`].filter(existsSync)
}

function targetSidecars(dataDirectory: string): string[] {
  const path = join(dataDirectory, 'continuum.db')
  return [`${path}-wal`, `${path}-shm`].filter(existsSync)
}
