import { join, resolve } from 'node:path'
import { Effect } from 'effect'
import { canonicalProjectDir } from '../db/paths'
import { CanonicalStorageError } from '../db/storage-errors'
import { prepareCanonicalDatabaseEffect } from '../db/storage'
import {
  publishDatabaseSnapshot,
  readDatabaseSnapshot,
  type DatabaseSnapshot,
} from '../db/storage-snapshot'
import { currentDate, randomUuid } from './authority'
import { readBackupConfig } from './config'
import {
  bytesDigest,
  databaseObjectKey,
  encodeJson,
  manifestObjectKey,
  type BackupConfig,
  type BackupHead,
  type BackupManifest,
} from './contracts'
import {
  BackupDecodeError,
  BackupIntegrityError,
  BackupLineageError,
  BackupRemoteError,
  BackupRestoreConflict,
  causeMessage,
} from './errors'
import {
  assertSnapshotMetadata,
  inspectSnapshotMetadata,
} from './database-metadata'
import { BackupObjectStore, putImmutable } from './object-store'
import {
  assertHeadUnchanged,
  publishHead,
  readHead,
  readManifest,
  requireHead,
} from './remote'

export type BackupResult = {
  generation: string
  digest: string
  byteLength: number
  parentGeneration: string | null
}

export type RestoreResult = BackupResult & { outputPath: string }

export const createBackup = Effect.fn('Backup.create')(function* (
  workspaceRoot: string,
) {
  const config = yield* readBackupConfig(workspaceRoot)
  const canonical = yield* prepareCanonicalDatabaseEffect(workspaceRoot)
  const snapshot = yield* storageTry('read database snapshot', () =>
    readDatabaseSnapshot(canonical.dbPath),
  )
  const initialHead = yield* readHead(config)
  const now = yield* currentDate
  const generation = yield* createGeneration(now)
  const manifest = yield* createManifest(
    config,
    snapshot,
    generation,
    initialHead,
    now,
  )
  const manifestKey = manifestObjectKey(config.projectId, generation)

  yield* putImmutable(
    manifest.database.objectKey,
    snapshot.bytes,
    'application/vnd.sqlite3',
  )
  yield* putImmutable(manifestKey, encodeJson(manifest), 'application/json')
  yield* assertHeadUnchanged(config, initialHead)
  yield* publishHead(config, manifest, manifestKey, now)

  return resultFromManifest(manifest)
})

export const listBackups = Effect.fn('Backup.list')(function* (
  workspaceRoot: string,
  limit = 100,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    return yield* Effect.fail(
      new BackupLineageError({
        code: 'BACKUP_LINEAGE_ERROR',
        message: 'Backup list limit must be between 1 and 1000',
      }),
    )
  }
  const config = yield* readBackupConfig(workspaceRoot)
  const head = yield* readHead(config)
  if (!head) return []

  const manifests: BackupManifest[] = []
  const visited = new Set<string>()
  let generation: string | null = head.generation
  while (generation && manifests.length < limit) {
    if (visited.has(generation)) {
      return yield* Effect.fail(
        new BackupLineageError({
          code: 'BACKUP_LINEAGE_ERROR',
          message: 'Backup manifest lineage contains a cycle',
        }),
      )
    }
    visited.add(generation)
    const manifest: BackupManifest = yield* readManifest(config, generation)
    manifests.push(manifest)
    generation = manifest.parentGeneration
  }
  return manifests
})

