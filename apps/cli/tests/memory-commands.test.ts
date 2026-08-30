import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContinuum } from '@continuum/core'

const repoRoot = join(import.meta.dir, '..', '..', '..')
const continuumBin = join(repoRoot, 'apps', 'cli', 'src', 'index.ts')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('CLI memory command parity', () => {
  test('advertises exactly the approved command surface without opening storage', async () => {
    const context = cliContext('help')
    const result = await executeCli(['--help'], context)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(commandNames(result.stdout)).toEqual([
      'guide',
      'summary',
      'record',
      'search',
      'get',
      'mcp',
    ])
    expect(result.stdout).toContain('Durable workspace memory')
    expect(existsSync(context.dataDirectory)).toBe(false)

    const version = await executeCli(['--version'], context)
    expect(version).toEqual({ exitCode: 0, stdout: '0.2.0\n', stderr: '' })

    for (const command of ['summary', 'record', 'search', 'get']) {
      const help = await executeCli([command, '--help'], context)
      expect(help.exitCode).toBe(0)
      expect(help.stderr).toBe('')
      expect(help.stdout).toContain('--cwd <path>')
    }
    expect(existsSync(context.dataDirectory)).toBe(false)
  })

  test('uses default and relative cwd and returns default and custom summary pages', async () => {
    const context = cliContext('summary')
    const empty = await executeCli(['summary'], {
      ...context,
      workingDirectory: context.workspace,
    })
    expectSuccess(empty)
    expect(JSON.parse(empty.stdout)).toEqual({
      workspace: {
        identity: { kind: 'path', value: context.workspace },
        aliases: [{ kind: 'path', value: context.workspace }],
      },
      records: [],
      hasMore: false,
      nextCursor: null,
    })

    const continuum = createContinuum({ dataDirectory: context.dataDirectory })
    for (let index = 0; index < 11; index += 1) {
      continuum.record({
        workspace: context.workspace,
        content: `Summary evidence ${index}`,
      })
    }
    continuum.close()

    const defaultPage = await executeCli(
      ['summary', '--cwd', 'workspace'],
      context,
    )
    expectSuccess(defaultPage)
    const defaultData = JSON.parse(defaultPage.stdout) as {
      records: unknown[]
      hasMore: boolean
      nextCursor: string
    }
    expect(defaultData.records).toHaveLength(10)
    expect(defaultData.hasMore).toBe(true)
    expect(typeof defaultData.nextCursor).toBe('string')

    const customPage = await executeCli(
      ['summary', '--cwd', context.workspace, '--limit', '3'],
      context,
    )
    expectSuccess(customPage)
    expect(JSON.parse(customPage.stdout)).toMatchObject({
      records: expect.any(Array),
      hasMore: true,
      nextCursor: expect.any(String),
    })
    expect(
      (JSON.parse(customPage.stdout) as { records: unknown[] }).records,
    ).toHaveLength(3)
    expect(hasSidecars(context.dataDirectory)).toBe(false)
  })

  test('records, searches, paginates, and gets complete persisted memory', async () => {
    const context = cliContext('memory')
    const exactContent = '  Exact CLI anchor evidence.\n'
    const oldResult = await executeCli(
      [
        'record',
        '--cwd',
        context.workspace,
        '--content',
        exactContent,
        '--tag',
        'CLI',
        '--tag',
        'history',
        '--tag',
        'cli',
      ],
      context,
    )
    expectSuccess(oldResult)
    const old = JSON.parse(oldResult.stdout) as MemoryRecord
    expect(old).toMatchObject({
      kind: 'observation',
      content: exactContent,
      tags: ['cli', 'history'],
      supersedes: [],
      supersededBy: [],
    })

    const replacementResult = await executeCli(
      [
        'record',
        '--cwd',
        'workspace',
        '--content',
        'Current CLI anchor evidence.',
        '--kind',
        'Decision',
        '--tag',
        'CLI',
        '--tag',
        'current',
        '--supersedes',
        old.id,
        '--supersedes',
        old.id,
      ],
      context,
    )
    expectSuccess(replacementResult)
    const replacement = JSON.parse(replacementResult.stdout) as MemoryRecord
    expect(replacement).toMatchObject({
      kind: 'decision',
      tags: ['cli', 'current'],
      supersedes: [old.id],
      supersededBy: [],
    })

    const otherResult = await executeCli(
      [
        'record',
        '--cwd',
        context.workspace,
        '--content',
        'Additional CLI anchor evidence.',
        '--tag',
        'cli',
        '--tag',
        'current',
      ],
      context,
    )
    expectSuccess(otherResult)
    const other = JSON.parse(otherResult.stdout) as MemoryRecord

    const browse = await executeCli(
      ['search', '--cwd', context.workspace],
      context,
    )
    expectSuccess(browse)
    const browseIds = recordIds(browse)
    expect(new Set(browseIds)).toEqual(new Set([replacement.id, other.id]))
    expect(browseIds).not.toContain(old.id)

    const filtered = await executeCli(
      [
        'search',
        '--cwd',
        context.workspace,
        '--query',
        'CLI anchor',
        '--tag',
        'CLI',
        '--kind',
        'DECISION',
      ],
      context,
    )
    expectSuccess(filtered)
    expect(recordIds(filtered)).toEqual([replacement.id])

    const history = await executeCli(
      [
        'search',
        '--cwd',
        context.workspace,
        '--query',
        'CLI anchor',
        '--tag',
        'cli',
        '--kind',
        'observation',
        '--kind',
        'decision',
        '--include-history',
      ],
      context,
    )
    expectSuccess(history)
    expect(new Set(recordIds(history))).toEqual(
      new Set([old.id, replacement.id, other.id]),
    )

    const firstRelevancePage = await executeCli(
      [
        'search',
        '--cwd',
        context.workspace,
        '--query',
        'CLI anchor',
        '--tag',
        'cli',
        '--limit',
        '1',
      ],
      context,
    )
    expectSuccess(firstRelevancePage)
    const firstRelevanceData = JSON.parse(
      firstRelevancePage.stdout,
    ) as SearchResult
    expect(firstRelevanceData.hasMore).toBe(true)
    const nextRelevancePage = await executeCli(
      [
        'search',
        '--cwd',
        context.workspace,
        '--query',
        'cli anchor',
        '--tag',
        'CLI',
        '--limit',
        '1',
        '--cursor',
        firstRelevanceData.nextCursor as string,
      ],
      context,
    )
    expectSuccess(nextRelevancePage)
    expect(
      new Set([
        ...recordIds(firstRelevancePage),
        ...recordIds(nextRelevancePage),
      ]),
    ).toEqual(new Set([replacement.id, other.id]))

    const firstPage = await executeCli(
      ['summary', '--cwd', context.workspace, '--limit', '1'],
      context,
    )
    expectSuccess(firstPage)
    const firstPageData = JSON.parse(firstPage.stdout) as SearchResult
    expect(firstPageData.records).toHaveLength(1)
    expect(firstPageData.hasMore).toBe(true)
    expect(typeof firstPageData.nextCursor).toBe('string')
    const nextPage = await executeCli(
      [
        'search',
        '--cwd',
        context.workspace,
        '--limit',
        '1',
        '--cursor',
        firstPageData.nextCursor as string,
      ],
      context,
    )
    expectSuccess(nextPage)
    expect((JSON.parse(nextPage.stdout) as SearchResult).records).toHaveLength(
      1,
    )
    expect(recordIds(nextPage)).not.toEqual(recordIds(firstPage))

    const exact = await executeCli(
      ['get', '--cwd', context.workspace, replacement.id, 'missing-id', old.id],
      context,
    )
    expectSuccess(exact)
    const exactData = JSON.parse(exact.stdout) as {
      records: MemoryRecord[]
      missingIds: string[]
    }
    expect(exactData.records.map(({ id }) => id)).toEqual([
      replacement.id,
      old.id,
    ])
    expect(exactData.records[0]?.supersedes).toEqual([old.id])
    expect(exactData.records[1]?.supersededBy).toEqual([replacement.id])
    expect(exactData.missingIds).toEqual(['missing-id'])

    const continuum = createContinuum({ dataDirectory: context.dataDirectory })
    expect(
      continuum.get({
        workspace: context.workspace,
        ids: [replacement.id, 'missing-id', old.id],
      }),
    ).toEqual(exactData)
    continuum.close()
    expect(hasSidecars(context.dataDirectory)).toBe(false)
  })

  test('preserves core failures without leaking content and rejects CLI-only syntax', async () => {
    const context = cliContext('errors')

    for (const limit of ['not-a-number', '1.5', '0', '101']) {
      const invalidLimit = await executeCli(
        ['summary', '--cwd', context.workspace, '--limit', limit],
        context,
      )
      expectFailure(invalidLimit, {
        code: 'VALIDATION_ERROR',
        operation: 'summarize workspace',
        message: 'Limit must be an integer between 1 and 100.',
      })
    }

    const privateContent = 'PRIVATE CLI CONTENT MUST NOT LEAK'
    const emptyContent = await executeCli(
      ['record', '--cwd', context.workspace, '--content', '   '],
      context,
    )
    expectFailure(emptyContent, {
      code: 'VALIDATION_ERROR',
      operation: 'record memory',
      message: 'Memory content must not be empty.',
    })

    const missingRecord = await executeCli(
      [
        'record',
        '--cwd',
        context.workspace,
        '--content',
        privateContent,
        '--supersedes',
        'missing-record',
      ],
      context,
    )
    expectFailure(missingRecord, {
      code: 'NOT_FOUND',
      operation: 'record memory',
      message: 'A superseded memory record was not found.',
      context: { recordId: 'missing-record' },
    })
    expect(missingRecord.stderr).not.toContain(privateContent)

    const missingPath = join(context.root, 'missing-workspace')
    const invalidPath = await executeCli(
      ['summary', '--cwd', missingPath],
      context,
    )
    expectFailure(invalidPath, {
      code: 'WORKSPACE_ERROR',
      operation: 'resolve workspace',
      message: 'Workspace path must identify an existing directory.',
      context: { workspacePath: missingPath },
    })

    for (const args of [
      ['record', '--content', 'No privileged IDs.', '--id', 'caller-id'],
      [
        'record',
        '--content',
        'No privileged timestamps.',
        '--createdAt',
        '2026-01-01T00:00:00.000Z',
      ],
      ['record'],
      ['get'],
      ['search', '--unknown'],
      ['not-a-command'],
    ]) {
      const result = await executeCli(args, context)
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: { code: 'CLI_ERROR', operation: 'cli' },
      })
    }

    expect(existsSync(context.dataDirectory)).toBe(true)
    expect(hasSidecars(context.dataDirectory)).toBe(false)
  })
})

