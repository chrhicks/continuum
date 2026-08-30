import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  ContinuumError,
  getGuide,
  type Continuum,
  type ContinuumErrorCode,
} from '@continuum/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const workspacePathSchema = z
  .string()
  .describe(
    'Absolute path to the workspace whose logical memory should be used.',
  )
const recordIdSchema = z.string().describe('Public ID of a memory record.')
const tagSchema = z.string().describe('Tag used to retrieve related memory.')
const kindSchema = z
  .string()
  .describe(
    'Open-ended memory kind, such as observation, decision, preference, or lesson.',
  )

const memoryRecordSchema = z
  .object({
    id: recordIdSchema,
    kind: kindSchema,
    content: z.string().describe('Complete immutable memory content.'),
    tags: z
      .array(tagSchema)
      .describe('Normalized tags stored with the record.'),
    createdAt: z
      .string()
      .describe('Canonical UTC timestamp when the record was created.'),
    supersedes: z
      .array(recordIdSchema)
      .describe('Older record IDs explicitly replaced by this record.'),
    supersededBy: z
      .array(recordIdSchema)
      .describe('Newer record IDs that explicitly replace this record.'),
  })
  .strict()

const workspaceAliasSchema = z
  .object({
    kind: z.enum(['git', 'path']).describe('Workspace alias type.'),
    value: z.string().describe('Normalized workspace alias value.'),
  })
  .strict()

const workspaceInfoSchema = z
  .object({
    identity: workspaceAliasSchema.describe(
      'Canonical logical workspace identity.',
    ),
    aliases: z
      .array(workspaceAliasSchema)
      .describe('Known paths and Git remotes for the logical workspace.'),
  })
  .strict()

const pageFields = {
  records: z
    .array(memoryRecordSchema)
    .describe('Complete memory records in retrieval order.'),
  hasMore: z
    .boolean()
    .describe('Whether another page exists for the unchanged result set.'),
  nextCursor: z
    .string()
    .nullable()
    .describe('Opaque cursor for the next search page, or null at the end.'),
}

const guideInputSchema = z.object({}).strict()
const guideOutputSchema = z
  .object({
    version: z.literal(1).describe('Guide contract version.'),
    purpose: z.string().describe('Continuum product purpose.'),
    workflow: z
      .array(z.string())
      .describe('Ordered guidance for effective durable-memory use.'),
    operations: z
      .array(
        z
          .object({
            name: z.string().describe('Public operation name.'),
            use: z.string().describe('When to use the operation.'),
          })
          .strict(),
      )
      .describe('Composable memory operations.'),
    recordKinds: z
      .object({
        conventional: z
          .array(z.string())
          .describe('Conventional, non-exclusive record kinds.'),
        guidance: z.string().describe('How to choose a record kind.'),
      })
      .strict(),
  })
  .strict()

const summaryInputSchema = z
  .object({
    workspace: workspacePathSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum current records to return; defaults to 10.'),
  })
  .strict()
const summaryOutputSchema = z
  .object({
    workspace: workspaceInfoSchema,
    ...pageFields,
  })
  .strict()

const recordInputSchema = z
  .object({
    workspace: workspacePathSchema,
    content: z
      .string()
      .describe(
        'Complete, self-contained durable knowledge to store unchanged.',
      ),
    kind: kindSchema
      .optional()
      .describe('Open-ended memory kind; defaults to observation.'),
    tags: z
      .array(tagSchema)
      .optional()
      .describe('Tags to normalize and store for later retrieval.'),
    supersedes: z
      .array(recordIdSchema)
      .optional()
      .describe('Same-workspace record IDs that this new record replaces.'),
  })
  .strict()

const searchInputSchema = z
  .object({
    workspace: workspacePathSchema,
    query: z
      .string()
      .max(2_000)
      .optional()
      .describe(
        'Ordinary text for relevance search; omit or leave blank to browse newest first.',
      ),
    tags: z
      .array(tagSchema)
      .max(50)
      .optional()
      .describe('Tags that every returned record must contain.'),
    kinds: z
      .array(kindSchema)
      .max(50)
      .optional()
      .describe('Kinds of which a returned record may match any.'),
    includeHistory: z
      .boolean()
      .optional()
      .describe(
        'Include superseded records; defaults to current records only.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Maximum records to return; defaults to 20.'),
    cursor: z
      .string()
      .max(4_096)
      .optional()
      .describe(
        'Opaque nextCursor from the same normalized search or summary browse.',
      ),
  })
  .strict()
