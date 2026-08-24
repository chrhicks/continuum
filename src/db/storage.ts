import { existsSync } from 'node:fs'
import { Effect } from 'effect'
import { ensureProjectStorageId, normalizedWorkspacePath } from './paths'
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
  workspaceRoot: string,
  options: { initialize?: boolean; warn?: boolean } = {},
) {
  return yield* Effect.try({
    try: () => prepareCanonicalDatabase(workspaceRoot, options),
    catch: (cause) =>
      cause instanceof CanonicalStorageError
        ? cause
        : migrationFailure(
            `Unable to prepare canonical storage for ${workspaceRoot}`,
            cause,
          ),
  })
})

export function prepareCanonicalDatabase(
  workspaceRoot: string,
  options: { initialize?: boolean; warn?: boolean } = {},
): CanonicalDatabaseState {
  const identityRoot = normalizedWorkspacePath(workspaceRoot)
  const initialize = options.initialize === true
  const pathHashPaths = resolvePathHashStoragePaths(identityRoot)
  const legacyExists = existsSync(pathHashPaths.sourcePath)
  const pathHashDatabaseExists = existsSync(pathHashPaths.dbPath)

  if (initialize || legacyExists || pathHashDatabaseExists) {
    ensureProjectStorageId(identityRoot)
  }

  const paths = resolveStoragePaths(identityRoot)
  if (pathHashPaths.dbPath !== paths.dbPath && pathHashDatabaseExists) {
    upgradePathHashStorage(identityRoot, pathHashPaths, paths)
  }

  const destinationExisted = existsSync(paths.dbPath)
  if (!existsSync(paths.sourcePath)) {
    return prepareWithoutLegacy(
      identityRoot,
      paths,
      initialize,
      destinationExisted,
    )
  }

  const source = readDatabaseSnapshot(paths.sourcePath)
  if (existsSync(paths.receiptPath)) {
    return verifyRecordedMigration(identityRoot, paths, source, options.warn)
  }
  if (destinationExisted) {
    return adoptLineageDestination(identityRoot, paths, source, options.warn)
  }
  if (!initialize) {
    throw migrationFailure(
      `Legacy database requires one-time migration: ${paths.sourcePath}. ` +
        'Run `continuum init` before using this workspace.',
    )
  }
  return migrateLegacyDatabase(identityRoot, paths, source, options.warn)
}
