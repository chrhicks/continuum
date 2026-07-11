import { Schema } from 'effect'

export const JournalMetadata = Schema.Struct({
  tags: Schema.optional(Schema.Array(Schema.String)),
  taskIds: Schema.optional(Schema.Array(Schema.String)),
  filePaths: Schema.optional(Schema.Array(Schema.String)),
  toolNames: Schema.optional(Schema.Array(Schema.String)),
  operationId: Schema.optional(Schema.String),
})
export type JournalMetadata = typeof JournalMetadata.Type

export const JournalAppendInput = Schema.Struct({
  id: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  kind: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.String.pipe(Schema.minLength(1)),
  source: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  sourceProjectId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  sourceSessionId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  idempotencyKey: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  metadata: Schema.optional(JournalMetadata),
  payloadVersion: Schema.optional(Schema.Int.pipe(Schema.positive())),
  createdAt: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
})
export type JournalAppendInput = typeof JournalAppendInput.Type

export const JournalEntry = Schema.Struct({
  sequence: Schema.Int.pipe(Schema.positive()),
  id: Schema.String,
  kind: Schema.String,
  content: Schema.String,
  source: Schema.NullOr(Schema.String),
  sourceProjectId: Schema.NullOr(Schema.String),
  sourceSessionId: Schema.NullOr(Schema.String),
  idempotencyKey: Schema.NullOr(Schema.String),
  metadata: JournalMetadata,
  payloadVersion: Schema.Int.pipe(Schema.positive()),
  createdAt: Schema.String,
})
export type JournalEntry = typeof JournalEntry.Type
