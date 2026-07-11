import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  consolidateMcpMemory,
  getMcpRecallStatus,
  importMcpRecall,
} from './memory-tools'
import { toolResult } from './result'
import { positiveIntegerSchema, workspaceSchema } from './task-schemas'

export function registerMemoryTools(server: McpServer): void {
  server.registerTool(
    'continuum_memory_consolidate',
    {
      description:
        'Consolidate pending immutable journal entries; dryRun may still call the configured summarizer.',
      inputSchema: {
        workspace: workspaceSchema(),
        dryRun: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => toolResult(await consolidateMcpMemory(input)),
  )
  server.registerTool(
    'continuum_recall_status',
    {
      description: 'Read canonical OpenCode recall inventory counts.',
      inputSchema: { workspace: workspaceSchema() },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => toolResult(getMcpRecallStatus(input)),
  )
  server.registerTool(
    'continuum_recall_import',
    {
      description:
        'Import OpenCode sessions into canonical recall; dryRun performs no writes or LLM calls.',
      inputSchema: {
        workspace: workspaceSchema(),
        sourceDb: z.string().optional(),
        projectId: z.string().optional(),
        sessionId: z.string().optional(),
        after: z.string().optional(),
        limit: positiveIntegerSchema().max(1000).optional(),
        dryRun: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => toolResult(await importMcpRecall(input)),
  )
}
