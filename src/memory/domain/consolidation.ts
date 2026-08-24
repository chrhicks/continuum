import { Schema } from 'effect'

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const ConsolidationStatus = Schema.Literals([
  'pending',
  'completed',
  'failed',
])

export const MemoryConsolidation = Schema.Struct({
  id: Schema.String,
  firstSequence: PositiveInt,
  lastSequence: PositiveInt,
  status: ConsolidationStatus,
  summary: Schema.NullOr(Schema.Unknown),
  summaryVersion: PositiveInt,
  model: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
})
export interface MemoryConsolidation extends Schema.Schema.Type<
  typeof MemoryConsolidation
> {}
