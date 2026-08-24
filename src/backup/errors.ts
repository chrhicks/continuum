import { Schema } from 'effect'

export class BackupConfigurationError extends Schema.TaggedError<BackupConfigurationError>()(
  'BackupConfigurationError',
  {
    code: Schema.Literal('BACKUP_CONFIGURATION_ERROR'),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class BackupDecodeError extends Schema.TaggedError<BackupDecodeError>()(
  'BackupDecodeError',
  {
    code: Schema.Literal('BACKUP_DECODE_ERROR'),
    source: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class BackupRemoteError extends Schema.TaggedError<BackupRemoteError>()(
  'BackupRemoteError',
  {
    code: Schema.Literal('BACKUP_REMOTE_ERROR'),
    operation: Schema.String,
    key: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class BackupIdentityConflict extends Schema.TaggedError<BackupIdentityConflict>()(
  'BackupIdentityConflict',
  {
    code: Schema.Literal('BACKUP_IDENTITY_CONFLICT'),
    message: Schema.String,
  },
) {}

export class BackupLineageError extends Schema.TaggedError<BackupLineageError>()(
  'BackupLineageError',
  {
    code: Schema.Literal('BACKUP_LINEAGE_ERROR'),
    message: Schema.String,
  },
) {}

export class BackupIntegrityError extends Schema.TaggedError<BackupIntegrityError>()(
  'BackupIntegrityError',
  {
    code: Schema.Literal('BACKUP_INTEGRITY_ERROR'),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class BackupRestoreConflict extends Schema.TaggedError<BackupRestoreConflict>()(
  'BackupRestoreConflict',
  {
    code: Schema.Literal('BACKUP_RESTORE_CONFLICT'),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export type BackupError =
  | BackupConfigurationError
  | BackupDecodeError
  | BackupRemoteError
  | BackupIdentityConflict
  | BackupLineageError
  | BackupIntegrityError
  | BackupRestoreConflict

export function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
