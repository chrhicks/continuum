import { readFileSync } from 'node:fs'
import { parseFrontmatter } from '../../utils/frontmatter'
import {
  normalizeNowRecord,
  normalizeOpencodeSummaryRecord,
} from '../collectors'
import type { CollectedRecord, MemorySummary } from '../types'
import type { OpencodeRecallSummary } from '../opencode/summary-parse'
import { normalizeTags } from '../util'

export type PreparedConsolidationInput = {
  record: CollectedRecord
  sourcePath: string
  sessionId: string
  timestampStart: Date
  timestampEnd: Date
  durationMinutes: number
  tags: string[]
  frontmatter?: Record<string, unknown>
  frontmatterKeys?: string[]
  body?: string
  precomputedSummary?: MemorySummary
  clearSourceAfterPersist?: boolean
}

export function prepareNowConsolidationInput(
  nowPath: string,
): PreparedConsolidationInput {
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
        Math.round((timestampEnd.getTime() - timestampStart.getTime()) / 60000),
      )
  const tags = normalizeTags(frontmatter.tags)

  const record = normalizeNowRecord({
    sessionId,
    body,
    workspaceRoot:
      typeof frontmatter.project_path === 'string'
        ? frontmatter.project_path
        : null,
    projectPath:
      typeof frontmatter.project_path === 'string'
        ? frontmatter.project_path
        : null,
    createdAt: timestampStart.toISOString(),
    updatedAt: timestampEnd.toISOString(),
    tags,
    relatedTasks: Array.isArray(frontmatter.related_tasks)
      ? frontmatter.related_tasks
      : [],
    metadata: {
      parent_session:
        typeof frontmatter.parent_session === 'string'
          ? frontmatter.parent_session
          : null,
      memory_type: frontmatter.memory_type ?? 'NOW',
    },
  })

  return {
    record,
    sourcePath: nowPath,
    sessionId,
    timestampStart,
    timestampEnd,
    durationMinutes,
    tags,
    frontmatter,
    frontmatterKeys: keys,
    body,
    clearSourceAfterPersist: true,
  }
}

export function prepareRecallSummaryConsolidationInput(
  summary: OpencodeRecallSummary,
  sourcePath: string,
): PreparedConsolidationInput {
  const record = normalizeOpencodeSummaryRecord(summary)
  const timestampStart = new Date(summary.createdAt)
  const timestampEnd = new Date(summary.updatedAt)
  const durationMinutes = Math.max(
    1,
    Math.round((timestampEnd.getTime() - timestampStart.getTime()) / 60000) ||
      1,
  )

  return {
    record,
    sourcePath,
    sessionId: summary.sessionId,
    timestampStart,
    timestampEnd,
    durationMinutes,
    tags: ['opencode', 'recall'],
    precomputedSummary: buildRecallMemorySummary(summary),
    clearSourceAfterPersist: false,
  }
}

export function prepareCollectedRecordConsolidationInput(options: {
  record: CollectedRecord
  sourcePath: string
  sessionId?: string
  durationMinutes?: number
  tags?: string[]
  precomputedSummary?: MemorySummary
}): PreparedConsolidationInput {
  const timestampStart = resolveTimestamp(options.record.createdAt)
  const timestampEnd = resolveTimestamp(
    options.record.updatedAt ?? options.record.createdAt,
  )
  const durationMinutes =
    options.durationMinutes ??
    Math.max(
      1,
      Math.round((timestampEnd.getTime() - timestampStart.getTime()) / 60000) ||
        1,
    )

  return {
    record: options.record,
    sourcePath: options.sourcePath,
    sessionId: options.sessionId ?? options.record.externalId,
    timestampStart,
    timestampEnd,
    durationMinutes,
    tags: options.tags ?? options.record.references.tags,
    precomputedSummary: options.precomputedSummary,
    clearSourceAfterPersist: false,
  }
}

export function buildRecallMemorySummary(
  summary: OpencodeRecallSummary,
): MemorySummary {
  return {
    narrative: summary.focus,
    decisions: summary.decisions,
    discoveries: summary.discoveries,
    patterns: summary.patterns,
    whatWorked: [],
    whatFailed: [],
    blockers: summary.blockers,
    openQuestions: summary.openQuestions,
    nextSteps: summary.nextSteps,
    tasks: summary.tasks,
    files: summary.files,
    confidence: summary.confidence,
  }
}

function resolveTimestamp(value: string | null): Date {
  if (!value) {
    return new Date()
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return new Date()
  }
  return new Date(parsed)
}
