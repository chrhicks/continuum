import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { appendMcpMemory, getSummary, searchMcpMemory } from './tools'
import { registerTaskTools } from './register-task-tools'
import { registerMemoryTools } from './register-memory-tools'
import { toolResult } from './result'

const workspaceSchema = () =>
  z
    .string()
    .min(1)
    .describe('Absolute path inside the initialized Continuum workspace')
const positiveIntegerSchema = () => z.number().int().positive()

export function createContinuumMcpServer(): McpServer {
  const server = new McpServer({ name: 'continuum', version: '0.1.1' })

  registerTaskTools(server)
  registerMemoryTools(server)

  server.registerTool(
    'continuum_summary',
    {
      description: 'Read the current task and memory briefing for a workspace.',
      inputSchema: {
        workspace: workspaceSchema(),
        taskLimit: positiveIntegerSchema().optional(),
        memoryLimit: positiveIntegerSchema().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      toolResult(await getSummary(input), (result) => result.output),
  )

  server.registerTool(
    'continuum_memory_append',
    {
      description:
        'Append one immutable, fully formatted entry to workspace memory.',
      inputSchema: {
        workspace: workspaceSchema(),
        kind: z.enum(['user', 'agent', 'tool']),
        content: z
          .string()
          .min(1)
          .describe('Full entry text; Markdown is allowed'),
        tags: z.array(z.string().min(1)).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) =>
      toolResult(
        await appendMcpMemory(input),
        (result) =>
          `Appended memory entry ${result.id} at sequence ${result.sequence}.`,
      ),
  )

  server.registerTool(
    'continuum_memory_search',
    {
      description: 'Search canonical memory in an initialized workspace.',
      inputSchema: {
        workspace: workspaceSchema(),
        query: z.string().min(1),
        limit: positiveIntegerSchema().max(100).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      toolResult(await searchMcpMemory(input), (result) =>
        JSON.stringify(result.matches, null, 2),
      ),
  )

  return server
}

export async function serveContinuumMcp(): Promise<void> {
  await createContinuumMcpServer().connect(new StdioServerTransport())
}
