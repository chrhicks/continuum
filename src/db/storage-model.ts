import {
  canonicalStoragePaths,
  legacyDbFilePath,
  pathHashProjectStorageId,
} from './paths'
import type { StorageAuthority } from './storage-authority'

export type CanonicalDatabaseState = {
  dbPath: string
  legacyDbPath: string
  receiptPath: string
  created: boolean
  migrated: boolean
  legacySource: 'absent' | 'proven-migrated'
}

export type StoragePaths = {
  dbPath: string
  sourcePath: string
  receiptPath: string
}

export function resolveStoragePaths(authority: StorageAuthority): StoragePaths {
  return {
    dbPath: authority.dbPath,
    sourcePath: legacyDbFilePath(authority.workspacePath),
    receiptPath: authority.receiptPath,
  }
}

export function resolvePathHashStoragePaths(
  authority: StorageAuthority,
): StoragePaths {
  const paths = canonicalStoragePaths(
    pathHashProjectStorageId(authority.workspacePath),
    authority.dataHome,
  )
  return {
    dbPath: paths.dbPath,
    sourcePath: legacyDbFilePath(authority.workspacePath),
    receiptPath: paths.receiptPath,
  }
}

export function makeCanonicalDatabaseState(
  paths: StoragePaths,
  created: boolean,
  migrated: boolean,
  legacySource: 'absent' | 'proven-migrated',
): CanonicalDatabaseState {
  return {
    dbPath: paths.dbPath,
    legacyDbPath: paths.sourcePath,
    receiptPath: paths.receiptPath,
    created,
    migrated,
    legacySource,
  }
}
