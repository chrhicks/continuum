import { Schema } from 'effect'

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const RecallSource = Schema.Struct({
  id: Schema.String,
  harness: Schema.String,
  externalProjectId: Schema.NullOr(Schema.String),
  externalSessionId: Schema.String,
  title: Schema.NullOr(Schema.String),
  sourceCreatedAt: Schema.NullOr(Schema.String),
  sourceUpdatedAt: Schema.NullOr(Schema.String),
  fingerprint: Schema.String,
  firstIngestedAt: Schema.String,
  lastIngestedAt: Schema.String,
})
export interface RecallSource extends Schema.Schema.Type<typeof RecallSource> {}

export const RecallMessage = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  sourceFingerprint: Schema.String,
  ordinal: Schema.Natural,
  role: Schema.Literals(['user', 'assistant']),
  content: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
})
export interface RecallMessage extends Schema.Schema.Type<
  typeof RecallMessage
> {}

export const RecallSummary = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  summary: Schema.Unknown,
  summaryVersion: PositiveInt,
  model: Schema.NullOr(Schema.String),
  sourceFingerprint: Schema.String,
  createdAt: Schema.String,
})
export interface RecallSummary extends Schema.Schema.Type<
  typeof RecallSummary
> {}
