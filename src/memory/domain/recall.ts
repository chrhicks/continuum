import { Schema } from 'effect'

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

export const RecallMessage = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  sourceFingerprint: Schema.String,
  ordinal: Schema.Int.pipe(Schema.nonNegative()),
  role: Schema.Literal('user', 'assistant'),
  content: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
})

export const RecallSummary = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  summary: Schema.Unknown,
  summaryVersion: Schema.Int.pipe(Schema.positive()),
  model: Schema.NullOr(Schema.String),
  sourceFingerprint: Schema.String,
  createdAt: Schema.String,
})

export type RecallSource = typeof RecallSource.Type
export type RecallMessage = typeof RecallMessage.Type
export type RecallSummary = typeof RecallSummary.Type
