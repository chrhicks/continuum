import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { resolveRuntimeContract } from '../runtime/contract'
import { toolResult } from './result'
import { resolveInitWorkspace } from './tools'

export function registerRuntimeTool(server: McpServer): void {
  server.registerTool(
    'continuum_runtime',
    {
      description:
        'Inspect the exact Continuum runtime and canonical storage paths.',
      inputSchema: {
        workspace: z
          .string()
          .min(1)
          .describe('Absolute path inside the target Continuum workspace'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      toolResult(
        resolveRuntimeContract(resolveInitWorkspace(input.workspace), {
          readOnly: true,
        }),
      ),
  )
}
