import { existsSync, readFileSync } from 'node:fs'
import { initMemory } from './init'
import { MEMORY_DIR, memoryPath } from './paths'
import { getMemoryConfig } from './config'
import { parseFrontmatter } from '../utils/frontmatter'
import { resolveCurrentSessionPath } from './session'
import { withMemoryLockAsync } from './lock'
import { summarizeNow, mechanicalSummary, type NowSummary } from './summarize'
import { normalizeTags } from './util'
import {
  buildIndexEntry,
  dedupeEntriesByAnchor,
  insertEntryInSection,
  upsertMemoryIndex,
} from './memory-index'
import {
  type AtomicWriteTarget,
  buildLogEntry,
  buildUpdatedLog,
  cleanupOldNowFiles,
  countLines,
  LOG_ROTATION_LINES,
  writeFilesAtomically,
} from './consolidate-io'
import {
  buildClearedNowContent,
  buildMemorySection,
  buildRecentEntry,
  formatAnchorTime,
  formatDate,
  formatDisplayTime,
  upsertMemoryFile,
  upsertRecent,
} from './memory-content-builders'

type ConsolidationPreview = {
  recentLines: number
  memoryLines: number
  memoryIndexLines: number
  logLines: number
  nowLines: number
}

type ConsolidationOutput = {
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
  const runConsolidation = async (): Promise<ConsolidationOutput> => {
    if (!dryRun) {
      initMemory()
    } else if (!existsSync(MEMORY_DIR)) {
      throw new Error(
        'Memory directory not initialized. Run: continuum memory init',
      )
    }
    const config = getMemoryConfig()
    const nowPath =
      options.nowPath ?? resolveCurrentSessionPath({ allowFallback: true })
    if (!nowPath) {
      throw new Error('No active NOW session found.')
    }

    const nowContent = readFileSync(nowPath, 'utf-8')
    const { frontmatter, body, keys } = parseFrontmatter(nowContent)

    const sessionId = String(frontmatter.session_id ?? 'unknown')
    const timestampStart = frontmatter.timestamp_start
      ? new Date(String(frontmatter.timestamp_start))
      : new Date()
    const timestampEnd = frontmatter.timestamp_end
      ? new Date(String(frontmatter.timestamp_end))
      : new Date()
    const durationMinutes = frontmatter.duration_minutes
      ? Number(frontmatter.duration_minutes)
      : Math.max(
          1,
          Math.round(
            (timestampEnd.getTime() - timestampStart.getTime()) / 60000,
          ),
        )
    const tags = normalizeTags(frontmatter.tags)

    const summary: NowSummary = config.consolidation
      ? await summarizeNow(body, config.consolidation)
      : mechanicalSummary(body)

    const dateStamp = formatDate(timestampStart)
    const displayTime = formatDisplayTime(timestampStart)
    const anchorTime = formatAnchorTime(timestampStart)
    const sessionAnchor =
      `session-${dateStamp}-${anchorTime}-${sessionId}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '',
      )
    const memoryFilePath = memoryPath(`MEMORY-${dateStamp}.md`)
    const memoryIndexPath = memoryPath('MEMORY.md')
    const recentPath = memoryPath('RECENT.md')
    const logPath = memoryPath('consolidation.log')

    const recentEntry = buildRecentEntry({
      dateStamp,
      timeStamp: displayTime,
      durationMinutes,
      summary,
      memoryFileName: `MEMORY-${dateStamp}.md`,
      anchor: sessionAnchor,
    })

    const updatedRecent = upsertRecent(recentPath, recentEntry, {
      maxSessions: config.recent_session_count,
      maxLines: config.recent_max_lines,
    })

    const memorySection = buildMemorySection({
      sessionId,
      dateStamp,
      timeStamp: displayTime,
      summary,
      anchor: sessionAnchor,
    })
    const updatedMemory = upsertMemoryFile(memoryFilePath, {
      sessionId,
      tags,
      section: memorySection,
    })

    const indexEntry = buildIndexEntry({
      dateStamp,
      timeStamp: displayTime,
      focus: summary.narrative,
      memoryFileName: `MEMORY-${dateStamp}.md`,
      anchor: sessionAnchor,
    })
    const updatedIndex = upsertMemoryIndex(memoryIndexPath, {
      entry: indexEntry,
      hasDecisions: summary.decisions.length > 0,
      hasDiscoveries: summary.discoveries.length > 0,
      hasPatterns: false,
      sections: config.memory_sections,
    })

    const updatedFrontmatter = {
      ...frontmatter,
      duration_minutes: durationMinutes,
    }
    const clearedNow = buildClearedNowContent(updatedFrontmatter, keys, body)
    const updatedNow = clearedNow

    const logEntry = buildLogEntry({
      nowFile: nowPath,
      memoryFile: memoryFilePath,
      recentPath,
      decisions: summary.decisions.length,
      discoveries: summary.discoveries.length,
      patterns: 0,
    })

    if (!dryRun) {
      const logUpdate = buildUpdatedLog(logPath, logEntry, LOG_ROTATION_LINES)
      writeFilesAtomically([
        { path: recentPath, content: updatedRecent },
        { path: memoryFilePath, content: updatedMemory },
        { path: memoryIndexPath, content: updatedIndex },
        { path: nowPath, content: updatedNow },
        {
          path: logPath,
          content: logUpdate.content,
          rotateExistingTo: logUpdate.rotateExistingTo,
        },
      ])
      if (!options.skipNowCleanup) {
        cleanupOldNowFiles(nowPath, NOW_RETENTION_DAYS)
      }
    }

    const preview: ConsolidationPreview = {
      recentLines: countLines(updatedRecent),
      memoryLines: countLines(updatedMemory),
      memoryIndexLines: countLines(updatedIndex),
      logLines: countLines(logEntry.entry),
      nowLines: countLines(updatedNow),
    }

    return {
      recentPath,
      memoryPath: memoryFilePath,
      memoryIndexPath,
      logPath,
      nowPath,
      dryRun,
      preview: dryRun ? preview : undefined,
    }
  }

  if (dryRun) {
    return runConsolidation()
  }

  return withMemoryLockAsync(runConsolidation)
}

// Re-export for backward compatibility (tests import these from this module)
export { dedupeEntriesByAnchor, insertEntryInSection } from './memory-index'
