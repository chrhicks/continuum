import {
  type OpencodeDiffEntry,
  type OpencodeDiffReport,
} from '../../../recall/diff/opencode-diff'

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return 'n/a'
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ${units[unitIndex]}`
}

export function formatAgeMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return 'n/a'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h`
  }
  return `${Math.round(minutes / (60 * 24))}d`
}

export function formatScore(score: number): string {
  const rounded = Math.round(score * 1000) / 1000
  return rounded.toFixed(3)
}

export function formatRecallModeLabel(
  mode: 'bm25' | 'semantic' | 'auto',
): string {
  if (mode === 'auto') {
    return 'auto (hybrid)'
  }
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
