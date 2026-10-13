import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolveStorageAuthority } from '../src/db/storage-authority'
import {
  consolidateMemoryResultSchema,
  recallImportOutputSchema,
} from '../src/mcp/memory-schemas'

const repoRoot = process.cwd()
const continuumBin = join(repoRoot, 'bin', 'continuum')
const roots: string[] = []

function canonicalDbFilePath(workspace: string): string {
  return resolveStorageAuthority(workspace, 'read-write').dbPath
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

describe('Continuum MCP server', () => {
  test('exposes the MVP tools and preserves formatted memory content', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'continuum-mcp-'))
    roots.push(workspace)

    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', continuumBin, 'mcp'],
      cwd: repoRoot,
      env: stringEnvironment(),
      stderr: 'pipe',
    })
    const client = new Client({ name: 'continuum-test', version: '1.0.0' })
    await client.connect(transport)

    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'continuum_init',
        'continuum_memory_append',
        'continuum_memory_consolidate',
        'continuum_memory_search',
        'continuum_recall_import',
        'continuum_recall_status',
        'continuum_runtime',
        'continuum_summary',
        'continuum_task_complete',
        'continuum_task_create',
        'continuum_task_delete',
        'continuum_task_get',
        'continuum_task_graph',
        'continuum_task_list',
        'continuum_task_note_add',
        'continuum_task_steps_add',
        'continuum_task_steps_complete',
        'continuum_task_steps_list',
        'continuum_task_steps_update',
        'continuum_task_update',
        'continuum_task_validate',
      ])
      expect(
        tools.tools.find((tool) => tool.name === 'continuum_summary')
          ?.annotations?.readOnlyHint,
      ).toBe(true)
      expect(
        tools.tools.find((tool) => tool.name === 'continuum_summary')
          ?.inputSchema.properties?.memoryLimit,
      ).toMatchObject({ type: 'integer' })
      for (const name of [
        'continuum_summary',
        'continuum_memory_append',
        'continuum_memory_search',
        'continuum_memory_consolidate',
        'continuum_recall_status',
        'continuum_recall_import',
      ]) {
        const schema = tools.tools.find(
          (tool) => tool.name === name,
        )?.outputSchema
        expect(schema, name).toMatchObject({ type: 'object' })
        expect(
          Object.keys(schema?.properties ?? {}).length,
          `${name} output properties`,
        ).toBeGreaterThan(0)
      }

      const runtime = await client.callTool({
        name: 'continuum_runtime',
        arguments: { workspace },
      })
      expect(runtime.isError).not.toBe(true)
      expect(runtime.structuredContent).toMatchObject({
        storageGeneration: 'xdg-project-sha256-v1',
        workspace,
        entrypoint: realpathSync(continuumBin),
        home: process.env.HOME,
        dataHome: process.env.XDG_DATA_HOME,
        database: canonicalDbFilePath(workspace),
      })

      const init = await client.callTool({
        name: 'continuum_init',
        arguments: { workspace },
      })
      expect(init.isError).not.toBe(true)
      expect(init.structuredContent).toMatchObject({
        workspace,
        created: true,
        initialized: true,
      })

      const emptyConsolidation = await client.callTool({
        name: 'continuum_memory_consolidate',
        arguments: { workspace },
      })
      expect(emptyConsolidation.isError).not.toBe(true)
      expect(emptyConsolidation.structuredContent).toEqual({
        workspace,
        status: 'no-pending',
        dryRun: false,
      })

      const content =
        '## Durable entry\n\nUse `code`, "$HOME", $(not-run), and \'quotes\'.\n\n- item one\n- item two'
      const append = await client.callTool({
        name: 'continuum_memory_append',
        arguments: {
          workspace,
          kind: 'agent',
          content,
          tags: ['mcp'],
        },
      })
      expect(append.isError).not.toBe(true)
      expect(append.structuredContent).toMatchObject({
        workspace,
        sequence: 1,
        projectionStale: false,
      })

      const search = await client.callTool({
        name: 'continuum_memory_search',
        arguments: { workspace, query: 'not-run' },
      })
      expect(search.isError).not.toBe(true)
      const searchData = search.structuredContent as {
        matches: Array<{ content: string }>
      }
      expect(searchData.matches[0]?.content).toBe(content)
      expect(search.content).toEqual([
        { type: 'text', text: 'Structured data returned: workspace, matches.' },
      ])

      const summary = await client.callTool({
        name: 'continuum_summary',
        arguments: { workspace },
      })
      expect(summary.isError).not.toBe(true)
      const summaryData = summary.structuredContent as { output: string }
      expect(summaryData.output).toContain(content)
      expect(summary.content).toEqual([
        { type: 'text', text: 'Structured data returned: workspace, output.' },
      ])

      const consolidation = await client.callTool({
        name: 'continuum_memory_consolidate',
        arguments: { workspace },
      })
      expect(consolidation.isError).not.toBe(true)
      expect(consolidation.structuredContent).toMatchObject({
        workspace,
        status: 'completed',
      })

      const regenerated = await client.callTool({
        name: 'continuum_memory_consolidate',
        arguments: { workspace },
      })
      expect(regenerated.isError).not.toBe(true)
      expect(regenerated.structuredContent).toMatchObject({
        workspace,
        status: 'no-pending',
        dryRun: false,
        projection: { stale: false },
      })

      const dryRunEmpty = await client.callTool({
        name: 'continuum_memory_consolidate',
        arguments: { workspace, dryRun: true },
      })
      expect(dryRunEmpty.isError).not.toBe(true)
      expect(dryRunEmpty.structuredContent).toEqual({
        workspace,
        status: 'no-pending',
        dryRun: true,
      })

      await client.callTool({
        name: 'continuum_memory_append',
        arguments: {
          workspace,
          kind: 'agent',
          content: 'Preview this pending entry.',
          tags: ['mcp'],
        },
      })
      const preview = await client.callTool({
        name: 'continuum_memory_consolidate',
        arguments: { workspace, dryRun: true },
      })
      expect(preview.isError).not.toBe(true)
      expect(preview.structuredContent).toMatchObject({
        workspace,
        status: 'preview',
        dryRun: true,
        entryCount: 1,
      })

      const recallStatus = await client.callTool({
        name: 'continuum_recall_status',
        arguments: { workspace },
      })
      expect(recallStatus.structuredContent).toMatchObject({
        workspace,
        sources: 0,
        rawMessages: 0,
        derivedSummaries: 0,
      })
      const missingRecallImport = await client.callTool({
        name: 'continuum_recall_import',
        arguments: { workspace, dryRun: true, limit: 1 },
      })
      expect(missingRecallImport.isError).toBe(true)
      expect(missingRecallImport.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringMatching(
          /No OpenCode project found for repo:|OpenCode sqlite database not found:/,
        ),
      })

      const sourceDb = join(workspace, 'opencode.db')
      seedOpencodeDb(sourceDb, workspace)
      const recallImport = await client.callTool({
        name: 'continuum_recall_import',
        arguments: { workspace, sourceDb, dryRun: true },
      })
      expect(recallImport.isError).not.toBe(true)
      expect(recallImport.structuredContent).toMatchObject({
        workspace,
        sourceDbPath: sourceDb,
        dryRun: true,
        totalSessions: 1,
        imported: 1,
        changed: 0,
        skippedExisting: 0,
        importedSessions: ['session-1'],
        sessionOutcomes: [{ sessionId: 'session-1', status: 'would-import' }],
      })

      const created = await client.callTool({
        name: 'continuum_task_create',
        arguments: {
          workspace,
          task: {
            title: 'Exercise MCP task tools',
            type: 'chore',
            description: 'End-to-end MCP coverage',
          },
        },
      })
      const task = (created.structuredContent as { task: { id: string } }).task
      expect(task.id).toStartWith('tkt-')

      const stepsAdded = await client.callTool({
        name: 'continuum_task_steps_add',
        arguments: {
          workspace,
          id: task.id,
          steps: [{ title: 'Verify', description: 'Run MCP checks' }],
        },
      })
      const firstStep = (
        stepsAdded.structuredContent as {
          task: { steps: Array<{ id: string }> }
        }
      ).task.steps[0]
      if (!firstStep) throw new Error('Expected MCP step')
      await client.callTool({
        name: 'continuum_task_steps_update',
        arguments: {
          workspace,
          id: task.id,
          stepId: firstStep.id,
          patch: { status: 'in_progress' },
        },
      })
      await client.callTool({
        name: 'continuum_task_note_add',
        arguments: {
          workspace,
          id: task.id,
          kind: 'discovery',
          content: 'MCP task notes work.',
        },
      })
      await client.callTool({
        name: 'continuum_task_steps_complete',
        arguments: {
          workspace,
          id: task.id,
          stepId: firstStep.id,
          notes: 'Verified',
        },
      })
      const validation = await client.callTool({
        name: 'continuum_task_validate',
        arguments: { workspace, id: task.id, transition: 'completed' },
      })
      expect(validation.structuredContent).toMatchObject({
        valid: false,
        missingFields: ['plan'],
      })
      await client.callTool({
        name: 'continuum_task_update',
        arguments: {
          workspace,
          id: task.id,
          patch: { priority: 10, plan: 'Run all MCP operations.' },
        },
      })
      const revalidation = await client.callTool({
        name: 'continuum_task_validate',
        arguments: { workspace, id: task.id, transition: 'completed' },
      })
      expect(revalidation.structuredContent).toMatchObject({ valid: true })
      const graph = await client.callTool({
        name: 'continuum_task_graph',
        arguments: { workspace, id: task.id, query: 'children' },
      })
      expect(graph.structuredContent).toMatchObject({ taskIds: [] })
      const paginationPeer = await client.callTool({
        name: 'continuum_task_create',
        arguments: {
          workspace,
          task: {
            title: 'MCP pagination peer',
            type: 'chore',
            description: 'Force a second task-list page',
            priority: 20,
          },
        },
      })
      const peerId = (
        paginationPeer.structuredContent as { task: { id: string } }
      ).task.id
      const firstPage = await client.callTool({
        name: 'continuum_task_list',
        arguments: {
          workspace,
          options: { limit: 1, sort: 'priority', order: 'asc' },
        },
      })
      const firstPageData = firstPage.structuredContent as {
        tasks: Array<{ id: string }>
        nextCursor?: string
      }
      expect(firstPageData.tasks.map(({ id }) => id)).toEqual([task.id])
      expect(firstPageData.nextCursor).toBeString()
      const listed = await client.callTool({
        name: 'continuum_task_list',
        arguments: {
          workspace,
          options: {
            cursor: firstPageData.nextCursor,
            limit: 1,
            sort: 'priority',
            order: 'asc',
          },
        },
      })
      expect(listed.structuredContent).toMatchObject({
        tasks: [{ id: peerId }],
      })
      expect(
        (listed.structuredContent as { nextCursor?: string }).nextCursor,
      ).toBeUndefined()
      const fetched = await client.callTool({
        name: 'continuum_task_get',
        arguments: { workspace, id: task.id, expand: ['children'] },
      })
      expect(fetched.structuredContent).toMatchObject({ children: [] })
      expect(fetched.content).toEqual([
        {
          type: 'text',
          text: 'Structured data returned: workspace, task, parent, children, blockers.',
        },
      ])
      await client.callTool({
        name: 'continuum_task_complete',
        arguments: { workspace, id: task.id, outcome: 'All MCP calls passed.' },
      })
      const deleted = await client.callTool({
        name: 'continuum_task_delete',
        arguments: { workspace, id: task.id },
      })
      expect(deleted.structuredContent).toMatchObject({ deleted: true })
    } finally {
      await client.close()
    }
  }, 20_000)

  test('models every consolidation and recall-import result variant', () => {
    const workspace = '/workspace'
    const summary = {
      narrative: 'Summary',
      decisions: [],
      discoveries: [],
      patterns: [],
      whatWorked: [],
      whatFailed: [],
      blockers: [],
      openQuestions: [],
      nextSteps: [],
      tasks: [],
      files: [],
      confidence: null,
    }
    const variants = [
      { workspace, status: 'no-pending', dryRun: true },
      { workspace, status: 'no-pending', dryRun: false },
      {
        workspace,
        status: 'no-pending',
        dryRun: false,
        projection: { stale: false },
      },
      {
        workspace,
        status: 'no-pending',
        dryRun: false,
        projection: { stale: true, error: { reason: 'write failed' } },
      },
      {
        workspace,
        status: 'preview',
        dryRun: true,
        firstSequence: 1,
        lastSequence: 2,
        entryCount: 2,
        summary,
      },
      {
        workspace,
        status: 'conflict',
        dryRun: false,
        expectedBoundary: 1,
        actualBoundary: 2,
      },
      {
        workspace,
        status: 'completed',
        dryRun: false,
        consolidation: {
          id: 'consolidation-1',
          firstSequence: 1,
          lastSequence: 2,
          summary,
          summaryVersion: 1,
          model: null,
          createdAt: '2026-10-13T00:00:00.000Z',
          completedAt: '2026-10-13T00:00:00.000Z',
        },
        entryCount: 2,
        projectionStale: false,
      },
    ]
    for (const variant of variants) {
      expect(
        consolidateMemoryResultSchema().safeParse(variant).success,
        JSON.stringify(variant),
      ).toBe(true)
    }

    const recallImport = {
      workspace,
      sourceDbPath: '/data/opencode.db',
      dryRun: false,
      totalSessions: 5,
      imported: 1,
      changed: 1,
      skippedExisting: 1,
      importedSessions: [
        'would-import',
        'would-refresh',
        'imported',
        'refreshed',
      ],
      sessionOutcomes: [
        { sessionId: 'current', status: 'current' },
        { sessionId: 'would-import', status: 'would-import' },
        { sessionId: 'would-refresh', status: 'would-refresh' },
        { sessionId: 'imported', status: 'imported' },
        { sessionId: 'refreshed', status: 'refreshed' },
      ],
    }
    expect(recallImportOutputSchema().safeParse(recallImport).success).toBe(
      true,
    )
  })
})

function seedOpencodeDb(dbPath: string, workspace: string): void {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT,
      directory TEXT, title TEXT, version TEXT, summary_additions INTEGER,
      summary_deletions INTEGER, summary_files INTEGER, time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,
      time_updated INTEGER, data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
      time_created INTEGER, time_updated INTEGER, data TEXT
    );
  `)
  db.query('INSERT INTO project (id, worktree) VALUES (?, ?)').run(
    'project-1',
    workspace,
  )
  const timestamp = Date.parse('2026-10-13T00:00:00.000Z')
  db.query(
    `INSERT INTO session
     (id, project_id, slug, directory, title, version, summary_additions,
      summary_deletions, summary_files, time_created, time_updated)
     VALUES ('session-1', 'project-1', 'session-1', ?, 'Session 1', '1',
             0, 0, 0, ?, ?)`,
  ).run(workspace, timestamp, timestamp)
  db.close()
}
