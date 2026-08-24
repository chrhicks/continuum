import { Schema } from 'effect'

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const JournalMetadata = Schema.Struct({
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  taskIds: Schema.optionalKey(Schema.Array(Schema.String)),
  filePaths: Schema.optionalKey(Schema.Array(Schema.String)),
  toolNames: Schema.optionalKey(Schema.Array(Schema.String)),
  operationId: Schema.optionalKey(Schema.String),
})
export interface JournalMetadata extends Schema.Schema.Type<
  typeof JournalMetadata
> {}

export const JournalAppendInput = Schema.Struct({
  id: Schema.optionalKey(Schema.NonEmptyString),
  kind: Schema.NonEmptyString,
  content: Schema.NonEmptyString,
  source: Schema.optionalKey(Schema.NonEmptyString),
  sourceProjectId: Schema.optionalKey(Schema.NonEmptyString),
  sourceSessionId: Schema.optionalKey(Schema.NonEmptyString),
  idempotencyKey: Schema.optionalKey(Schema.NonEmptyString),
  metadata: Schema.optionalKey(JournalMetadata),
  payloadVersion: Schema.optionalKey(PositiveInt),
  createdAt: Schema.optionalKey(Schema.NonEmptyString),
})
export interface JournalAppendInput extends Schema.Schema.Type<
  typeof JournalAppendInput
> {}

export const JournalEntry = Schema.Struct({
  sequence: PositiveInt,
  id: Schema.String,
  kind: Schema.String,
  content: Schema.String,
  source: Schema.NullOr(Schema.String),
  sourceProjectId: Schema.NullOr(Schema.String),
  sourceSessionId: Schema.NullOr(Schema.String),
  idempotencyKey: Schema.NullOr(Schema.String),
  metadata: JournalMetadata,
  payloadVersion: PositiveInt,
  createdAt: Schema.String,
})
export interface JournalEntry extends Schema.Schema.Type<typeof JournalEntry> {}
