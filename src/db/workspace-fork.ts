import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { Effect } from 'effect'
import {
  canonicalDataHome,
  canonicalDbFilePathForStorageId,
  canonicalProjectDirForStorageId,
  legacyDbFilePath,
  normalizedWorkspacePath,
  type CanonicalPathOptions,
} from './paths'
import { CanonicalStorageError, migrationFailure } from './storage-errors'
import { prepareMigratedSnapshot, type StorageLineage } from './storage-lineage'
import {
  publishDatabaseSnapshot,
  readDatabaseSnapshot,
} from './storage-snapshot'
import {
  makeWorkspaceIdentity,
  readWorkspaceIdentity,
  replaceWorkspaceIdentity,
} from './workspace-identity'
import {
  claimWorkspaceIdentity,
  workspaceClaimExists,
} from './workspace-registry'

export type WorkspaceForkResult = {
  workspacePath: string
  previousProjectId: string
  projectId: string
  sourceDatabasePath: string
  databasePath: string
}

export const forkWorkspaceStorageEffect = Effect.fn(
  'CanonicalStorage.forkWorkspace',
)(function* (directory: string, options: CanonicalPathOptions = {}) {
  return yield* Effect.try({
    try: () => forkWorkspaceStorage(directory, options),
    catch: (cause) =>
      cause instanceof CanonicalStorageError
        ? cause
        : migrationFailure(
            `Unable to fork workspace storage for ${directory}`,
            cause,
          ),
  })
})

function forkWorkspaceStorage(
  directory: string,
  options: CanonicalPathOptions,
): WorkspaceForkResult {
  const workspacePath = normalizedWorkspacePath(directory)
  const previous = readWorkspaceIdentity(workspacePath)
  if (!previous) {
    throw migrationFailure(
      `Cannot fork an uninitialized workspace: ${workspacePath}`,
    )
  }
  const sourceDatabasePath = canonicalDbFilePathForStorageId(
    previous.id,
    options,
  )
  if (!existsSync(sourceDatabasePath)) {
    throw migrationFailure(
      `Cannot fork because the canonical database is missing: ${sourceDatabasePath}`,
    )
  }

  const projectId = generateAvailableProjectId(options)
  const databasePath = canonicalDbFilePathForStorageId(projectId, options)
  const legacy = readLegacyLineage(workspacePath, projectId)
  const source = readDatabaseSnapshot(sourceDatabasePath)
  const forked = prepareMigratedSnapshot(
    source,
    projectId,
    legacy ? [legacy.lineage] : [],
    dirname(databasePath),
  )
  publishDatabaseSnapshot(databasePath, forked)
  assertLegacyUnchanged(legacy)
  replaceWorkspaceIdentity(workspacePath, projectId)
  claimWorkspaceIdentity(projectId, workspacePath, canonicalDataHome(options))
  return {
    workspacePath,
    previousProjectId: previous.id,
    projectId,
    sourceDatabasePath,
    databasePath,
  }
}

function generateAvailableProjectId(options: CanonicalPathOptions): string {
  const dataHome = canonicalDataHome(options)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = makeWorkspaceIdentity().id
    const projectDir = canonicalProjectDirForStorageId(id, options)
    if (!existsSync(projectDir) && !workspaceClaimExists(id, dataHome)) {
      return id
    }
  }
  throw migrationFailure('Unable to allocate a unique workspace identity')
}

type LegacyLineageSnapshot = {
  path: string
  digest: string
  byteLength: number
  lineage: StorageLineage
}

function readLegacyLineage(
  workspacePath: string,
  projectId: string,
): LegacyLineageSnapshot | null {
  const path = legacyDbFilePath(workspacePath)
  if (!existsSync(path)) return null
  const snapshot = readDatabaseSnapshot(path)
  return {
    path,
    digest: snapshot.fingerprint.digest,
    byteLength: snapshot.fingerprint.byteLength,
    lineage: {
      projectId,
      sourceKind: 'legacy',
      sourcePath: path,
      sourceFingerprint: snapshot.fingerprint,
    },
  }
}

function assertLegacyUnchanged(legacy: LegacyLineageSnapshot | null): void {
  if (!legacy) return
  const current = readDatabaseSnapshot(legacy.path).fingerprint
  if (
    current.digest !== legacy.digest ||
    current.byteLength !== legacy.byteLength
  ) {
    throw migrationFailure(
      `Legacy database changed while forking: ${legacy.path}. ` +
        'The workspace identity was not replaced.',
    )
  }
}