type CliContext = {
  root: string
  workspace: string
  dataDirectory: string
  workingDirectory: string
}

type CliExecution = {
  exitCode: number
  stdout: string
  stderr: string
}

type MemoryRecord = {
  id: string
  kind: string
  content: string
  tags: string[]
  createdAt: string
  supersedes: string[]
  supersededBy: string[]
}

type SearchResult = {
  records: MemoryRecord[]
  hasMore: boolean
  nextCursor: string | null
}

function cliContext(name: string): CliContext {
  const root = mkdtempSync(join(tmpdir(), `continuum-cli-${name}-`))
  const workspace = join(root, 'workspace')
  const dataDirectory = join(root, 'data')
  mkdirSync(workspace)
  temporaryRoots.push(root)
  return { root, workspace, dataDirectory, workingDirectory: root }
}

async function executeCli(
  args: string[],
  context: CliContext,
): Promise<CliExecution> {
  const child = Bun.spawn([process.execPath, continuumBin, ...args], {
    cwd: context.workingDirectory,
    env: processEnvironment({ CONTINUUM_DATA_DIR: context.dataDirectory }),
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

function expectSuccess(result: CliExecution): void {
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  expect(result.stdout.endsWith('\n')).toBe(true)
  expect(result.stdout.split('\n')).toHaveLength(2)
  expect(() => JSON.parse(result.stdout)).not.toThrow()
}

function expectFailure(
  result: CliExecution,
  error: Record<string, unknown>,
): void {
  expect(result.exitCode).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr.endsWith('\n')).toBe(true)
  expect(result.stderr.split('\n')).toHaveLength(2)
  expect(JSON.parse(result.stderr)).toEqual({ error })
}

function recordIds(result: CliExecution): string[] {
  return (JSON.parse(result.stdout) as SearchResult).records.map(({ id }) => id)
}

function commandNames(help: string): string[] {
  const lines = help.split('\n')
  const commands = lines.slice(
    lines.findIndex((line) => line === 'Commands:') + 1,
  )
  return commands
    .map((line) => line.match(/^  ([a-z][a-z-]*)(?: |$)/)?.[1])
    .filter((name): name is string => name !== undefined)
}

function hasSidecars(dataDirectory: string): boolean {
  return (
    existsSync(join(dataDirectory, 'continuum.db-wal')) ||
    existsSync(join(dataDirectory, 'continuum.db-shm'))
  )
}

function processEnvironment(
  overrides: Record<string, string>,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    ...overrides,
  }
}
