import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { canonicalProjectDir } from '../db/paths'
import { prepareCanonicalDatabase } from '../db/storage'
import {
  publishDatabaseSnapshot,
  readDatabaseSnapshot,
  type DatabaseSnapshot,
} from '../db/storage-snapshot'
import { readBackupConfig } from './config'
import {
  bytesDigest,
  databaseObjectKey,
  decodeBackupHead,
  decodeBackupManifest,
  encodeJson,
  headObjectKey,
  manifestObjectKey,
  type BackupConfig,
  type BackupHead,
  type BackupManifest,
} from './contracts'
import {
  assertSnapshotMetadata,
  inspectSnapshotMetadata,
} from './database-metadata'
import { putImmutable, type BackupObjectStore } from './object-store'

export type BackupResult = {
  generation: string
  digest: string
  byteLength: number
  parentGeneration: string | null
}

export type RestoreResult = BackupResult & { outputPath: string }

export function createBackup(
  workspaceRoot: string,
  store: BackupObjectStore,
  now: Date = new Date(),
): BackupResult {
  const config = readBackupConfig(workspaceRoot)
  const canonical = prepareCanonicalDatabase(workspaceRoot)
  const snapshot = readDatabaseSnapshot(canonical.dbPath)
  const initialHead = readHead(store, config)
  const generation = createGeneration(now)
  const manifest = createManifest(
    config,
    snapshot,
    generation,
    initialHead,
    now,
  )
  const databaseKey = manifest.database.objectKey
  const manifestKey = manifestObjectKey(config.projectId, generation)

  putImmutable(store, databaseKey, snapshot.bytes, 'application/vnd.sqlite3')
  putImmutable(store, manifestKey, encodeJson(manifest), 'application/json')
  assertHeadUnchanged(store, config, initialHead)
  publishHead(store, config, manifest, manifestKey, now)

  return resultFromManifest(manifest)
}

export function listBackups(
  workspaceRoot: string,
  store: BackupObjectStore,
  limit = 100,
): BackupManifest[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Backup list limit must be between 1 and 1000')
  }
  const config = readBackupConfig(workspaceRoot)
  const head = readHead(store, config)
  if (!head) return []

  const manifests: BackupManifest[] = []
  const visited = new Set<string>()
  let generation: string | null = head.generation
  while (generation && manifests.length < limit) {
    if (visited.has(generation))
      throw new Error('Backup manifest lineage contains a cycle')
    visited.add(generation)
    const manifest = readManifest(store, config, generation)
    manifests.push(manifest)
    generation = manifest.parentGeneration
  }
  return manifests
}

export function restoreBackup(
  workspaceRoot: string,
  store: BackupObjectStore,
  options: { generation?: string; outputPath?: string } = {},
): RestoreResult {
  const config = readBackupConfig(workspaceRoot)
  const generation = options.generation ?? requireHead(store, config).generation
  validateGenerationInput(generation)
  const manifest = readManifest(store, config, generation)
  const bytes = store.get(manifest.database.objectKey)
  if (!bytes)
    throw new Error(`Backup database object is missing: ${generation}`)
  validateDatabaseBytes(manifest, bytes)

  const outputPath = resolve(
    options.outputPath ??
      join(
        canonicalProjectDir(workspaceRoot),
        'restores',
        `${generation}.sqlite`,
      ),
  )
  const snapshot: DatabaseSnapshot = {
    bytes,
    fingerprint: {
      algorithm: 'sha256',
      digest: manifest.database.digest,
      byteLength: manifest.database.byteLength,
    },
  }
  publishDatabaseSnapshot(outputPath, snapshot)
  return { ...resultFromManifest(manifest), outputPath }
}

function createManifest(
  config: BackupConfig,
  snapshot: DatabaseSnapshot,
  generation: string,
  head: BackupHead | null,
  now: Date,
): BackupManifest {
  return {
    formatVersion: 1,
    projectId: config.projectId,
    generation,
    parentGeneration: head?.generation ?? null,
    createdAt: now.toISOString(),
    writerId: config.writerId,
    database: {
      objectKey: databaseObjectKey(config.projectId, generation),
      ...snapshot.fingerprint,
    },
    metadata: inspectSnapshotMetadata(snapshot.bytes),
  }
}

