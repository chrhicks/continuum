/**
 * Formatting, summary, recent-file, and memory-file helpers for consolidation.
 */
import { existsSync, readFileSync } from 'node:fs'
import { parseFrontmatter, replaceFrontmatter } from '../utils/frontmatter'
import type { MemorySummary } from './types'
import { extractAnchorFromEntry } from './memory-index'
import { buildSummaryLines } from './memory-summary-lines'

const MEANINGFUL_MIN_CONTENT_LINES = 3
const MEANINGFUL_MIN_CONTENT_LENGTH = 120

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
// RECENT file helpers
// ---------------------------------------------------------------------------

export function buildRecentEntry(options: {
  entryLabel: string
  sourceLabel?: string | null
  dateStamp: string
  timeStamp: string
  durationMinutes: number
  summary: MemorySummary
  memoryFileName: string
  anchor: string
}): string {
  const duration = formatDuration(options.durationMinutes)
  const lines: string[] = []
  lines.push(
    `## ${options.entryLabel} ${options.dateStamp} ${options.timeStamp} (${duration})`,
  )
  lines.push('')
  lines.push(
    ...buildSummaryLines({
      summary: options.summary,
      includeFiles: false,
      sourceLabel: options.sourceLabel,
    }),
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
  existingContent?: string | null,
): string {
  const maxSessions = Math.max(1, options.maxSessions)
  const header = `# RECENT - Last ${maxSessions} Sessions`
  const currentContent =
    typeof existingContent === 'string'
      ? existingContent
      : existsSync(path)
        ? readFileSync(path, 'utf-8')
        : null

  if (!currentContent) {
    return `${header}\n\n${entry}\n`
  }
  const content = currentContent.trim()
  const lines = content.split('\n')
  const existingEntries = extractRecentEntries(lines)
  const deduped = dedupeRecentEntriesPreferringMeaningful([
    entry,
    ...existingEntries,
  ])
  const allEntries = selectRecentEntries(deduped, maxSessions, maxSessions)
  return buildRecentContent(header, allEntries, options.maxLines)
}

export function extractRecentEntries(lines: string[]): string[] {
  const entries: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
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
// Meaningfulness and cleared-NOW detection
// ---------------------------------------------------------------------------

export function isClearedNowBody(
  body: string,
  frontmatter?: Record<string, unknown>,
): boolean {
  // Explicit marker set when we clear a NOW file after consolidation
  if (frontmatter?.consolidated === true) return true

  const trimmed = body.trim()
  if (!trimmed) return true
  const lines = trimmed.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) return true
  if (lines.length === 1 && lines[0].startsWith('#')) {
    // If the session was ended (duration set) and the body is only a header,
    // it was likely already consolidated and cleared.
    const duration = frontmatter?.duration_minutes
    if (duration != null && duration !== 'null') {
      return true
    }
  }
  return false
}

export function isPlaceholderNarrative(narrative: string): boolean {
  const trimmed = narrative.trim().toLowerCase()
  if (trimmed === 'no summary available.') return true
  if (trimmed.startsWith('the now file contains only the session header'))
    return true
  return false
}

export function scoreEntryMeaningfulness(entry: string): number {
  const lines = entry.split('\n')
  let score = 0
  let inNarrative = false
  let narrativeText = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('## ')) continue
    if (trimmed.startsWith('**Source**')) continue
    if (trimmed.startsWith('**Link**')) continue
    if (trimmed === '---') continue

    if (trimmed.startsWith('- ')) {
      score += 2
      continue
    }

    if (trimmed.startsWith('**') && trimmed.endsWith('**:')) {
      score += 1
      continue
    }

    // Accumulate narrative text for placeholder check
    narrativeText += trimmed + ' '
    inNarrative = true
  }

  if (inNarrative) {
    const narrative = narrativeText.trim()
    if (!isPlaceholderNarrative(narrative)) {
      score += Math.min(
        3,
        Math.floor(narrative.length / MEANINGFUL_MIN_CONTENT_LENGTH),
      )
    }
  }

  return score
}

export function isMeaningfulEntry(entry: string): boolean {
  const lines = entry.split('\n')
  let contentLineCount = 0
  let narrativeText = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('## ')) continue
    if (trimmed.startsWith('**Source**')) continue
    if (trimmed.startsWith('**Link**')) continue
    if (trimmed === '---') continue

    contentLineCount++

    if (
      !trimmed.startsWith('- ') &&
      !trimmed.startsWith('**') &&
      !trimmed.startsWith('*')
    ) {
      narrativeText += trimmed + ' '
    }
  }

  const narrative = narrativeText.trim()
  const hasEnoughLines = contentLineCount >= MEANINGFUL_MIN_CONTENT_LINES
  const hasEnoughLength = narrative.length >= MEANINGFUL_MIN_CONTENT_LENGTH
  const isPlaceholder = isPlaceholderNarrative(narrative)

  return (hasEnoughLines || hasEnoughLength) && !isPlaceholder
}

function dedupeRecentEntriesPreferringMeaningful(entries: string[]): string[] {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    const anchor = extractAnchorFromEntry(entry)
    const key = anchor ?? entry
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, entry)
      continue
    }
    if (scoreEntryMeaningfulness(entry) > scoreEntryMeaningfulness(existing)) {
      seen.set(key, entry)
    }
  }
  return Array.from(seen.values())
}

function selectRecentEntries(
  entries: string[],
  maxSessions: number,
  minMeaningful: number,
): string[] {
  if (entries.length <= maxSessions) return entries

  // entries are newest-first. Always keep the newest (position 0).
  const current = entries[0]
  const existing = entries.slice(1)

  // Start with current + most recent existing entries up to maxSessions-1
  const selected = [current, ...existing.slice(0, maxSessions - 1)]

  const meaningfulCount = selected.filter(isMeaningfulEntry).length
  const shortfall = Math.max(0, minMeaningful - meaningfulCount)

  if (shortfall === 0 || existing.length <= maxSessions - 1) {
    return selected
  }

  const remainingExisting = existing.slice(maxSessions - 1)
  const meaningfulRemaining = remainingExisting.filter(isMeaningfulEntry)
  const swaps = meaningfulRemaining.slice(0, shortfall)

  let swapIdx = 0
  for (let i = selected.length - 1; i >= 0 && swapIdx < swaps.length; i--) {
    if (!isMeaningfulEntry(selected[i])) {
      selected[i] = swaps[swapIdx++]
    }
  }

  return selected
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
