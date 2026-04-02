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

type RenderContext = {
  descriptor: ReturnType<typeof describeConsolidatedRecord>
  dateStamp: string
  displayTime: string
  sessionAnchor: string
  memoryFilePath: string
  memoryIndexPath: string
  recentPath: string
  logPath: string
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
  const context = buildRenderContext(input)

  const updatedRecent = buildUpdatedRecent({
    context,
    input,
    summary,
    config,
    existingRecent: options.existing?.recent,
  })
  const updatedMemory = buildUpdatedMemory({
    context,
    input,
    summary,
    existingMemory: options.existing?.memory,
  })
  const updatedIndex = buildUpdatedIndex({
    context,
    summary,
    config,
    existingIndex: options.existing?.index,
  })
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
    memoryFile: context.memoryFilePath,
    recentPath: context.recentPath,
    decisions: summary.decisions.length,
    discoveries: summary.discoveries.length,
    patterns: summary.patterns.length,
  })

  return {
    memoryFilePath: context.memoryFilePath,
    memoryIndexPath: context.memoryIndexPath,
    recentPath: context.recentPath,
    logPath: context.logPath,
    updatedRecent,
    updatedMemory,
    updatedIndex,
    updatedSourceContent,
    logEntry,
  }
}

function buildRenderContext(input: PreparedConsolidationInput): RenderContext {
  const descriptor = describeConsolidatedRecord(input.record)
  const dateStamp = formatDate(input.timestampStart)
  const displayTime = formatDisplayTime(input.timestampStart)
  const anchorTime = formatAnchorTime(input.timestampStart)

  return {
    descriptor,
    dateStamp,
    displayTime,
    sessionAnchor:
      `session-${dateStamp}-${anchorTime}-${input.sessionId}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '',
      ),
    memoryFilePath: memoryPath(`MEMORY-${dateStamp}.md`),
    memoryIndexPath: memoryPath('MEMORY.md'),
    recentPath: memoryPath('RECENT.md'),
    logPath: memoryPath('consolidation.log'),
  }
}

function buildUpdatedRecent(options: {
  context: RenderContext
  input: PreparedConsolidationInput
  summary: MemorySummary
  config: MemoryConfig
  existingRecent?: string | null
}): string {
  const { context, input, summary, config, existingRecent } = options
  const recentEntry = buildRecentEntry({
    entryLabel: context.descriptor.entryLabel,
    sourceLabel: context.descriptor.sourceLabel,
    dateStamp: context.dateStamp,
    timeStamp: context.displayTime,
    durationMinutes: input.durationMinutes,
    summary,
    memoryFileName: `MEMORY-${context.dateStamp}.md`,
    anchor: context.sessionAnchor,
  })

  return upsertRecent(
    context.recentPath,
    recentEntry,
    {
      maxSessions: config.recent_session_count,
      maxLines: config.recent_max_lines,
    },
    existingRecent,
  )
}

function buildUpdatedMemory(options: {
  context: RenderContext
  input: PreparedConsolidationInput
  summary: MemorySummary
  existingMemory?: string | null
}): string {
  const { context, input, summary, existingMemory } = options
  const memorySection = buildMemorySection({
    entryLabel: context.descriptor.entryLabel,
    sourceLabel: context.descriptor.sourceLabel,
    sessionId: input.sessionId,
    dateStamp: context.dateStamp,
    timeStamp: context.displayTime,
    summary,
    anchor: context.sessionAnchor,
  })

  return upsertMemoryFile(
    context.memoryFilePath,
    {
      sessionId: input.sessionId,
      tags: input.tags,
      section: memorySection,
    },
    existingMemory,
  )
}

function buildUpdatedIndex(options: {
  context: RenderContext
  summary: MemorySummary
  config: MemoryConfig
  existingIndex?: string | null
}): string {
  const { context, summary, config, existingIndex } = options
  const indexEntry = buildIndexEntry({
    entryLabel: context.descriptor.entryLabel,
    dateStamp: context.dateStamp,
    timeStamp: context.displayTime,
    focus: summary.narrative,
    memoryFileName: `MEMORY-${context.dateStamp}.md`,
    anchor: context.sessionAnchor,
  })

  return upsertMemoryIndex(
    context.memoryIndexPath,
    {
      entry: indexEntry,
      entryLabel: context.descriptor.entryLabel,
      hasDecisions: summary.decisions.length > 0,
      hasDiscoveries: summary.discoveries.length > 0,
      hasPatterns: summary.patterns.length > 0,
      sections: config.memory_sections,
    },
    existingIndex,
  )
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
