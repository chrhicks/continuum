import { Data } from 'effect'

export class DatabaseOpenError extends Data.TaggedError('DatabaseOpenError')<{
  readonly path: string
  readonly cause: unknown
}> {}

export class DatabaseMigrationError extends Data.TaggedError(
  'DatabaseMigrationError',
)<{ readonly path: string; readonly cause: unknown }> {}

export class DatabaseQueryError extends Data.TaggedError('DatabaseQueryError')<{
  readonly operation: string
  readonly cause: unknown
}> {}

export class DatabaseBusyError extends Data.TaggedError('DatabaseBusyError')<{
  readonly operation: string
  readonly cause: unknown
}> {}

export class DecodeError extends Data.TaggedError('DecodeError')<{
  readonly schema: string
  readonly field?: string
  readonly cause: unknown
}> {}

export class JournalAppendError extends Data.TaggedError('JournalAppendError')<{
  readonly cause: unknown
}> {}

export class JournalIdempotencyError extends Data.TaggedError(
  'JournalIdempotencyError',
)<{ readonly key: string }> {}

export class ConsolidationSnapshotError extends Data.TaggedError(
  'ConsolidationSnapshotError',
)<{ readonly cause: unknown }> {}

export class ConsolidationSummarizationError extends Data.TaggedError(
  'ConsolidationSummarizationError',
)<{ readonly cause: unknown }> {}

export class ConsolidationPersistenceError extends Data.TaggedError(
  'ConsolidationPersistenceError',
)<{ readonly cause: unknown }> {}

export class ConsolidationConflictError extends Data.TaggedError(
  'ConsolidationConflictError',
)<{
  readonly expectedBoundary: number
  readonly actualBoundary: number
}> {}

export class RecallSourceError extends Data.TaggedError('RecallSourceError')<{
  readonly cause: unknown
}> {}

export class RecallFingerprintError extends Data.TaggedError(
  'RecallFingerprintError',
)<{ readonly cause: unknown }> {}

export class RecallIngestionError extends Data.TaggedError(
  'RecallIngestionError',
)<{
  readonly cause: unknown
}> {}

export class RecallSummaryError extends Data.TaggedError('RecallSummaryError')<{
  readonly cause: unknown
}> {}

export class ProjectionPublicationError extends Data.TaggedError(
  'ProjectionPublicationError',
)<{ readonly path: string; readonly cause: unknown }> {}

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
