import { isAbsolute } from 'node:path'
import { getDbClientByPath } from '../db/client'
import { consolidateMemory } from '../memory/application/consolidate'
import { importCanonicalOpencodeRecall } from '../memory/application/recall-import'
import { getRecallStatus } from '../memory/application/recall-status'
import { getMemoryConfig } from '../memory/config'
import { makeConsolidationRepository } from '../memory/repository/consolidation-repository'
import { makeJournalRepository } from '../memory/repository/journal-repository'
import { makeRecallRepository } from '../memory/repository/recall-repository'
import { resolveMcpWorkspace } from './tools'
import { runMcpEffect } from './result'

export async function consolidateMcpMemory(input: {
  workspace: string
  dryRun?: boolean
}): Promise<Record<string, unknown>> {
  const context = resolveMcpWorkspace(input.workspace)
  const handle = getDbClientByPath(context.dbPath)
  const result = await runMcpEffect(
    consolidateMemory({
      dbPath: context.dbPath,
      memoryDir: context.memoryDir,
      dryRun: input.dryRun,
      config: getMemoryConfig(context.memoryDir),
      journal: makeJournalRepository(handle),
      consolidations: makeConsolidationRepository(handle),
    }),
  )
  if (result.status === 'conflict') {
    return {
      workspace: context.workspaceRoot,
      status: result.status,
      dryRun: result.dryRun,
      expectedBoundary: result.error.expectedBoundary,
      actualBoundary: result.error.actualBoundary,
    }
  }
  if (result.status === 'completed') {
    return {
      workspace: context.workspaceRoot,
      status: result.status,
      dryRun: result.dryRun,
      consolidation: result.consolidation,
      entryCount: result.entryCount,
      projectionStale: result.projection.stale,
    }
  }
  return { workspace: context.workspaceRoot, ...result }
}

export function getMcpRecallStatus(input: { workspace: string }): {
  workspace: string
  sources: number
  rawMessages: number
  derivedSummaries: number
} {
  const context = resolveMcpWorkspace(input.workspace)
  const status = getRecallStatus(getDbClientByPath(context.dbPath))
  return {
    workspace: context.workspaceRoot,
    sources: status.sources,
    rawMessages: status.messages,
    derivedSummaries: status.summaries,
  }
}

export async function importMcpRecall(input: {
  workspace: string
  sourceDb?: string
  projectId?: string
  sessionId?: string
  after?: string
  limit?: number
  dryRun?: boolean
}): Promise<Record<string, unknown>> {
  const context = resolveMcpWorkspace(input.workspace)
  if (input.sourceDb && !isAbsolute(input.sourceDb)) {
    throw new Error('sourceDb must be an absolute path')
  }
  const afterDate = input.after ? parseDate(input.after) : undefined
  const handle = getDbClientByPath(context.dbPath)
  const result = await runMcpEffect(
    importCanonicalOpencodeRecall({
      continuumDbPath: context.dbPath,
      dbPath: input.sourceDb,
      repoPath: context.workspaceRoot,
      projectId: input.projectId,
      sessionId: input.sessionId,
      afterDate,
      limit: input.limit,
      dryRun: input.dryRun,
      repository: makeRecallRepository(handle),
    }),
  )
  return { workspace: context.workspaceRoot, ...result }
}

function parseDate(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`)
  return date
}
