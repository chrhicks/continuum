import { existsSync } from 'node:fs'
import { initMemory } from '../init'
import { getMemoryConfig } from '../config'
import {
  LOG_ROTATION_LINES,
  buildUpdatedLog,
  cleanupOldNowFiles,
  writeFilesAtomically,
} from '../consolidate-io'
import { formatDate } from '../memory-content-builders'
import { memoryPath, resolveMemoryDir } from '../paths'
import { summarizePreparedInput } from './summarize'
import { renderConsolidationArtifacts } from './render'
import type { PreparedConsolidationInput } from './extract'

const NOW_RETENTION_DAYS = 3

export type ConsolidationBatchState = {
  memoryContents: Map<string, string>
  sourceContents: Map<string, string>
  cleanupPaths: Set<string>
  memoryPaths: Set<string>
  logEntries: string[]
  recentPath: string | null
  recentContent: string | null
  memoryIndexPath: string | null
  memoryIndexContent: string | null
  logPath: string | null
}

export function ensureConsolidationEnvironment(dryRun: boolean): void {
  if (!dryRun) {
    initMemory()
    return
  }
  if (!existsSync(resolveMemoryDir())) {
    throw new Error(
      'Memory directory not initialized. Run: continuum memory init',
    )
  }
}

export function createBatchState(): ConsolidationBatchState {
  return {
    memoryContents: new Map<string, string>(),
    sourceContents: new Map<string, string>(),
    cleanupPaths: new Set<string>(),
    memoryPaths: new Set<string>(),
    logEntries: [],
    recentPath: null,
    recentContent: null,
    memoryIndexPath: null,
    memoryIndexContent: null,
    logPath: null,
  }
}

export async function processBatchInput(options: {
  input: PreparedConsolidationInput
  config: ReturnType<typeof getMemoryConfig>
  state: ConsolidationBatchState
  skipSourceCleanup?: boolean
}): Promise<void> {
  const { input, config, state } = options
  const summary = await summarizePreparedInput(input, config)
  const artifacts = renderConsolidationArtifacts({
    input,
    summary,
    config,
    existing: {
      recent: state.recentContent,
      memory: state.memoryContents.get(
        memoryPath(`MEMORY-${formatDate(input.timestampStart)}.md`),
      ),
      index: state.memoryIndexContent,
    },
  })

  state.recentPath = artifacts.recentPath
  state.recentContent = artifacts.updatedRecent
  state.memoryIndexPath = artifacts.memoryIndexPath
  state.memoryIndexContent = artifacts.updatedIndex
  state.logPath = artifacts.logPath
  state.memoryPaths.add(artifacts.memoryFilePath)
  state.memoryContents.set(artifacts.memoryFilePath, artifacts.updatedMemory)
  state.logEntries.push(artifacts.logEntry.entry)

  if (artifacts.updatedSourceContent && !options.skipSourceCleanup) {
    state.sourceContents.set(input.sourcePath, artifacts.updatedSourceContent)
  }
  if (input.clearSourceAfterPersist && !options.skipSourceCleanup) {
    state.cleanupPaths.add(input.sourcePath)
  }
}

export function persistBatchState(state: ConsolidationBatchState): void {
  if (!state.recentPath || !state.memoryIndexPath || !state.logPath) {
    return
  }

  const logUpdate = buildUpdatedLog(
    state.logPath,
    state.logEntries.join(''),
    LOG_ROTATION_LINES,
  )
  writeFilesAtomically([
    { path: state.recentPath, content: state.recentContent ?? '' },
    ...sortEntries(state.memoryContents),
    { path: state.memoryIndexPath, content: state.memoryIndexContent ?? '' },
    ...sortEntries(state.sourceContents),
    {
      path: state.logPath,
      content: logUpdate.content,
      rotateExistingTo: logUpdate.rotateExistingTo,
    },
  ])

  for (const sourcePath of state.cleanupPaths) {
    cleanupOldNowFiles(sourcePath, NOW_RETENTION_DAYS)
  }
}

function sortEntries(
  contents: Map<string, string>,
): Array<{ path: string; content: string }> {
  return Array.from(contents.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, content }))
}
