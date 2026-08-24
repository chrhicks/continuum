import { getDbClientByPath } from '../db/client'
import { canonicalDbFilePath } from '../db/paths'
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
  await init_project({ directory: workspace })
  getDbClientByPath(canonicalDbFilePath(workspace))
  const after = await init_status({ directory: workspace })
  return {
    workspace,
    dbPath: canonicalDbFilePath(workspace),
    created: !before.dbFileExists,
    initialized: after.pluginDirExists && after.dbFileExists,
  }
}
