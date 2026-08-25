import { statSync } from 'node:fs'
import type { Command } from 'commander'
import {
  resolveFrom,
  resolveWorkspaceContext,
  type WorkspaceContext,
} from '../workspace/resolve'

export type CliInvocation = {
  cwd: string
}

export type CliMemoryAccessPolicy = 'inspect' | 'claim-migrate-scoped'

export type CliMemoryAccess<
  Policy extends CliMemoryAccessPolicy = CliMemoryAccessPolicy,
> = {
  policy: Policy
  executionCwd: string
  workspace: WorkspaceContext
}

export function resolveCliMemoryAccess<Policy extends CliMemoryAccessPolicy>(
  command: Command,
  invocation: CliInvocation,
  policy: Policy,
): CliMemoryAccess<Policy> {
  const requestedCwd = getRequestedCwd(command)
  const executionCwd = requestedCwd
    ? resolveFrom(invocation.cwd, requestedCwd)
    : invocation.cwd
  if (!statSync(executionCwd).isDirectory()) {
    throw new Error(`CLI working directory is not a directory: ${executionCwd}`)
  }
  const workspace = resolveWorkspaceContext({
    startDir: invocation.cwd,
    cwd: requestedCwd,
    access: 'deferred',
  })
  return { policy, executionCwd, workspace }
}

function getRequestedCwd(command: Command): string | null {
  let root = command
  while (root.parent) root = root.parent
  return root.opts<{ cwd?: string }>().cwd ?? null
}
