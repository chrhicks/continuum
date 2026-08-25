import { existsSync } from 'node:fs'
import { Effect } from 'effect'
import type { ClaimedStorageAuthority } from './storage-authority'
import {
  adoptLineageDestination,
  migrateLegacyDatabase,
  prepareWithoutLegacy,
  verifyRecordedMigration,
} from './storage-canonical'
import { CanonicalStorageError, migrationFailure } from './storage-errors'
import {
  resolvePathHashStoragePaths,
  resolveStoragePaths,
  type CanonicalDatabaseState,
} from './storage-model'
import { upgradePathHashStorage } from './storage-path-hash'
import { readDatabaseSnapshot } from './storage-snapshot'

export type { CanonicalDatabaseState } from './storage-model'

export const prepareCanonicalDatabaseEffect = Effect.fn(
  'CanonicalStorage.prepare',
)(function* (
  authority: ClaimedStorageAuthority,
  options: { initialize?: boolean; warn?: boolean } = {},
) {
  return yield* Effect.try({
    try: () => prepareCanonicalDatabase(authority, options),
    catch: (cause) =>
      cause instanceof CanonicalStorageError
        ? cause
        : migrationFailure(
            `Unable to prepare canonical storage for ${authority.workspacePath}`,
            cause,
          ),
  })
})

export function prepareCanonicalDatabase(
  authority: ClaimedStorageAuthority,
  options: { initialize?: boolean; warn?: boolean } = {},
): CanonicalDatabaseState {
  const initialize = options.initialize === true
  const pathHashPaths = resolvePathHashStoragePaths(authority)
  const legacyExists = existsSync(pathHashPaths.sourcePath)
  const pathHashDatabaseExists = existsSync(pathHashPaths.dbPath)
  const paths = resolveStoragePaths(authority)

  if (pathHashPaths.dbPath !== paths.dbPath && pathHashDatabaseExists) {
    upgradePathHashStorage(authority, pathHashPaths, paths)
  }

  const destinationExisted = existsSync(paths.dbPath)
  if (!legacyExists) {
    return prepareWithoutLegacy(
      authority,
      paths,
      initialize,
      destinationExisted,
    )
  }

  const source = readDatabaseSnapshot(paths.sourcePath)
  if (existsSync(paths.receiptPath)) {
    return verifyRecordedMigration(authority, paths, source, options.warn)
  }
  if (destinationExisted) {
    return adoptLineageDestination(authority, paths, source, options.warn)
  }
  if (!initialize) {
    throw migrationFailure(
      `Legacy database requires one-time migration: ${paths.sourcePath}. ` +
        'Run `continuum init` before using this workspace.',
    )
  }
  return migrateLegacyDatabase(authority, paths, source, options.warn)
}
