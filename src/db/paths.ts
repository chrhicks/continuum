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

export function projectStorageId(directory: string): string {
  return createHash('sha256')
    .update(normalizedWorkspacePath(directory))
    .digest('hex')
}

export function canonicalProjectDir(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(
    canonicalDataHome(options),
    CONTINUUM_DATA_DIR,
    PROJECTS_DIR,
    projectStorageId(directory),
  )
}

export function canonicalDbFilePath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(canonicalProjectDir(directory, options), DB_FILE)
}

export function migrationReceiptPath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(canonicalProjectDir(directory, options), RECEIPT_FILE)
}

export function dbFilePath(directory: string): string {
  return canonicalDbFilePath(directory)
}
