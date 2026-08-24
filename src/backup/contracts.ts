import { createHash } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { BackupDecodeError, causeMessage } from './errors'

const BACKUP_FORMAT_VERSION = 1 as const
const BACKUP_OBJECT_PREFIX = 'continuum/v1/projects'
const Uuid = Schema.String.check(Schema.isUUID())
const Generation = Schema.String.check(
  Schema.isPattern(/^\d{8}T\d{9}Z-[0-9a-f-]{36}$/),
)
const IsoDate = Schema.String.check(
  Schema.makeFilter((value) =>
    Number.isFinite(Date.parse(value)) ? undefined : 'Expected a valid date',
  ),
)
const Digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))

const BackupConfigSchema = Schema.Struct({
  formatVersion: Schema.Literal(BACKUP_FORMAT_VERSION),
  bucket: Schema.NonEmptyString,
  projectId: Uuid,
  writerId: Uuid,
  createdAt: IsoDate,
})

export interface BackupConfig extends Schema.Schema.Type<
  typeof BackupConfigSchema
> {}

const BackupDatabaseMetadataSchema = Schema.Struct({
  applicationVersion: Schema.NonEmptyString,
  migrationCreatedAt: Schema.NullOr(Schema.Natural),
  migrationHash: Schema.NullOr(Schema.NonEmptyString),
  tables: Schema.Array(Schema.String),
})

export interface BackupDatabaseMetadata extends Schema.Schema.Type<
  typeof BackupDatabaseMetadataSchema
> {}

const BackupManifestSchema = Schema.Struct({
  formatVersion: Schema.Literal(BACKUP_FORMAT_VERSION),
  projectId: Uuid,
  generation: Generation,
  parentGeneration: Schema.NullOr(Generation),
  createdAt: IsoDate,
  writerId: Uuid,
  database: Schema.Struct({
    objectKey: Schema.NonEmptyString,
    algorithm: Schema.Literal('sha256'),
    digest: Digest,
    byteLength: Schema.Natural,
  }),
  metadata: BackupDatabaseMetadataSchema,
})

export interface BackupManifest extends Schema.Schema.Type<
  typeof BackupManifestSchema
> {}

const BackupHeadSchema = Schema.Struct({
  formatVersion: Schema.Literal(BACKUP_FORMAT_VERSION),
  projectId: Uuid,
  generation: Generation,
  manifestKey: Schema.NonEmptyString,
  writerId: Uuid,
  updatedAt: IsoDate,
})

export interface BackupHead extends Schema.Schema.Type<
  typeof BackupHeadSchema
> {}

function projectPrefix(projectId: string): string {
  return `${BACKUP_OBJECT_PREFIX}/${projectId}`
}

function generationPrefix(projectId: string, generation: string): string {
  return `${projectPrefix(projectId)}/generations/${generation}`
}

export function databaseObjectKey(
  projectId: string,
  generation: string,
): string {
  return `${generationPrefix(projectId, generation)}/continuum.sqlite`
}

export function manifestObjectKey(
  projectId: string,
  generation: string,
): string {
  return `${generationPrefix(projectId, generation)}/manifest.json`
}

export function headObjectKey(projectId: string): string {
  return `${projectPrefix(projectId)}/head.json`
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

export const decodeBackupConfig = Effect.fn('Backup.decodeConfig')(function* (
  bytes: Uint8Array,
) {
  const value = yield* parseJson(bytes, 'backup configuration')
  const config = yield* Schema.decodeUnknownEffect(BackupConfigSchema)(
    value,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new BackupDecodeError({
          code: 'BACKUP_DECODE_ERROR',
          source: 'backup configuration',
          message: `Invalid backup configuration: ${causeMessage(cause)}`,
          cause,
        }),
    ),
  )
  return {
    ...config,
    projectId: config.projectId.toLowerCase(),
    writerId: config.writerId.toLowerCase(),
  }
})

export const decodeBackupManifest = Effect.fn('Backup.decodeManifest')(
  function* (bytes: Uint8Array) {
    const value = yield* parseJson(bytes, 'backup manifest')
    const manifest = yield* Schema.decodeUnknownEffect(BackupManifestSchema)(
      value,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new BackupDecodeError({
            code: 'BACKUP_DECODE_ERROR',
            source: 'backup manifest',
            message: `Invalid backup manifest: ${causeMessage(cause)}`,
            cause,
          }),
      ),
    )
    return {
      ...manifest,
      projectId: manifest.projectId.toLowerCase(),
      writerId: manifest.writerId.toLowerCase(),
      metadata: {
        ...manifest.metadata,
        tables: [...manifest.metadata.tables].sort(),
      },
    }
  },
)

export const decodeBackupHead = Effect.fn('Backup.decodeHead')(function* (
  bytes: Uint8Array,
) {
  const value = yield* parseJson(bytes, 'backup head')
  const head = yield* Schema.decodeUnknownEffect(BackupHeadSchema)(value).pipe(
    Effect.mapError(
      (cause) =>
        new BackupDecodeError({
          code: 'BACKUP_DECODE_ERROR',
          source: 'backup head',
          message: `Invalid backup head: ${causeMessage(cause)}`,
          cause,
        }),
    ),
  )
  return {
    ...head,
    projectId: head.projectId.toLowerCase(),
    writerId: head.writerId.toLowerCase(),
  }
})

export function bytesDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseJson(
  bytes: Uint8Array,
  source: string,
): Effect.Effect<unknown, BackupDecodeError> {
  return Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(bytes)),
    catch: (cause) =>
      new BackupDecodeError({
        code: 'BACKUP_DECODE_ERROR',
        source,
        message: `Invalid ${source} JSON: ${causeMessage(cause)}`,
        cause,
      }),
  })
}
