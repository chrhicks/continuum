import { createHash } from 'node:crypto'

export const BACKUP_FORMAT_VERSION = 1 as const
export const BACKUP_OBJECT_PREFIX = 'continuum/v1/projects'

export type BackupConfig = {
  formatVersion: 1
  bucket: string
  projectId: string
  writerId: string
  createdAt: string
}

export type BackupDatabaseMetadata = {
  applicationVersion: string
  migrationCreatedAt: number | null
  migrationHash: string | null
  tables: readonly string[]
}

export type BackupManifest = {
  formatVersion: 1
  projectId: string
  generation: string
  parentGeneration: string | null
  createdAt: string
  writerId: string
  database: {
    objectKey: string
    algorithm: 'sha256'
    digest: string
    byteLength: number
  }
  metadata: BackupDatabaseMetadata
}

export type BackupHead = {
  formatVersion: 1
  projectId: string
  generation: string
  manifestKey: string
  writerId: string
  updatedAt: string
}

export function projectPrefix(projectId: string): string {
  return `${BACKUP_OBJECT_PREFIX}/${projectId}`
}

export function generationPrefix(
  projectId: string,
  generation: string,
): string {
  return `${projectPrefix(projectId)}/generations/${generation}`
}

export function databaseObjectKey(
  projectId: string,
  generation: string,
): string {
  return `${generationPrefix(projectId, generation)}/continuum.sqlite`
}

export function manifestObjectKey(
  projectId: string,
  generation: string,
): string {
  return `${generationPrefix(projectId, generation)}/manifest.json`
}

export function headObjectKey(projectId: string): string {
  return `${projectPrefix(projectId)}/head.json`
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

export function decodeBackupConfig(bytes: Uint8Array): BackupConfig {
  const value = parseObject(bytes, 'backup configuration')
  assertVersion(value)
  return {
    formatVersion: 1,
    bucket: requiredString(value, 'bucket'),
    projectId: requiredUuid(value, 'projectId'),
    writerId: requiredUuid(value, 'writerId'),
    createdAt: requiredDate(value, 'createdAt'),
  }
}

export function decodeBackupManifest(bytes: Uint8Array): BackupManifest {
  const value = parseObject(bytes, 'backup manifest')
  assertVersion(value)
  const database = requiredObject(value, 'database')
  const metadata = requiredObject(value, 'metadata')
  const tables = metadata.tables
  if (
    !Array.isArray(tables) ||
    !tables.every((item) => typeof item === 'string')
  ) {
    throw new Error('Invalid backup manifest metadata.tables')
  }
  return {
    formatVersion: 1,
    projectId: requiredUuid(value, 'projectId'),
    generation: requiredGeneration(value, 'generation'),
    parentGeneration: optionalGeneration(value, 'parentGeneration'),
    createdAt: requiredDate(value, 'createdAt'),
    writerId: requiredUuid(value, 'writerId'),
    database: {
      objectKey: requiredString(database, 'objectKey'),
      algorithm: requiredSha256Algorithm(database),
      digest: requiredDigest(database, 'digest'),
      byteLength: requiredNonnegativeInteger(database, 'byteLength'),
    },
    metadata: {
      applicationVersion: requiredString(metadata, 'applicationVersion'),
      migrationCreatedAt: optionalNonnegativeInteger(
        metadata,
        'migrationCreatedAt',
      ),
      migrationHash: optionalString(metadata, 'migrationHash'),
      tables: [...tables].sort(),
    },
  }
}

export function decodeBackupHead(bytes: Uint8Array): BackupHead {
  const value = parseObject(bytes, 'backup head')
  assertVersion(value)
  return {
    formatVersion: 1,
    projectId: requiredUuid(value, 'projectId'),
    generation: requiredGeneration(value, 'generation'),
    manifestKey: requiredString(value, 'manifestKey'),
    writerId: requiredUuid(value, 'writerId'),
    updatedAt: requiredDate(value, 'updatedAt'),
  }
}

export function bytesDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseObject(
  bytes: Uint8Array,
  label: string,
): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Invalid ${label} JSON: ${detail}`)
  }
  if (!isObject(value)) throw new Error(`Invalid ${label}: expected an object`)
  return value
}

function assertVersion(value: Record<string, unknown>): void {
  if (value.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Unsupported backup format version: ${String(value.formatVersion)}`,
    )
  }
}

function requiredObject(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const field = value[key]
  if (!isObject(field)) throw new Error(`Invalid backup field: ${key}`)
  return field
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`Invalid backup field: ${key}`)
  }
  return field
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key]
  if (field === null) return null
  return requiredString(value, key)
}

function requiredUuid(value: Record<string, unknown>, key: string): string {
  const field = requiredString(value, key)
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      field,
    )
  ) {
    throw new Error(`Invalid backup UUID: ${key}`)
  }
  return field.toLowerCase()
}

function requiredGeneration(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = requiredString(value, key)
  if (!/^\d{8}T\d{9}Z-[0-9a-f-]{36}$/.test(field)) {
    throw new Error(`Invalid backup generation: ${key}`)
  }
  return field
}

function optionalGeneration(
  value: Record<string, unknown>,
  key: string,
): string | null {
  if (value[key] === null) return null
  return requiredGeneration(value, key)
}

function requiredDate(value: Record<string, unknown>, key: string): string {
  const field = requiredString(value, key)
  if (!Number.isFinite(Date.parse(field)))
    throw new Error(`Invalid backup date: ${key}`)
  return field
}

function requiredDigest(value: Record<string, unknown>, key: string): string {
  const field = requiredString(value, key)
  if (!/^[0-9a-f]{64}$/.test(field)) throw new Error(`Invalid SHA-256: ${key}`)
  return field
}

function requiredNonnegativeInteger(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key]
  if (!Number.isSafeInteger(field) || typeof field !== 'number' || field < 0) {
    throw new Error(`Invalid nonnegative integer: ${key}`)
  }
  return field
}

function optionalNonnegativeInteger(
  value: Record<string, unknown>,
  key: string,
): number | null {
  if (value[key] === null) return null
  return requiredNonnegativeInteger(value, key)
}

function requiredSha256Algorithm(value: Record<string, unknown>): 'sha256' {
  if (value.algorithm !== 'sha256') {
    throw new Error('Unsupported backup digest algorithm')
  }
  return 'sha256'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
