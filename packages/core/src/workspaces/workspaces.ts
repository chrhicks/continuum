import type { Database } from 'bun:sqlite'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { ContinuumError, WorkspaceConflictError } from '../errors'
import { inspectWorkspace } from './git-workspace'

export type WorkspaceAlias = {
  kind: 'git' | 'path'
  value: string
}

export type WorkspaceInfo = {
  identity: WorkspaceAlias
  aliases: WorkspaceAlias[]
}

export type ResolvedWorkspace = WorkspaceInfo & {
  id: string
}

type StoredWorkspace = {
  id: string
  identity_kind: WorkspaceAlias['kind']
  identity_value: string
}

type OwnedAlias = {
  alias: WorkspaceAlias
  workspace: StoredWorkspace
}

export type PreparedWorkspace = {
  requestedPathAlias: WorkspaceAlias
  rootPathAlias: WorkspaceAlias
  pathAliases: WorkspaceAlias[]
  remoteAliases: WorkspaceAlias[]
  isGitRepository: boolean
}

export function prepareWorkspaceResolution(
  requestedPath: string,
): PreparedWorkspace {
  validateWorkspacePath(requestedPath)

  let inspected: ReturnType<typeof inspectWorkspace>
  try {
    inspected = inspectWorkspace(requestedPath)
  } catch (cause) {
    throw new ContinuumError({
      code: 'WORKSPACE_ERROR',
      operation: 'resolve workspace',
      message: 'Failed to inspect the workspace path.',
      context: { workspacePath: requestedPath },
      cause,
    })
  }

  const requestedPathAlias: WorkspaceAlias = {
    kind: 'path',
    value: inspected.requestedPath,
  }
  const rootPathAlias: WorkspaceAlias = {
    kind: 'path',
    value: inspected.rootPath,
  }

  return {
    requestedPathAlias,
    rootPathAlias,
    pathAliases:
      requestedPathAlias.value === rootPathAlias.value
        ? [requestedPathAlias]
        : [requestedPathAlias, rootPathAlias],
    remoteAliases: inspected.remotes.map((remote) => ({
      kind: 'git',
      value: remote.value,
    })),
    isGitRepository: inspected.isGitRepository,
  }
}

export function resolveWorkspace(
  database: Database,
  requestedPath: string,
): ResolvedWorkspace {
  const prepared = prepareWorkspaceResolution(requestedPath)

  try {
    return database
      .transaction(() => registerWorkspaceInTransaction(database, prepared))
      .immediate()
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'resolve workspace',
      message: 'Failed to register the Continuum workspace.',
      context: { workspacePath: prepared.requestedPathAlias.value },
      cause,
    })
  }
}

export function registerWorkspaceInTransaction(
  database: Database,
  prepared: PreparedWorkspace,
): ResolvedWorkspace {
  const requestedPathWorkspace = findWorkspaceByAlias(
    database,
    prepared.requestedPathAlias,
  )
  const rootPathWorkspace = findWorkspaceByAlias(
    database,
    prepared.rootPathAlias,
  )
  const remoteOwners = findOwnedAliases(database, prepared.remoteAliases)
  const descendantPathOwners = prepared.isGitRepository
    ? findDescendantPathOwners(database, prepared.rootPathAlias.value)
    : []
  const workspace = selectWorkspace({
    requestedPathWorkspace,
    rootPathWorkspace,
    descendantPathOwners,
    remoteAliases: prepared.remoteAliases,
    remoteOwners,
    requestedPathAlias: prepared.requestedPathAlias,
    rootPathAlias: prepared.rootPathAlias,
  })
  const resolved =
    workspace ??
    createWorkspace(
      database,
      prepared.remoteAliases[0] ?? prepared.rootPathAlias,
    )

  for (const alias of [...prepared.pathAliases, ...prepared.remoteAliases]) {
    addAlias(database, resolved.id, alias, prepared.requestedPathAlias.value)
  }

  return readWorkspaceInfo(database, resolved.id)
}

function validateWorkspacePath(path: string): void {
  if (!isAbsolute(path)) {
    throw new ContinuumError({
      code: 'WORKSPACE_ERROR',
      operation: 'resolve workspace',
      message: 'Workspace must be an absolute path.',
      context: { workspacePath: path },
    })
  }
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new ContinuumError({
        code: 'WORKSPACE_ERROR',
        operation: 'resolve workspace',
        message: 'Workspace path must identify an existing directory.',
        context: { workspacePath: path },
      })
    }
  } catch (cause) {
    if (cause instanceof ContinuumError) throw cause
    throw new ContinuumError({
      code: 'WORKSPACE_ERROR',
      operation: 'resolve workspace',
      message: 'Failed to inspect the workspace path.',
      context: { workspacePath: path },
      cause,
    })
  }
}

