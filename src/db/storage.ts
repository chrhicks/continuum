import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrateDbSync } from './migrate'
import {
  canonicalDbFilePath,
  legacyDbFilePath,
  migrationReceiptPath,
  normalizedWorkspacePath,
} from './paths'
import {
  createMigrationReceipt,
  publishMigrationReceipt,
  readMigrationReceipt,
  verifyMigrationReceipt,
  warnRemovableLegacySource,
} from './storage-receipt'
import {
  publishDatabaseSnapshot,
  readDatabaseSnapshot,
  type DatabaseSnapshot,
} from './storage-snapshot'
import {
  migrationConflict,
  migrationFailure,
  sourceChangedDuringMigration,
} from './storage-errors'

export type CanonicalDatabaseState = {
  dbPath: string
  legacyDbPath: string
  receiptPath: string
  created: boolean
  migrated: boolean
  legacySource: 'absent' | 'proven-migrated'
}

type StoragePaths = {
  dbPath: string
  sourcePath: string
  receiptPath: string
}

export function prepareCanonicalDatabase(
  workspaceRoot: string,
  options: { initialize?: boolean; warn?: boolean } = {},
): CanonicalDatabaseState {
  const identityRoot = normalizedWorkspacePath(workspaceRoot)
  const paths = resolveStoragePaths(identityRoot)
  const initialize = options.initialize === true
  const destinationExisted = existsSync(paths.dbPath)

  if (!existsSync(paths.sourcePath)) {
    return prepareWithoutLegacy(paths, initialize, destinationExisted)
  }

  const source = readDatabaseSnapshot(paths.sourcePath)
  if (existsSync(paths.receiptPath)) {
    return verifyRecordedMigration(identityRoot, paths, source, options.warn)
  }
  if (destinationExisted) {
    return adoptEquivalentDestination(identityRoot, paths, source, options.warn)
  }
  if (!initialize) {
    throw migrationFailure(
      `Legacy database requires one-time migration: ${paths.sourcePath}. ` +
        'Run `continuum init` before using this workspace.',
    )
  }
  return migrateLegacyDatabase(identityRoot, paths, source, options.warn)
}

function prepareWithoutLegacy(
  paths: StoragePaths,
  initialize: boolean,
  destinationExisted: boolean,
): CanonicalDatabaseState {
  if (initialize && !destinationExisted) {
    mkdirSync(dirname(paths.dbPath), { recursive: true })
    migrateDbSync(paths.dbPath)
  }
  return state(paths, initialize && !destinationExisted, false, 'absent')
}

function verifyRecordedMigration(
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
    paths.dbPath,
    source.fingerprint,
  )
  if (!existsSync(paths.dbPath)) {
    throw migrationFailure(
      `Canonical database is missing despite migration receipt: ${paths.dbPath}`,
    )
  }
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return state(paths, false, false, 'proven-migrated')
}

function adoptEquivalentDestination(
  workspaceRoot: string,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  const destination = readDatabaseSnapshot(paths.dbPath)
  if (destination.fingerprint.digest !== source.fingerprint.digest) {
    throw migrationConflict(paths.sourcePath, paths.dbPath)
  }
  assertSourceUnchanged(paths.sourcePath, source)
  recordMigration(
    workspaceRoot,
    paths,
    source.fingerprint,
    destination.fingerprint,
  )
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return state(paths, false, true, 'proven-migrated')
}

function migrateLegacyDatabase(
  workspaceRoot: string,
  paths: StoragePaths,
  source: DatabaseSnapshot,
  warn: boolean | undefined,
): CanonicalDatabaseState {
  publishDatabaseSnapshot(paths.dbPath, source)
  migrateDbSync(paths.dbPath)
  const destination = readDatabaseSnapshot(paths.dbPath)
  assertSourceUnchanged(paths.sourcePath, source)
  recordMigration(
    workspaceRoot,
    paths,
    source.fingerprint,
    destination.fingerprint,
  )
  warnRemovableLegacySource(paths.sourcePath, source.fingerprint, warn)
  return state(paths, true, true, 'proven-migrated')
}

function assertSourceUnchanged(
  sourcePath: string,
  expected: DatabaseSnapshot,
): void {
  const current = readDatabaseSnapshot(sourcePath)
  if (current.fingerprint.digest !== expected.fingerprint.digest) {
    throw sourceChangedDuringMigration(sourcePath)
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

function resolveStoragePaths(workspaceRoot: string): StoragePaths {
  return {
    dbPath: canonicalDbFilePath(workspaceRoot),
    sourcePath: legacyDbFilePath(workspaceRoot),
    receiptPath: migrationReceiptPath(workspaceRoot),
  }
}

function state(
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
