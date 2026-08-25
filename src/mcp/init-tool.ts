import { getDbClientByPath } from '../db/client'
import { init_project, init_status } from '../task/util'
import { resolveInitWorkspace } from './tools'

export async function initMcpWorkspace(input: { workspace: string }): Promise<{
  workspace: string
  dbPath: string
  created: boolean
  initialized: boolean
}> {
  const workspace = resolveInitWorkspace(input.workspace)
  const before = await init_status({ directory: workspace })
  const authority = await init_project({ directory: workspace })
  getDbClientByPath(authority.dbPath)
  const after = await init_status({ directory: workspace })
  return {
    workspace,
    dbPath: authority.dbPath,
    created: !before.dbFileExists,
    initialized: after.pluginDirExists && after.dbFileExists,
  }
}
