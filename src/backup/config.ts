import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { decodeBackupConfig, encodeJson, type BackupConfig } from './contracts'

const CONFIG_FILE = 'r2-backup.json'

export type ConfigureBackupInput = {
  workspaceRoot: string
  bucket: string
  projectId?: string
  writerId?: string
  now?: Date
}

export function backupConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.continuum', CONFIG_FILE)
}

export function configureBackup(input: ConfigureBackupInput): BackupConfig {
  validateBucket(input.bucket)
  const path = backupConfigPath(input.workspaceRoot)
  if (existsSync(path)) {
    const existing = readBackupConfig(input.workspaceRoot)
    assertCompatible(existing, input)
    return existing
  }

  const config: BackupConfig = {
    formatVersion: 1,
    bucket: input.bucket,
    projectId: input.projectId ?? randomUUID(),
    writerId: input.writerId ?? randomUUID(),
    createdAt: (input.now ?? new Date()).toISOString(),
  }
  const validated = decodeBackupConfig(encodeJson(config))
  writeConfig(path, validated)
  return validated
}

export function readBackupConfig(workspaceRoot: string): BackupConfig {
  const path = backupConfigPath(workspaceRoot)
  if (!existsSync(path)) {
    throw new Error(
      `R2 backup is not configured. Run continuum backup configure --bucket <name>.`,
    )
  }
  return decodeBackupConfig(readFileSync(path))
}

function writeConfig(path: string, config: BackupConfig): void {
  mkdirSync(dirname(path), { recursive: true })
  const staging = `${path}.${process.pid}-${randomUUID()}.tmp`
  try {
    writeFileSync(staging, encodeJson(config), { mode: 0o600, flag: 'wx' })
    renameSync(staging, path)
  } finally {
    rmSync(staging, { force: true })
  }
}

function validateBucket(bucket: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error(`Invalid R2 bucket name: ${bucket}`)
  }
}

function assertCompatible(
  existing: BackupConfig,
  input: ConfigureBackupInput,
): void {
  if (existing.bucket !== input.bucket) {
    throw new Error(
      `R2 backup is already configured for bucket ${existing.bucket}`,
    )
  }
  if (input.projectId && existing.projectId !== input.projectId.toLowerCase()) {
    throw new Error('R2 backup is already configured with another project ID')
  }
  if (input.writerId && existing.writerId !== input.writerId.toLowerCase()) {
    throw new Error('R2 backup is already configured with another writer ID')
  }
}
