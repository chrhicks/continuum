import { Effect } from 'effect'
import {
  bytesDigest,
  databaseObjectKey,
  decodeBackupHead,
  decodeBackupManifest,
  encodeJson,
  headObjectKey,
  manifestObjectKey,
  type BackupConfig,
  type BackupHead,
  type BackupManifest,
} from './contracts'
import {
  BackupIdentityConflict,
  BackupLineageError,
  BackupRemoteError,
} from './errors'
import { BackupObjectStore } from './object-store'

export const readHead = Effect.fn('Backup.readHead')(function* (
  config: BackupConfig,
) {
  const store = yield* BackupObjectStore
  const bytes = yield* store.get(headObjectKey(config.projectId))
  if (!bytes) return null
  const head = yield* decodeBackupHead(bytes)
  if (head.projectId !== config.projectId) {
    return yield* Effect.fail(
      identityConflict('Remote backup head has a different project identity'),
    )
  }
  if (head.writerId !== config.writerId) {
    return yield* Effect.fail(
      identityConflict(
        `Remote backup writer conflict: expected ${config.writerId}, found ${head.writerId}`,
      ),
    )
  }
  const expectedKey = manifestObjectKey(config.projectId, head.generation)
  if (head.manifestKey !== expectedKey) {
    return yield* Effect.fail(
      identityConflict('Remote backup head contains an invalid manifest key'),
    )
  }
  return head
})

export const requireHead = Effect.fn('Backup.requireHead')(function* (
  config: BackupConfig,
) {
  const head = yield* readHead(config)
  if (head) return head
  return yield* Effect.fail(
    new BackupLineageError({
      code: 'BACKUP_LINEAGE_ERROR',
      message: 'No remote backup head exists for this project',
    }),
  )
})

export const readManifest = Effect.fn('Backup.readManifest')(function* (
  config: BackupConfig,
  generation: string,
) {
  const store = yield* BackupObjectStore
  const key = manifestObjectKey(config.projectId, generation)
  const bytes = yield* store.get(key)
  if (!bytes) {
    return yield* Effect.fail(
      new BackupRemoteError({
        code: 'BACKUP_REMOTE_ERROR',
        operation: 'download manifest',
        key,
        message: `Backup manifest is missing: ${generation}`,
      }),
    )
  }
  const manifest = yield* decodeBackupManifest(bytes)
  if (
    manifest.projectId !== config.projectId ||
    manifest.generation !== generation
  ) {
    return yield* Effect.fail(
      identityConflict(`Backup manifest identity mismatch: ${generation}`),
    )
  }
  if (manifest.writerId !== config.writerId) {
    return yield* Effect.fail(
      identityConflict(`Backup manifest writer conflict: ${generation}`),
    )
  }
  const expectedDatabaseKey = databaseObjectKey(config.projectId, generation)
  if (manifest.database.objectKey !== expectedDatabaseKey) {
    return yield* Effect.fail(
      identityConflict(`Backup manifest database key mismatch: ${generation}`),
    )
  }
  return manifest
})

export const assertHeadUnchanged = Effect.fn('Backup.assertHeadUnchanged')(
  function* (config: BackupConfig, initial: BackupHead | null) {
    const current = yield* readHead(config)
    if (current?.generation !== initial?.generation) {
      return yield* Effect.fail(
        identityConflict(
          'Remote backup head changed during upload; immutable objects were retained but the stale head was not published',
        ),
      )
    }
  },
)

export const publishHead = Effect.fn('Backup.publishHead')(function* (
  config: BackupConfig,
  manifest: BackupManifest,
  manifestKey: string,
  now: Date,
) {
  const store = yield* BackupObjectStore
  const head: BackupHead = {
    formatVersion: 1,
    projectId: config.projectId,
    generation: manifest.generation,
    manifestKey,
    writerId: config.writerId,
    updatedAt: now.toISOString(),
  }
  const content = encodeJson(head)
  const key = headObjectKey(config.projectId)
  yield* store.put(key, content, 'application/json')
  const published = yield* store.get(key)
  if (!published || bytesDigest(published) !== bytesDigest(content)) {
    return yield* Effect.fail(
      new BackupRemoteError({
        code: 'BACKUP_REMOTE_ERROR',
        operation: 'verify head publication',
        key,
        message: 'Remote backup head publication could not be verified',
      }),
    )
  }
})

function identityConflict(message: string): BackupIdentityConflict {
  return new BackupIdentityConflict({
    code: 'BACKUP_IDENTITY_CONFLICT',
    message,
  })
}
