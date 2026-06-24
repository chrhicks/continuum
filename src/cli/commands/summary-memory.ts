import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { getWorkspaceContext, memoryPath } from '../../memory/paths'
import { getStatus } from '../../memory/status'
import { parseFrontmatter } from '../../utils/frontmatter'
import {
  extractRecentEntries,
  isMeaningfulEntry,
} from '../../memory/recent-content-builders'
import { parseRecentEntry } from './recent-entry-parser'
import { truncate } from './summary-tasks'

export function renderMemorySummary(memoryLines: number): string {
  const status = getStatus()
  const lines = ['## Memory']
  lines.push(`- NOW: ${status.nowPath ? basename(status.nowPath) : 'none'}`)
  lines.push(`- NOW lines: ${status.nowLines}`)
  lines.push(`- RECENT lines: ${status.recentLines}`)
  lines.push(`- last consolidation: ${status.lastConsolidation ?? 'n/a'}`)

  if (status.nowPath) {
    appendExcerpt(lines, 'NOW tail', status.nowPath, memoryLines, 'tail')
  }

  const recentPath = memoryPath('RECENT.md')
  const recentEntries = loadRecentEntries(recentPath)
  const meaningfulCount = recentEntries.filter(isMeaningfulEntry).length

  if (recentEntries.length > 0) {
    lines.push('', '### Recent Sessions')
    const shown = recentEntries.slice(0, 3)
    for (const entry of shown) {
      const parsed = parseRecentEntry(entry)
      lines.push(`- **${parsed.label}** (${parsed.date} ${parsed.duration})`)
      if (parsed.source) {
        lines.push(`  - Source: ${parsed.source}`)
      }
      if (parsed.narrative) {
        lines.push(`  - ${parsed.narrative}`)
      }
      appendRecentEntryList(lines, 'Next steps', parsed.nextSteps)
      appendRecentEntryList(lines, 'Blockers', parsed.blockers)
      appendRecentEntryList(lines, 'Open questions', parsed.openQuestions)
      appendRecentEntryList(lines, 'Decisions', parsed.decisions)
      appendRecentEntryList(lines, 'Discoveries', parsed.discoveries)
    }

    if (meaningfulCount < 2) {
      const fallback = loadMemoryFallback(3)
      if (fallback.length > 0) {
        lines.push('', '### Additional Context from Memory Index')
        for (const item of fallback) {
          lines.push(`- **${item.label}** - ${item.summary}`)
        }
      }
    }
  }

  return lines.join('\n')
}

function appendRecentEntryList(
  lines: string[],
  label: string,
  items: string[],
): void {
  if (items.length === 0) return
  lines.push(`  - ${label}: ${items.join('; ')}`)
}

function loadRecentEntries(path: string): string[] {
  if (!existsSync(path)) return []
  const content = readFileSync(path, 'utf-8')
  return extractRecentEntries(content.split('\n'))
}

function loadMemoryFallback(limit: number): Array<{
  label: string
  summary: string
}> {
  const indexPath = memoryPath('MEMORY.md')
  if (!existsSync(indexPath)) return []

  const content = readFileSync(indexPath, 'utf-8')
  const entries: Array<{ label: string; summary: string; timestamp: number }> =
    []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue
    const match = trimmed.match(/^-\s+\*\*\[(.+?)\]\([^)]+\)\*\*\s+-\s+(.+)/)
    if (match) {
      entries.push({
        label: match[1],
        summary: match[2],
        timestamp: extractIndexedEntryTimestamp(match[1]),
      })
    }
  }

  return entries
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit)
    .map(({ label, summary }) => ({ label, summary }))
}

function extractIndexedEntryTimestamp(label: string): number {
  const match = label.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/)
  if (!match) return 0
  return Date.parse(`${match[1]}T${match[2]}:00.000Z`) || 0
}

function appendExcerpt(
  lines: string[],
  title: string,
  path: string,
  limit: number,
  mode: 'head' | 'tail',
): void {
  const excerpt = readExcerpt(path, limit, mode)
  if (excerpt.length === 0) return
  lines.push('', `### ${title}`)
  for (const line of excerpt) {
    lines.push(`- ${line}`)
  }
}

function readExcerpt(
  path: string,
  limit: number,
  mode: 'head' | 'tail',
): string[] {
  if (!existsSync(path)) return []
  const parsed = parseFrontmatter(readFileSync(path, 'utf-8'))
  const lines = parsed.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('# Session:'))
  const slice = mode === 'head' ? lines.slice(0, limit) : lines.slice(-limit)
  return slice.map((line) => truncate(normalizeMemoryLine(line), 160))
}

function normalizeMemoryLine(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/^[-*]\s+/, '')
}
