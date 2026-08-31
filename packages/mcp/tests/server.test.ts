import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { maximumSerializedErrorLength } from '@continuum/core'
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
      expect(searchProperties.query).not.toHaveProperty('maxLength')
      expect(searchProperties.tags).not.toHaveProperty('maxItems')
      expect(searchProperties.kinds).not.toHaveProperty('maxItems')
      expect(searchProperties.limit).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 100,
      })
      expect(searchProperties.cursor).toMatchObject({ maxLength: 4_096 })
      const getIds = schemaProperties(tools.get('continuum_memory_get')).ids
      expect(getIds).toMatchObject({ minItems: 1 })
      expect(getIds).not.toHaveProperty('maxItems')
    } finally {
      await context.close()
    }
  })

  test('bounds standard SDK validation failures without weakening strict discovery', async () => {
    const context = await mcpContext('bounded-validation', true)
    try {
      const listed = await context.client.listTools()
      expect(
        listed.tools.every(
          (tool) =>
            tool.inputSchema.type === 'object' &&
            tool.inputSchema.additionalProperties === false,
        ),
      ).toBe(true)

      const hugeUnknownKey = '😀'.repeat(5_000)
      const unknownKeyResult = await call(context.client, 'continuum_guide', {
        [hugeUnknownKey]: true,
      })
      const malformedArrayResult = await call(
        context.client,
        'continuum_memory_search',
        {
          workspace: context.workspace,
          tags: Array.from({ length: 10_000 }, (_, index) => index),
        },
      )

      for (const result of [unknownKeyResult, malformedArrayResult]) {
        const text = textContent(result)
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toBeUndefined()
        expect(text).toContain('Input validation error:')
        expect(text.length).toBeLessThanOrEqual(maximumSerializedErrorLength)
        expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
          maximumSerializedErrorLength,
        )
      }
      expect(textContent(unknownKeyResult)).not.toContain('😀'.repeat(100))
      expect(textContent(malformedArrayResult)).not.toContain('[9999]')
      expect(existsSync(context.dataDirectory)).toBe(false)
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
    const dataDirectory = join(root, 'data')
    const server = createContinuumMcpServer({ dataDirectory })
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
    const firstClose = server.close()
    const secondClose = server.close()
    expect(firstClose).toBe(secondClose)
    await firstClose
    expect(transport.closeCount).toBe(1)
    expect(existsSync(dataDirectory)).toBe(false)
  })

  test('memoizes concurrent, repeated, and rejecting transport closure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-mcp-close-once-'))
    temporaryRoots.push(root)

    const concurrentServer = createContinuumMcpServer({
      dataDirectory: join(root, 'concurrent-data'),
    })
    const concurrentTransport = new DeferredCloseTransport()
    await concurrentServer.connect(concurrentTransport)
    const firstClose = concurrentServer.close()
    const concurrentClose = concurrentServer.close()
    expect(firstClose).toBe(concurrentClose)
    expect(concurrentTransport.closeCount).toBe(1)
    concurrentTransport.finishClose()
    await Promise.all([firstClose, concurrentClose])
    expect(concurrentServer.close()).toBe(firstClose)
    await concurrentServer.close()
    expect(concurrentTransport.closeCount).toBe(1)
    await expectRejected(
      concurrentServer.connect(new FailingTransport()),
      'closed',
    )

    const rejectingServer = createContinuumMcpServer({
      dataDirectory: join(root, 'rejecting-data'),
    })
    const rejectingTransport = new FailingTransport()
    const closeFailure = new Error('transport close failed')
    rejectingTransport.closeFailure = closeFailure
    await rejectingServer.connect(rejectingTransport)
    const rejectingClose = rejectingServer.close()
    const repeatedRejectingClose = rejectingServer.close()
    expect(rejectingClose).toBe(repeatedRejectingClose)
    await expectSameRejection(rejectingClose, closeFailure)
    await expectSameRejection(rejectingServer.close(), closeFailure)
    expect(rejectingTransport.closeCount).toBe(1)
    await expectRejected(
      rejectingServer.connect(new FailingTransport()),
      'closed',
    )
    expect(existsSync(join(root, 'rejecting-data'))).toBe(false)
  })

  test('preinstalls the close promise before a rejecting transport reenters close', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-mcp-reentrant-close-'))
    temporaryRoots.push(root)
    const dataDirectory = join(root, 'data')
    const server = createContinuumMcpServer({ dataDirectory })
    const closeFailure = new Error('transport notified close then failed')
    const transport = new NotifyThenRejectTransport(closeFailure)
    let observedClose = 0
    let reentrantClose: Promise<void> | undefined
    server.server.onclose = () => {
      observedClose += 1
      reentrantClose = server.close()
    }
    await server.connect(transport)

    const outerClose = server.close()
    const concurrentClose = server.close()

    expect(observedClose).toBe(1)
    expect(reentrantClose).toBe(outerClose)
    expect(concurrentClose).toBe(outerClose)
    await expectSameRejection(outerClose, closeFailure)
    await expectSameRejection(reentrantClose as Promise<void>, closeFailure)
    expect(server.close()).toBe(outerClose)
    await expectSameRejection(server.close(), closeFailure)
    expect(transport.closeCount).toBe(1)
    await expectRejected(server.connect(new FailingTransport()), 'closed')
    expect(existsSync(dataDirectory)).toBe(false)
  })

  test('preserves a start failure when attached transport cleanup also rejects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-mcp-double-failure-'))
    temporaryRoots.push(root)
    const dataDirectory = join(root, 'data')
    const server = createContinuumMcpServer({ dataDirectory })
    const transport = new FailingTransport()
    const startFailure = new Error('primary transport start failure')
    const closeFailure = new Error('secondary transport close failure')
    transport.startFailure = startFailure
    transport.closeFailure = closeFailure

    await expectSameRejection(server.connect(transport), startFailure)
    await expectSameRejection(server.close(), closeFailure)
    await expectSameRejection(server.close(), closeFailure)
    expect(transport.closeCount).toBe(1)
    await expectRejected(server.connect(new FailingTransport()), 'closed')
    expect(existsSync(dataDirectory)).toBe(false)
  })

  test('owns closure during transport start when the close observer was replaced', async () => {
    const root = mkdtempSync(join(tmpdir(), 'continuum-mcp-start-close-'))
    temporaryRoots.push(root)
    const server = createContinuumMcpServer({
      dataDirectory: join(root, 'data'),
    })
    const transport = new ClosingDuringStartTransport()
    let observedClose = 0
    server.server.onclose = () => {
      observedClose += 1
    }

    await server.connect(transport)

    expect(observedClose).toBe(1)
    await expectRejected(server.connect(new FailingTransport()), 'closed')
    await server.close()
    await server.close()
    expect(observedClose).toBe(1)
    expect(transport.closeCount).toBe(0)
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

  test('does not reopen storage when an in-flight call resumes after transport close', async () => {
    const context = await mcpContext('in-flight-close')
    try {
      await record(context, {
        workspace: context.workspace,
        content: 'Open storage before the in-flight shutdown race.',
      })
      expect(hasSidecars(context.dataDirectory)).toBe(true)

      const inFlight = call(context.client, 'continuum_memory_record', {
        workspace: context.workspace,
        content:
          'This call may complete or abort, but must never reopen storage.',
      })
      await context.client.close()
      await inFlight.catch(() => undefined)
      await Bun.sleep(10)

      expect(hasSidecars(context.dataDirectory)).toBe(false)
      await expectRejected(
        context.server.connect(new FailingTransport()),
        'closed',
      )
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

  test('applies normalized core limits consistently at the MCP boundary', async () => {
    const context = await mcpContext('normalized-limits')
    try {
      const stored = await record(context, {
        workspace: context.workspace,
        content: 'Normalized adapter parity anchor.',
        tags: ['duplicate'],
      })
      const whitespaceHeavyQuery = `${' '.repeat(2_100)}parity anchor`

      const duplicateFilters = await call(
        context.client,
        'continuum_memory_search',
        {
          workspace: context.workspace,
          query: whitespaceHeavyQuery,
          tags: Array.from({ length: 51 }, () => ' DUPLICATE '),
        },
      )
      expect(duplicateFilters.isError).not.toBe(true)
      expect(
        (
          duplicateFilters.structuredContent as {
            records: Array<{ id: string }>
          }
        ).records.map(({ id }) => id),
      ).toEqual([stored.id])

      const duplicateIds = await call(context.client, 'continuum_memory_get', {
        workspace: context.workspace,
        ids: Array.from({ length: 101 }, () => stored.id),
      })
      expect(duplicateIds.isError).not.toBe(true)
      expect(duplicateIds.structuredContent).toMatchObject({
        records: [{ id: stored.id }],
        missingIds: [],
      })

      for (const [tool, arguments_] of [
        [
          'continuum_memory_search',
          {
            workspace: context.workspace,
            tags: Array.from({ length: 51 }, (_, index) => `tag-${index}`),
          },
        ],
        [
          'continuum_memory_get',
          {
            workspace: context.workspace,
            ids: Array.from({ length: 101 }, (_, index) => `id-${index}`),
          },
        ],
        [
          'continuum_memory_search',
          {
            workspace: context.workspace,
            query: `x${' y'.repeat(1_000)}`,
          },
        ],
      ] as const) {
        const result = await call(context.client, tool, arguments_)
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toBeUndefined()
        expect(JSON.parse(textContent(result))).toMatchObject({
          error: { code: 'VALIDATION_ERROR' },
        })
      }
    } finally {
      await context.close()
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

      const escapeHeavyText = ['"', '\\', '\n'].join('').repeat(5_000)
      const attackerId = `missing-${escapeHeavyText}`
      const bounded = await call(context.client, 'continuum_memory_record', {
        workspace: context.workspace,
        content: privateContent,
        supersedes: [attackerId],
      })
      const boundedText = textContent(bounded)
      expect(bounded.isError).toBe(true)
      expect(bounded.structuredContent).toBeUndefined()
      expect(boundedText.length).toBeLessThanOrEqual(
        maximumSerializedErrorLength,
      )
      expect(Buffer.byteLength(boundedText, 'utf8')).toBeLessThanOrEqual(
        maximumSerializedErrorLength,
      )
      const boundedError = JSON.parse(boundedText) as {
        error: { context: { recordId: string } }
      }
      expect(boundedError).toMatchObject({
        error: {
          code: 'NOT_FOUND',
          operation: 'record memory',
          message: 'A superseded memory record was not found.',
        },
      })
      expect(typeof boundedError.error.context.recordId).toBe('string')
      expect(boundedError.error.context.recordId).not.toBe(attackerId)
      expect(
        boundedError.error.context.recordId.length < attackerId.length,
      ).toBe(true)
      expect(boundedText).not.toContain(attackerId)
      expect(boundedText).not.toContain(privateContent)
      expect(boundedText).not.toMatch(/stack|SELECT|\sat\s/)
    } finally {
      await context.close()
    }
  })
})

class FailingTransport implements Transport {
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']
  startFailure: Error | undefined
  closeFailure: Error | undefined
  closeCount = 0

  async start(): Promise<void> {
    if (this.startFailure) throw this.startFailure
  }

  async send(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCount += 1
    if (this.closeFailure) throw this.closeFailure
    this.onclose?.()
  }
}

class NotifyThenRejectTransport implements Transport {
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']
  closeCount = 0

  constructor(readonly closeFailure: Error) {}

  async start(): Promise<void> {}

  async send(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCount += 1
    this.onclose?.()
    throw this.closeFailure
  }
}

class DeferredCloseTransport implements Transport {
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']
  closeCount = 0
  readonly #closed = Promise.withResolvers<void>()

  async start(): Promise<void> {}

  async send(): Promise<void> {}

  close(): Promise<void> {
    this.closeCount += 1
    return this.#closed.promise
  }

  finishClose(): void {
    this.onclose?.()
    this.#closed.resolve()
  }
}

class ClosingDuringStartTransport implements Transport {
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']
  closeCount = 0

  async start(): Promise<void> {
    this.onclose?.()
  }

  async send(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCount += 1
    this.onclose?.()
  }
}

async function expectSameRejection(
  promise: Promise<unknown>,
  expected: unknown,
): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (cause) {
    caught = cause
  }
  expect(caught).toBe(expected)
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
