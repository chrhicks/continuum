import { Schema } from 'effect'

export class DatabaseOpenError extends Schema.TaggedError<DatabaseOpenError>()(
  'DatabaseOpenError',
  { path: Schema.String, cause: Schema.Defect() },
) {}

export class DatabaseMigrationError extends Schema.TaggedError<DatabaseMigrationError>()(
  'DatabaseMigrationError',
  { path: Schema.String, cause: Schema.Defect() },
) {}

export class DatabaseQueryError extends Schema.TaggedError<DatabaseQueryError>()(
  'DatabaseQueryError',
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class DatabaseBusyError extends Schema.TaggedError<DatabaseBusyError>()(
  'DatabaseBusyError',
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class DecodeError extends Schema.TaggedError<DecodeError>()(
  'DecodeError',
  {
    schema: Schema.String,
    field: Schema.optionalKey(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class JournalAppendError extends Schema.TaggedError<JournalAppendError>()(
  'JournalAppendError',
  { cause: Schema.Defect() },
) {}

export class ConsolidationSummarizationError extends Schema.TaggedError<ConsolidationSummarizationError>()(
  'ConsolidationSummarizationError',
  { cause: Schema.Defect() },
) {}

export class ConsolidationPersistenceError extends Schema.TaggedError<ConsolidationPersistenceError>()(
  'ConsolidationPersistenceError',
  { cause: Schema.Defect() },
) {}

export class ConsolidationConflictError extends Schema.TaggedError<ConsolidationConflictError>()(
  'ConsolidationConflictError',
  {
    expectedBoundary: Schema.Number,
    actualBoundary: Schema.Number,
  },
) {}

export class RecallSourceError extends Schema.TaggedError<RecallSourceError>()(
  'RecallSourceError',
  { cause: Schema.Defect() },
) {}

export class RecallIngestionError extends Schema.TaggedError<RecallIngestionError>()(
  'RecallIngestionError',
  { cause: Schema.Defect() },
) {}

export class RecallSummaryError extends Schema.TaggedError<RecallSummaryError>()(
  'RecallSummaryError',
  { cause: Schema.Defect() },
) {}

export class ProjectionPublicationError extends Schema.TaggedError<ProjectionPublicationError>()(
  'ProjectionPublicationError',
  { path: Schema.String, cause: Schema.Defect() },
) {}

export function databaseBusyError(
  operation: string,
  cause: unknown,
): DatabaseBusyError | null {
  if (!cause || typeof cause !== 'object') return null
  const code = 'code' in cause ? String(cause.code) : ''
  return code.includes('SQLITE_BUSY') || code.includes('SQLITE_LOCKED')
    ? new DatabaseBusyError({ operation, cause })
    : null
}