export const restoreBackup = Effect.fn('Backup.restore')(function* (
  workspaceRoot: string,
  options: { generation?: string; outputPath?: string } = {},
) {
  const store = yield* BackupObjectStore
  const config = yield* readBackupConfig(workspaceRoot)
  const generation =
    options.generation ?? (yield* requireHead(config)).generation
  yield* validateGenerationInput(generation)
  const manifest = yield* readManifest(config, generation)
  const bytes = yield* store.get(manifest.database.objectKey)
  if (!bytes) {
    return yield* Effect.fail(
      new BackupRemoteError({
        code: 'BACKUP_REMOTE_ERROR',
        operation: 'download database',
        key: manifest.database.objectKey,
        message: `Backup database object is missing: ${generation}`,
      }),
    )
  }
  yield* validateDatabaseBytes(manifest, bytes)

  const outputPath = resolve(
    options.outputPath ??
      join(
        canonicalProjectDir(workspaceRoot),
        'restores',
        `${generation}.sqlite`,
      ),
  )
  const snapshot: DatabaseSnapshot = {
    bytes,
    fingerprint: {
      algorithm: 'sha256',
      digest: manifest.database.digest,
      byteLength: manifest.database.byteLength,
    },
  }
  yield* Effect.try({
    try: () => publishDatabaseSnapshot(outputPath, snapshot),
    catch: (cause) =>
      new BackupRestoreConflict({
        code: 'BACKUP_RESTORE_CONFLICT',
        message: causeMessage(cause),
        cause,
      }),
  })
  return { ...resultFromManifest(manifest), outputPath }
})

function createManifest(
  config: BackupConfig,
  snapshot: DatabaseSnapshot,
  generation: string,
  head: BackupHead | null,
  now: Date,
): Effect.Effect<BackupManifest, BackupIntegrityError> {
  return storageTry(
    'inspect database snapshot',
    (): BackupManifest => ({
      formatVersion: 1,
      projectId: config.projectId,
      generation,
      parentGeneration: head?.generation ?? null,
      createdAt: now.toISOString(),
      writerId: config.writerId,
      database: {
        objectKey: databaseObjectKey(config.projectId, generation),
        ...snapshot.fingerprint,
      },
      metadata: inspectSnapshotMetadata(snapshot.bytes),
    }),
  ).pipe(
    Effect.mapError((error) =>
      error instanceof BackupIntegrityError
        ? error
        : integrityError('inspect database snapshot', error),
    ),
  )
}

function validateDatabaseBytes(
  manifest: BackupManifest,
  bytes: Uint8Array,
): Effect.Effect<void, BackupIntegrityError> {
  return storageTry('validate database snapshot', () => {
    if (
      bytes.byteLength !== manifest.database.byteLength ||
      bytesDigest(bytes) !== manifest.database.digest
    ) {
      throw new Error(
        `Backup database checksum mismatch: ${manifest.generation}`,
      )
    }
    const actual = inspectSnapshotMetadata(bytes)
    assertSnapshotMetadata(manifest.metadata, actual)
  }).pipe(
    Effect.mapError((error) =>
      error instanceof BackupIntegrityError
        ? error
        : integrityError('validate database snapshot', error),
    ),
  )
}

function createGeneration(now: Date): Effect.Effect<string> {
  return randomUuid().pipe(
    Effect.map((id) => {
      const timestamp = now.toISOString().replace(/[-:.]/g, '')
      return `${timestamp}-${id}`
    }),
  )
}

function validateGenerationInput(
  generation: string,
): Effect.Effect<void, BackupDecodeError> {
  if (/^\d{8}T\d{9}Z-[0-9a-f-]{36}$/.test(generation)) return Effect.void
  return Effect.fail(
    new BackupDecodeError({
      code: 'BACKUP_DECODE_ERROR',
      source: 'backup generation',
      message: `Invalid backup generation: ${generation}`,
    }),
  )
}

function resultFromManifest(manifest: BackupManifest): BackupResult {
  return {
    generation: manifest.generation,
    digest: manifest.database.digest,
    byteLength: manifest.database.byteLength,
    parentGeneration: manifest.parentGeneration,
  }
}

function storageTry<A>(
  operation: string,
  run: () => A,
): Effect.Effect<A, CanonicalStorageError | BackupIntegrityError> {
  return Effect.try({
    try: run,
    catch: (cause) =>
      cause instanceof CanonicalStorageError
        ? cause
        : integrityError(operation, cause),
  })
}

function integrityError(
  operation: string,
  cause: unknown,
): BackupIntegrityError {
  return new BackupIntegrityError({
    code: 'BACKUP_INTEGRITY_ERROR',
    message: `${operation}: ${causeMessage(cause)}`,
    cause,
  })
}
