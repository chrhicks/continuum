import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const repoRoot = process.cwd()
const continuumBin = join(repoRoot, 'bin', 'continuum')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Continuum MCP server', () => {
  test('exposes the MVP tools and preserves formatted memory content', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'continuum-mcp-'))
    roots.push(workspace)

    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', continuumBin, 'mcp'],
      cwd: repoRoot,
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
      expect(consolidation.structuredContent).toMatchObject({
        workspace,
        status: 'completed',
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
      const recallImport = await client.callTool({
        name: 'continuum_recall_import',
        arguments: { workspace, dryRun: true, limit: 1 },
      })
      expect(recallImport.isError).toBe(true)
      expect(recallImport.content[0]).toMatchObject({
        type: 'text',
        text: expect.stringMatching(
          /No OpenCode project found for repo:|OpenCode sqlite database not found:/,
        ),
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
      const listed = await client.callTool({
        name: 'continuum_task_list',
        arguments: { workspace },
      })
      expect(JSON.stringify(listed.structuredContent)).toContain(task.id)
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
})
