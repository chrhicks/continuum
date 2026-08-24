import { randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { Schema } from 'effect'
import { normalizedWorkspacePath, projectStorageId } from './paths'
import { CanonicalStorageError, migrationFailure } from './storage-errors'
import {
  StorageFingerprintSchema,
  type StorageFingerprint,
} from './storage-snapshot'
import { writeDurably } from './storage-snapshot'

const RECEIPT_VERSION = 2
const warnedSources = new Set<string>()

const MigrationReceiptSchema = Schema.Struct({
  version: Schema.Literals([1, RECEIPT_VERSION]),
  projectId: Schema.NonEmptyString,
  workspacePath: Schema.NonEmptyString,
  sourcePath: Schema.NonEmptyString,
  destinationPath: Schema.NonEmptyString,
  sourceFingerprint: StorageFingerprintSchema,
  destinationFingerprint: StorageFingerprintSchema,
  migratedAt: Schema.String.check(
    Schema.makeFilter((value) =>
      Number.isFinite(Date.parse(value)) ? undefined : 'Expected a valid date',
    ),
  ),
  method: Schema.Literal('sqlite-serialize-snapshot'),
})

export interface MigrationReceipt extends Schema.Schema.Type<
  typeof MigrationReceiptSchema
> {}

export function createMigrationReceipt(
  workspaceRoot: string,
  sourcePath: string,
  destinationPath: string,
  sourceFingerprint: StorageFingerprint,
  destinationFingerprint: StorageFingerprint,
): MigrationReceipt {
  return {
    version: RECEIPT_VERSION,
    projectId: projectStorageId(workspaceRoot),
    workspacePath: normalizedWorkspacePath(workspaceRoot),
    sourcePath,
    destinationPath,
    sourceFingerprint,
    destinationFingerprint,
    migratedAt: new Date().toISOString(),
    method: 'sqlite-serialize-snapshot',
  }
}

export function publishMigrationReceipt(
  path: string,
  receipt: MigrationReceipt,
): void {
  mkdirSync(dirname(path), { recursive: true })
  const staging = `${path}.${process.pid}-${randomUUID()}.tmp`
  writeDurably(staging, `${JSON.stringify(receipt, null, 2)}\n`)
  try {
    try {
      linkSync(staging, path)
    } catch (cause) {
      if (!existsSync(path)) throw cause
      assertEquivalentReceipt(readMigrationReceipt(path), receipt)
    }
  } finally {
    if (existsSync(staging)) unlinkSync(staging)
  }
}

export function readMigrationReceipt(path: string): MigrationReceipt {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return Schema.decodeUnknownSync(MigrationReceiptSchema)(value)
  } catch (cause) {
    throw migrationFailure(`Migration receipt is unreadable: ${path}`, cause)
  }
}

export function verifyMigrationReceiptIdentity(
  receipt: MigrationReceipt,
  workspaceRoot: string,
): void {
  const identityMatches =
    receipt.version === RECEIPT_VERSION &&
    receipt.projectId === projectStorageId(workspaceRoot)
  if (!identityMatches) {
    throw migrationFailure(
      `Migration receipt does not match workspace identity: ${receipt.sourcePath}`,
    )
  }
}

export function verifyMigrationReceipt(
  receipt: MigrationReceipt,
  workspaceRoot: string,
  sourcePath: string,
  sourceFingerprint: StorageFingerprint,
): void {
  verifyMigrationReceiptIdentity(receipt, workspaceRoot)
  if (
    receipt.sourceFingerprint.digest !== sourceFingerprint.digest ||
    receipt.sourceFingerprint.byteLength !== sourceFingerprint.byteLength
  ) {
    throw new CanonicalStorageError({
      code: 'STORAGE_MIGRATION_CONFLICT',
      message:
        `Legacy database changed since migration: ${sourcePath}. ` +
        'Continuum will not claim it is removable or guess how to merge it.',
    })
  }
}

export function warnRemovableLegacySource(
  sourcePath: string,
  source: StorageFingerprint,
  warn = true,
): void {
  const key = `${sourcePath}:${source.digest}`
  if (!warn || warnedSources.has(key)) return
  warnedSources.add(key)
  console.warn(
    `Legacy database ${sourcePath} matches the exact source state recorded by ` +
      'Continuum and may be removed manually. It will never be deleted automatically.',
  )
}

function assertEquivalentReceipt(
  actual: MigrationReceipt,
  expected: MigrationReceipt,
): void {
  const equivalent =
    actual.version === expected.version &&
    actual.projectId === expected.projectId &&
    actual.sourceFingerprint.digest === expected.sourceFingerprint.digest &&
    actual.sourceFingerprint.byteLength ===
      expected.sourceFingerprint.byteLength
  if (!equivalent) {
    throw migrationFailure(
      `Concurrent migration published a conflicting receipt: ${actual.sourcePath}`,
    )
  }
}
