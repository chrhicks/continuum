import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { appendMemory } from '../memory/application/append'
import {
  listMemoryEvidence,
  searchMemoryEvidence,
  type MemoryEvidence,
} from '../memory/application/query'
import { getDbClientByPath } from '../db/client'
import { prepareCanonicalDatabase } from '../db/storage'
import { renderMemorySummary } from '../cli/commands/summary-memory'
import {
  loadTaskSummary,
  renderTaskSummary,
} from '../cli/commands/summary-tasks'
import { resolveWorkspaceContext } from '../workspace/resolve'
import { runMcpEffect } from './result'

export type McpWorkspace = {
  workspaceRoot: string
  memoryDir: string
  dbPath: string
}

export async function getSummary(input: {
  workspace: string
  taskLimit?: number
  memoryLimit?: number
}): Promise<{ workspace: string; output: string }> {
  const context = resolveMcpWorkspace(input.workspace)
  const taskLimit = input.taskLimit ?? 5
  const memoryLimit = input.memoryLimit ?? 3
  const handle = getDbClientByPath(context.dbPath)
  const [tasks, evidence] = await Promise.all([
    loadTaskSummary(taskLimit, context.workspaceRoot),
    runMcpEffect(listMemoryEvidence(context.dbPath, {}, handle)),
  ])
  const output = [
    '# Continuum Summary',
    '',
    `Workspace: ${context.workspaceRoot}`,
    '',
    renderTaskSummary(tasks, taskLimit),
    '',
    renderMemorySummary(evidence, memoryLimit),
  ].join('\n')
  return { workspace: context.workspaceRoot, output }
}

export async function appendMcpMemory(input: {
  workspace: string
  kind: 'user' | 'agent' | 'tool'
  content: string
  tags?: string[]
}): Promise<{
  workspace: string
  id: string
  sequence: number
  projectionStale: boolean
}> {
  const context = resolveMcpWorkspace(input.workspace)
  const result = await runMcpEffect(
    appendMemory({
      dbPath: context.dbPath,
      nowPath: join(context.memoryDir, 'NOW.md'),
      input: {
        kind: input.kind,
        content: input.content,
        metadata: input.tags ? { tags: input.tags } : undefined,
      },
    }),
  )
  return {
    workspace: context.workspaceRoot,
    id: result.entry.id,
    sequence: result.entry.sequence,
    projectionStale: result.projection.stale,
  }
}

export async function searchMcpMemory(input: {
  workspace: string
  query: string
  limit?: number
}): Promise<{
  workspace: string
  matches: Array<MemoryEvidence & { score: number }>
}> {
  const context = resolveMcpWorkspace(input.workspace)
  const handle = getDbClientByPath(context.dbPath)
  const matches = await runMcpEffect(
    searchMemoryEvidence(
      context.dbPath,
      input.query,
      { limit: input.limit ?? 20 },
      handle,
    ),
  )
  return { workspace: context.workspaceRoot, matches }
}

export function resolveMcpWorkspace(workspace: string): McpWorkspace {
  if (!isAbsolute(workspace)) {
    throw new Error('workspace must be an absolute path')
  }
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error(`workspace directory does not exist: ${workspace}`)
  }
  const resolved = resolveWorkspaceContext({ startDir: workspace })
  prepareCanonicalDatabase(resolved.workspaceRoot)
  if (!existsSync(resolved.continuumDbPath)) {
    throw new Error(
      `Continuum is not initialized in workspace: ${resolved.workspaceRoot}`,
    )
  }
  return {
    workspaceRoot: resolved.workspaceRoot,
    memoryDir: resolved.memoryDir,
    dbPath: resolved.continuumDbPath,
  }
}

export function resolveInitWorkspace(workspace: string): string {
  if (!isAbsolute(workspace)) {
    throw new Error('workspace must be an absolute path')
  }
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error(`workspace directory does not exist: ${workspace}`)
  }
  return resolve(workspace)
}