function readHead(
  store: BackupObjectStore,
  config: BackupConfig,
): BackupHead | null {
  const bytes = store.get(headObjectKey(config.projectId))
  if (!bytes) return null
  const head = decodeBackupHead(bytes)
  if (head.projectId !== config.projectId) {
    throw new Error('Remote backup head has a different project identity')
  }
  if (head.writerId !== config.writerId) {
    throw new Error(
      `Remote backup writer conflict: expected ${config.writerId}, found ${head.writerId}`,
    )
  }
  const expectedKey = manifestObjectKey(config.projectId, head.generation)
  if (head.manifestKey !== expectedKey) {
    throw new Error('Remote backup head contains an invalid manifest key')
  }
  return head
}

function requireHead(
  store: BackupObjectStore,
  config: BackupConfig,
): BackupHead {
  const head = readHead(store, config)
  if (!head) throw new Error('No remote backup head exists for this project')
  return head
}

function readManifest(
  store: BackupObjectStore,
  config: BackupConfig,
  generation: string,
): BackupManifest {
  validateGenerationInput(generation)
  const key = manifestObjectKey(config.projectId, generation)
  const bytes = store.get(key)
  if (!bytes) throw new Error(`Backup manifest is missing: ${generation}`)
  const manifest = decodeBackupManifest(bytes)
  if (
    manifest.projectId !== config.projectId ||
    manifest.generation !== generation
  ) {
    throw new Error(`Backup manifest identity mismatch: ${generation}`)
  }
  if (manifest.writerId !== config.writerId) {
    throw new Error(`Backup manifest writer conflict: ${generation}`)
  }
  const expectedDatabaseKey = databaseObjectKey(config.projectId, generation)
  if (manifest.database.objectKey !== expectedDatabaseKey) {
    throw new Error(`Backup manifest database key mismatch: ${generation}`)
  }
  return manifest
}

function assertHeadUnchanged(
  store: BackupObjectStore,
  config: BackupConfig,
  initial: BackupHead | null,
): void {
  const current = readHead(store, config)
  if (current?.generation !== initial?.generation) {
    throw new Error(
      'Remote backup head changed during upload; immutable objects were retained but the stale head was not published',
    )
  }
}

function publishHead(
  store: BackupObjectStore,
  config: BackupConfig,
  manifest: BackupManifest,
  manifestKey: string,
  now: Date,
): void {
  const head: BackupHead = {
    formatVersion: 1,
    projectId: config.projectId,
    generation: manifest.generation,
    manifestKey,
    writerId: config.writerId,
    updatedAt: now.toISOString(),
  }
  const content = encodeJson(head)
  const key = headObjectKey(config.projectId)
  store.put(key, content, 'application/json')
  const published = store.get(key)
  if (!published || bytesDigest(published) !== bytesDigest(content)) {
    throw new Error('Remote backup head publication could not be verified')
  }
}

function validateDatabaseBytes(
  manifest: BackupManifest,
  bytes: Uint8Array,
): void {
  if (
    bytes.byteLength !== manifest.database.byteLength ||
    bytesDigest(bytes) !== manifest.database.digest
  ) {
    throw new Error(`Backup database checksum mismatch: ${manifest.generation}`)
  }
  const actual = inspectSnapshotMetadata(bytes)
  assertSnapshotMetadata(manifest.metadata, actual)
}

function createGeneration(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, '')
  return `${timestamp}-${randomUUID()}`
}

function validateGenerationInput(generation: string): void {
  if (!/^\d{8}T\d{9}Z-[0-9a-f-]{36}$/.test(generation)) {
    throw new Error(`Invalid backup generation: ${generation}`)
  }
}

function resultFromManifest(manifest: BackupManifest): BackupResult {
  return {
    generation: manifest.generation,
    digest: manifest.database.digest,
    byteLength: manifest.database.byteLength,
    parentGeneration: manifest.parentGeneration,
  }
}
