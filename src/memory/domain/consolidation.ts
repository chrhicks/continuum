import { Schema } from 'effect'

export const ConsolidationStatus = Schema.Literal(
  'pending',
  'completed',
  'failed',
)

export const MemoryConsolidation = Schema.Struct({
  id: Schema.String,
  firstSequence: Schema.Int.pipe(Schema.positive()),
  lastSequence: Schema.Int.pipe(Schema.positive()),
  status: ConsolidationStatus,
  summary: Schema.NullOr(Schema.Unknown),
  summaryVersion: Schema.Int.pipe(Schema.positive()),
  model: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
})
export type MemoryConsolidation = typeof MemoryConsolidation.Type
