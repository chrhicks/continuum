import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { createContinuumMcpServer } from '@continuum/mcp'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Continuum MCP tools', () => {
  test('advertises exactly the five strict structured tools with correct annotations', async () => {
    const context = await mcpContext('schemas')
    try {
      const listed = await context.client.listTools()
      expect(listed.tools.map(({ name }) => name)).toEqual([
        'continuum_guide',
        'continuum_summary',
        'continuum_memory_record',
        'continuum_memory_search',
        'continuum_memory_get',
      ])

      const tools = new Map(listed.tools.map((tool) => [tool.name, tool]))
      expectToolShape(
        tools.get('continuum_guide'),
        [],
        ['version', 'purpose', 'workflow', 'operations', 'recordKinds'],
      )
      expectToolShape(
        tools.get('continuum_summary'),
        ['workspace', 'limit'],
        ['workspace', 'records', 'hasMore', 'nextCursor'],
      )
      expectToolShape(
        tools.get('continuum_memory_record'),
        ['workspace', 'content', 'kind', 'tags', 'supersedes'],
        [
          'id',
          'kind',
          'content',
          'tags',
          'createdAt',
          'supersedes',
          'supersededBy',
        ],
      )
      expectToolShape(
        tools.get('continuum_memory_search'),
        [
          'workspace',
          'query',
          'tags',
          'kinds',
          'includeHistory',
          'limit',
          'cursor',
        ],
        ['records', 'hasMore', 'nextCursor'],
      )
      expectToolShape(
        tools.get('continuum_memory_get'),
        ['workspace', 'ids'],
        ['records', 'missingIds'],
      )

      expectAnnotations(tools.get('continuum_guide'), true, true)
      expectAnnotations(tools.get('continuum_summary'), false, true)
      expectAnnotations(tools.get('continuum_memory_record'), false, false)
      expectAnnotations(tools.get('continuum_memory_search'), true, true)
      expectAnnotations(tools.get('continuum_memory_get'), true, true)
      expect(listed.tools.every((tool) => Boolean(tool.description))).toBe(true)

      expect(
        schemaProperties(tools.get('continuum_summary')).limit,
      ).toMatchObject({ type: 'integer', minimum: 1, maximum: 100 })
      const searchProperties = schemaProperties(
        tools.get('continuum_memory_search'),
      )
      expect(searchProperties.query).toMatchObject({ maxLength: 2_000 })
      expect(searchProperties.tags).toMatchObject({ maxItems: 50 })
      expect(searchProperties.kinds).toMatchObject({ maxItems: 50 })
      expect(searchProperties.limit).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 100,
      })
      expect(searchProperties.cursor).toMatchObject({ maxLength: 4_096 })
      expect(
        schemaProperties(tools.get('continuum_memory_get')).ids,
      ).toMatchObject({ minItems: 1, maxItems: 100 })
    } finally {
      await context.close()
    }
  })

  test('keeps guide and tool discovery lazy and closes cleanly', async () => {
    const context = await mcpContext('guide-lazy', true)
    expect(existsSync(context.dataDirectory)).toBe(false)

    const guide = await call(context.client, 'continuum_guide', {})
    expect(guide.isError).not.toBe(true)
    expect(guide.structuredContent).toMatchObject({
      version: 1,
      purpose: expect.any(String),
    })
    expect(existsSync(context.dataDirectory)).toBe(false)

    await context.close()
    await context.server.close()
    expect(existsSync(context.dataDirectory)).toBe(false)
  })

  test('closes a partially started transport and permanently closes the owned core', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-mcp-connect-failure-'))
    temporaryRoots.push(root)
    const server = createContinuumMcpServer({
      dataDirectory: join(root, 'data'),
    })
    const transport = new FailingTransport()
    const connectionFailure = new Error('transport start failed')
    transport.startFailure = connectionFailure

    let caught: unknown
    try {
      await server.connect(transport)
    } catch (cause) {
      caught = cause
    }

    expect(caught).toBe(connectionFailure)
    expect(transport.closeCount).toBe(1)
    await expectRejected(server.connect(new FailingTransport()), 'closed')
    await server.close()
    await server.close()
    expect(transport.closeCount).toBe(1)
  })

  test('closes core storage when transport closes despite a replaced close observer', async () => {
    const context = await mcpContext('transport-close')
    let observedClose = 0
    try {
      await record(context, {
        workspace: context.workspace,
        content: 'Transport lifecycle evidence.',
      })
      expect(hasSidecars(context.dataDirectory)).toBe(true)
      context.server.server.onclose = () => {
        observedClose += 1
      }

      await context.client.close()

      expect(observedClose).toBe(1)
      expect(hasSidecars(context.dataDirectory)).toBe(false)
    } finally {
      await context.close()
    }
  })

  test('shares one isolated core across record, summary, search, and get', async () => {
    const context = await mcpContext('memory')
    try {
      const emptySummary = await call(context.client, 'continuum_summary', {
        workspace: context.workspace,
      })
      expect(emptySummary.isError).not.toBe(true)
      expect(emptySummary.structuredContent).toMatchObject({
        workspace: {
          identity: { kind: 'path', value: context.workspace },
          aliases: [{ kind: 'path', value: context.workspace }],
        },
        records: [],
        hasMore: false,
        nextCursor: null,
      })

      const old = await record(context, {
        workspace: context.workspace,
        content: '  Exact MCP anchor evidence.\n',
        tags: ['MCP', 'history'],
      })
      expect(old).toMatchObject({
        kind: 'observation',
        content: '  Exact MCP anchor evidence.\n',
        tags: ['history', 'mcp'],
        supersedes: [],
        supersededBy: [],
      })

      const replacement = await record(context, {
        workspace: context.workspace,
        content: 'Current MCP anchor evidence.',
        kind: 'Decision',
        tags: ['mcp', 'current'],
        supersedes: [old.id],
      })
      const other = await record(context, {
        workspace: context.workspace,
        content: 'Additional MCP anchor evidence.',
        tags: ['mcp', 'current'],
      })

      const summary = await call(context.client, 'continuum_summary', {
        workspace: context.workspace,
        limit: 1,
      })
      expect(summary.isError).not.toBe(true)
      const summaryData = summary.structuredContent as {
        records: Array<{ id: string }>
        hasMore: boolean
        nextCursor: string
      }
      expect(summaryData.records).toHaveLength(1)
      expect(summaryData.hasMore).toBe(true)
      expect(typeof summaryData.nextCursor).toBe('string')
      const summaryNext = await call(
        context.client,
        'continuum_memory_search',
        {
          workspace: context.workspace,
          limit: 1,
          cursor: summaryData.nextCursor,
        },
      )
      expect(summaryNext.isError).not.toBe(true)
      expect(
        (summaryNext.structuredContent as { records: Array<{ id: string }> })
          .records,
      ).toHaveLength(1)

      const firstPage = await call(context.client, 'continuum_memory_search', {
        workspace: context.workspace,
        query: 'MCP anchor',
        tags: ['MCP'],
        limit: 1,
      })
      expect(firstPage.isError).not.toBe(true)
      const firstPageData = firstPage.structuredContent as {
        records: Array<{ id: string }>
        hasMore: boolean
        nextCursor: string
      }
      expect(firstPageData.records).toHaveLength(1)
      expect(firstPageData.hasMore).toBe(true)

      const secondPage = await call(context.client, 'continuum_memory_search', {
        workspace: context.workspace,
        query: 'mcp anchor',
        tags: ['mcp'],
        limit: 1,
        cursor: firstPageData.nextCursor,
      })
      expect(secondPage.isError).not.toBe(true)
      const currentIds = [
        firstPageData.records[0]?.id,
        ...(
          secondPage.structuredContent as {
            records: Array<{ id: string }>
          }
        ).records.map(({ id }) => id),
      ]
      expect(new Set(currentIds)).toEqual(new Set([replacement.id, other.id]))
      expect(currentIds).not.toContain(old.id)

      const history = await call(context.client, 'continuum_memory_search', {
        workspace: context.workspace,
        query: 'mcp anchor',
        tags: ['mcp'],
        kinds: ['observation', 'decision'],
        includeHistory: true,
      })
      expect(history.isError).not.toBe(true)
      const historyIds = (
        history.structuredContent as { records: Array<{ id: string }> }
      ).records.map(({ id }) => id)
      expect(new Set(historyIds)).toEqual(
        new Set([old.id, replacement.id, other.id]),
      )

      const exact = await call(context.client, 'continuum_memory_get', {
        workspace: context.workspace,
        ids: [replacement.id, 'missing-id', old.id],
      })
      expect(exact.isError).not.toBe(true)
      const exactData = exact.structuredContent as {
        records: Array<{
          id: string
          supersedes: string[]
          supersededBy: string[]
        }>
        missingIds: string[]
      }
      expect(exactData.records.map(({ id }) => id)).toEqual([
        replacement.id,
        old.id,
      ])
      expect(exactData.records[0]?.supersedes).toEqual([old.id])
      expect(exactData.records[1]?.supersededBy).toEqual([replacement.id])
      expect(exactData.missingIds).toEqual(['missing-id'])
    } finally {
      await context.close()
      expect(existsSync(join(context.dataDirectory, 'continuum.db-wal'))).toBe(
        false,
      )
      expect(existsSync(join(context.dataDirectory, 'continuum.db-shm'))).toBe(
        false,
      )
    }
  })

  test('rejects privileged or malformed input and maps safe core failures', async () => {
    const context = await mcpContext('errors')
    try {
      await context.client.listTools()

      for (const arguments_ of [
        {
          workspace: context.workspace,
          content: 'Must reject privileged ID.',
          id: 'caller-owned-id',
        },
        {
          workspace: context.workspace,
          content: 'Must reject privileged time.',
          createdAt: '2026-08-21T20:00:00.000Z',
        },
        { workspace: context.workspace, content: 42 },
      ]) {
        const result = await call(
          context.client,
          'continuum_memory_record',
          arguments_,
        )
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toBeUndefined()
        expect(textContent(result)).toContain('Input validation error')
      }

      const privateContent = 'PRIVATE CONTENT MUST NOT APPEAR IN THE FAILURE'
      const missing = await call(context.client, 'continuum_memory_record', {
        workspace: context.workspace,
        content: privateContent,
        supersedes: ['missing-record'],
      })
      expect(missing.isError).toBe(true)
      expect(missing.structuredContent).toBeUndefined()
      expect(JSON.parse(textContent(missing))).toEqual({
        error: {
          code: 'NOT_FOUND',
          operation: 'record memory',
          message: 'A superseded memory record was not found.',
          context: { recordId: 'missing-record' },
        },
      })
      expect(textContent(missing)).not.toContain(privateContent)
    } finally {
      await context.close()
    }
  })
})

