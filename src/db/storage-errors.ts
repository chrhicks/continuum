import { Schema } from 'effect'

const CanonicalStorageErrorCode = Schema.Literals([
  'STORAGE_MIGRATION_CONFLICT',
  'STORAGE_MIGRATION_FAILED',
  'STORAGE_READ_ONLY_UNAVAILABLE',
  'STORAGE_WORKSPACE_COLLISION',
])

type CanonicalStorageErrorCode = typeof CanonicalStorageErrorCode.Type

export class CanonicalStorageError extends Schema.TaggedError<CanonicalStorageError>()(
  'CanonicalStorageError',
  {
    code: CanonicalStorageErrorCode,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export function isCanonicalStorageError(
  error: unknown,
): error is CanonicalStorageError {
  return error instanceof CanonicalStorageError
}

export function migrationConflict(
  sourcePath: string,
  destinationPath: string,
): CanonicalStorageError {
  return new CanonicalStorageError({
    code: 'STORAGE_MIGRATION_CONFLICT',
    message:
      `Legacy and canonical databases are divergent (${sourcePath} vs ${destinationPath}). ` +
      'Neither database was overwritten; reconcile them explicitly before retrying.',
  })
}

export function sourceChangedDuringMigration(
  sourcePath: string,
): CanonicalStorageError {
  return new CanonicalStorageError({
    code: 'STORAGE_MIGRATION_CONFLICT',
    message:
      `Legacy database changed during migration: ${sourcePath}. ` +
      'No removal receipt was recorded; retry only after legacy writes stop.',
  })
}

export function workspaceCollision(
  registeredPath: string,
  requestedPath: string,
): CanonicalStorageError {
  return new CanonicalStorageError({
    code: 'STORAGE_WORKSPACE_COLLISION',
    message:
      `Workspace identity is already active at ${registeredPath}; refusing to open it from ${requestedPath}. ` +
      'Run `continuum workspace fork` from the copied workspace to create an independent identity and database.',
  })
}

export function migrationFailure(
  message: string,
  cause?: unknown,
): CanonicalStorageError {
  return new CanonicalStorageError({
    code: 'STORAGE_MIGRATION_FAILED',
    message,
    ...(cause === undefined ? {} : { cause }),
  })
}

export function readOnlyUnavailable(
  message: string,
  cause?: unknown,
): CanonicalStorageError {
  return new CanonicalStorageError({
    code: 'STORAGE_READ_ONLY_UNAVAILABLE',
    message,
    ...(cause === undefined ? {} : { cause }),
  })
}
