import type { Database } from 'bun:sqlite'
import { ContinuumError } from '../errors'
import {
  lookupPreparedWorkspace,
  prepareWorkspaceResolution,
  type PreparedWorkspace,
} from '../workspaces/workspaces'

/**
 * Which workspaces a read covers. Exactly one field must be provided:
 * a checkout path, logical workspace IDs, or every workspace.
 */
export type RetrievalScopeInput = {
  workspace?: string
  workspaceIds?: string[]
  allWorkspaces?: boolean
}

export type PreparedRetrievalScope =
  | { kind: 'path'; workspace: PreparedWorkspace }
  | { kind: 'ids'; workspaceIds: string[] }
  | { kind: 'all' }

/** A resolved scope. `workspaceIds` is null when every workspace is covered. */
export type RetrievalScope = {
  /** Identifies the scope inside cursors; a single workspace uses its ID. */
  key: string
  workspaceIds: string[] | null
}

const maximumWorkspaceIds = 50

export function prepareRetrievalScope(
  input: RetrievalScopeInput,
  operation: string,
): PreparedRetrievalScope {
  const chosen = [
    input.workspace !== undefined,
    input.workspaceIds !== undefined,
    input.allWorkspaces === true,
  ].filter(Boolean).length
  if (chosen !== 1) {
    throw validationError(
      'Provide exactly one of workspace, workspaceIds, or allWorkspaces.',
      operation,
    )
  }
  if (
    input.allWorkspaces !== undefined &&
    typeof input.allWorkspaces !== 'boolean'
  ) {
    throw validationError('allWorkspaces must be a boolean.', operation)
  }

  if (input.workspace !== undefined) {
    return {
      kind: 'path',
      workspace: prepareWorkspaceResolution(input.workspace),
    }
  }
  if (input.workspaceIds !== undefined) {
    return {
      kind: 'ids',
      workspaceIds: normalizeWorkspaceIds(input.workspaceIds, operation),
    }
  }
  return { kind: 'all' }
}

/**
 * Resolves a prepared scope inside the caller's read transaction. Returns null
 * when a checkout path has no registered workspace, so there is nothing to
 * read. Unknown workspace IDs are an error because an ID can only come from an
 * existing workspace.
 */
export function resolveRetrievalScope(
  database: Database,
  prepared: PreparedRetrievalScope,
  operation: string,
): RetrievalScope | null {
  switch (prepared.kind) {
    case 'all':
      return { key: 'all', workspaceIds: null }
    case 'path': {
      const workspace = lookupPreparedWorkspace(database, prepared.workspace)
      return workspace
        ? { key: workspace.id, workspaceIds: [workspace.id] }
        : null
    }
    case 'ids': {
      const placeholders = prepared.workspaceIds.map(() => '?').join(', ')
      const found = new Set(
        (
          database
            .query(`SELECT id FROM workspaces WHERE id IN (${placeholders})`)
            .all(...prepared.workspaceIds) as Array<{ id: string }>
        ).map(({ id }) => id),
      )
      const missing = prepared.workspaceIds.find((id) => !found.has(id))
      if (missing !== undefined) {
        throw new ContinuumError({
          code: 'NOT_FOUND',
          operation,
          message: 'A workspace ID was not found.',
          context: { workspaceId: missing },
        })
      }
      const [only] = prepared.workspaceIds
      return {
        key:
          prepared.workspaceIds.length === 1 && only !== undefined
            ? only
            : `ids:${prepared.workspaceIds.join(',')}`,
        workspaceIds: prepared.workspaceIds,
      }
    }
  }
}

/** SQL clause and parameters restricting `recordAlias` rows to the scope. */
export function scopeClause(
  recordAlias: string,
  scope: RetrievalScope,
): { clause: string; parameters: string[] } {
  if (scope.workspaceIds === null) return { clause: '1 = 1', parameters: [] }
  return {
    clause: `${recordAlias}.workspace_id IN (${scope.workspaceIds.map(() => '?').join(', ')})`,
    parameters: scope.workspaceIds,
  }
}

function normalizeWorkspaceIds(ids: string[], operation: string): string[] {
  if (!Array.isArray(ids)) {
    throw validationError('workspaceIds must be an array.', operation)
  }
  const normalized = ids.map((value) => {
    if (typeof value !== 'string') {
      throw validationError('workspaceIds must contain text.', operation)
    }
    const id = value.trim()
    if (!id) throw validationError('workspaceIds must not be empty.', operation)
    return id
  })
  const distinct = [...new Set(normalized)].sort()
  if (distinct.length === 0 || distinct.length > maximumWorkspaceIds) {
    throw validationError(
      `workspaceIds requires between 1 and ${maximumWorkspaceIds} distinct IDs.`,
      operation,
    )
  }
  return distinct
}

function validationError(message: string, operation: string): ContinuumError {
  return new ContinuumError({ code: 'VALIDATION_ERROR', operation, message })
}