const searchOutputSchema = z.object(pageFields).strict()

const getInputSchema = z
  .object({
    workspace: workspacePathSchema,
    ids: z
      .array(recordIdSchema)
      .min(1)
      .max(100)
      .describe('Record IDs to retrieve exactly, in request order.'),
  })
  .strict()
const getOutputSchema = z
  .object({
    records: z
      .array(memoryRecordSchema)
      .describe('Found complete records in request order.'),
    missingIds: z
      .array(recordIdSchema)
      .describe('Requested IDs not found in this logical workspace.'),
  })
  .strict()

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export function registerContinuumTools(
  server: McpServer,
  continuum: Continuum,
): void {
  server.registerTool(
    'continuum_guide',
    {
      description:
        'Read version-matched guidance for orienting, searching, recording, correcting, browsing, and following Continuum memory.',
      inputSchema: guideInputSchema,
      outputSchema: guideOutputSchema,
      annotations: readOnlyAnnotations,
    },
    () =>
      callCoreTool('continuum_guide', 'Continuum usage guidance', () =>
        getGuide(),
      ),
  )

  server.registerTool(
    'continuum_summary',
    {
      description:
        'Start work with the newest current records for one logical workspace; use its cursor with chronological search when more context is needed.',
      inputSchema: summaryInputSchema,
      outputSchema: summaryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      callCoreTool('continuum_summary', 'Continuum workspace summary', () =>
        continuum.summary(input),
      ),
  )

  server.registerTool(
    'continuum_memory_record',
    {
      description:
        'Store one complete immutable memory record at a useful checkpoint; record a replacement with supersedes when prior knowledge becomes stale.',
      inputSchema: recordInputSchema,
      outputSchema: memoryRecordSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      callCoreTool('continuum_memory_record', 'Continuum memory record', () =>
        continuum.record(input),
      ),
  )

  server.registerTool(
    'continuum_memory_search',
    {
      description:
        'Search complete current records by ordinary text and filters, browse newest-first with an empty query, paginate with nextCursor, or include superseded history explicitly.',
      inputSchema: searchInputSchema,
      outputSchema: searchOutputSchema,
      annotations: readOnlyAnnotations,
    },
    (input) =>
      callCoreTool('continuum_memory_search', 'Continuum memory search', () =>
        continuum.search(input),
      ),
  )

  server.registerTool(
    'continuum_memory_get',
    {
      description:
        'Retrieve several exact memory IDs from one workspace, including superseded records and both replacement relationship directions.',
      inputSchema: getInputSchema,
      outputSchema: getOutputSchema,
      annotations: readOnlyAnnotations,
    },
    (input) =>
      callCoreTool(
        'continuum_memory_get',
        'Continuum exact memory retrieval',
        () => continuum.get(input),
      ),
  )
}

function callCoreTool<T extends object>(
  toolName: string,
  successText: string,
  operation: () => T,
): CallToolResult {
  try {
    return successResult(operation(), successText)
  } catch (cause) {
    return errorResult(cause, toolName)
  }
}

function successResult<T extends object>(
  value: T,
  text: string,
): CallToolResult {
  return {
    content: [{ type: 'text', text: `${text} returned as structured data.` }],
    structuredContent: { ...value } as Record<string, unknown>,
  }
}

function errorResult(cause: unknown, toolName: string): CallToolResult {
  const error =
    cause instanceof ContinuumError
      ? {
          code: cause.code,
          operation: cause.operation,
          message: cause.message,
          context: safeContext(cause.context),
        }
      : {
          code: 'DATABASE_ERROR' as ContinuumErrorCode,
          operation: toolName,
          message: 'Continuum could not complete the MCP operation.',
          context: undefined,
        }
  const structuredError = {
    code: error.code,
    operation: error.operation,
    message: error.message,
    ...(error.context ? { context: error.context } : {}),
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Continuum returned a structured ${error.code} failure for ${error.operation}.`,
      },
    ],
    structuredContent: { error: structuredError },
  }
}

function safeContext(
  context: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!context) return undefined
  const safeKeys = new Set([
    'workspacePath',
    'recordId',
    'conflictingAlias',
    'databasePath',
    'dataDirectory',
  ])
  const safeEntries = Object.entries(context).filter(([key]) =>
    safeKeys.has(key),
  )
  return safeEntries.length > 0 ? Object.fromEntries(safeEntries) : undefined
}
