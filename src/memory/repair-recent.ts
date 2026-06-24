import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { countLines, writeFilesAtomically } from './consolidate-io'
import { getMemoryConfig } from './config'
import {
  extractRecentEntries,
  isMeaningfulEntry,
  upsertRecent,
} from './recent-content-builders'
import { extractAnchorFromEntry } from './memory-index'
import { initMemory } from './init'
import { memoryPath, resolveMemoryDir } from './paths'
import { parseFrontmatter } from '../utils/frontmatter'

type RepairRecentOptions = {
  dryRun?: boolean
}

type RepairedRecentEntry = {
  anchor: string
  content: string
  reusedDuration: boolean
  timestamp: number
}

type MemorySection = {
  anchor: string | null
  dateStamp: string
  entryLabel: string
  fileName: string
  summaryLines: string[]
  timeStamp: string
}

export type RepairRecentResult = {
  dryRun: boolean
  meaningfulEntries: number
  rebuiltEntries: number
  recentLines: number
  recentPath: string
  scannedMemoryFiles: number
  scannedSections: number
  unknownDurations: number
  reusedDurations: number
  updatedRecent: string
  wroteFile: boolean
}

const MEMORY_SECTION_HEADING =
  /^##\s+(.+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+UTC\s+\(([^)]+)\)$/

export function repairRecent(
  options: RepairRecentOptions = {},
): RepairRecentResult {
  initMemory()

  const dryRun = options.dryRun ?? false
  const config = getMemoryConfig()
  const recentPath = memoryPath('RECENT.md')
  const durationByAnchor = loadDurationByAnchor(recentPath)
  const rebuiltEntries = loadRepairedRecentEntries(durationByAnchor)
  const header = `# RECENT - Last ${Math.max(1, config.recent_session_count)} Sessions`
  const updatedRecent = buildRepairedRecentContent(
    rebuiltEntries,
    recentPath,
    config.recent_session_count,
    config.recent_max_lines,
    header,
  )
  const meaningfulEntries = extractRecentEntries(
    updatedRecent.split('\n'),
  ).filter(isMeaningfulEntry).length

  if (!dryRun && rebuiltEntries.length > 0) {
    writeFilesAtomically([{ path: recentPath, content: updatedRecent }])
  }

  const reusedDurations = rebuiltEntries.filter(
    (entry) => entry.reusedDuration,
  ).length

  return {
    dryRun,
    meaningfulEntries,
    rebuiltEntries: rebuiltEntries.length,
    recentLines: countLines(updatedRecent),
    recentPath,
    scannedMemoryFiles: listMemoryFiles(resolveMemoryDir()).length,
    scannedSections: rebuiltEntries.length,
    unknownDurations: rebuiltEntries.length - reusedDurations,
    reusedDurations,
    updatedRecent,
    wroteFile: !dryRun && rebuiltEntries.length > 0,
  }
}

function buildRepairedRecentContent(
  entries: RepairedRecentEntry[],
  recentPath: string,
  maxSessions: number,
  maxLines: number,
  header: string,
): string {
  if (entries.length === 0) {
    return `${header}\n`
  }

  let rebuilt = ''
  for (const entry of entries
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp)) {
    rebuilt = upsertRecent(
      recentPath,
      entry.content,
      {
        maxSessions,
        maxLines,
      },
      rebuilt,
    )
  }

  return rebuilt || `${header}\n`
}

function loadRepairedRecentEntries(
  durationByAnchor: Map<string, string>,
): RepairedRecentEntry[] {
  const deduped = new Map<string, RepairedRecentEntry>()

  for (const fileName of listMemoryFiles(resolveMemoryDir())) {
    const filePath = join(resolveMemoryDir(), fileName)
    const content = readFileSync(filePath, 'utf-8')

    for (const section of extractMemorySections(fileName, content)) {
      if (!section.anchor) {
        continue
      }

      const entry = buildRecentEntryFromMemorySection(section, durationByAnchor)
      const existing = deduped.get(entry.anchor)
      if (!existing || entry.timestamp >= existing.timestamp) {
        deduped.set(entry.anchor, entry)
      }
    }
  }

  return Array.from(deduped.values())
}

function listMemoryFiles(memoryDir: string): string[] {
  if (!existsSync(memoryDir)) {
    return []
  }

  return readdirSync(memoryDir)
    .filter((fileName) => /^MEMORY-.*\.md$/.test(fileName))
    .sort()
}

function loadDurationByAnchor(recentPath: string): Map<string, string> {
  const durationByAnchor = new Map<string, string>()
  if (!existsSync(recentPath)) {
    return durationByAnchor
  }

  const content = readFileSync(recentPath, 'utf-8')
  for (const entry of extractRecentEntries(content.split('\n'))) {
    const anchor = extractAnchorFromEntry(entry)
    const heading = entry.match(
      /^##\s+.+?\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\(([^)]+)\)$/m,
    )
    if (!anchor || !heading) {
      continue
    }
    durationByAnchor.set(anchor, heading[1])
  }

  return durationByAnchor
}

function extractMemorySections(
  fileName: string,
  content: string,
): MemorySection[] {
  const { body } = parseFrontmatter(content)
  const lines = body.split('\n')
  const sections: MemorySection[] = []
  let current: MemorySection | null = null

  for (const line of lines) {
    const heading = line.match(MEMORY_SECTION_HEADING)
    if (heading) {
      if (current) {
        sections.push(current)
      }
      current = {
        anchor: null,
        dateStamp: heading[2],
        entryLabel: heading[1],
        fileName,
        summaryLines: [],
        timeStamp: heading[3],
      }
      continue
    }

    if (!current) {
      continue
    }

    const anchor = extractAnchorFromLine(line)
    if (anchor && !current.anchor) {
      current.anchor = anchor
      continue
    }

    current.summaryLines.push(line)
  }

  if (current) {
    sections.push(current)
  }

  return sections
}

function buildRecentEntryFromMemorySection(
  section: MemorySection,
  durationByAnchor: Map<string, string>,
): RepairedRecentEntry {
  const duration = durationByAnchor.get(section.anchor ?? '') ?? 'unknown'
  const summaryLines = normalizeSummaryLines(section.summaryLines)
  const lines = [
    `## ${section.entryLabel} ${section.dateStamp} ${section.timeStamp} (${duration})`,
    '',
    ...summaryLines,
    `**Link**: [Full details](${section.fileName}#${section.anchor})`,
  ]

  return {
    anchor:
      section.anchor ??
      `${basename(section.fileName)}-${section.dateStamp}-${section.timeStamp}`,
    content: lines.join('\n'),
    reusedDuration: durationByAnchor.has(section.anchor ?? ''),
    timestamp:
      Date.parse(`${section.dateStamp}T${section.timeStamp}:00.000Z`) || 0,
  }
}

function normalizeSummaryLines(lines: string[]): string[] {
  const filtered = lines.filter((line) => !line.startsWith('**Files**:'))
  while (filtered.length > 0 && filtered[0].trim() === '') {
    filtered.shift()
  }
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
    filtered.pop()
  }
  return filtered
}

function extractAnchorFromLine(line: string): string | null {
  const match = line.trim().match(/^<a name="([A-Za-z0-9_-]+)"><\/a>$/)
  return match?.[1] ?? null
}
