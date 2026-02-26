/**
 * Memory index helpers: insert, deduplicate, and build the MEMORY.md index.
 */
import { existsSync, readFileSync } from 'node:fs'

export function extractAnchorFromEntry(entry: string): string | null {
  const match = entry.match(/#([A-Za-z0-9_-]+)/)
  return match?.[1] ?? null
}

export function dedupeEntriesByAnchor(entries: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const entry of entries) {
    const anchor = extractAnchorFromEntry(entry)
    const key = anchor ?? entry
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    output.push(entry)
  }
  return output
}

export function insertEntryInSection(
  content: string,
  section: string,
  entry: string,
): string {
  const lines = content.split('\n')
  const header = `## ${section}`
  let index = lines.findIndex((line) => line.trim() === header)
  if (index === -1) {
    return content.trimEnd() + `\n${header}\n${entry}\n`
  }

  let scanIndex = index + 1
  while (scanIndex < lines.length && lines[scanIndex].trim() === '') {
    scanIndex += 1
  }
  const insertIndex = scanIndex
  const entryAnchor = extractAnchorFromEntry(entry)
  while (scanIndex < lines.length && !lines[scanIndex].startsWith('## ')) {
    if (lines[scanIndex].startsWith('- ')) {
      if (entryAnchor) {
        const existingAnchor = extractAnchorFromEntry(lines[scanIndex])
        if (existingAnchor === entryAnchor) {
          return lines.join('\n')
        }
      } else if (lines[scanIndex] === entry) {
        return lines.join('\n')
      }
    }
    scanIndex += 1
  }
  lines.splice(insertIndex, 0, entry)
  return lines.join('\n')
}

export function dedupeIndexEntries(content: string): string {
  const lines = content.split('\n')
  const output: string[] = []
  const seenBySection = new Map<string, Set<string>>()
  let currentSection: string | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.replace(/^##\s+/, '').trim()
      output.push(line)
      continue
    }

    if (currentSection && line.startsWith('- ')) {
      const key = extractAnchorFromEntry(line) ?? line
      let seen = seenBySection.get(currentSection)
      if (!seen) {
        seen = new Set()
        seenBySection.set(currentSection, seen)
      }
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
    }

    output.push(line)
  }

  return output.join('\n')
}

export function buildDefaultIndexContent(sections: string[]): string {
  const lines: string[] = ['# Long-term Memory Index', '']
  for (const section of sections) {
    lines.push(`## ${section}`, '')
  }
  return lines.join('\n')
}

export function resolveIndexSections(sections: string[]): {
  decisions: string
  discoveries: string
  patterns: string
  sessions: string
} {
  return {
    decisions: sections[0] ?? 'Architecture Decisions',
    discoveries: sections[1] ?? 'Technical Discoveries',
    patterns: sections[2] ?? 'Development Patterns',
    sessions: sections.find((section) => section === 'Sessions') ?? 'Sessions',
  }
}

export function buildIndexEntry(options: {
  dateStamp: string
  timeStamp: string
  focus: string
  memoryFileName: string
  anchor: string
}): string {
  const summary =
    options.focus.length > 80
      ? `${options.focus.slice(0, 77)}...`
      : options.focus
  return `- **[Session ${options.dateStamp} ${options.timeStamp}](${options.memoryFileName}#${options.anchor})** - ${summary}`
}

export function upsertMemoryIndex(
  path: string,
  options: {
    entry: string
    hasDecisions: boolean
    hasDiscoveries: boolean
    hasPatterns: boolean
    sections: string[]
  },
): string {
  const defaultContent = buildDefaultIndexContent(options.sections)

  const content = existsSync(path)
    ? readFileSync(path, 'utf-8')
    : defaultContent
  let updated = dedupeIndexEntries(content)

  const indexSections = resolveIndexSections(options.sections)
  if (options.hasDecisions) {
    updated = insertEntryInSection(
      updated,
      indexSections.decisions,
      options.entry,
    )
  } else if (options.hasDiscoveries) {
    updated = insertEntryInSection(
      updated,
      indexSections.discoveries,
      options.entry,
    )
  } else if (options.hasPatterns) {
    updated = insertEntryInSection(
      updated,
      indexSections.patterns,
      options.entry,
    )
  } else {
    updated = insertEntryInSection(
      updated,
      indexSections.sessions,
      options.entry,
    )
  }

  return updated.trimEnd() + '\n'
}
