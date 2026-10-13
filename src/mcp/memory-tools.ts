import { isAbsolute } from 'node:path'
import { consolidateMemory } from '../memory/application/consolidate'
import { importCanonicalOpencodeRecall } from '../memory/application/recall-import'
import { getRecallStatus } from '../memory/application/recall-status'
import { resolveMcpMemoryOwner, resolveReadOnlyMcpMemoryOwner } from './tools'
import {
  consolidateMemoryResultSchema,
  type ConsolidateMemoryMcpResult,
  type RecallImportMcpResult,
  type RecallStatusMcpResult,
} from './memory-schemas'
import { runMcpEffect } from './result'

export async function consolidateMcpMemory(input: {
  workspace: string
  dryRun?: boolean
}): Promise<ConsolidateMemoryMcpResult> {
  const owner = resolveMcpMemoryOwner(input.workspace)
  const result = await runMcpEffect(
    consolidateMemory(owner, { dryRun: input.dryRun }),
  )
  if (result.status === 'conflict') {
    return consolidateMemoryResultSchema().parse({
      workspace: owner.workspaceRoot,
      status: result.status,
      dryRun: result.dryRun,
      expectedBoundary: result.error.expectedBoundary,
      actualBoundary: result.error.actualBoundary,
    })
  }
  if (result.status === 'completed') {
    return consolidateMemoryResultSchema().parse({
      workspace: owner.workspaceRoot,
      status: result.status,
      dryRun: result.dryRun,
      consolidation: result.consolidation,
      entryCount: result.entryCount,
      projectionStale: result.projection.stale,
    })
  }
  return consolidateMemoryResultSchema().parse({
    workspace: owner.workspaceRoot,
    ...result,
  })
}

export function getMcpRecallStatus(input: {
  workspace: string
}): RecallStatusMcpResult {
  const owner = resolveReadOnlyMcpMemoryOwner(input.workspace)
  const status = getRecallStatus(owner)
  return {
    workspace: owner.workspaceRoot,
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
}): Promise<RecallImportMcpResult> {
  const owner = resolveMcpMemoryOwner(input.workspace)
  if (input.sourceDb && !isAbsolute(input.sourceDb)) {
    throw new Error('sourceDb must be an absolute path')
  }
  const afterDate = input.after ? parseDate(input.after) : undefined
  const result = await runMcpEffect(
    importCanonicalOpencodeRecall(owner, {
      dbPath: input.sourceDb,
      projectId: input.projectId,
      sessionId: input.sessionId,
      afterDate,
      limit: input.limit,
      dryRun: input.dryRun,
    }),
  )
  return { workspace: owner.workspaceRoot, ...result }
}

function parseDate(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`)
  return date
}
