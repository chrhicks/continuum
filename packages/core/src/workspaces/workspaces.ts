import type { Database } from 'bun:sqlite'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
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

export function resolveWorkspace(
  database: Database,
  requestedPath: string,
): ResolvedWorkspace {
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

  const pathAlias: WorkspaceAlias = {
    kind: 'path',
    value: inspected.rootPath,
  }
  const remoteAliases: WorkspaceAlias[] = inspected.remotes.map((remote) => ({
    kind: 'git',
    value: remote.value,
  }))

  let transactionStarted = false
  try {
    database.exec('BEGIN IMMEDIATE')
    transactionStarted = true
    const existingPathWorkspace = findWorkspaceByAlias(database, pathAlias)
    const remoteOwners = remoteAliases
      .map((alias) => ({
        alias,
        workspace: findWorkspaceByAlias(database, alias),
      }))
      .filter(
        (item): item is { alias: WorkspaceAlias; workspace: StoredWorkspace } =>
          item.workspace !== null,
      )

    const workspace = existingPathWorkspace
      ? resolveExistingPathWorkspace(
          existingPathWorkspace,
          remoteOwners,
          pathAlias,
        )
      : resolveRemoteWorkspace(remoteOwners, pathAlias)

    const resolved =
      workspace ?? createWorkspace(database, remoteAliases[0] ?? pathAlias)

    addAlias(database, resolved.id, pathAlias, pathAlias.value)
    for (const alias of remoteAliases) {
      addAlias(database, resolved.id, alias, pathAlias.value)
    }

    const result = readWorkspaceInfo(database, resolved.id)
    database.exec('COMMIT')
    return result
  } catch (cause) {
    if (transactionStarted) database.exec('ROLLBACK')
    if (cause instanceof ContinuumError) throw cause
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'resolve workspace',
      message: 'Failed to register the Continuum workspace.',
      context: { workspacePath: pathAlias.value },
      cause,
    })
  }
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

function resolveExistingPathWorkspace(
  pathWorkspace: StoredWorkspace,
  remoteOwners: Array<{ alias: WorkspaceAlias; workspace: StoredWorkspace }>,
  pathAlias: WorkspaceAlias,
): StoredWorkspace {
  const conflict = remoteOwners.find(
    ({ workspace }) => workspace.id !== pathWorkspace.id,
  )
  if (conflict) {
    throw new WorkspaceConflictError({
      workspacePath: pathAlias.value,
      alias: conflict.alias.value,
    })
  }
  return pathWorkspace
}

function resolveRemoteWorkspace(
  remoteOwners: Array<{ alias: WorkspaceAlias; workspace: StoredWorkspace }>,
  pathAlias: WorkspaceAlias,
): StoredWorkspace | null {
  const workspaces = new Map(
    remoteOwners.map(({ workspace }) => [workspace.id, workspace]),
  )
  if (workspaces.size > 1) {
    throw new WorkspaceConflictError({
      workspacePath: pathAlias.value,
      alias: remoteOwners.map(({ alias }) => alias.value).join(', '),
    })
  }
  return workspaces.values().next().value ?? null
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
