import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathHashProjectStorageId } from './paths'
import type { ClaimedStorageAuthority } from './storage-authority'
import { containsSnapshotRows } from './storage-content'
import { migrationConflict, migrationFailure } from './storage-errors'
import {
  hasEmbeddedLineage,
  hasEmbeddedStorageIdentity,
  prepareMigratedSnapshot,
  type StorageLineage,
} from './storage-lineage'
import type { StoragePaths } from './storage-model'
import { assertSourceUnchanged, legacyLineage } from './storage-provenance'
import { readMigrationReceipt } from './storage-receipt'
import {
  publishDatabaseSnapshot,
  readDatabaseSnapshot,
  type DatabaseSnapshot,
  type StorageFingerprint,
} from './storage-snapshot'

export function upgradePathHashStorage(
  authority: ClaimedStorageAuthority,
  oldPaths: StoragePaths,
  paths: StoragePaths,
): void {
  const source = readDatabaseSnapshot(oldPaths.dbPath)
  const pathHashLineage: StorageLineage = {
    projectId: authority.projectId,
    sourceKind: 'path-hash',
    sourcePath: oldPaths.dbPath,
    sourceFingerprint: source.fingerprint,
  }
  const lineages: StorageLineage[] = [pathHashLineage]
  const priorLegacy = priorLegacyLineage(authority, oldPaths, source)
  if (priorLegacy) lineages.push(priorLegacy)

  if (existsSync(paths.dbPath)) {
    assertExistingDestination(paths, oldPaths, pathHashLineage)
    assertSourceUnchanged(oldPaths.dbPath, source)
    return
  }

  const destination = prepareMigratedSnapshot(
    source,
    pathHashLineage.projectId,
    lineages,
    dirname(paths.dbPath),
  )
  assertSourceUnchanged(oldPaths.dbPath, source)
  publishDatabaseSnapshot(paths.dbPath, destination)
  assertSourceUnchanged(oldPaths.dbPath, source)
}

function assertExistingDestination(
  paths: StoragePaths,
  oldPaths: StoragePaths,
  pathHashLineage: StorageLineage,
): void {
  if (
    !hasEmbeddedStorageIdentity(paths.dbPath, pathHashLineage.projectId) ||
    !hasEmbeddedLineage(paths.dbPath, pathHashLineage)
  ) {
    throw migrationConflict(oldPaths.dbPath, paths.dbPath)
  }
}

function priorLegacyLineage(
  authority: ClaimedStorageAuthority,
  oldPaths: StoragePaths,
  oldCanonical: DatabaseSnapshot,
): StorageLineage | null {
  if (!existsSync(oldPaths.receiptPath) || !existsSync(oldPaths.sourcePath)) {
    return null
  }
  const receipt = readMigrationReceipt(oldPaths.receiptPath)
  const validOldIdentity =
    receipt.version === 1 &&
    receipt.projectId === pathHashProjectStorageId(authority.workspacePath) &&
    receipt.sourcePath === oldPaths.sourcePath &&
    receipt.destinationPath === oldPaths.dbPath &&
    receipt.method === 'sqlite-serialize-snapshot'
  if (!validOldIdentity) {
    throw migrationFailure(
      `Migration receipt does not match path-hash storage identity: ${oldPaths.receiptPath}`,
    )
  }
  const source = readDatabaseSnapshot(oldPaths.sourcePath)
  if (!fingerprintMatches(source, receipt.sourceFingerprint)) return null
  if (
    !fingerprintMatches(oldCanonical, receipt.destinationFingerprint) &&
    !containsSnapshotRows(oldCanonical, source, dirname(oldPaths.dbPath))
  ) {
    return null
  }
  return legacyLineage(authority, oldPaths.sourcePath, source)
}

function fingerprintMatches(
  snapshot: DatabaseSnapshot,
  expected: StorageFingerprint,
): boolean {
  return (
    snapshot.fingerprint.digest === expected.digest &&
    snapshot.fingerprint.byteLength === expected.byteLength
  )
}
