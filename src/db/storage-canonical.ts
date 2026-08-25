import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ClaimedStorageAuthority } from './storage-authority'
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
  authority: ClaimedStorageAuthority,
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
      const destination = prepareInitializedSnapshot(
        authority.projectId,
        dirname(paths.dbPath),
      )
      publishDatabaseSnapshot(paths.dbPath, destination)
    }
    return makeCanonicalDatabaseState(paths, initialize, false, 'absent')
  }

  if (!hasEmbeddedStorageIdentity(paths.dbPath, authority.projectId)) {
    throw migrationConflict('workspace identity metadata', paths.dbPath)
  }
  if (receiptExists) {
    verifyRemovedLegacyLineage(authority, paths)
  }
  return makeCanonicalDatabaseState(paths, false, false, 'absent')
}

export function verifyRecordedMigration(
  authority: ClaimedStorageAuthority,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  const receipt = readMigrationReceipt(paths.receiptPath)
  verifyMigrationReceipt(
    receipt,
    authority,
    paths.sourcePath,
    source.fingerprint,
  )
  if (!existsSync(paths.dbPath)) {
    throw migrationFailure(
      `Canonical database is missing despite migration receipt: ${paths.dbPath}`,
    )
  }
  assertDestinationLineage(authority, paths, source)
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return makeCanonicalDatabaseState(paths, false, false, 'proven-migrated')
}

export function adoptLineageDestination(
  authority: ClaimedStorageAuthority,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  assertDestinationLineage(authority, paths, source)
  assertSourceUnchanged(paths.sourcePath, source)
  const destination = readDatabaseSnapshot(paths.dbPath)
  recordMigration(authority, paths, source.fingerprint, destination.fingerprint)
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return makeCanonicalDatabaseState(paths, false, true, 'proven-migrated')
}

export function migrateLegacyDatabase(
  authority: ClaimedStorageAuthority,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  const destination = prepareMigratedSnapshot(
    source,
    authority.projectId,
    [legacyLineage(authority, paths.sourcePath, source)],
    dirname(paths.dbPath),
  )
  assertSourceUnchanged(paths.sourcePath, source)
  publishDatabaseSnapshot(paths.dbPath, destination)
  assertSourceUnchanged(paths.sourcePath, source)
  recordMigration(authority, paths, source.fingerprint, destination.fingerprint)
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return makeCanonicalDatabaseState(paths, true, true, 'proven-migrated')
}

function verifyRemovedLegacyLineage(
  authority: ClaimedStorageAuthority,
  paths: StoragePaths,
): void {
  const receipt = readMigrationReceipt(paths.receiptPath)
  verifyMigrationReceiptIdentity(receipt, authority)
  const lineage: StorageLineage = {
    projectId: authority.projectId,
    sourceKind: 'legacy',
    sourcePath: receipt.sourcePath,
    sourceFingerprint: receipt.sourceFingerprint,
  }
  if (!hasEmbeddedLineage(paths.dbPath, lineage)) {
    throw migrationConflict(receipt.sourcePath, paths.dbPath)
  }
}

function assertDestinationLineage(
  authority: ClaimedStorageAuthority,
  paths: StoragePaths,
  source: DatabaseSnapshot,
): void {
  const lineage = legacyLineage(authority, paths.sourcePath, source)
  if (
    !hasEmbeddedStorageIdentity(paths.dbPath, authority.projectId) ||
    !hasEmbeddedLineage(paths.dbPath, lineage)
  ) {
    throw migrationConflict(paths.sourcePath, paths.dbPath)
  }
}

function recordMigration(
  authority: ClaimedStorageAuthority,
  paths: StoragePaths,
  source: DatabaseSnapshot['fingerprint'],
  destination: DatabaseSnapshot['fingerprint'],
): void {
  const receipt = createMigrationReceipt(
    authority,
    paths.sourcePath,
    paths.dbPath,
    source,
    destination,
  )
  publishMigrationReceipt(paths.receiptPath, receipt)
}
