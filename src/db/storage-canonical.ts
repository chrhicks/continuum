import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { projectStorageId } from './paths'
import { migrationConflict, migrationFailure } from './storage-errors'
import {
  hasEmbeddedLineage,
  hasEmbeddedStorageIdentity,
  prepareInitializedSnapshot,
  prepareMigratedSnapshot,
  type StorageLineage,
} from './storage-lineage'
import {
  makeCanonicalDatabaseState,
  type CanonicalDatabaseState,
  type StoragePaths,
} from './storage-model'
import { assertSourceUnchanged, legacyLineage } from './storage-provenance'
import {
  createMigrationReceipt,
  publishMigrationReceipt,
  readMigrationReceipt,
  verifyMigrationReceipt,
  verifyMigrationReceiptIdentity,
  warnRemovableLegacySource,
} from './storage-receipt'
import {
  publishDatabaseSnapshot,
  readDatabaseSnapshot,
  type DatabaseSnapshot,
} from './storage-snapshot'

export function prepareWithoutLegacy(
  workspaceRoot: string,
  paths: StoragePaths,
  initialize: boolean,
  destinationExisted: boolean,
): CanonicalDatabaseState {
  const receiptExists = existsSync(paths.receiptPath)
  if (!destinationExisted) {
    if (receiptExists) {
      throw migrationFailure(
        `Canonical database is missing despite migration receipt: ${paths.dbPath}`,
      )
    }
    if (initialize) {
      const projectId = projectStorageId(workspaceRoot)
      const destination = prepareInitializedSnapshot(
        projectId,
        dirname(paths.dbPath),
      )
      publishDatabaseSnapshot(paths.dbPath, destination)
    }
    return makeCanonicalDatabaseState(paths, initialize, false, 'absent')
  }

  const projectId = projectStorageId(workspaceRoot)
  if (!hasEmbeddedStorageIdentity(paths.dbPath, projectId)) {
    throw migrationConflict('workspace identity metadata', paths.dbPath)
  }
  if (receiptExists) {
    verifyRemovedLegacyLineage(workspaceRoot, paths, projectId)
  }
  return makeCanonicalDatabaseState(paths, false, false, 'absent')
}

export function verifyRecordedMigration(
  workspaceRoot: string,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  const receipt = readMigrationReceipt(paths.receiptPath)
  verifyMigrationReceipt(
    receipt,
    workspaceRoot,
    paths.sourcePath,
    source.fingerprint,
  )
  if (!existsSync(paths.dbPath)) {
    throw migrationFailure(
      `Canonical database is missing despite migration receipt: ${paths.dbPath}`,
    )
  }
  assertDestinationLineage(workspaceRoot, paths, source)
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return makeCanonicalDatabaseState(paths, false, false, 'proven-migrated')
}

export function adoptLineageDestination(
  workspaceRoot: string,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  assertDestinationLineage(workspaceRoot, paths, source)
  assertSourceUnchanged(paths.sourcePath, source)
  const destination = readDatabaseSnapshot(paths.dbPath)
  recordMigration(
    workspaceRoot,
    paths,
    source.fingerprint,
    destination.fingerprint,
  )
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return makeCanonicalDatabaseState(paths, false, true, 'proven-migrated')
}

export function migrateLegacyDatabase(
  workspaceRoot: string,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  const projectId = projectStorageId(workspaceRoot)
  const destination = prepareMigratedSnapshot(
    source,
    projectId,
    [legacyLineage(workspaceRoot, paths.sourcePath, source)],
    dirname(paths.dbPath),
  )
  assertSourceUnchanged(paths.sourcePath, source)
  publishDatabaseSnapshot(paths.dbPath, destination)
  assertSourceUnchanged(paths.sourcePath, source)
  recordMigration(
    workspaceRoot,
    paths,
    source.fingerprint,
    destination.fingerprint,
  )
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return makeCanonicalDatabaseState(paths, true, true, 'proven-migrated')
}

function verifyRemovedLegacyLineage(
  workspaceRoot: string,
  paths: StoragePaths,
  projectId: string,
): void {
  const receipt = readMigrationReceipt(paths.receiptPath)
  verifyMigrationReceiptIdentity(receipt, workspaceRoot)
  const lineage: StorageLineage = {
    projectId,
    sourceKind: 'legacy',
    sourcePath: receipt.sourcePath,
    sourceFingerprint: receipt.sourceFingerprint,
  }
  if (!hasEmbeddedLineage(paths.dbPath, lineage)) {
    throw migrationConflict(receipt.sourcePath, paths.dbPath)
  }
}

function assertDestinationLineage(
  workspaceRoot: string,
  paths: StoragePaths,
  source: DatabaseSnapshot,
): void {
  const projectId = projectStorageId(workspaceRoot)
  const lineage = legacyLineage(workspaceRoot, paths.sourcePath, source)
  if (
    !hasEmbeddedStorageIdentity(paths.dbPath, projectId) ||
    !hasEmbeddedLineage(paths.dbPath, lineage)
  ) {
    throw migrationConflict(paths.sourcePath, paths.dbPath)
  }
}

function recordMigration(
  workspaceRoot: string,
  paths: StoragePaths,
  source: DatabaseSnapshot['fingerprint'],
  destination: DatabaseSnapshot['fingerprint'],
): void {
  const receipt = createMigrationReceipt(
    workspaceRoot,
    paths.sourcePath,
    paths.dbPath,
    source,
    destination,
  )
  publishMigrationReceipt(paths.receiptPath, receipt)
}
