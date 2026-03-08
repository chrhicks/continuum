import { existsSync } from 'node:fs'
import { initMemory } from './init'
import { memoryPath, resolveMemoryDir } from './paths'
import { getMemoryConfig } from './config'
import { resolveCurrentSessionPath } from './session'
import { withMemoryLockAsync } from './lock'
import { dedupeEntriesByAnchor, insertEntryInSection } from './memory-index'
import { formatDate } from './memory-content-builders'
import {
  LOG_ROTATION_LINES,
  buildUpdatedLog,
  cleanupOldNowFiles,
  writeFilesAtomically,
} from './consolidate-io'
import {
  prepareNowConsolidationInput,
  type PreparedConsolidationInput,
} from './consolidation/extract'
import { summarizePreparedInput } from './consolidation/summarize'
import { renderConsolidationArtifacts } from './consolidation/render'
import {
  buildConsolidationPreview,
  persistConsolidationArtifacts,
  type ConsolidationPreview,
} from './consolidation/persist'

export type ConsolidationOutput = {
  recentPath: string
  memoryPath: string
  memoryIndexPath: string
  logPath: string
  nowPath: string
  dryRun: boolean
  preview?: ConsolidationPreview
}

export type ConsolidationBatchOutput = {
  count: number
  dryRun: boolean
  recentPath: string | null
  memoryPaths: string[]
  memoryIndexPath: string | null
  logPath: string | null
}

const NOW_RETENTION_DAYS = 3
const RECENT_FILE_LIMIT = 8

export async function consolidateNow(
  options: {
    nowPath?: string
    dryRun?: boolean
    skipNowCleanup?: boolean
  } = {},
): Promise<ConsolidationOutput> {
  const dryRun = options.dryRun ?? false
  const nowPath =
    options.nowPath ?? resolveCurrentSessionPath({ allowFallback: true })
  if (!nowPath) {
    throw new Error('No active NOW session found.')
  }
  const input = prepareNowConsolidationInput(nowPath)

  const runConsolidation = async (): Promise<ConsolidationOutput> => {
    return consolidatePreparedInput(input, {
      dryRun,
      skipSourceCleanup: options.skipNowCleanup ?? false,
    })
  }

  if (dryRun) {
    return runConsolidation()
  }

  return runConsolidation()
}

export async function consolidatePreparedInput(
  input: PreparedConsolidationInput,
  options: { dryRun?: boolean; skipSourceCleanup?: boolean } = {},
): Promise<ConsolidationOutput> {
  const dryRun = options.dryRun ?? false

  const runConsolidation = async (): Promise<ConsolidationOutput> => {
    if (!dryRun) {
      initMemory()
    } else if (!existsSync(resolveMemoryDir())) {
      throw new Error(
        'Memory directory not initialized. Run: continuum memory init',
      )
    }

    const config = getMemoryConfig()
    const summary = await summarizePreparedInput(input, config)
    const artifacts = renderConsolidationArtifacts({ input, summary, config })

    if (!dryRun) {
      persistConsolidationArtifacts({
        input,
        artifacts,
        skipSourceCleanup: options.skipSourceCleanup ?? false,
        sourceCleanupRetentionDays: NOW_RETENTION_DAYS,
      })
    }

    const preview: ConsolidationPreview = buildConsolidationPreview(artifacts)

    return {
      recentPath: artifacts.recentPath,
      memoryPath: artifacts.memoryFilePath,
      memoryIndexPath: artifacts.memoryIndexPath,
      logPath: artifacts.logPath,
      nowPath: input.sourcePath,
      dryRun,
      preview: dryRun ? preview : undefined,
    }
  }

  if (dryRun) {
    return runConsolidation()
  }

  return withMemoryLockAsync(runConsolidation)
}

