import { existsSync, readFileSync } from 'node:fs'
import { parseFrontmatter, replaceFrontmatter } from '../utils/frontmatter'
import type { MemorySummary } from './types'
import { buildSummaryLines } from './memory-summary-lines'

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

export function unique(items: string[]): string[] {
  return Array.from(new Set(items))
}

export function mergeUnique(current: unknown, incoming: string[]): string[] {
  const currentArray = Array.isArray(current) ? current.map(String) : []
  return unique([...currentArray, ...incoming])
}

// ---------------------------------------------------------------------------
// MEMORY file helpers
// ---------------------------------------------------------------------------

export function buildMemorySection(options: {
  entryLabel: string
  sourceLabel?: string | null
  sessionId: string
  dateStamp: string
  timeStamp: string
  summary: MemorySummary
  anchor: string
}): string {
  const lines: string[] = []
  lines.push(
    `## ${options.entryLabel} ${options.dateStamp} ${options.timeStamp} UTC (${options.sessionId})`,
  )
  lines.push(`<a name="${options.anchor}"></a>`)
  lines.push('')
  lines.push(
    ...buildSummaryLines({
      summary: options.summary,
      includeFiles: true,
      sourceLabel: options.sourceLabel,
    }),
  )
  return lines.join('\n')
}

export function upsertMemoryFile(
  path: string,
  options: { sessionId: string; tags: string[]; section: string },
  existingContent?: string | null,
): string {
  const now = new Date().toISOString()
  const currentContent =
    typeof existingContent === 'string'
      ? existingContent
      : existsSync(path)
        ? readFileSync(path, 'utf-8')
        : null

  if (!currentContent) {
    const frontmatter = buildMemoryFrontmatter({
      consolidationDate: now,
      sessionIds: [options.sessionId],
      tags: options.tags,
      totalSessions: 1,
    })
    return `${frontmatter}\n\n# Consolidated Memory\n\n${options.section}\n`
  }

  const { frontmatter, body, keys } = parseFrontmatter(currentContent)
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
  const updatedFrontmatter = {
    ...frontmatter,
    consolidated: true,
  }
  const updatedKeys = keys.includes('consolidated')
    ? keys
    : [...keys, 'consolidated']
  return replaceFrontmatter(
    clearedBody,
    updatedFrontmatter,
    updatedKeys.length ? updatedKeys : undefined,
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
