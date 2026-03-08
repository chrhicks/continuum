import { buildIndexEntry, upsertMemoryIndex } from '../memory-index'
import {
  buildClearedNowContent,
  buildMemorySection,
  buildRecentEntry,
  formatAnchorTime,
  formatDate,
  formatDisplayTime,
  upsertMemoryFile,
  upsertRecent,
} from '../memory-content-builders'
import { buildLogEntry } from '../consolidate-io'
import { memoryPath } from '../paths'
import type { MemoryConfig } from '../config'
import type { MemorySummary } from '../types'
import type { PreparedConsolidationInput } from './extract'

export type RenderedConsolidationArtifacts = {
  memoryFilePath: string
  memoryIndexPath: string
  recentPath: string
  logPath: string
  updatedRecent: string
  updatedMemory: string
  updatedIndex: string
  updatedSourceContent?: string
  logEntry: { entry: string; timestamp: string }
}

export function renderConsolidationArtifacts(options: {
  input: PreparedConsolidationInput
  summary: MemorySummary
  config: MemoryConfig
  existing?: {
    recent?: string | null
    memory?: string | null
    index?: string | null
  }
}): RenderedConsolidationArtifacts {
  const { input, summary, config } = options
  const descriptor = describeConsolidatedRecord(input.record)
  const dateStamp = formatDate(input.timestampStart)
  const displayTime = formatDisplayTime(input.timestampStart)
  const anchorTime = formatAnchorTime(input.timestampStart)
  const sessionAnchor =
    `session-${dateStamp}-${anchorTime}-${input.sessionId}`.replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    )
  const memoryFilePath = memoryPath(`MEMORY-${dateStamp}.md`)
  const memoryIndexPath = memoryPath('MEMORY.md')
  const recentPath = memoryPath('RECENT.md')
  const logPath = memoryPath('consolidation.log')

  const recentEntry = buildRecentEntry({
    entryLabel: descriptor.entryLabel,
    sourceLabel: descriptor.sourceLabel,
    dateStamp,
    timeStamp: displayTime,
    durationMinutes: input.durationMinutes,
    summary,
    memoryFileName: `MEMORY-${dateStamp}.md`,
    anchor: sessionAnchor,
  })
  const updatedRecent = upsertRecent(
    recentPath,
    recentEntry,
    {
      maxSessions: config.recent_session_count,
      maxLines: config.recent_max_lines,
    },
    options.existing?.recent,
  )
  const memorySection = buildMemorySection({
    entryLabel: descriptor.entryLabel,
    sourceLabel: descriptor.sourceLabel,
    sessionId: input.sessionId,
    dateStamp,
    timeStamp: displayTime,
    summary,
    anchor: sessionAnchor,
  })
  const updatedMemory = upsertMemoryFile(
    memoryFilePath,
    {
      sessionId: input.sessionId,
      tags: input.tags,
      section: memorySection,
    },
    options.existing?.memory,
  )
  const indexEntry = buildIndexEntry({
    entryLabel: descriptor.entryLabel,
    dateStamp,
    timeStamp: displayTime,
    focus: summary.narrative,
    memoryFileName: `MEMORY-${dateStamp}.md`,
    anchor: sessionAnchor,
  })
  const updatedIndex = upsertMemoryIndex(
    memoryIndexPath,
    {
      entry: indexEntry,
      entryLabel: descriptor.entryLabel,
      hasDecisions: summary.decisions.length > 0,
      hasDiscoveries: summary.discoveries.length > 0,
      hasPatterns: summary.patterns.length > 0,
      sections: config.memory_sections,
    },
    options.existing?.index,
  )
  const updatedSourceContent =
    input.clearSourceAfterPersist && input.frontmatter && input.body
      ? buildClearedNowContent(
          {
            ...input.frontmatter,
            duration_minutes: input.durationMinutes,
          },
          input.frontmatterKeys ?? [],
          input.body,
        )
      : undefined
  const logEntry = buildLogEntry({
    nowFile: input.sourcePath,
    memoryFile: memoryFilePath,
    recentPath,
    decisions: summary.decisions.length,
    discoveries: summary.discoveries.length,
    patterns: summary.patterns.length,
  })

  return {
    memoryFilePath,
    memoryIndexPath,
    recentPath,
    logPath,
    updatedRecent,
    updatedMemory,
    updatedIndex,
    updatedSourceContent,
    logEntry,
  }
}

function describeConsolidatedRecord(
  record: PreparedConsolidationInput['record'],
): {
  entryLabel: string
  sourceLabel: string
} {
  if (record.source === 'task' || record.kind === 'task') {
    return { entryLabel: 'Task', sourceLabel: 'Task history' }
  }

  if (record.source === 'opencode' && record.kind === 'summary') {
    return {
      entryLabel: 'Recall Import',
      sourceLabel: 'Imported OpenCode summary',
    }
  }

  if (record.source === 'opencode') {
    return { entryLabel: 'OpenCode Session', sourceLabel: 'OpenCode session' }
  }

  return { entryLabel: 'Session', sourceLabel: 'NOW session' }
}
