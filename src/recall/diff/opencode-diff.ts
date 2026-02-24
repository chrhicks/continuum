import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseFrontmatter } from '../../utils/frontmatter'
import type {
  OpencodeProjectIndexRecord,
  OpencodeSourceIndex,
  OpencodeSourceIndexEntry,
} from '../index/opencode-source-index'

const SUMMARY_PREFIX = 'OPENCODE-SUMMARY-'

export type OpencodeSummaryEntry = {
  key: string
  session_id: string
  project_id: string
  summary_path: string
  summary_generated_at: string | null
  summary_generated_at_ms: number | null
  summary_model: string | null
  summary_chunks: number | null
  summary_mtime_ms: number | null
  summary_fingerprint: string
}

export type OpencodeSummaryDuplicate = {
  key: string
  kept: string
  dropped: string
}

export type OpencodeSummaryIndex = {
  summaries: Record<string, OpencodeSummaryEntry>
  duplicates: OpencodeSummaryDuplicate[]
}

export type OpencodeDiffStatus =
  | 'new'
  | 'stale'
  | 'unchanged'
  | 'orphan'
  | 'unknown'

export type OpencodeDiffEntry = {
  key: string
  session_id: string | null
  project_id: string | null
  title: string | null
  status: OpencodeDiffStatus
  reason: string | null
  source_fingerprint: string | null
  source_updated_at: string | null
  source_latest_ms: number | null
  summary_fingerprint: string | null
  summary_generated_at: string | null
  summary_mtime_ms: number | null
  summary_path: string | null
}

export type OpencodeDiffProjectScope = {
  project_ids: string[]
  include_global: boolean
  repo_path: string
}

export type OpencodeDiffReport = {
  generated_at: string
  index_file: string
  summary_dir: string
  project_scope: OpencodeDiffProjectScope
  stats: {
    source_sessions: number
    local_summaries: number
    local_duplicates: number
    new: number
    stale: number
    unchanged: number
    orphan: number
    unknown: number
  }
  new: OpencodeDiffEntry[]
  stale: OpencodeDiffEntry[]
  unchanged: OpencodeDiffEntry[]
  orphan: OpencodeDiffEntry[]
  unknown: OpencodeDiffEntry[]
  duplicates: OpencodeSummaryDuplicate[]
}

export type OpencodeSyncPlanItem = {
  key: string
  session_id: string
  project_id: string
  title: string | null
  status: 'new' | 'stale'
  reason: string | null
  source_fingerprint: string | null
  source_updated_at: string | null
  summary_fingerprint: string | null
  summary_generated_at: string | null
  summary_path: string | null
}

export type OpencodeSyncPlan = {
  version: number
  generated_at: string
  index_file: string
  summary_dir: string
  report_file: string | null
  project_scope: OpencodeDiffProjectScope
  stats: {
    total: number
    new: number
    stale: number
  }
  items: OpencodeSyncPlanItem[]
}

export function listOpencodeSummaryFiles(summaryDir: string): string[] {
  if (!existsSync(summaryDir)) return []
  return readdirSync(summaryDir)
    .filter(
      (fileName) =>
        fileName.startsWith(SUMMARY_PREFIX) && fileName.endsWith('.md'),
    )
    .sort()
    .map((fileName) => join(summaryDir, fileName))
}

export function parseOpencodeSummaryFile(
  filePath: string,
): OpencodeSummaryEntry | null {
  const content = readFileSync(filePath, 'utf-8')
  const { frontmatter, hasFrontmatter } = parseFrontmatter(content)
  if (!hasFrontmatter) return null

  const sessionId = normalizeString(frontmatter.session_id)
  const projectId = normalizeString(frontmatter.project_id)
  if (!sessionId || !projectId) return null

  const summaryGeneratedAt = normalizeString(frontmatter.summary_generated_at)
  const summaryGeneratedAtMs = parseDateMs(summaryGeneratedAt)
  const summaryModel = normalizeString(frontmatter.summary_model)
  const summaryChunks = normalizeNumber(frontmatter.summary_chunks)
  const stat = statSync(filePath)

  return {
    key: `${projectId}:${sessionId}`,
    session_id: sessionId,
    project_id: projectId,
    summary_path: filePath,
    summary_generated_at: summaryGeneratedAt,
    summary_generated_at_ms: summaryGeneratedAtMs,
    summary_model: summaryModel,
    summary_chunks: summaryChunks,
    summary_mtime_ms: stat.mtimeMs ?? null,
    summary_fingerprint: hashContent(content),
  }
}

export function loadOpencodeSummaryEntries(
  summaryDir: string,
): OpencodeSummaryEntry[] {
  return listOpencodeSummaryFiles(summaryDir)
    .map((filePath) => parseOpencodeSummaryFile(filePath))
    .filter((entry): entry is OpencodeSummaryEntry => entry !== null)
}

