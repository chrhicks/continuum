import { createHash, randomUUID } from 'node:crypto'
import { Database } from 'bun:sqlite'
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  CanonicalStorageError,
  migrationConflict,
  migrationFailure,
} from './storage-errors'

export type StorageFingerprint = {
  algorithm: 'sha256'
  digest: string
  byteLength: number
}

export type DatabaseSnapshot = {
  bytes: Uint8Array
  fingerprint: StorageFingerprint
}

export function readDatabaseSnapshot(path: string): DatabaseSnapshot {
  let sqlite: Database | null = null
  try {
    sqlite = new Database(path, { readonly: true })
    assertIntegrity(sqlite, path)
    const bytes = sqlite.serialize()
    return { bytes, fingerprint: fingerprintStorage(bytes) }
  } catch (cause) {
    if (cause instanceof CanonicalStorageError) throw cause
    throw migrationFailure(`Unable to snapshot SQLite database: ${path}`, cause)
  } finally {
    sqlite?.close()
  }
}

export function publishDatabaseSnapshot(
  path: string,
  snapshot: DatabaseSnapshot,
): void {
  mkdirSync(dirname(path), { recursive: true })
  const staging = `${path}.migrate-${process.pid}-${randomUUID()}.tmp`
  writeDurably(staging, snapshot.bytes)
  try {
    const validation = readDatabaseSnapshot(staging)
    if (validation.fingerprint.digest !== snapshot.fingerprint.digest) {
      throw migrationFailure(
        `Staged SQLite snapshot changed before publish: ${path}`,
      )
    }
    publishWithoutOverwrite(staging, path, validation)
  } catch (cause) {
    if (cause instanceof CanonicalStorageError) throw cause
    throw migrationFailure(
      `Unable to publish canonical database: ${path}`,
      cause,
    )
  } finally {
    if (existsSync(staging)) unlinkSync(staging)
    rmSync(`${staging}-wal`, { force: true })
    rmSync(`${staging}-shm`, { force: true })
  }
}

export function writeDurably(path: string, content: Uint8Array | string): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, content)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function publishWithoutOverwrite(
  staging: string,
  destination: string,
  validation: DatabaseSnapshot,
): void {
  try {
    linkSync(staging, destination)
  } catch (cause) {
    if (!existsSync(destination)) throw cause
    const existing = readDatabaseSnapshot(destination)
    if (existing.fingerprint.digest !== validation.fingerprint.digest) {
      throw migrationConflict('staged legacy snapshot', destination)
    }
  }
}

function assertIntegrity(sqlite: Database, path: string): void {
  const rows = sqlite.query('PRAGMA integrity_check').all() as Array<{
    integrity_check: string
  }>
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
    throw migrationFailure(`SQLite integrity validation failed: ${path}`)
  }
}

function fingerprintStorage(bytes: Uint8Array): StorageFingerprint {
  return {
    algorithm: 'sha256',
    digest: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}