export async function consolidatePreparedInputs(
  inputs: PreparedConsolidationInput[],
  options: { dryRun?: boolean; skipSourceCleanup?: boolean } = {},
): Promise<ConsolidationBatchOutput> {
  if (inputs.length === 0) {
    return {
      count: 0,
      dryRun: options.dryRun ?? false,
      recentPath: null,
      memoryPaths: [],
      memoryIndexPath: null,
      logPath: null,
    }
  }

  const dryRun = options.dryRun ?? false
  const runBatch = async (): Promise<ConsolidationBatchOutput> => {
    if (!dryRun) {
      initMemory()
    } else if (!existsSync(resolveMemoryDir())) {
      throw new Error(
        'Memory directory not initialized. Run: continuum memory init',
      )
    }

    const config = getMemoryConfig()
    const sortedInputs = inputs.slice().sort(comparePreparedInputs)
    const memoryContents = new Map<string, string>()
    const sourceContents = new Map<string, string>()
    const cleanupPaths = new Set<string>()
    const memoryPaths = new Set<string>()
    const logEntries: string[] = []
    let recentPath: string | null = null
    let recentContent: string | null = null
    let memoryIndexPath: string | null = null
    let memoryIndexContent: string | null = null
    let logPath: string | null = null

    for (const input of sortedInputs) {
      const summary = await summarizePreparedInput(input, config)
      const artifacts = renderConsolidationArtifacts({
        input,
        summary,
        config,
        existing: {
          recent: recentContent,
          memory: memoryContents.get(
            memoryPath(`MEMORY-${formatDate(input.timestampStart)}.md`),
          ),
          index: memoryIndexContent,
        },
      })

      recentPath = artifacts.recentPath
      recentContent = artifacts.updatedRecent
      memoryIndexPath = artifacts.memoryIndexPath
      memoryIndexContent = artifacts.updatedIndex
      logPath = artifacts.logPath
      memoryPaths.add(artifacts.memoryFilePath)
      memoryContents.set(artifacts.memoryFilePath, artifacts.updatedMemory)
      logEntries.push(artifacts.logEntry.entry)

      if (artifacts.updatedSourceContent && !options.skipSourceCleanup) {
        sourceContents.set(input.sourcePath, artifacts.updatedSourceContent)
      }
      if (input.clearSourceAfterPersist && !options.skipSourceCleanup) {
        cleanupPaths.add(input.sourcePath)
      }
    }

    if (!dryRun && recentPath && memoryIndexPath && logPath) {
      const logUpdate = buildUpdatedLog(
        logPath,
        logEntries.join(''),
        LOG_ROTATION_LINES,
      )
      const targets = [
        { path: recentPath, content: recentContent ?? '' },
        ...Array.from(memoryContents.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([path, content]) => ({ path, content })),
        { path: memoryIndexPath, content: memoryIndexContent ?? '' },
        ...Array.from(sourceContents.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([path, content]) => ({ path, content })),
        {
          path: logPath,
          content: logUpdate.content,
          rotateExistingTo: logUpdate.rotateExistingTo,
        },
      ]
      writeFilesAtomically(targets)

      for (const sourcePath of cleanupPaths) {
        cleanupOldNowFiles(sourcePath, NOW_RETENTION_DAYS)
      }
    }

    return {
      count: sortedInputs.length,
      dryRun,
      recentPath,
      memoryPaths: Array.from(memoryPaths).sort((left, right) =>
        left.localeCompare(right),
      ),
      memoryIndexPath,
      logPath,
    }
  }

  if (dryRun) {
    return runBatch()
  }

  return withMemoryLockAsync(runBatch)
}

function comparePreparedInputs(
  left: PreparedConsolidationInput,
  right: PreparedConsolidationInput,
): number {
  const timeDelta =
    left.timestampStart.getTime() - right.timestampStart.getTime()
  if (timeDelta !== 0) {
    return timeDelta
  }
  return left.sessionId.localeCompare(right.sessionId)
}

// Re-export for backward compatibility (tests import these from this module)
export { dedupeEntriesByAnchor, insertEntryInSection } from './memory-index'
