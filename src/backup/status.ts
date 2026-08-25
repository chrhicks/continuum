import { Effect, Result } from 'effect'
import { createReadOnlyClient } from '../db/client'
import { observeStorageAuthority } from '../db/storage-authority'
import {
  type CanonicalStorageError,
  isCanonicalStorageError,
  migrationFailure,
} from '../db/storage-errors'
import {
  readDatabaseSnapshot,
  type DatabaseSnapshot,
} from '../db/storage-snapshot'
import { currentDate } from './authority'
import type { BackupManifest } from './contracts'
import { BackupConfiguration } from './config'
import { readHead, readManifest } from './remote'

export const BACKUP_FRESHNESS_THRESHOLD_SECONDS = 24 * 60 * 60

export type BackupStatusState =
  | 'missing'
  | 'fresh'
  | 'stale'
  | 'divergent'
  | 'remote-error'

export type BackupStatus = {
  state: BackupStatusState
  checkedAt: string
  staleAfterSeconds: number
  local: {
    digest: string
    byteLength: number
  }
  remote: {
    generation: string
    digest: string
    byteLength: number
    updatedAt: string
    ageSeconds: number
  } | null
  errorCode: string | null
}

export const getBackupStatus = Effect.fn('Backup.status')(function* (
  workspaceRoot: string,
) {
  const config = yield* BackupConfiguration
  const snapshot = yield* readLocalSnapshot(workspaceRoot)
  const now = yield* currentDate
  const checkedAt = now.toISOString()
  const local = {
    digest: snapshot.fingerprint.digest,
    byteLength: snapshot.fingerprint.byteLength,
  }
  const remoteResult = yield* Effect.result(
    Effect.gen(function* () {
      const head = yield* readHead(config)
      if (!head) return null
      const manifest = yield* readManifest(config, head.generation)
      return { head, manifest }
    }),
  )

  if (Result.isFailure(remoteResult)) {
    return statusResult({
      state: 'remote-error',
      checkedAt,
      local,
      remote: null,
      errorCode: remoteResult.failure.code,
    })
  }
  if (remoteResult.success === null) {
    return statusResult({
      state: 'missing',
      checkedAt,
      local,
      remote: null,
      errorCode: null,
    })
  }

  const { head, manifest } = remoteResult.success
  const ageMillis = now.getTime() - Date.parse(head.updatedAt)
  const remote = remoteStatus(manifest, head.updatedAt, ageMillis)
  const state = classifyStatus(
    local.digest,
    remote.digest,
    ageMillis,
    BACKUP_FRESHNESS_THRESHOLD_SECONDS * 1_000,
  )
  return statusResult({ state, checkedAt, local, remote, errorCode: null })
})

function readLocalSnapshot(
  workspaceRoot: string,
): Effect.Effect<DatabaseSnapshot, CanonicalStorageError> {
  return Effect.try({
    try: () => {
      const dbPath = observeStorageAuthority(workspaceRoot).dbPath
      const client = createReadOnlyClient(dbPath)
      try {
        return readDatabaseSnapshot(dbPath)
      } finally {
        client.sqlite.close()
      }
    },
    catch: (cause) =>
      isCanonicalStorageError(cause)
        ? cause
        : migrationFailure('Unable to inspect local backup state', cause),
  })
}

function classifyStatus(
  localDigest: string,
  remoteDigest: string,
  ageMillis: number,
  staleAfterMillis: number,
): BackupStatusState {
  if (localDigest !== remoteDigest) return 'divergent'
  if (ageMillis < 0 || ageMillis > staleAfterMillis) return 'stale'
  return 'fresh'
}

function remoteStatus(
  manifest: BackupManifest,
  updatedAt: string,
  ageMillis: number,
): NonNullable<BackupStatus['remote']> {
  return {
    generation: manifest.generation,
    digest: manifest.database.digest,
    byteLength: manifest.database.byteLength,
    updatedAt,
    ageSeconds: Math.floor(ageMillis / 1_000),
  }
}

function statusResult(
  input: Omit<BackupStatus, 'staleAfterSeconds'>,
): BackupStatus {
  return {
    ...input,
    staleAfterSeconds: BACKUP_FRESHNESS_THRESHOLD_SECONDS,
  }
}
