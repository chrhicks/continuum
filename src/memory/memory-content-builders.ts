/**
 * Formatting, summary, recent-file, and memory-file helpers for consolidation.
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseFrontmatter, replaceFrontmatter } from '../utils/frontmatter'
import { type NowSummary } from './summarize'
import { dedupeEntriesByAnchor } from './memory-index'

// ---------------------------------------------------------------------------
// Date/time formatters
// ---------------------------------------------------------------------------

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function formatDisplayTime(date: Date): string {
  return date.toISOString().slice(11, 16)
}

export function formatAnchorTime(date: Date): string {
  return date.toISOString().slice(11, 16).replace(/:/g, '-')
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  if (remaining === 0) {
    return `${hours}h`
  }
  return `${hours}h ${remaining}m`
}

// ---------------------------------------------------------------------------
// Summary/display helpers
// ---------------------------------------------------------------------------

export function formatFileList(files: string[], limit?: number): string {
  if (files.length === 0) {
    return 'none'
  }
  const wrapped = files.map((file) => `\`${file}\``)
  if (!limit || files.length <= limit) {
    return wrapped.join(', ')
  }
  const shown = wrapped.slice(0, limit).join(', ')
  const remaining = files.length - limit
  return `${shown} (+${remaining} more)`
}

export function unique(items: string[]): string[] {
  return Array.from(new Set(items))
}

export function mergeUnique(current: unknown, incoming: string[]): string[] {
  const currentArray = Array.isArray(current) ? current.map(String) : []
  return unique([...currentArray, ...incoming])
}

export function buildSummaryLines(options: {
  summary: NowSummary
  includeFiles: boolean
}): string[] {
  const { summary } = options
  const lines = [summary.narrative]
  const sections: Array<{ heading: string; items: string[] }> = [
    { heading: '**Decisions**:', items: summary.decisions },
    { heading: '**Discoveries**:', items: summary.discoveries },
    { heading: '**What worked**:', items: summary.whatWorked },
    { heading: "**What didn't work**:", items: summary.whatFailed },
    { heading: '**Open questions**:', items: summary.openQuestions },
    { heading: '**Next steps**:', items: summary.nextSteps },
  ]

  for (const section of sections) {
    if (section.items.length === 0) {
      continue
    }
    lines.push('')
    lines.push(section.heading)
    lines.push(...section.items.map((item) => `- ${item}`))
  }

  if (summary.tasks.length > 0) {
    lines.push('')
    lines.push(`**Tasks**: ${summary.tasks.join(', ')}`)
  }

  if (options.includeFiles && summary.files.length > 0) {
    lines.push('')
    lines.push(`**Files**: ${formatFileList(summary.files)}`)
  }

  return lines
}

// ---------------------------------------------------------------------------
// RECENT file helpers
// ---------------------------------------------------------------------------

export function buildRecentEntry(options: {
  dateStamp: string
  timeStamp: string
  durationMinutes: number
  summary: NowSummary
  memoryFileName: string
  anchor: string
}): string {
  const duration = formatDuration(options.durationMinutes)
  const lines: string[] = []
  lines.push(
    `## Session ${options.dateStamp} ${options.timeStamp} (${duration})`,
  )
  lines.push('')
  lines.push(
    ...buildSummaryLines({ summary: options.summary, includeFiles: false }),
  )
  lines.push(
    `**Link**: [Full details](${options.memoryFileName}#${options.anchor})`,
  )
  return lines.join('\n')
}

export function upsertRecent(
  path: string,
  entry: string,
  options: { maxSessions: number; maxLines: number },
): string {
  const maxSessions = Math.max(1, options.maxSessions)
  const header = `# RECENT - Last ${maxSessions} Sessions`
  if (!existsSync(path)) {
    return `${header}\n\n${entry}\n`
  }
  const content = readFileSync(path, 'utf-8').trim()
  const lines = content.split('\n')
  const existingEntries = extractRecentEntries(lines)
  const allEntries = dedupeEntriesByAnchor([entry, ...existingEntries]).slice(
    0,
    maxSessions,
  )
  return buildRecentContent(header, allEntries, options.maxLines)
}

export function extractRecentEntries(lines: string[]): string[] {
  const entries: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith('## Session ')) {
      if (current.length > 0) {
        entries.push(current.join('\n').trim())
      }
      current = [line]
      continue
    }
    if (line.startsWith('# ')) {
      continue
    }
    if (current.length > 0 && line.trim() === '---') {
      continue
    }
    if (current.length > 0) {
      current.push(line)
    }
  }
  if (current.length > 0) {
    entries.push(current.join('\n').trim())
  }
  return entries
}

export function buildRecentContent(
  header: string,
  entries: string[],
  maxLines: number,
): string {
  let currentEntries = entries.slice()
  let content = `${header}\n\n${currentEntries.join('\n\n---\n\n')}\n`
  if (maxLines <= 0) {
    return content
  }

  while (content.split('\n').length > maxLines && currentEntries.length > 1) {
    currentEntries = currentEntries.slice(0, currentEntries.length - 1)
    content = `${header}\n\n${currentEntries.join('\n\n---\n\n')}\n`
  }
  return content
}

// ---------------------------------------------------------------------------
// MEMORY file helpers
// ---------------------------------------------------------------------------

export function buildMemorySection(options: {
  sessionId: string
  dateStamp: string
  timeStamp: string
  summary: NowSummary
  anchor: string
}): string {
  const lines: string[] = []
  lines.push(
    `## Session ${options.dateStamp} ${options.timeStamp} UTC (${options.sessionId})`,
  )
  lines.push(`<a name="${options.anchor}"></a>`)
  lines.push('')
  lines.push(
    ...buildSummaryLines({ summary: options.summary, includeFiles: true }),
  )
  return lines.join('\n')
}

export function upsertMemoryFile(
  path: string,
  options: { sessionId: string; tags: string[]; section: string },
): string {
  const now = new Date().toISOString()
  if (!existsSync(path)) {
    const frontmatter = buildMemoryFrontmatter({
      consolidationDate: now,
      sessionIds: [options.sessionId],
      tags: options.tags,
      totalSessions: 1,
    })
    return `${frontmatter}\n\n# Consolidated Memory\n\n${options.section}\n`
  }

  const existing = readFileSync(path, 'utf-8')
  const { frontmatter, body, keys } = parseFrontmatter(existing)
  const sessionIds = mergeUnique(frontmatter.source_sessions, [
    options.sessionId,
  ])
  const tags = mergeUnique(frontmatter.tags, options.tags)
  const updatedFrontmatter = {
    ...frontmatter,
    consolidation_date: now,
    source_sessions: sessionIds,
    total_sessions_consolidated: sessionIds.length,
    tags,
  }
  const updatedBody = body.trimEnd() + '\n\n' + options.section + '\n'
  return replaceFrontmatter(
    updatedBody,
    updatedFrontmatter,
    keys.length ? keys : undefined,
  )
}

export function buildMemoryFrontmatter(options: {
  consolidationDate: string
  sessionIds: string[]
  totalSessions: number
  tags: string[]
}): string {
  const lines = [
    `consolidation_date: ${options.consolidationDate}`,
    `source_sessions: [${options.sessionIds.join(', ')}]`,
    `total_sessions_consolidated: ${options.totalSessions}`,
    `tags: [${options.tags.join(', ')}]`,
    `consolidated_by: continuum-cli-v0.1`,
  ]
  return `---\n${lines.join('\n')}\n---`
}

export function buildClearedNowContent(
  frontmatter: Record<string, unknown>,
  keys: string[],
  body: string,
): string {
  const header = extractSessionHeader(body)
  const clearedBody = `${header}\n\n`
  return replaceFrontmatter(
    clearedBody,
    frontmatter,
    keys.length ? keys : undefined,
  )
}

export function extractSessionHeader(body: string): string {
  const lines = body.split('\n')
  for (const line of lines) {
    if (line.startsWith('# Session: ')) {
      return line
    }
  }
  for (const line of lines) {
    if (line.startsWith('# ')) {
      return line
    }
  }
  return '# Session: unknown'
}
