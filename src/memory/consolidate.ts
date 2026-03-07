import { existsSync } from 'node:fs'
import { initMemory } from './init'
import { resolveMemoryDir } from './paths'
import { getMemoryConfig } from './config'
import { resolveCurrentSessionPath } from './session'
import { withMemoryLockAsync } from './lock'
import { dedupeEntriesByAnchor, insertEntryInSection } from './memory-index'
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

  return runConsolidation()
}

// Re-export for backward compatibility (tests import these from this module)
export { dedupeEntriesByAnchor, insertEntryInSection } from './memory-index'
