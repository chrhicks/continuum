export type ParsedRecentEntry = {
  label: string
  date: string
  duration: string
  source: string
  narrative: string
  blockers: string[]
  openQuestions: string[]
  nextSteps: string[]
  decisions: string[]
  discoveries: string[]
}

type RecentEntrySection =
  | 'blockers'
  | 'decisions'
  | 'discoveries'
  | 'nextSteps'
  | 'openQuestions'

const SECTION_KEYS: Record<string, RecentEntrySection | null> = {
  '**Decisions**': 'decisions',
  '**Discoveries**': 'discoveries',
  '**Blockers**': 'blockers',
  '**Open questions**': 'openQuestions',
  '**Next steps**': 'nextSteps',
  '**Source**': null,
  '**Link**': null,
}

function createEmptyParsedRecentEntry(): ParsedRecentEntry {
  return {
    label: 'Session',
    date: '',
    duration: '',
    source: '',
    narrative: '',
    blockers: [],
    openQuestions: [],
    nextSteps: [],
    decisions: [],
    discoveries: [],
  }
}

export function parseRecentEntry(entry: string): ParsedRecentEntry {
  const lines = entry.split('\n')
  const result = createEmptyParsedRecentEntry()
  parseRecentHeading(lines, result)
  parseRecentBody(lines, result)
  return result
}

function parseRecentHeading(
  lines: string[],
  result: ParsedRecentEntry,
): void {
  const headingLine = lines.find((line) => line.startsWith('## '))
  if (!headingLine) return
  const headingMatch = headingLine.match(
    /^##\s+(.+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+\(([^)]+)\)/,
  )
  if (headingMatch) {
    result.label = headingMatch[1]
    result.date = `${headingMatch[2]} ${headingMatch[3]}`
    result.duration = headingMatch[4]
  } else {
    result.label = headingLine.replace('## ', '').trim()
  }
}

function parseRecentBody(lines: string[], result: ParsedRecentEntry): void {
  let currentSection: RecentEntrySection | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '---' || trimmed.startsWith('## ')) continue

    const sectionKey = matchSectionKey(trimmed)
    if (sectionKey !== undefined) {
      currentSection = sectionKey
      if (trimmed.startsWith('**Source**')) {
        const sourceMatch = trimmed.match(/^\*\*Source\*\*:\s*(.+)/)
        if (sourceMatch) result.source = sourceMatch[1]
      }
      continue
    }

    if (trimmed.startsWith('- ')) {
      appendSectionItem(result, currentSection, trimmed.slice(2))
      continue
    }

    if (!result.narrative) {
      result.narrative = trimmed
    }
  }
}

function matchSectionKey(
  trimmed: string,
): RecentEntrySection | null | undefined {
  if (trimmed.startsWith('**Source**')) return null
  if (trimmed.startsWith('**Link**')) return null
  for (const [prefix, section] of Object.entries(SECTION_KEYS)) {
    if (trimmed.startsWith(prefix)) return section
  }
  if (trimmed.startsWith('**') && trimmed.endsWith('**:')) return null
  return undefined
}

function appendSectionItem(
  result: ParsedRecentEntry,
  section: RecentEntrySection | null,
  item: string,
): void {
  if (!section) return
  result[section].push(item)
}
