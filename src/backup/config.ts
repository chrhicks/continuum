import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Effect } from 'effect'
import { currentDate, randomUuid } from './authority'
import { decodeBackupConfig, encodeJson, type BackupConfig } from './contracts'
import { BackupConfigurationError, causeMessage } from './errors'

const CONFIG_FILE = 'r2-backup.json'

export type ConfigureBackupInput = {
  workspaceRoot: string
  bucket: string
  projectId?: string
  writerId?: string
}

export const configureBackup = Effect.fn('Backup.configure')(function* (
  input: ConfigureBackupInput,
) {
  yield* validateBucket(input.bucket)
  const path = backupConfigPath(input.workspaceRoot)
  if (existsSync(path)) {
    const existing = yield* readBackupConfig(input.workspaceRoot)
    yield* assertCompatible(existing, input)
    return existing
  }

  const projectId = input.projectId ?? (yield* randomUuid())
  const writerId = input.writerId ?? (yield* randomUuid())
  const now = yield* currentDate
  const config = yield* decodeBackupConfig(
    encodeJson({
      formatVersion: 1,
      bucket: input.bucket,
      projectId,
      writerId,
      createdAt: now.toISOString(),
    }),
  )
  yield* writeConfig(path, config)
  return config
})

export const readBackupConfig = Effect.fn('Backup.readConfig')(function* (
  workspaceRoot: string,
) {
  const path = backupConfigPath(workspaceRoot)
  if (!existsSync(path)) {
    return yield* Effect.fail(
      configurationError(
        'R2 backup is not configured. Run continuum backup configure --bucket <name>.',
      ),
    )
  }
  const bytes = yield* Effect.try({
    try: () => readFileSync(path),
    catch: (cause) =>
      configurationError(
        `Unable to read R2 backup configuration: ${causeMessage(cause)}`,
        cause,
      ),
  })
  return yield* decodeBackupConfig(bytes)
})

function backupConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.continuum', CONFIG_FILE)
}

function writeConfig(
  path: string,
  config: BackupConfig,
): Effect.Effect<void, BackupConfigurationError> {
  return Effect.try({
    try: () => {
      mkdirSync(dirname(path), { recursive: true })
      const staging = `${path}.${process.pid}-${randomUUID()}.tmp`
      try {
        writeFileSync(staging, encodeJson(config), { mode: 0o600, flag: 'wx' })
        renameSync(staging, path)
      } finally {
        rmSync(staging, { force: true })
      }
    },
    catch: (cause) =>
      configurationError(
        `Unable to write R2 backup configuration: ${causeMessage(cause)}`,
        cause,
      ),
  })
}

function validateBucket(
  bucket: string,
): Effect.Effect<void, BackupConfigurationError> {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
    ? Effect.void
    : Effect.fail(configurationError(`Invalid R2 bucket name: ${bucket}`))
}

function assertCompatible(
  existing: BackupConfig,
  input: ConfigureBackupInput,
): Effect.Effect<void, BackupConfigurationError> {
  if (existing.bucket !== input.bucket) {
    return Effect.fail(
      configurationError(
        `R2 backup is already configured for bucket ${existing.bucket}`,
      ),
    )
  }
  if (input.projectId && existing.projectId !== input.projectId.toLowerCase()) {
    return Effect.fail(
      configurationError(
        'R2 backup is already configured with another project ID',
      ),
    )
  }
  if (input.writerId && existing.writerId !== input.writerId.toLowerCase()) {
    return Effect.fail(
      configurationError(
        'R2 backup is already configured with another writer ID',
      ),
    )
  }
  return Effect.void
}

function configurationError(
  message: string,
  cause?: unknown,
): BackupConfigurationError {
  return new BackupConfigurationError({
    code: 'BACKUP_CONFIGURATION_ERROR',
    message,
    ...(cause === undefined ? {} : { cause }),
  })
}
