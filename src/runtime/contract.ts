import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { CANONICAL_STORAGE_GENERATION, canonicalDataHome } from '../db/paths'
import { resolveWorkspaceContext } from '../workspace/resolve'

export type RuntimeContract = {
  storageGeneration: string
  workspace: string
  entrypoint: string
  home: string
  dataHome: string
  database: string
}

export function resolveRuntimeContract(
  startDir?: string,
  options: { readOnly?: boolean } = {},
): RuntimeContract {
  const context = resolveWorkspaceContext({
    startDir,
    access: options.readOnly ? 'read-only' : 'read-write',
  })
  return {
    storageGeneration: CANONICAL_STORAGE_GENERATION,
    workspace: context.workspaceRoot,
    entrypoint: resolveEntrypoint(),
    home: resolve(process.env.HOME ?? homedir()),
    dataHome: canonicalDataHome(),
    database: context.continuumDbPath,
  }
}

function resolveEntrypoint(): string {
  const candidate = resolve(process.argv[1] ?? 'bin/continuum')
  try {
    return realpathSync.native(candidate)
  } catch {
    return candidate
  }
}