class FailingTransport implements Transport {
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']
  startFailure: Error = new Error('transport start failed')
  closeCount = 0

  async start(): Promise<void> {
    throw this.startFailure
  }

  async send(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCount += 1
    this.onclose?.()
  }
}

async function expectRejected(
  promise: Promise<unknown>,
  messagePart: string,
): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (cause) {
    caught = cause
  }
  expect(caught).toBeInstanceOf(Error)
  expect((caught as Error).message).toContain(messagePart)
}

function hasSidecars(dataDirectory: string): boolean {
  return (
    existsSync(join(dataDirectory, 'continuum.db-wal')) ||
    existsSync(join(dataDirectory, 'continuum.db-shm'))
  )
}

async function mcpContext(name: string, dataMustRemainAbsent = false) {
  const root = mkdtempSync(join(tmpdir(), `continuum-mcp-${name}-`))
  const dataDirectory = join(root, 'data')
  const workspace = join(root, 'workspace')
  temporaryRoots.push(root)
  if (!dataMustRemainAbsent) mkdirSync(workspace)

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const server = createContinuumMcpServer({ dataDirectory })
  const client = new Client({ name: 'continuum-mcp-test', version: '1.0.0' })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  let closed = false

  return {
    root,
    dataDirectory,
    workspace,
    server,
    client,
    async close() {
      if (closed) return
      closed = true
      await client.close()
      await server.close()
    },
  }
}