export function indexOpencodeSummaryEntries(
  entries: OpencodeSummaryEntry[],
): OpencodeSummaryIndex {
  return entries.reduce<OpencodeSummaryIndex>(
    (acc, entry) => {
      const existing = acc.summaries[entry.key]
      if (!existing) {
        return {
          summaries: { ...acc.summaries, [entry.key]: entry },
          duplicates: acc.duplicates,
        }
      }
      if (isNewerSummary(entry, existing)) {
        return {
          summaries: { ...acc.summaries, [entry.key]: entry },
          duplicates: [
            ...acc.duplicates,
            {
              key: entry.key,
              kept: entry.summary_path,
              dropped: existing.summary_path,
            },
          ],
        }
      }
      return {
        summaries: acc.summaries,
        duplicates: [
          ...acc.duplicates,
          {
            key: entry.key,
            kept: existing.summary_path,
            dropped: entry.summary_path,
          },
        ],
      }
    },
    { summaries: {}, duplicates: [] },
  )
}

export function resolveOpencodeProjectIdForRepo(
  projects: Record<string, OpencodeProjectIndexRecord>,
  repoPath: string,
): string | null {
  const normalizedRepo = resolve(repoPath)
  const match = Object.values(projects).find(
    (project) =>
      project.worktree && resolve(project.worktree) === normalizedRepo,
  )
  return match?.id ?? null
}

export function buildOpencodeDiffProjectScope(
  sourceIndex: OpencodeSourceIndex,
  repoPath: string,
  explicitProject: string | null,
  includeGlobal: boolean,
): OpencodeDiffProjectScope {
  const resolvedProject =
    explicitProject ??
    resolveOpencodeProjectIdForRepo(sourceIndex.projects ?? {}, repoPath)
  const projectIds = resolvedProject ? [resolvedProject] : []
  const scope = includeGlobal
    ? Array.from(new Set([...projectIds, 'global']))
    : projectIds

  if (scope.length === 0) {
    throw new Error(
      `No OpenCode project found for repo: ${repoPath}. Use --project or --include-global.`,
    )
  }

  return {
    project_ids: scope,
    include_global: includeGlobal,
    repo_path: repoPath,
  }
}

export function filterOpencodeSourceSessions(
  sessions: Record<string, OpencodeSourceIndexEntry>,
  projectIds: string[],
): Record<string, OpencodeSourceIndexEntry> {
  const allowed = new Set(projectIds)
  return Object.fromEntries(
    Object.entries(sessions).filter(([, entry]) =>
      allowed.has(entry.project_id),
    ),
  )
}

export function filterOpencodeSummaryEntries(
  entries: OpencodeSummaryEntry[],
  projectIds: string[],
): OpencodeSummaryEntry[] {
  const allowed = new Set(projectIds)
  return entries.filter((entry) => allowed.has(entry.project_id))
}

export function buildOpencodeDiffReport(
  sourceIndex: OpencodeSourceIndex,
  summaryIndex: OpencodeSummaryIndex,
  summaryDir: string,
  projectScope: OpencodeDiffProjectScope,
): OpencodeDiffReport {
  const sourceEntries = Object.values(sourceIndex.sessions ?? {})
  const summaryEntries = Object.values(summaryIndex.summaries)
  const summaryMap = summaryIndex.summaries
  const sourceKeys = new Set(sourceEntries.map((entry) => entry.key))

  const classified = sourceEntries.map((entry) =>
    classifySourceEntry(entry, summaryMap[entry.key] ?? null),
  )

  const orphans = summaryEntries
    .filter((entry) => !sourceKeys.has(entry.key))
    .map((entry) => buildDiffEntry(null, entry, 'orphan', 'missing-source'))

  const grouped = groupByStatus([...classified, ...orphans])
  const ordered: Record<OpencodeDiffStatus, OpencodeDiffEntry[]> = {
    new: sortByLatest(grouped.new),
    stale: sortByLatest(grouped.stale),
    unchanged: sortByLatest(grouped.unchanged),
    orphan: sortByLatest(grouped.orphan),
    unknown: sortByLatest(grouped.unknown),
  }

  return {
    generated_at: new Date().toISOString(),
    index_file: sourceIndex.index_file,
    summary_dir: summaryDir,
    project_scope: projectScope,
    stats: {
      source_sessions: sourceEntries.length,
      local_summaries: summaryEntries.length,
      local_duplicates: summaryIndex.duplicates.length,
      new: ordered.new.length,
      stale: ordered.stale.length,
      unchanged: ordered.unchanged.length,
      orphan: ordered.orphan.length,
      unknown: ordered.unknown.length,
    },
    new: ordered.new,
    stale: ordered.stale,
    unchanged: ordered.unchanged,
    orphan: ordered.orphan,
    unknown: ordered.unknown,
    duplicates: summaryIndex.duplicates,
  }
}

