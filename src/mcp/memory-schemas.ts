import { z } from 'zod'

const WorkspaceSchema = z.string().min(1)
const NonNegativeIntegerSchema = z.number().int().nonnegative()
const PositiveIntegerSchema = z.number().int().positive()

const MemorySummarySchema = z
  .object({
    narrative: z.string(),
    decisions: z.array(z.string()),
    discoveries: z.array(z.string()),
    patterns: z.array(z.string()),
    whatWorked: z.array(z.string()),
    whatFailed: z.array(z.string()),
    blockers: z.array(z.string()),
    openQuestions: z.array(z.string()),
    nextSteps: z.array(z.string()),
    tasks: z.array(z.string()),
    files: z.array(z.string()),
    confidence: z.enum(['low', 'medium', 'high']).nullable(),
  })
  .strict()

const ProjectionStatusSchema = z.discriminatedUnion('stale', [
  z.object({ stale: z.literal(false) }).strict(),
  z
    .object({
      stale: z.literal(true),
      error: z.unknown(),
    })
    .strict(),
])

const CompletedConsolidationSchema = z
  .object({
    id: z.string(),
    firstSequence: PositiveIntegerSchema,
    lastSequence: PositiveIntegerSchema,
    summary: MemorySummarySchema,
    summaryVersion: PositiveIntegerSchema,
    model: z.string().nullable(),
    createdAt: z.string(),
    completedAt: z.string(),
  })
  .strict()

const SummaryOutputSchema = z
  .object({ workspace: WorkspaceSchema, output: z.string() })
  .strict()

const AppendMemoryOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    id: z.string(),
    sequence: PositiveIntegerSchema,
    projectionStale: z.boolean(),
  })
  .strict()

const MemoryEvidenceSchema = z
  .object({
    type: z.enum([
      'journal',
      'consolidation',
      'recall-message',
      'recall-summary',
    ]),
    provenance: z.enum(['raw', 'derived']),
    id: z.string(),
    content: z.string(),
    createdAt: z.string().nullable(),
    source: z.string(),
    tags: z.array(z.string()),
    current: z.boolean(),
    score: PositiveIntegerSchema,
  })
  .strict()

const SearchMemoryOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    matches: z.array(MemoryEvidenceSchema),
  })
  .strict()

const ConsolidateMemoryResultSchema = z.union([
  z
    .object({
      workspace: WorkspaceSchema,
      status: z.literal('no-pending'),
      dryRun: z.literal(true),
    })
    .strict(),
  z
    .object({
      workspace: WorkspaceSchema,
      status: z.literal('no-pending'),
      dryRun: z.literal(false),
    })
    .strict(),
  z
    .object({
      workspace: WorkspaceSchema,
      status: z.literal('no-pending'),
      dryRun: z.literal(false),
      projection: ProjectionStatusSchema,
    })
    .strict(),
  z
    .object({
      workspace: WorkspaceSchema,
      status: z.literal('preview'),
      dryRun: z.literal(true),
      firstSequence: PositiveIntegerSchema,
      lastSequence: PositiveIntegerSchema,
      entryCount: PositiveIntegerSchema,
      summary: MemorySummarySchema,
    })
    .strict(),
  z
    .object({
      workspace: WorkspaceSchema,
      status: z.literal('conflict'),
      dryRun: z.literal(false),
      expectedBoundary: NonNegativeIntegerSchema,
      actualBoundary: NonNegativeIntegerSchema,
    })
    .strict(),
  z
    .object({
      workspace: WorkspaceSchema,
      status: z.literal('completed'),
      dryRun: z.literal(false),
      consolidation: CompletedConsolidationSchema,
      entryCount: PositiveIntegerSchema,
      projectionStale: z.boolean(),
    })
    .strict(),
])

const ConsolidateMemoryOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    status: z.enum(['no-pending', 'preview', 'conflict', 'completed']),
    dryRun: z.boolean(),
    projection: ProjectionStatusSchema.optional(),
    firstSequence: PositiveIntegerSchema.optional(),
    lastSequence: PositiveIntegerSchema.optional(),
    entryCount: PositiveIntegerSchema.optional(),
    summary: MemorySummarySchema.optional(),
    expectedBoundary: NonNegativeIntegerSchema.optional(),
    actualBoundary: NonNegativeIntegerSchema.optional(),
    consolidation: CompletedConsolidationSchema.optional(),
    projectionStale: z.boolean().optional(),
  })
  .strict()

const RecallStatusOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    sources: NonNegativeIntegerSchema,
    rawMessages: NonNegativeIntegerSchema,
    derivedSummaries: NonNegativeIntegerSchema,
  })
  .strict()

const RecallSessionOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ sessionId: z.string(), status: z.literal('current') }).strict(),
  z
    .object({ sessionId: z.string(), status: z.literal('would-import') })
    .strict(),
  z
    .object({ sessionId: z.string(), status: z.literal('would-refresh') })
    .strict(),
  z.object({ sessionId: z.string(), status: z.literal('imported') }).strict(),
  z.object({ sessionId: z.string(), status: z.literal('refreshed') }).strict(),
])

const RecallImportOutputSchema = z
  .object({
    workspace: WorkspaceSchema,
    sourceDbPath: z.string(),
    dryRun: z.boolean(),
    totalSessions: NonNegativeIntegerSchema,
    imported: NonNegativeIntegerSchema,
    changed: NonNegativeIntegerSchema,
    skippedExisting: NonNegativeIntegerSchema,
    importedSessions: z.array(z.string()),
    sessionOutcomes: z.array(RecallSessionOutcomeSchema),
  })
  .strict()

export type SummaryMcpResult = z.infer<typeof SummaryOutputSchema>
export type AppendMemoryMcpResult = z.infer<typeof AppendMemoryOutputSchema>
export type SearchMemoryMcpResult = z.infer<typeof SearchMemoryOutputSchema>
export type ConsolidateMemoryMcpResult = z.infer<
  typeof ConsolidateMemoryResultSchema
>
export type RecallStatusMcpResult = z.infer<typeof RecallStatusOutputSchema>
export type RecallImportMcpResult = z.infer<typeof RecallImportOutputSchema>

export function summaryOutputSchema(): typeof SummaryOutputSchema {
  return SummaryOutputSchema
}

export function appendMemoryOutputSchema(): typeof AppendMemoryOutputSchema {
  return AppendMemoryOutputSchema
}

export function searchMemoryOutputSchema(): typeof SearchMemoryOutputSchema {
  return SearchMemoryOutputSchema
}

export function consolidateMemoryOutputSchema(): typeof ConsolidateMemoryOutputSchema {
  return ConsolidateMemoryOutputSchema
}

export function consolidateMemoryResultSchema(): typeof ConsolidateMemoryResultSchema {
  return ConsolidateMemoryResultSchema
}

export function recallStatusOutputSchema(): typeof RecallStatusOutputSchema {
  return RecallStatusOutputSchema
}

export function recallImportOutputSchema(): typeof RecallImportOutputSchema {
  return RecallImportOutputSchema
}
