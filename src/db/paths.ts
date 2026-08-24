import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { migrationFailure } from './storage-errors'

const CONTINUUM_DATA_DIR = 'continuum'
const PROJECTS_DIR = 'projects'
const DB_FILE = 'continuum.db'
const RECEIPT_FILE = 'legacy-migration-receipt.json'
const WORKSPACE_IDENTITY_FILE = 'workspace.json'
const WORKSPACE_IDENTITY_VERSION = 1

export type CanonicalPathOptions = {
  dataHome?: string
}

type WorkspaceIdentity = {
  version: number
  id: string
}

export function continuumDir(directory: string): string {
  return join(directory, '.continuum')
}

export function legacyDbFilePath(directory: string): string {
  return join(continuumDir(directory), DB_FILE)
}

export function workspaceIdentityPath(directory: string): string {
  return join(continuumDir(directory), WORKSPACE_IDENTITY_FILE)
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

export function projectStorageId(directory: string): string {
  return (
    readWorkspaceIdentity(directory)?.id ?? pathHashProjectStorageId(directory)
  )
}

export function ensureProjectStorageId(directory: string): string {
  const existing = readWorkspaceIdentity(directory)
  if (existing) return existing.id

  const path = workspaceIdentityPath(directory)
  mkdirSync(dirname(path), { recursive: true })
  const identity: WorkspaceIdentity = {
    version: WORKSPACE_IDENTITY_VERSION,
    id: randomUUID(),
  }
  const staging = `${path}.${process.pid}-${randomUUID()}.tmp`
  writeFileSync(staging, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
    flush: true,
  })
  try {
    try {
      linkSync(staging, path)
      return identity.id
    } catch (cause) {
      if (!existsSync(path)) throw cause
      const winner = readWorkspaceIdentity(directory)
      if (!winner) {
        throw migrationFailure(`Workspace identity is unreadable: ${path}`)
      }
      return winner.id
    }
  } finally {
    if (existsSync(staging)) unlinkSync(staging)
  }
}

export function canonicalProjectDir(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  const projectId = existsSync(continuumDir(directory))
    ? ensureProjectStorageId(directory)
    : projectStorageId(directory)
  return canonicalProjectDirForId(projectId, options)
}

export function pathHashCanonicalProjectDir(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return canonicalProjectDirForId(pathHashProjectStorageId(directory), options)
}

export function canonicalDbFilePath(
  directory: string,
  options: CanonicalPathOptions = {},
): string {
  return join(canonicalProjectDir(directory, options), DB_FILE)
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

function canonicalProjectDirForId(
  projectId: string,
  options: CanonicalPathOptions,
): string {
  return join(
    canonicalDataHome(options),
    CONTINUUM_DATA_DIR,
    PROJECTS_DIR,
    projectId,
  )
}

function readWorkspaceIdentity(directory: string): WorkspaceIdentity | null {
  const path = workspaceIdentityPath(directory)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<WorkspaceIdentity>
    if (
      value.version !== WORKSPACE_IDENTITY_VERSION ||
      typeof value.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.id,
      )
    ) {
      throw new Error('unsupported workspace identity format')
    }
    return { version: value.version, id: value.id }
  } catch (cause) {
    throw migrationFailure(`Workspace identity is unreadable: ${path}`, cause)
  }
}
