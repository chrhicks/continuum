import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { getGuide } from '@continuum/core'

export function createContinuumMcpServer(): McpServer {
  const server = new McpServer({ name: 'continuum', version: '0.2.0' })

  server.registerTool(
    'continuum_guide',
    {
      description: 'Read version-matched guidance for using Continuum memory.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () => {
      const guide = getGuide()
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Continuum usage guidance returned as structured data.',
          },
        ],
        structuredContent: { ...guide },
      }
    },
  )

  return server
}

export async function serveContinuumMcp(): Promise<void> {
  const server = createContinuumMcpServer()
  await server.connect(new StdioServerTransport())
}
