import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const CANONICAL_STORAGE_GENERATION = 'xdg-project-sha256-v1'

const CONTINUUM_DATA_DIR = 'continuum'
const PROJECTS_DIR = 'projects'
const DB_FILE = 'continuum.db'
const RECEIPT_FILE = 'legacy-migration-receipt.json'

export type CanonicalPathOptions = {
  dataHome?: string
}

export type CanonicalStoragePaths = {
  projectDir: string
  dbPath: string
  receiptPath: string
}

export function continuumDir(directory: string): string {
  return join(directory, '.continuum')
}

export function legacyDbFilePath(directory: string): string {
  return join(continuumDir(directory), DB_FILE)
}

export function canonicalDataHome(options: CanonicalPathOptions = {}): string {
  if (options.dataHome) return resolve(options.dataHome)
  if (process.env.XDG_DATA_HOME) return resolve(process.env.XDG_DATA_HOME)
  return join(process.env.HOME ?? homedir(), '.local', 'share')
}

export function normalizedWorkspacePath(directory: string): string {
  const absolute = resolve(directory)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

export function pathHashProjectStorageId(directory: string): string {
  return createHash('sha256')
    .update(normalizedWorkspacePath(directory))
    .digest('hex')
}

export function canonicalStoragePaths(
  projectId: string,
  dataHome: string,
): CanonicalStoragePaths {
  const projectDir = canonicalProjectDir(projectId, dataHome)
  return {
    projectDir,
    dbPath: canonicalDbFilePath(projectId, dataHome),
    receiptPath: migrationReceiptPath(projectId, dataHome),
  }
}

export function canonicalProjectDir(
  projectId: string,
  dataHome: string,
): string {
  return join(dataHome, CONTINUUM_DATA_DIR, PROJECTS_DIR, projectId)
}

export function canonicalDbFilePath(
  projectId: string,
  dataHome: string,
): string {
  return join(canonicalProjectDir(projectId, dataHome), DB_FILE)
}

export function migrationReceiptPath(
  projectId: string,
  dataHome: string,
): string {
  return join(canonicalProjectDir(projectId, dataHome), RECEIPT_FILE)
}
