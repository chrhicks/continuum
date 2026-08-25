import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  ensureWorkspaceIdentity,
  readWorkspaceIdentity,
} from './workspace-identity'
import {
  assertWorkspaceClaim,
  claimWorkspaceIdentity,
} from './workspace-registry'

export { workspaceIdentityPath } from './workspace-identity'

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

export function pathHashProjectStorageId(directory: string): string {
  return createHash('sha256')
    .update(normalizedWorkspacePath(directory))
    .digest('hex')
}

export function unclaimedProjectStorageId(directory: string): string {
  return resolveProjectStorageIdentity(directory).id
}

export function projectStorageId(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  const workspacePath = normalizedWorkspacePath(directory)
  const identity = resolveProjectStorageIdentity(workspacePath)
  if (!identity.stable) return identity.id
  assertWorkspaceClaim(identity.id, workspacePath, canonicalDataHome(options))
  return identity.id
}

export function ensureProjectStorageId(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  const workspacePath = normalizedWorkspacePath(directory)
  const identity = ensureWorkspaceIdentity(workspacePath)
  claimWorkspaceIdentity(identity.id, workspacePath, canonicalDataHome(options))
  return identity.id
}

export function canonicalProjectDir(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  const projectId = existsSync(continuumDir(directory))
    ? ensureProjectStorageId(directory, options)
    : projectStorageId(directory, options)
  return canonicalProjectDirForStorageId(projectId, options)
}

export function readOnlyCanonicalProjectDir(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return canonicalProjectDirForStorageId(
    projectStorageId(directory, options),
    options,
  )
}

export function pathHashCanonicalProjectDir(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return canonicalProjectDirForStorageId(
    pathHashProjectStorageId(directory),
    options,
  )
}

export function canonicalDbFilePath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(canonicalProjectDir(directory, options), DB_FILE)
}

export function unclaimedCanonicalDbFilePath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return canonicalDbFilePathForStorageId(
    unclaimedProjectStorageId(directory),
    options,
  )
}

export function canonicalDbFilePathForStorageId(
  projectId: string,
  options: CanonicalPathOptions = {},
): string {
  return join(canonicalProjectDirForStorageId(projectId, options), DB_FILE)
}

export function readOnlyCanonicalDbFilePath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(readOnlyCanonicalProjectDir(directory, options), DB_FILE)
}

export function pathHashCanonicalDbFilePath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(pathHashCanonicalProjectDir(directory, options), DB_FILE)
}

export function migrationReceiptPath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(canonicalProjectDir(directory, options), RECEIPT_FILE)
}

export function pathHashMigrationReceiptPath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(pathHashCanonicalProjectDir(directory, options), RECEIPT_FILE)
}

export function dbFilePath(directory: string): string {
  return canonicalDbFilePath(directory)
}

export function canonicalProjectDirForStorageId(
  projectId: string,
  options: CanonicalPathOptions = {},
): string {
  return join(
    canonicalDataHome(options),
    CONTINUUM_DATA_DIR,
    PROJECTS_DIR,
    projectId,
  )
}

function resolveProjectStorageIdentity(directory: string): {
  id: string
  stable: boolean
} {
  const workspacePath = normalizedWorkspacePath(directory)
  const identity = readWorkspaceIdentity(workspacePath)
  return identity
    ? { id: identity.id, stable: true }
    : { id: pathHashProjectStorageId(workspacePath), stable: false }
}
