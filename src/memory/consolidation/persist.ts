import {
  LOG_ROTATION_LINES,
  buildUpdatedLog,
  cleanupOldNowFiles,
  countLines,
  writeFilesAtomically,
} from '../consolidate-io'
import type { RenderedConsolidationArtifacts } from './render'
import type { PreparedConsolidationInput } from './extract'

export type ConsolidationPreview = {
  recentLines: number
  memoryLines: number
  memoryIndexLines: number
  logLines: number
  nowLines: number
}

export function buildConsolidationPreview(
  artifacts: RenderedConsolidationArtifacts,
): ConsolidationPreview {
  return {
    recentLines: countLines(artifacts.updatedRecent),
    memoryLines: countLines(artifacts.updatedMemory),
    memoryIndexLines: countLines(artifacts.updatedIndex),
    logLines: countLines(artifacts.logEntry.entry),
    nowLines: artifacts.updatedSourceContent
      ? countLines(artifacts.updatedSourceContent)
      : 0,
  }
}

export function persistConsolidationArtifacts(options: {
  input: PreparedConsolidationInput
  artifacts: RenderedConsolidationArtifacts
  skipSourceCleanup?: boolean
  sourceCleanupRetentionDays: number
}): void {
  const { input, artifacts } = options
  const logUpdate = buildUpdatedLog(
    artifacts.logPath,
    artifacts.logEntry,
    LOG_ROTATION_LINES,
  )

  writeFilesAtomically([
    { path: artifacts.recentPath, content: artifacts.updatedRecent },
    { path: artifacts.memoryFilePath, content: artifacts.updatedMemory },
    { path: artifacts.memoryIndexPath, content: artifacts.updatedIndex },
    ...(artifacts.updatedSourceContent && !options.skipSourceCleanup
      ? [{ path: input.sourcePath, content: artifacts.updatedSourceContent }]
      : []),
    {
      path: artifacts.logPath,
      content: logUpdate.content,
      rotateExistingTo: logUpdate.rotateExistingTo,
    },
  ])

  if (input.clearSourceAfterPersist && !options.skipSourceCleanup) {
    cleanupOldNowFiles(input.sourcePath, options.sourceCleanupRetentionDays)
  }
}
