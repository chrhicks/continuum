import {
  canonicalDbFilePath,
  legacyDbFilePath,
  migrationReceiptPath,
  pathHashCanonicalDbFilePath,
  pathHashMigrationReceiptPath,
} from './paths'

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

export function resolveStoragePaths(workspaceRoot: string): StoragePaths {
  return {
    dbPath: canonicalDbFilePath(workspaceRoot),
    sourcePath: legacyDbFilePath(workspaceRoot),
    receiptPath: migrationReceiptPath(workspaceRoot),
  }
}

export function resolvePathHashStoragePaths(
  workspaceRoot: string,
): StoragePaths {
  return {
    dbPath: pathHashCanonicalDbFilePath(workspaceRoot),
    sourcePath: legacyDbFilePath(workspaceRoot),
    receiptPath: pathHashMigrationReceiptPath(workspaceRoot),
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