function selectWorkspace(options: {
  requestedPathWorkspace: StoredWorkspace | null
  rootPathWorkspace: StoredWorkspace | null
  descendantPathOwners: OwnedAlias[]
  remoteAliases: WorkspaceAlias[]
  remoteOwners: OwnedAlias[]
  requestedPathAlias: WorkspaceAlias
  rootPathAlias: WorkspaceAlias
}): StoredWorkspace | null {
  if (options.requestedPathWorkspace) {
    ensureSameWorkspace(
      options.requestedPathWorkspace,
      [
        ...ownedAlias(options.rootPathAlias, options.rootPathWorkspace),
        ...options.descendantPathOwners,
        ...options.remoteOwners,
      ],
      options.requestedPathAlias,
    )
    return options.requestedPathWorkspace
  }

  if (options.rootPathWorkspace) {
    ensureSameWorkspace(
      options.rootPathWorkspace,
      [...options.descendantPathOwners, ...options.remoteOwners],
      options.requestedPathAlias,
    )
    return options.rootPathWorkspace
  }

  const descendantWorkspace = selectDescendantWorkspace(
    options.descendantPathOwners,
    options.requestedPathAlias,
  )
  if (descendantWorkspace) {
    ensureSameWorkspace(
      descendantWorkspace,
      options.remoteOwners,
      options.requestedPathAlias,
    )
    return descendantWorkspace
  }

  const preferredRemote = options.remoteAliases[0]
  if (!preferredRemote) return null

  const preferredOwner = options.remoteOwners.find(
    ({ alias }) => alias.value === preferredRemote.value,
  )
  const secondaryOwners = options.remoteOwners.filter(
    ({ alias }) => alias.value !== preferredRemote.value,
  )

  if (!preferredOwner) {
    if (secondaryOwners[0]) {
      throwWorkspaceConflict(
        options.requestedPathAlias,
        secondaryOwners[0].alias,
      )
    }
    return null
  }

  ensureSameWorkspace(
    preferredOwner.workspace,
    secondaryOwners,
    options.requestedPathAlias,
  )
  return preferredOwner.workspace
}

function findDescendantPathOwners(
  database: Database,
  rootPath: string,
): OwnedAlias[] {
  const aliases = database
    .query(
      `SELECT a.kind, a.value, w.id, w.identity_kind, w.identity_value
       FROM workspace_aliases a
       JOIN workspaces w ON w.id = a.workspace_id
       WHERE a.kind = 'path'`,
    )
    .all() as Array<WorkspaceAlias & StoredWorkspace>

  return aliases
    .filter((alias) => isDescendantPath(rootPath, alias.value))
    .map((alias) => ({
      alias: { kind: alias.kind, value: alias.value },
      workspace: {
        id: alias.id,
        identity_kind: alias.identity_kind,
        identity_value: alias.identity_value,
      },
    }))
}

function isDescendantPath(rootPath: string, candidatePath: string): boolean {
  const pathFromRoot = relative(rootPath, candidatePath)
  return (
    pathFromRoot !== '' &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  )
}

function selectDescendantWorkspace(
  owners: OwnedAlias[],
  requestedPathAlias: WorkspaceAlias,
): StoredWorkspace | null {
  const first = owners[0]
  if (!first) return null

  const conflict = owners.find(
    ({ workspace }) => workspace.id !== first.workspace.id,
  )
  if (conflict) throwWorkspaceConflict(requestedPathAlias, conflict.alias)
  return first.workspace
}

function findOwnedAliases(
  database: Database,
  aliases: WorkspaceAlias[],
): OwnedAlias[] {
  return aliases.flatMap((alias) => {
    const workspace = findWorkspaceByAlias(database, alias)
    return workspace ? [{ alias, workspace }] : []
  })
}

function ownedAlias(
  alias: WorkspaceAlias,
  workspace: StoredWorkspace | null,
): OwnedAlias[] {
  return workspace ? [{ alias, workspace }] : []
}

function ensureSameWorkspace(
  expected: StoredWorkspace,
  owners: OwnedAlias[],
  requestedPathAlias: WorkspaceAlias,
): void {
  const conflict = owners.find(({ workspace }) => workspace.id !== expected.id)
  if (conflict) {
    throwWorkspaceConflict(requestedPathAlias, conflict.alias)
  }
}

function throwWorkspaceConflict(
  requestedPathAlias: WorkspaceAlias,
  conflictingAlias: WorkspaceAlias,
): never {
  throw new WorkspaceConflictError({
    workspacePath: requestedPathAlias.value,
    alias: conflictingAlias.value,
  })
}

function findWorkspaceByAlias(
  database: Database,
  alias: WorkspaceAlias,
): StoredWorkspace | null {
  return database
    .query(
      `SELECT w.id, w.identity_kind, w.identity_value
       FROM workspace_aliases a
       JOIN workspaces w ON w.id = a.workspace_id
       WHERE a.kind = ? AND a.value = ?`,
    )
    .get(alias.kind, alias.value) as StoredWorkspace | null
}

function createWorkspace(
  database: Database,
  identity: WorkspaceAlias,
): StoredWorkspace {
  const workspace: StoredWorkspace = {
    id: crypto.randomUUID(),
    identity_kind: identity.kind,
    identity_value: identity.value,
  }
  database
    .query(
      `INSERT INTO workspaces
       (id, identity_kind, identity_value, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      workspace.id,
      workspace.identity_kind,
      workspace.identity_value,
      new Date().toISOString(),
    )
  return workspace
}

function addAlias(
  database: Database,
  workspaceId: string,
  alias: WorkspaceAlias,
  workspacePath: string,
): void {
  const existing = findWorkspaceByAlias(database, alias)
  if (existing) {
    if (existing.id !== workspaceId) {
      throw new WorkspaceConflictError({
        workspacePath,
        alias: alias.value,
      })
    }
    return
  }

  database
    .query(
      `INSERT INTO workspace_aliases
       (kind, value, workspace_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(alias.kind, alias.value, workspaceId, new Date().toISOString())
}

function readWorkspaceInfo(
  database: Database,
  workspaceId: string,
): ResolvedWorkspace {
  const workspace = database
    .query(
      `SELECT id, identity_kind, identity_value
       FROM workspaces WHERE id = ?`,
    )
    .get(workspaceId) as StoredWorkspace
  const aliases = database
    .query(
      `SELECT kind, value FROM workspace_aliases
       WHERE workspace_id = ? ORDER BY kind, value`,
    )
    .all(workspaceId) as WorkspaceAlias[]

  return {
    id: workspace.id,
    identity: {
      kind: workspace.identity_kind,
      value: workspace.identity_value,
    },
    aliases,
  }
}
