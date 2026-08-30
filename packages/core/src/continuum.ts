import type { Database } from 'bun:sqlite'
import {
  openContinuumDatabase,
  resolveContinuumDataPaths,
  type DataPathOptions,
} from './database/database'
import { resolveWorkspace, type WorkspaceInfo } from './workspaces/workspaces'

export type Continuum = {
  resolveWorkspace(workspacePath: string): WorkspaceInfo
  close(): void
}

export function createContinuum(options: DataPathOptions = {}): Continuum {
  const paths = resolveContinuumDataPaths(options)
  let database: Database | undefined

  return {
    resolveWorkspace(workspacePath) {
      database ??= openContinuumDatabase(paths)
      const workspace = resolveWorkspace(database, workspacePath)
      return { identity: workspace.identity, aliases: workspace.aliases }
    },
    close() {
      database?.close()
      database = undefined
    },
  }
}
