import { serializeFrontmatter } from '../utils/frontmatter'
import type { OpencodeRecallSummary } from '../recall/opencode/summary-parse'

const NOW_FRONTMATTER_ORDER = [
  'session_id',
  'timestamp_start',
  'timestamp_end',
  'duration_minutes',
  'project_path',
  'tags',
  'parent_session',
  'related_tasks',
  'memory_type',
]

export function buildNowContent(summary: OpencodeRecallSummary): string {
  const focus = summary.focus
  const tags = ['opencode', 'recall']
  const relatedTasks = extractTaskIds(summary.tasks)
  const durationMinutes = computeDurationMinutes(
    summary.createdAt,
    summary.updatedAt,
  )
  const frontmatter = serializeFrontmatter(
    {
      session_id: summary.sessionId,
      timestamp_start: summary.createdAt,
      timestamp_end: summary.updatedAt,
      duration_minutes: durationMinutes,
      project_path: summary.directory ?? process.cwd(),
      tags,
      parent_session: null,
      related_tasks: relatedTasks,
      memory_type: 'NOW',
    },
    NOW_FRONTMATTER_ORDER,
  )

  const lines: string[] = []
  lines.push(frontmatter)
  lines.push('')
  lines.push(
    `# Session: ${summary.sessionId} - ${formatTimestampForHeader(summary.createdAt)}`,
  )
  lines.push('')
  lines.push(`## User: ${focus}`)

  if (summary.decisions.length > 0) {
    lines.push('')
    summary.decisions.forEach((decision) => {
      lines.push(`@decision: ${decision}`)
    })
  }
  if (summary.discoveries.length > 0) {
    lines.push('')
    summary.discoveries.forEach((discovery) => {
      lines.push(`@discovery: ${discovery}`)
    })
  }
  if (summary.patterns.length > 0) {
    lines.push('')
    summary.patterns.forEach((pattern) => {
      lines.push(`@pattern: ${pattern}`)
    })
  }
  if (summary.tasks.length > 0) {
    lines.push('')
    lines.push('## Tasks')
    summary.tasks.forEach((task) => {
      lines.push(`- ${task}`)
    })
  }
  if (summary.files.length > 0) {
    lines.push('')
    lines.push('## Files')
    summary.files.forEach((file) => {
      lines.push(`- ${file}`)
    })
  }

  lines.push('')
  return lines.join('\n')
}

function extractTaskIds(items: string[]): string[] {
  const matches: string[] = []
  for (const item of items) {
    const found = item.match(/\btkt_[a-zA-Z0-9_-]+\b/g)
    if (found) {
      matches.push(...found)
    }
  }
  return Array.from(new Set(matches))
}

function computeDurationMinutes(start: string, end: string): number | null {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null
  }
  if (endMs <= startMs) {
    return 1
  }
  return Math.max(1, Math.round((endMs - startMs) / 60000))
}

function formatTimestampForHeader(timestamp: string): string {
  const date = new Date(timestamp)
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  const iso = safe.toISOString()
  const [day, time] = iso.split('T')
  return `${day} ${time.slice(0, 5)} UTC`
}
