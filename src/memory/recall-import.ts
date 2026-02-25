import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { consolidateNow } from './consolidate'
import { initMemory } from './init'
import { memoryPath } from './paths'
import { parseFrontmatter, serializeFrontmatter } from '../utils/frontmatter'
import {
  resolveOpencodeDbPath,
  resolveOpencodeOutputDir,
} from '../recall/opencode/paths'

export type RecallImportOptions = {
  summaryDir?: string
  outDir?: string
  dbPath?: string
  projectId?: string
  sessionId?: string
  dryRun?: boolean
}

export type RecallImportSkipped = {
  summaryPath: string
  reason: string
  sessionId?: string
}

export type RecallImportResult = {
  summaryDir: string
  memoryDir: string
  dryRun: boolean
  totalSummaries: number
  imported: number
  skippedExisting: number
  skippedInvalid: number
  skippedFiltered: number
  importedSessions: string[]
  skipped: RecallImportSkipped[]
}

type RecallSummary = {
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
  tasks: string[]
  files: string[]
}

const DEFAULT_SUMMARY_DIR = join('.continuum', 'recall', 'opencode')
const TEMP_IMPORT_DIR = join('.tmp', 'recall-import')
const SUMMARY_PREFIX = 'OPENCODE-SUMMARY-'

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

export async function importOpencodeRecall(
  options: RecallImportOptions = {},
): Promise<RecallImportResult> {
  const summaryDir = resolveOpencodeOutputDir(
    process.cwd(),
    options.summaryDir ?? options.outDir ?? null,
  )
  if (!existsSync(summaryDir)) {
    throw new Error(`Recall summary directory not found: ${summaryDir}`)
  }
  if (options.dbPath) {
    const dbPath = resolveOpencodeDbPath(options.dbPath)
    if (!existsSync(dbPath)) {
      throw new Error(
        `OpenCode sqlite database not found: ${dbPath}. OpenCode 1.2.0+ is required.`,
      )
    }
  }

  initMemory()
  ensureTempDir()

  const summaryFiles = listSummaryFiles(summaryDir)
  const memoryDir = resolve(memoryPath('.'))
  const existingSessions = loadImportedSessions(memoryDir)
  const projectFilter = options.projectId?.trim() || null
  const sessionFilter = options.sessionId?.trim() || null
  const importedSessions: string[] = []
  const skipped: RecallImportSkipped[] = []
  let imported = 0
  let skippedExisting = 0
  let skippedInvalid = 0
  let skippedFiltered = 0
  const dryRun = options.dryRun ?? false

  for (const summaryPath of summaryFiles) {
    const content = readFileSync(summaryPath, 'utf-8')
    const parsed = parseOpencodeSummary(content)
    if (!parsed) {
      skippedInvalid += 1
      skipped.push({ summaryPath, reason: 'Missing or invalid summary format' })
      continue
    }
    if (sessionFilter && parsed.sessionId !== sessionFilter) {
      skippedFiltered += 1
      skipped.push({
        summaryPath,
        sessionId: parsed.sessionId,
        reason: `Filtered by session id (${sessionFilter})`,
      })
      continue
    }
    if (projectFilter && parsed.projectId !== projectFilter) {
      skippedFiltered += 1
      skipped.push({
        summaryPath,
        sessionId: parsed.sessionId,
        reason: `Filtered by project id (${projectFilter})`,
      })
      continue
    }
    if (existingSessions.has(parsed.sessionId)) {
      skippedExisting += 1
      skipped.push({
        summaryPath,
        sessionId: parsed.sessionId,
        reason: 'Session already imported',
      })
      continue
    }

    const nowContent = buildNowContent(parsed)
    const tempPath = buildTempPath(parsed.sessionId)
    writeFileSync(tempPath, nowContent, 'utf-8')

    try {
      await consolidateNow({
        nowPath: tempPath,
        dryRun,
        skipNowCleanup: true,
      })
    } finally {
      cleanupTempPath(tempPath)
    }

    if (!dryRun) {
      existingSessions.add(parsed.sessionId)
      importedSessions.push(parsed.sessionId)
      imported += 1
    }
  }

  return {
    summaryDir,
    memoryDir,
    dryRun,
    totalSummaries: summaryFiles.length,
    imported,
    skippedExisting,
    skippedInvalid,
    skippedFiltered,
    importedSessions,
    skipped,
  }
}

function listSummaryFiles(summaryDir: string): string[] {
  return readdirSync(summaryDir)
    .filter(
      (fileName) =>
        fileName.startsWith(SUMMARY_PREFIX) && fileName.endsWith('.md'),
    )
    .sort()
    .map((fileName) => join(summaryDir, fileName))
}

function loadImportedSessions(memoryDir: string): Set<string> {
  const sessions = new Set<string>()
  if (!existsSync(memoryDir)) {
    return sessions
  }
  for (const fileName of readdirSync(memoryDir)) {
    if (!/^MEMORY-.*\.md$/.test(fileName)) {
      continue
    }
    const filePath = join(memoryDir, fileName)
    const content = readFileSync(filePath, 'utf-8')
    const { frontmatter } = parseFrontmatter(content)
    const sourceSessions = Array.isArray(frontmatter.source_sessions)
      ? frontmatter.source_sessions.map(String)
      : []
    for (const sessionId of sourceSessions) {
      if (sessionId) {
        sessions.add(sessionId)
      }
    }
  }
  return sessions
}

function parseOpencodeSummary(content: string): RecallSummary | null {
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
    tasks: parseList(sections.get('Tasks')),
    files: parseList(sections.get('Files')),
  }
}

function buildNowContent(summary: RecallSummary): string {
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function ensureTempDir(): void {
  mkdirSync(TEMP_IMPORT_DIR, { recursive: true })
}

function buildTempPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]+/g, '-')
  return join(TEMP_IMPORT_DIR, `recall-${safe}.md`)
}

function cleanupTempPath(filePath: string): void {
  const backupPath = `${filePath}.bak`
  if (existsSync(filePath)) {
    rmSync(filePath)
  }
  if (existsSync(backupPath)) {
    rmSync(backupPath)
  }
}
