export class CanonicalStorageError extends Error {
  readonly code: 'STORAGE_MIGRATION_CONFLICT' | 'STORAGE_MIGRATION_FAILED'

  constructor(
    code: 'STORAGE_MIGRATION_CONFLICT' | 'STORAGE_MIGRATION_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function isCanonicalStorageError(
  error: unknown,
): error is CanonicalStorageError {
  return error instanceof CanonicalStorageError
}

export function migrationConflict(
  sourcePath: string,
  destinationPath: string,
): CanonicalStorageError {
  return new CanonicalStorageError(
    'STORAGE_MIGRATION_CONFLICT',
    `Legacy and canonical databases are divergent (${sourcePath} vs ${destinationPath}). ` +
      'Neither database was overwritten; reconcile them explicitly before retrying.',
  )
}

export function sourceChangedDuringMigration(
  sourcePath: string,
): CanonicalStorageError {
  return new CanonicalStorageError(
    'STORAGE_MIGRATION_CONFLICT',
    `Legacy database changed during migration: ${sourcePath}. ` +
      'No removal receipt was recorded; retry only after legacy writes stop.',
  )
}

export function migrationFailure(
  message: string,
  cause?: unknown,
): CanonicalStorageError {
  return new CanonicalStorageError('STORAGE_MIGRATION_FAILED', message, {
    cause,
  })
}
