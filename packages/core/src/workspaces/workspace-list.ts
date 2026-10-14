import type { Database } from 'bun:sqlite'
import { ContinuumError } from '../errors'
import type { WorkspaceAlias, WorkspaceInfo } from './workspaces'

export type WorkspaceListing = WorkspaceInfo & {
  id: string
  currentRecordCount: number
  recordCount: number
  oldestCreatedAt: string | null
  newestCreatedAt: string | null
}

export type WorkspaceListResult = {
  workspaces: WorkspaceListing[]
}

type WorkspaceRow = {
  id: string
  identity_kind: WorkspaceAlias['kind']
  identity_value: string
  record_count: number
  current_record_count: number
  oldest_created_at: string | null
  newest_created_at: string | null
}

/**
 * Lists every logical workspace, most recently active first. Read-only: it
 * never registers a workspace, so it is safe to call from any directory.
 */
export function listWorkspaces(database: Database): WorkspaceListResult {
  try {
    return database.transaction(() => {
      const rows = database
        .query(
          `SELECT
             w.id,
             w.identity_kind,
             w.identity_value,
             COUNT(r.rowid) AS record_count,
             COUNT(r.rowid) - COUNT(s.superseded_record_rowid) AS current_record_count,
             MIN(r.created_at) AS oldest_created_at,
             MAX(r.created_at) AS newest_created_at
           FROM workspaces w
           LEFT JOIN memory_records r ON r.workspace_id = w.id
           LEFT JOIN (
             SELECT DISTINCT superseded_record_rowid FROM memory_supersessions
           ) s ON s.superseded_record_rowid = r.rowid
           GROUP BY w.id
           ORDER BY newest_created_at IS NULL, newest_created_at DESC, w.id`,
        )
        .all() as WorkspaceRow[]
      const aliases = database
        .query(
          `SELECT workspace_id, kind, value
           FROM workspace_aliases ORDER BY workspace_id, kind, value`,
        )
        .all() as Array<WorkspaceAlias & { workspace_id: string }>

      const aliasesByWorkspace = new Map<string, WorkspaceAlias[]>()
      for (const { workspace_id, kind, value } of aliases) {
        const list = aliasesByWorkspace.get(workspace_id) ?? []
        list.push({ kind, value })
        aliasesByWorkspace.set(workspace_id, list)
      }

      return {
        workspaces: rows.map((row) => ({
          id: row.id,
          identity: { kind: row.identity_kind, value: row.identity_value },
          aliases: aliasesByWorkspace.get(row.id) ?? [],
          currentRecordCount: row.current_record_count,
          recordCount: row.record_count,
          oldestCreatedAt: row.oldest_created_at,
          newestCreatedAt: row.newest_created_at,
        })),
      }
    })()
  } catch (cause) {
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'list workspaces',
      message: 'Failed to list workspaces.',
      cause,
    })
  }
}
