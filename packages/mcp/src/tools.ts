import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  ContinuumError,
  getGuide,
  serializeSafeError,
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

const unknownInputKey = '__continuum_unknown_input__'

function strictInputObject<Shape extends z.ZodRawShape>(shape: Shape) {
  const knownKeys = new Set(Object.keys(shape))
  const objectSchema = z.object(shape).strict()
  const inputSchema = z.preprocess((value) => {
    if (!isPlainObject(value)) return value
    if (!Object.keys(value).some((key) => !knownKeys.has(key))) return value

    const bounded: Record<string, unknown> = {}
    for (const key of knownKeys) {
      if (Object.hasOwn(value, key)) bounded[key] = value[key]
    }
    bounded[unknownInputKey] = true
    return bounded
  }, objectSchema)

  // SDK 1.29 recognizes object schemas through this property before its JSON
  // Schema converter unwraps the preprocessing effect using the input shape.
  Object.defineProperty(inputSchema, 'shape', { value: objectSchema.shape })
  return inputSchema
}

function boundedTextArray(item: z.ZodString, minimumLength?: number) {
  let arraySchema = z.array(item)
  if (minimumLength !== undefined) arraySchema = arraySchema.min(minimumLength)

  return z.preprocess((value) => {
    if (!Array.isArray(value)) return value
    for (const entry of value) {
      if (typeof entry !== 'string') return null
    }
    return value
  }, arraySchema)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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

const guideInputSchema = strictInputObject({})
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

const summaryInputSchema = strictInputObject({
  workspace: workspacePathSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum current records to return; defaults to 10.'),
})
const summaryOutputSchema = z
  .object({
    workspace: workspaceInfoSchema,
    ...pageFields,
  })
  .strict()

const recordInputSchema = strictInputObject({
  workspace: workspacePathSchema,
  content: z
    .string()
    .describe('Complete, self-contained durable knowledge to store unchanged.'),
  kind: kindSchema
    .optional()
    .describe('Open-ended memory kind; defaults to observation.'),
  tags: boundedTextArray(tagSchema)
    .optional()
    .describe('Tags to normalize and store for later retrieval.'),
  supersedes: boundedTextArray(recordIdSchema)
    .optional()
    .describe('Same-workspace record IDs that this new record replaces.'),
})

const searchInputSchema = strictInputObject({
  workspace: workspacePathSchema,
  query: z
    .string()
    .optional()
    .describe(
      'Ordinary text for relevance search; omit or leave blank to browse newest first.',
    ),
  tags: boundedTextArray(tagSchema)
    .optional()
    .describe('Tags that every returned record must contain.'),
  kinds: boundedTextArray(kindSchema)
    .optional()
    .describe('Kinds of which a returned record may match any.'),
  includeHistory: z
    .boolean()
    .optional()
    .describe('Include superseded records; defaults to current records only.'),
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
const searchOutputSchema = z.object(pageFields).strict()

const getInputSchema = strictInputObject({
  workspace: workspacePathSchema,
  ids: boundedTextArray(recordIdSchema, 1).describe(
    'Record IDs to retrieve exactly, in request order.',
  ),
})
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
          context: cause.context,
        }
      : {
          code: 'DATABASE_ERROR' as ContinuumErrorCode,
          operation: toolName,
          message: 'Continuum could not complete the MCP operation.',
          context: undefined,
        }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: serializeSafeError(error),
      },
    ],
  }
}
