import type { ClaimedStorageAuthority } from './storage-authority'
import { sourceChangedDuringMigration } from './storage-errors'
import type { StorageLineage } from './storage-lineage'
import { readDatabaseSnapshot, type DatabaseSnapshot } from './storage-snapshot'

export function legacyLineage(
  authority: ClaimedStorageAuthority,
  sourcePath: string,
  source: DatabaseSnapshot,
): StorageLineage {
  return {
    projectId: authority.projectId,
    sourceKind: 'legacy',
    sourcePath,
    sourceFingerprint: source.fingerprint,
  }
}

export function assertSourceUnchanged(
  sourcePath: string,
  expected: DatabaseSnapshot,
): void {
  const current = readDatabaseSnapshot(sourcePath)
  if (
    current.fingerprint.digest !== expected.fingerprint.digest ||
    current.fingerprint.byteLength !== expected.fingerprint.byteLength
  ) {
    throw sourceChangedDuringMigration(sourcePath)
  }
}
