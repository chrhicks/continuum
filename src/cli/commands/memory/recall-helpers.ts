import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { type RecallSearchMode } from '../../../recall/search'
import {
  type OpencodeDiffEntry,
  type OpencodeDiffReport,
} from '../../../recall/diff/opencode-diff'
import { parseOptionalPositiveInteger } from '../shared'

const DEFAULT_SYNC_PROCESSED_VERSION = 1

export function parseRecallMode(value?: string): RecallSearchMode {
  if (!value) return 'auto'
  const normalized = value.toLowerCase()
  if (
    normalized === 'bm25' ||
    normalized === 'semantic' ||
    normalized === 'auto'
  ) {
    return normalized
  }
  throw new Error('Invalid mode. Use: bm25, semantic, or auto.')
}

export function parseRecallLimit(value?: string): number {
  return parseOptionalPositiveInteger(
    value,
    5,
    'Limit must be a positive integer.',
  )
}

export function parseDiffLimit(value?: string): number {
  return parseOptionalPositiveInteger(
    value,
    10,
    'Limit must be a positive integer.',
  )
}

export function parseSyncLimit(value?: string): number | null {
  return parseOptionalPositiveInteger(
    value,
    null,
    'Limit must be a positive integer.',
  )
}

export function parseProcessedVersion(value?: string): number {
  return parseOptionalPositiveInteger(
    value,
    DEFAULT_SYNC_PROCESSED_VERSION,
    'Processed version must be a positive integer.',
  )
}

export function resolveRecallPath(
  dataRoot: string,
  value: string | null,
  defaultFileName: string,
): string {
  if (value) {
    return resolve(process.cwd(), value)
  }
  return join(dataRoot, 'recall', 'opencode', defaultFileName)
}

export function writeJsonFile(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

export function appendJsonLine(filePath: string, payload: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf-8')
}

export function formatScore(score: number): string {
  const rounded = Math.round(score * 1000) / 1000
  return rounded.toFixed(3)
}

export function formatRecallModeLabel(mode: 'bm25' | 'semantic'): string {
  if (mode === 'semantic') {
    return 'semantic (tf-idf)'
  }
  return mode
}

export function renderRecallDiffReport(
  report: OpencodeDiffReport,
  limit: number,
): string {
  const lines: string[] = []
  lines.push(`Source index: ${report.index_file}`)
  lines.push(`Summary dir: ${report.summary_dir}`)
  lines.push(`Project scope: ${report.project_scope.project_ids.join(', ')}`)
  lines.push(`Source sessions: ${report.stats.source_sessions}`)
  lines.push(
    `Local summaries: ${report.stats.local_summaries} (duplicates: ${report.stats.local_duplicates})`,
  )
  lines.push('Diff:')
  lines.push(`- new: ${report.stats.new}`)
  lines.push(`- stale: ${report.stats.stale}`)
  lines.push(`- unchanged: ${report.stats.unchanged}`)
  lines.push(`- orphan: ${report.stats.orphan}`)
  lines.push(`- unknown: ${report.stats.unknown}`)
  lines.push('')

  lines.push(...renderRecallDiffSection('New', report.new, limit))
  lines.push(...renderRecallDiffSection('Stale', report.stale, limit))
  lines.push(...renderRecallDiffSection('Orphan', report.orphan, limit))
  lines.push(...renderRecallDiffSection('Unknown', report.unknown, limit))

  if (report.stats.local_duplicates > 0) {
    const duplicateSuffix =
      limit > 0 && report.duplicates.length > limit ? `, showing ${limit}` : ''
    lines.push(
      `Duplicates (${report.stats.local_duplicates}${duplicateSuffix})`,
    )
    const rows = report.duplicates.slice(0, limit).map((entry) => {
      return `- ${entry.key} | kept=${entry.kept} | dropped=${entry.dropped}`
    })
    lines.push(...rows, '')
  }

  return lines.join('\n').trimEnd() + '\n'
}

function renderRecallDiffSection(
  label: string,
  entries: OpencodeDiffEntry[],
  limit: number,
): string[] {
  const showing = entries.slice(0, limit)
  const headerSuffix =
    limit > 0 && entries.length > limit ? `, showing ${limit}` : ''
  const header = `${label} (${entries.length}${headerSuffix})`
  if (showing.length === 0) {
    return [header, '- none', '']
  }

  const rows = showing.map((entry) => {
    const title = entry.title ?? 'untitled'
    const sourceUpdated = entry.source_updated_at ?? 'n/a'
    const summaryGenerated = entry.summary_generated_at ?? 'n/a'
    return `- ${entry.key} | ${title} | source_updated_at=${sourceUpdated} | summary_generated_at=${summaryGenerated}`
  })

  return [header, ...rows, '']
}