async function call(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({
    name,
    arguments: arguments_,
  })) as CallToolResult
}

async function record(
  context: Awaited<ReturnType<typeof mcpContext>>,
  arguments_: Record<string, unknown>,
): Promise<{
  id: string
  kind: string
  content: string
  tags: string[]
  supersedes: string[]
  supersededBy: string[]
}> {
  const result = await call(
    context.client,
    'continuum_memory_record',
    arguments_,
  )
  expect(result.isError).not.toBe(true)
  return result.structuredContent as {
    id: string
    kind: string
    content: string
    tags: string[]
    supersedes: string[]
    supersededBy: string[]
  }
}

function expectToolShape(
  tool: Tool | undefined,
  inputProperties: string[],
  outputProperties: string[],
): void {
  expect(tool).toBeDefined()
  expect(tool?.inputSchema.type).toBe('object')
  expect(tool?.inputSchema.additionalProperties).toBe(false)
  expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual(
    inputProperties.sort(),
  )
  expect(tool?.outputSchema?.type).toBe('object')
  expect(tool?.outputSchema?.additionalProperties).toBe(false)
  expect(Object.keys(tool?.outputSchema?.properties ?? {}).sort()).toEqual(
    outputProperties.sort(),
  )
}

function schemaProperties(
  tool: Tool | undefined,
): Record<string, Record<string, unknown>> {
  return (tool?.inputSchema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >
}

function expectAnnotations(
  tool: Tool | undefined,
  readOnly: boolean,
  idempotent: boolean,
): void {
  expect(tool?.annotations).toMatchObject({
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: false,
  })
}

function textContent(result: CallToolResult): string {
  return result.content
    .filter(
      (item): item is { type: 'text'; text: string } => item.type === 'text',
    )
    .map(({ text }) => text)
    .join('\n')
}
