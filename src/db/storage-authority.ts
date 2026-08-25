import { existsSync } from 'node:fs'
import { Effect } from 'effect'
import {
  canonicalDataHome,
  canonicalStoragePaths,
  continuumDir,
  normalizedWorkspacePath,
  pathHashProjectStorageId,
  type CanonicalPathOptions,
} from './paths'
import { CanonicalStorageError, migrationFailure } from './storage-errors'
import {
  ensureWorkspaceIdentity,
  readWorkspaceIdentity,
} from './workspace-identity'
import {
  assertWorkspaceClaim,
  claimWorkspaceIdentity,
} from './workspace-registry'

export type StorageAccess = 'read-write' | 'read-only' | 'deferred'
export type StorageAuthorityMode = 'claimed' | 'observed' | 'deferred'

type StorageAuthorityFields = {
  workspacePath: string
  projectId: string
  dataHome: string
  projectDir: string
  dbPath: string
  receiptPath: string
}

export type ClaimedStorageAuthority = StorageAuthorityFields & {
  mode: 'claimed'
}

export type ObservedStorageAuthority = StorageAuthorityFields & {
  mode: 'observed'
}

export type DeferredStorageAuthority = StorageAuthorityFields & {
  mode: 'deferred'
}

export type StorageAuthority =
  | ClaimedStorageAuthority
  | ObservedStorageAuthority
  | DeferredStorageAuthority

export function resolveStorageAuthority(
  directory: string,
  access: StorageAccess,
  options: CanonicalPathOptions = {},
): StorageAuthority {
  if (access === 'read-only') {
    return observeStorageAuthority(directory, options)
  }
  if (access === 'deferred' || !hasWriteAuthority(directory, options)) {
    return deferStorageAuthority(directory, options)
  }
  return claimStorageAuthority(directory, options)
}

export const claimStorageAuthorityEffect = Effect.fn(
  'CanonicalStorage.claimAuthority',
)(function* (directory: string, options: CanonicalPathOptions = {}) {
  return yield* Effect.try({
    try: () => claimStorageAuthority(directory, options),
    catch: (cause) =>
      cause instanceof CanonicalStorageError
        ? cause
        : migrationFailure(
            `Unable to claim storage authority for ${directory}`,
            cause,
          ),
  })
})

export function claimStorageAuthority(
  directory: string,
  options: CanonicalPathOptions = {},
): ClaimedStorageAuthority {
  const workspacePath = normalizedWorkspacePath(directory)
  const dataHome = canonicalDataHome(options)
  const identity = ensureWorkspaceIdentity(workspacePath)
  claimWorkspaceIdentity(identity.id, workspacePath, dataHome)
  return makeStorageAuthority('claimed', workspacePath, identity.id, dataHome)
}

export function observeStorageAuthority(
  directory: string,
  options: CanonicalPathOptions = {},
): ObservedStorageAuthority {
  const workspacePath = normalizedWorkspacePath(directory)
  const dataHome = canonicalDataHome(options)
  const identity = readWorkspaceIdentity(workspacePath)
  const projectId = identity?.id ?? pathHashProjectStorageId(workspacePath)
  if (identity) assertWorkspaceClaim(projectId, workspacePath, dataHome)
  return makeStorageAuthority('observed', workspacePath, projectId, dataHome)
}

export function deferStorageAuthority(
  directory: string,
  options: CanonicalPathOptions = {},
): DeferredStorageAuthority {
  const workspacePath = normalizedWorkspacePath(directory)
  const dataHome = canonicalDataHome(options)
  const projectId =
    readWorkspaceIdentity(workspacePath)?.id ??
    pathHashProjectStorageId(workspacePath)
  return makeStorageAuthority('deferred', workspacePath, projectId, dataHome)
}

function hasWriteAuthority(
  directory: string,
  options: CanonicalPathOptions,
): boolean {
  const workspacePath = normalizedWorkspacePath(directory)
  if (existsSync(continuumDir(workspacePath))) return true
  const dataHome = canonicalDataHome(options)
  const pathHash = canonicalStoragePaths(
    pathHashProjectStorageId(workspacePath),
    dataHome,
  )
  return existsSync(pathHash.dbPath)
}

function makeStorageAuthority<Mode extends StorageAuthorityMode>(
  mode: Mode,
  workspacePath: string,
  projectId: string,
  dataHome: string,
): StorageAuthorityFields & { mode: Mode } {
  return {
    mode,
    workspacePath,
    projectId,
    dataHome,
    ...canonicalStoragePaths(projectId, dataHome),
  }
}