export function buildOpencodeSyncPlan(
  report: OpencodeDiffReport,
  reportFile: string | null,
): OpencodeSyncPlan {
  const items = [...report.new, ...report.stale]
    .filter((entry) => entry.session_id && entry.project_id)
    .map<OpencodeSyncPlanItem>((entry) => ({
      key: entry.key,
      session_id: entry.session_id as string,
      project_id: entry.project_id as string,
      title: entry.title,
      status: entry.status === 'stale' ? 'stale' : 'new',
      reason: entry.reason,
      source_fingerprint: entry.source_fingerprint,
      source_updated_at: entry.source_updated_at,
      summary_fingerprint: entry.summary_fingerprint,
      summary_generated_at: entry.summary_generated_at,
      summary_path: entry.summary_path,
    }))

  const newCount = items.filter((item) => item.status === 'new').length
  const staleCount = items.filter((item) => item.status === 'stale').length

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    index_file: report.index_file,
    summary_dir: report.summary_dir,
    report_file: reportFile,
    project_scope: report.project_scope,
    stats: {
      total: items.length,
      new: newCount,
      stale: staleCount,
    },
    items,
  }
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function getSummaryRecencyMs(entry: OpencodeSummaryEntry): number | null {
  return entry.summary_generated_at_ms ?? entry.summary_mtime_ms ?? null
}

function isNewerSummary(
  next: OpencodeSummaryEntry,
  prev: OpencodeSummaryEntry,
): boolean {
  const nextMs = getSummaryRecencyMs(next)
  const prevMs = getSummaryRecencyMs(prev)
  if (nextMs === null && prevMs === null) return false
  if (nextMs === null) return false
  if (prevMs === null) return true
  return nextMs > prevMs
}

function getSourceLatestMs(entry: OpencodeSourceIndexEntry): number | null {
  const candidates = [
    parseDateMs(entry.updated_at ?? null),
    entry.session_mtime_ms,
    entry.message_latest_mtime_ms,
    entry.part_latest_mtime_ms,
  ].filter((value): value is number => typeof value === 'number')
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

function buildDiffEntry(
  source: OpencodeSourceIndexEntry | null,
  summary: OpencodeSummaryEntry | null,
  status: OpencodeDiffStatus,
  reason: string | null,
): OpencodeDiffEntry {
  return {
    key: source?.key ?? summary?.key ?? 'unknown',
    session_id: source?.session_id ?? summary?.session_id ?? null,
    project_id: source?.project_id ?? summary?.project_id ?? null,
    title: source?.title ?? null,
    status,
    reason,
    source_fingerprint: source?.fingerprint ?? null,
    source_updated_at: source?.updated_at ?? null,
    source_latest_ms: source ? getSourceLatestMs(source) : null,
    summary_fingerprint: summary?.summary_fingerprint ?? null,
    summary_generated_at: summary?.summary_generated_at ?? null,
    summary_mtime_ms: summary?.summary_mtime_ms ?? null,
    summary_path: summary?.summary_path ?? null,
  }
}

function classifySourceEntry(
  source: OpencodeSourceIndexEntry,
  summary: OpencodeSummaryEntry | null,
): OpencodeDiffEntry {
  if (!summary) {
    return buildDiffEntry(source, null, 'new', 'missing-summary')
  }

  const sourceLatest = getSourceLatestMs(source)
  const summaryLatest = getSummaryRecencyMs(summary)

  if (sourceLatest === null || summaryLatest === null) {
    return buildDiffEntry(source, summary, 'unknown', 'missing-timestamp')
  }

  if (sourceLatest > summaryLatest) {
    return buildDiffEntry(source, summary, 'stale', 'source-newer')
  }

  return buildDiffEntry(source, summary, 'unchanged', 'summary-current')
}

function groupByStatus(entries: OpencodeDiffEntry[]) {
  return entries.reduce<Record<OpencodeDiffStatus, OpencodeDiffEntry[]>>(
    (acc, entry) => ({
      ...acc,
      [entry.status]: [...acc[entry.status], entry],
    }),
    {
      new: [],
      stale: [],
      unchanged: [],
      orphan: [],
      unknown: [],
    },
  )
}

function sortByLatest(entries: OpencodeDiffEntry[]): OpencodeDiffEntry[] {
  return [...entries].sort((a, b) => {
    const left = a.source_latest_ms ?? a.summary_mtime_ms ?? 0
    const right = b.source_latest_ms ?? b.summary_mtime_ms ?? 0
    if (left !== right) return right - left
    return a.key.localeCompare(b.key)
  })
}
