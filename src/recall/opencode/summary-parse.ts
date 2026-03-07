import { parseFrontmatter } from '../../utils/frontmatter'

export type OpencodeRecallSummary = {
  sessionId: string
  projectId: string | null
  createdAt: string
  updatedAt: string
  directory: string | null
  title: string | null
  focus: string
  decisions: string[]
  discoveries: string[]
  patterns: string[]
  blockers: string[]
  openQuestions: string[]
  nextSteps: string[]
  tasks: string[]
  files: string[]
  confidence: 'low' | 'medium' | 'high' | null
}

export function parseOpencodeSummary(
  content: string,
): OpencodeRecallSummary | null {
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content)
  if (!hasFrontmatter) {
    return null
  }
  const sessionId = readString(frontmatter.session_id)
  if (!sessionId) {
    return null
  }
  const projectId = readString(frontmatter.project_id)
  const createdAt =
    readTimestamp(frontmatter.created_at) ??
    readTimestamp(frontmatter.updated_at) ??
    new Date().toISOString()
  let updatedAt = readTimestamp(frontmatter.updated_at) ?? createdAt
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    updatedAt = createdAt
  }

  const summaryTitle = extractSummaryTitle(body)
  const title = readString(frontmatter.title) ?? summaryTitle
  const sections = parseSections(body)
  const focus = resolveFocus(
    parseFocus(sections.get('Focus')),
    title,
    sessionId,
  )

  return {
    sessionId,
    projectId,
    createdAt,
    updatedAt,
    directory: readString(frontmatter.directory),
    title,
    focus,
    decisions: parseList(sections.get('Decisions')),
    discoveries: parseList(sections.get('Discoveries')),
    patterns: parseList(sections.get('Patterns')),
    blockers: parseList(sections.get('Blockers')),
    openQuestions: parseList(sections.get('Open Questions')),
    nextSteps: parseList(sections.get('Next Steps')),
    tasks: parseList(sections.get('Tasks')),
    files: parseList(sections.get('Files')),
    confidence: parseConfidence(body),
  }
}

function extractSummaryTitle(body: string): string | null {
  const match = body.match(/^#\s+Session Summary:\s*(.+)$/m)
  if (!match || !match[1]) {
    return null
  }
  return normalizeWhitespace(match[1])
}

function parseSections(body: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string | null = null
  for (const line of body.split('\n')) {
    const match = line.match(/^##\s+(.+)/)
    if (match) {
      current = match[1].trim()
      if (!sections.has(current)) {
        sections.set(current, [])
      }
      continue
    }
    if (!current) {
      continue
    }
    sections.get(current)?.push(line)
  }
  return sections
}

function parseFocus(lines?: string[]): string {
  if (!lines) {
    return ''
  }
  for (const line of lines) {
    const normalized = normalizeWhitespace(line.replace(/^-+\s*/, ''))
    if (!normalized) {
      continue
    }
    if (normalized.toLowerCase() === 'none') {
      return ''
    }
    return normalized
  }
  return ''
}

function resolveFocus(
  focus: string,
  title: string | null,
  sessionId: string,
): string {
  if (focus) {
    return focus
  }
  if (title) {
    return title
  }
  return `Recall import ${sessionId}`
}

function parseList(lines?: string[]): string[] {
  if (!lines) {
    return []
  }
  const items: string[] = []
  for (const line of lines) {
    const normalized = normalizeWhitespace(line.replace(/^-+\s*/, ''))
    if (!normalized) {
      continue
    }
    if (normalized.toLowerCase() === 'none') {
      continue
    }
    items.push(normalized)
  }
  return items
}

function parseConfidence(body: string): 'low' | 'medium' | 'high' | null {
  const match = body.match(/^##\s+Confidence\s*(?:\((.+)\))?$/im)
  const raw = match?.[1]?.trim().toLowerCase() ?? null
  if (!raw) {
    return null
  }
  if (raw === 'low') {
    return 'low'
  }
  if (raw === 'med' || raw === 'medium') {
    return 'medium'
  }
  if (raw === 'high') {
    return 'high'
  }
  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return 'high'
    if (numeric >= 0.5) return 'medium'
    return 'low'
  }
  return null
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  return Number.isNaN(Date.parse(value)) ? null : value
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
