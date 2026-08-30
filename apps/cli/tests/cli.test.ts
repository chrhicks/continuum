import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { getGuide } from '@continuum/core'

const repoRoot = join(import.meta.dir, '..', '..', '..')
const continuumBin = join(repoRoot, 'apps', 'cli', 'src', 'index.ts')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('CLI and MCP adapter behavior', () => {
  test('returns the core guide through the CLI and a real MCP stdio server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-guide-'))
    const dataDir = join(root, 'data-that-must-not-be-created')
    temporaryRoots.push(root)
    const env = processEnvironment({ CONTINUUM_DATA_DIR: dataDir })

    const cli = Bun.spawn([process.execPath, continuumBin, 'guide'], {
      cwd: repoRoot,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [cliOutput, cliError, cliExitCode] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ])

    expect(cliExitCode).toBe(0)
    expect(cliError).toBe('')
    expect(JSON.parse(cliOutput)).toEqual(getGuide())

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [continuumBin, 'mcp'],
      cwd: repoRoot,
      env,
      stderr: 'pipe',
    })
    const client = new Client({ name: 'continuum-test', version: '1.0.0' })
    await client.connect(transport)

    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'continuum_guide',
        'continuum_summary',
        'continuum_memory_record',
        'continuum_memory_search',
        'continuum_memory_get',
      ])
      expect(tools.tools[0]?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })

      const result = await client.callTool({
        name: 'continuum_guide',
        arguments: {},
      })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual(getGuide())
    } finally {
      await client.close()
    }

    expect(existsSync(dataDir)).toBe(false)
  }, 20_000)

  test('closes stdio memory storage cleanly when the client ends stdin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-stdio-memory-'))
    const dataDirectory = join(root, 'data')
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    temporaryRoots.push(root)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [continuumBin, 'mcp'],
      cwd: repoRoot,
      env: processEnvironment({ CONTINUUM_DATA_DIR: dataDirectory }),
      stderr: 'pipe',
    })
    const stderrChunks: string[] = []
    transport.stderr?.on('data', (chunk) => stderrChunks.push(String(chunk)))
    const client = new Client({ name: 'continuum-test', version: '1.0.0' })

    try {
      await client.connect(transport)
      const result = await client.callTool({
        name: 'continuum_memory_record',
        arguments: {
          workspace,
          content: 'Real stdio lifecycle evidence.',
        },
      })
      expect(result.isError).not.toBe(true)
      expect(hasSidecars(dataDirectory)).toBe(true)
    } finally {
      await client.close()
    }

    expect(existsSync(join(dataDirectory, 'continuum.db'))).toBe(true)
    expect(existsSync(join(dataDirectory, 'continuum.db-wal'))).toBe(false)
    expect(existsSync(join(dataDirectory, 'continuum.db-shm'))).toBe(false)
    expect(stderrChunks.join('')).toBe('')
  }, 20_000)

  test('keeps Commander help human-readable without reporting an error', async () => {
    const cli = Bun.spawn([process.execPath, continuumBin, '--help'], {
      cwd: repoRoot,
      env: processEnvironment({}),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [cliOutput, cliError, cliExitCode] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ])

    expect(cliExitCode).toBe(0)
    expect(cliOutput).toContain('Usage: continuum')
    expect(cliError).toBe('')
  })

  test('rejects a missing command with an actionable structured failure', async () => {
    const cli = Bun.spawn([process.execPath, continuumBin], {
      cwd: repoRoot,
      env: processEnvironment({}),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [cliOutput, cliError, cliExitCode] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ])

    expect(cliExitCode).toBe(1)
    expect(cliOutput).toBe('')
    expect(JSON.parse(cliError)).toEqual({
      error: {
        code: 'CLI_ERROR',
        operation: 'cli',
        message: 'A command is required; use --help for available commands',
      },
    })
  })

  test('writes structured CLI failures to stderr', async () => {
    const cli = Bun.spawn([process.execPath, continuumBin, 'not-a-command'], {
      cwd: repoRoot,
      env: processEnvironment({}),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [cliOutput, cliError, cliExitCode] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ])

    expect(cliExitCode).toBe(1)
    expect(cliOutput).toBe('')
    expect(JSON.parse(cliError)).toEqual({
      error: {
        code: 'CLI_ERROR',
        operation: 'cli',
        message: "error: unknown command 'not-a-command'",
      },
    })
  })
})

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
