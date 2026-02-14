import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseFrontmatter } from '../src/utils/frontmatter.ts'

type SourceIndexSession = {
  key: string
  session_id: string
  project_id: string
  title: string | null
  slug: string | null
  directory: string | null
  created_at: string | null
  updated_at: string | null
  message_count: number
  part_count: number
  message_latest_mtime_ms: number | null
  part_latest_mtime_ms: number | null
  session_file: string
  message_dir: string | null
  session_mtime_ms: number | null
  fingerprint: string
}

type SourceIndex = {
  version: number
  generated_at: string
  storage_root: string
  db_path?: string
  data_root: string
  index_file: string
  filters: {
    project_id: string | null
    session_id: string | null
  }
  projects?: Record<string, { id: string; worktree: string | null }>
  sessions: Record<string, SourceIndexSession>
}

type LocalSummaryEntry = {
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

type LocalSummaryIndex = {
  summaries: Record<string, LocalSummaryEntry>
  duplicates: Array<{
    key: string
    kept: string
    dropped: string
  }>
}

type DiffStatus = 'new' | 'stale' | 'unchanged' | 'orphan' | 'unknown'

type DiffEntry = {
  key: string
  session_id: string | null
  project_id: string | null
  title: string | null
  status: DiffStatus
  reason: string | null
  source_fingerprint: string | null
  source_updated_at: string | null
  source_latest_ms: number | null
  summary_fingerprint: string | null
  summary_generated_at: string | null
  summary_mtime_ms: number | null
  summary_path: string | null
}

type DiffReport = {
  generated_at: string
  index_file: string
  summary_dir: string
  project_scope: {
    project_ids: string[]
    include_global: boolean
    repo_path: string
  }
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
  new: DiffEntry[]
  stale: DiffEntry[]
  unchanged: DiffEntry[]
  orphan: DiffEntry[]
  unknown: DiffEntry[]
  duplicates: LocalSummaryIndex['duplicates']
}

type SyncPlanItem = {
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

type SyncPlan = {
  version: number
  generated_at: string
  index_file: string
  summary_dir: string
  report_file: string | null
  project_scope: DiffReport['project_scope']
  stats: {
    total: number
    new: number
    stale: number
  }
  items: SyncPlanItem[]
}

type LedgerEntryStatus = 'processed' | 'pending' | 'orphan' | 'unknown'

type LedgerEntry = {
  key: string
  session_id: string | null
  project_id: string | null
  status: LedgerEntryStatus
  reason: string | null
  source_fingerprint: string | null
  source_updated_at: string | null
  summary_fingerprint: string | null
  summary_path: string | null
  summary_generated_at: string | null
  processed_at: string | null
  verified_at: string
}

type Ledger = {
  version: number
  processed_version: number
  generated_at: string
  index_file: string
  summary_dir: string
  entries: Record<string, LedgerEntry>
  stats: {
    processed: number
    pending: number
    orphan: number
    unknown: number
  }
}

const LEDGER_PROCESSED_VERSION_DEFAULT = 1

const args = process.argv.slice(2)
const getFlag = (name: string) => args.includes(name)
const getArgValue = (name: string) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.split('=').slice(1).join('=')
  const index = args.findIndex((arg) => arg === name)
  if (index !== -1 && args[index + 1]) return args[index + 1]
  return null
}

const resolvePath = (value: string | null, base?: string): string | null => {
  if (!value) return null
  if (isAbsolute(value)) return value
  return resolve(base ?? process.cwd(), value)
}

const resolveDataRoot = (value: string | null): string => {
  if (value) return resolvePath(value) as string
  const dataHome = process.env.XDG_DATA_HOME
  return join(dataHome ?? join(homedir(), '.local', 'share'), 'continuum')
}

const resolveIndexFile = (value: string | null, dataRoot: string): string => {
  if (value) return resolvePath(value) as string
  return join(dataRoot, 'recall', 'opencode', 'source-index.json')
}

const resolvePlanFile = (value: string | null, dataRoot: string): string => {
  if (value) return resolvePath(value) as string
  return join(dataRoot, 'recall', 'opencode', 'sync-plan.json')
}

const resolveReportFile = (value: string | null, dataRoot: string): string => {
  if (value) return resolvePath(value) as string
  return join(dataRoot, 'recall', 'opencode', 'diff-report.json')
}

const resolveProjectIdForRepo = (
  projects: Record<string, { id: string; worktree: string | null }>,
  repoPath: string,
): string | null => {
  const normalizedRepo = resolve(repoPath)
  const match = Object.values(projects).find(
    (project) =>
      project.worktree && resolve(project.worktree) === normalizedRepo,
  )
  return match?.id ?? null
}

const buildProjectScope = (
  sourceIndex: SourceIndex,
  repoPath: string,
  explicitProject: string | null,
  includeGlobal: boolean,
): DiffReport['project_scope'] => {
  const resolvedProject =
    explicitProject ??
    resolveProjectIdForRepo(sourceIndex.projects ?? {}, repoPath)
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

const filterSourceSessions = (
  sessions: Record<string, SourceIndexSession>,
  projectIds: string[],
): Record<string, SourceIndexSession> => {
  const allowed = new Set(projectIds)
  return Object.fromEntries(
    Object.entries(sessions).filter(([, entry]) =>
      allowed.has(entry.project_id),
    ),
  )
}

const filterSummaryEntries = (
  entries: LocalSummaryEntry[],
  projectIds: string[],
): LocalSummaryEntry[] => {
  const allowed = new Set(projectIds)
  return entries.filter((entry) => allowed.has(entry.project_id))
}

const resolveLedgerFile = (value: string | null, dataRoot: string): string => {
  if (value) return resolvePath(value) as string
  return join(dataRoot, 'recall', 'opencode', 'state.json')
}

const resolveSummaryDir = (repoPath: string, value: string | null): string => {
  if (value) return resolvePath(value, repoPath) as string
  return join(repoPath, '.continuum', 'recall', 'opencode')
}

const parseDateMs = (value: string | null | undefined): number | null => {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

const normalizeString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

const listSummaryFiles = (summaryDir: string): string[] => {
  if (!existsSync(summaryDir)) return []
  return readdirSync(summaryDir).filter(
    (name) => name.startsWith('OPENCODE-SUMMARY-') && name.endsWith('.md'),
  )
}

const hashContent = (content: string): string => {
  return createHash('sha256').update(content).digest('hex')
}

const writeJsonFile = (filePath: string, payload: unknown) => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

const parseSummaryFile = (filePath: string): LocalSummaryEntry | null => {
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

const getSummaryRecencyMs = (entry: LocalSummaryEntry): number | null => {
  return entry.summary_generated_at_ms ?? entry.summary_mtime_ms ?? null
}

const isNewerSummary = (next: LocalSummaryEntry, prev: LocalSummaryEntry) => {
  const nextMs = getSummaryRecencyMs(next)
  const prevMs = getSummaryRecencyMs(prev)
  if (nextMs === null && prevMs === null) return false
  if (nextMs === null) return false
  if (prevMs === null) return true
  return nextMs > prevMs
}

const indexSummaries = (entries: LocalSummaryEntry[]): LocalSummaryIndex => {
  return entries.reduce<LocalSummaryIndex>(
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

const getSourceLatestMs = (entry: SourceIndexSession): number | null => {
  const candidates = [
    parseDateMs(entry.updated_at ?? null),
    entry.session_mtime_ms,
    entry.message_latest_mtime_ms,
    entry.part_latest_mtime_ms,
  ].filter((value): value is number => typeof value === 'number')
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

const buildDiffEntry = (
  source: SourceIndexSession | null,
  summary: LocalSummaryEntry | null,
  status: DiffStatus,
  reason: string | null,
): DiffEntry => {
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

const classifySourceEntry = (
  source: SourceIndexSession,
  summary: LocalSummaryEntry | null,
): DiffEntry => {
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

const groupByStatus = (entries: DiffEntry[]) => {
  return entries.reduce<Record<DiffStatus, DiffEntry[]>>(
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

const sortByLatest = (entries: DiffEntry[]): DiffEntry[] => {
  return [...entries].sort((a, b) => {
    const left = a.source_latest_ms ?? a.summary_mtime_ms ?? 0
    const right = b.source_latest_ms ?? b.summary_mtime_ms ?? 0
    if (left !== right) return right - left
    return a.key.localeCompare(b.key)
  })
}

const buildReport = (
  sourceIndex: SourceIndex,
  summaryIndex: LocalSummaryIndex,
  summaryDir: string,
  projectScope: DiffReport['project_scope'],
): DiffReport => {
  const sourceEntries = Object.values(sourceIndex.sessions ?? {})
  const summaryEntries = Object.values(summaryIndex.summaries)
  const sourceMap = sourceIndex.sessions ?? {}
  const summaryMap = summaryIndex.summaries
  const sourceKeys = new Set(sourceEntries.map((entry) => entry.key))

  const classified = sourceEntries.map((entry) =>
    classifySourceEntry(entry, summaryMap[entry.key] ?? null),
  )

  const orphans = summaryEntries
    .filter((entry) => !sourceKeys.has(entry.key))
    .map((entry) => buildDiffEntry(null, entry, 'orphan', 'missing-source'))

  const grouped = groupByStatus([...classified, ...orphans])

  const ordered: Record<DiffStatus, DiffEntry[]> = {
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

const buildSyncPlan = (
  report: DiffReport,
  reportFile: string | null,
): SyncPlan => {
  const items = [...report.new, ...report.stale]
    .filter((entry) => entry.session_id && entry.project_id)
    .map<SyncPlanItem>((entry) => ({
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

const toLedgerStatus = (status: DiffStatus): LedgerEntryStatus => {
  if (status === 'unchanged') return 'processed'
  if (status === 'new' || status === 'stale') return 'pending'
  if (status === 'orphan') return 'orphan'
  return 'unknown'
}

const resolveProcessedAt = (
  status: LedgerEntryStatus,
  summary: LocalSummaryEntry | null,
  previous: LedgerEntry | null,
  now: string,
): string | null => {
  if (status !== 'processed') return previous?.processed_at ?? null
  return summary?.summary_generated_at ?? previous?.processed_at ?? now
}

const buildLedgerEntry = (
  entry: DiffEntry,
  source: SourceIndexSession | null,
  summary: LocalSummaryEntry | null,
  previous: LedgerEntry | null,
  now: string,
): LedgerEntry => {
  const status = toLedgerStatus(entry.status)
  return {
    key: entry.key,
    session_id: entry.session_id,
    project_id: entry.project_id,
    status,
    reason: entry.reason,
    source_fingerprint: source?.fingerprint ?? null,
    source_updated_at: source?.updated_at ?? null,
    summary_fingerprint: summary?.summary_fingerprint ?? null,
    summary_path: summary?.summary_path ?? null,
    summary_generated_at: summary?.summary_generated_at ?? null,
    processed_at: resolveProcessedAt(status, summary, previous, now),
    verified_at: now,
  }
}

const computeLedgerStats = (entries: Record<string, LedgerEntry>) => {
  return Object.values(entries).reduce(
    (acc, entry) => ({
      ...acc,
      [entry.status]: acc[entry.status] + 1,
    }),
    {
      processed: 0,
      pending: 0,
      orphan: 0,
      unknown: 0,
    },
  )
}

const buildLedger = (
  report: DiffReport,
  sourceIndex: SourceIndex,
  summaryIndex: LocalSummaryIndex,
  previous: Ledger | null,
  processedVersion: number,
): Ledger => {
  const now = new Date().toISOString()
  const sourceMap = sourceIndex.sessions ?? {}
  const summaryMap = summaryIndex.summaries
  const diffEntries = [
    ...report.new,
    ...report.stale,
    ...report.unchanged,
    ...report.orphan,
    ...report.unknown,
  ]

  const entries = diffEntries.reduce<Record<string, LedgerEntry>>(
    (acc, entry) => ({
      ...acc,
      [entry.key]: buildLedgerEntry(
        entry,
        sourceMap[entry.key] ?? null,
        summaryMap[entry.key] ?? null,
        previous?.entries[entry.key] ?? null,
        now,
      ),
    }),
    {},
  )

  const carried = Object.entries(previous?.entries ?? {}).filter(
    ([key]) => !(key in entries),
  )
  const mergedEntries = {
    ...Object.fromEntries(carried),
    ...entries,
  }

  return {
    version: 1,
    processed_version: processedVersion,
    generated_at: now,
    index_file: report.index_file,
    summary_dir: report.summary_dir,
    entries: mergedEntries,
    stats: computeLedgerStats(mergedEntries),
  }
}

const renderSection = (
  label: string,
  entries: DiffEntry[],
  limit: number,
): string[] => {
  const showing = entries.slice(0, limit)
  const header = `${label} (${entries.length}${
    limit > 0 && entries.length > limit ? `, showing ${limit}` : ''
  })`
  if (showing.length === 0) {
    return [header, '- none', '']
  }

  const rows = showing.map((entry) => {
    const title = entry.title ?? 'untitled'
    const sourceUpdated = entry.source_updated_at ?? 'n/a'
    const summaryGenerated = entry.summary_generated_at ?? 'n/a'
    return `- ${entry.key} | ${title} | source_updated_at=${sourceUpdated} | summary_generated_at=${summaryGenerated}`
  })

  return [header, ...rows, '']
}

const renderTextReport = (report: DiffReport, limit: number): string => {
  const lines: string[] = []
  lines.push(`Source index: ${report.index_file}`)
  lines.push(`Summary dir: ${report.summary_dir}`)
  lines.push(`Project scope: ${report.project_scope.project_ids.join(', ')}`)
  lines.push(`Source sessions: ${report.stats.source_sessions}`)
  lines.push(
    `Local summaries: ${report.stats.local_summaries} (duplicates: ${report.stats.local_duplicates})`,
  )
  lines.push('Diff:')
  lines.push(`- new: ${report.stats.new}`)
  lines.push(`- stale: ${report.stats.stale}`)
  lines.push(`- unchanged: ${report.stats.unchanged}`)
  lines.push(`- orphan: ${report.stats.orphan}`)
  lines.push(`- unknown: ${report.stats.unknown}`)
  lines.push('')

  lines.push(...renderSection('New', report.new, limit))
  lines.push(...renderSection('Stale', report.stale, limit))
  lines.push(...renderSection('Orphan', report.orphan, limit))
  lines.push(...renderSection('Unknown', report.unknown, limit))

  if (report.stats.local_duplicates > 0) {
    lines.push(
      `Duplicates (${report.stats.local_duplicates}${
        limit > 0 && report.duplicates.length > limit
          ? `, showing ${limit}`
          : ''
      })`,
    )
    const rows = report.duplicates.slice(0, limit).map((entry) => {
      return `- ${entry.key} | kept=${entry.kept} | dropped=${entry.dropped}`
    })
    lines.push(...rows, '')
  }

  return lines.join('\n').trimEnd() + '\n'
}

const run = () => {
  if (getFlag('--help')) {
    console.log('opencode-recall-diff-prototype')
    console.log('')
    console.log(
      'Usage: bun run scripts/opencode-recall-diff-prototype.ts [options]',
    )
    console.log('')
    console.log('Options:')
    console.log(
      '  --index <path>      Source index file (default: $XDG_DATA_HOME/continuum/recall/opencode/source-index.json)',
    )
    console.log(
      '  --data-root <path>  Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    console.log('  --repo <path>       Repo root (default: cwd)')
    console.log(
      '  --summaries <path>  Summary dir (default: <repo>/.continuum/recall/opencode)',
    )
    console.log('  --limit <n>         Limit items per section (default: 10)')
    console.log('  --json              Output JSON report to stdout')
    console.log(
      '  --report <path>     Write JSON report to file (default: <data-root>/recall/opencode/diff-report.json)',
    )
    console.log('  --no-report         Skip writing the report file')
    console.log('  --project <id>      Limit to a single project id')
    console.log('  --include-global    Include global sessions in scope')
    console.log(
      '  --plan <path>       Write sync plan file (default: <data-root>/recall/opencode/sync-plan.json)',
    )
    console.log('  --no-plan           Skip writing the sync plan file')
    console.log(
      '  --ledger <path>     Write ledger file (default: <data-root>/recall/opencode/state.json)',
    )
    console.log('  --no-ledger         Skip writing the ledger file')
    console.log(
      `  --processed-version <n> Ledger processed version (default: ${LEDGER_PROCESSED_VERSION_DEFAULT})`,
    )
    return
  }

  const repoPath = resolve(process.cwd(), getArgValue('--repo') ?? '.')
  const dataRoot = resolveDataRoot(getArgValue('--data-root'))
  const indexFile = resolveIndexFile(getArgValue('--index'), dataRoot)
  const summaryDir = resolveSummaryDir(repoPath, getArgValue('--summaries'))
  const projectFilter = getArgValue('--project')
  const includeGlobal = getFlag('--include-global')
  const limitRaw = getArgValue('--limit')
  const limit = limitRaw ? Number(limitRaw) : 10
  const json = getFlag('--json')
  const reportPath = resolveReportFile(getArgValue('--report'), dataRoot)
  const writeReport = !getFlag('--no-report')
  const planPath = resolvePlanFile(getArgValue('--plan'), dataRoot)
  const writePlan = !getFlag('--no-plan')
  const ledgerPath = resolveLedgerFile(getArgValue('--ledger'), dataRoot)
  const writeLedger = !getFlag('--no-ledger')
  const processedVersionRaw = getArgValue('--processed-version')
  const processedVersionCandidate = processedVersionRaw
    ? Number(processedVersionRaw)
    : Number.NaN
  const processedVersion = Number.isFinite(processedVersionCandidate)
    ? processedVersionCandidate
    : LEDGER_PROCESSED_VERSION_DEFAULT

  if (!existsSync(indexFile)) {
    throw new Error(`Source index not found: ${indexFile}`)
  }

  const sourceIndex = JSON.parse(
    readFileSync(indexFile, 'utf-8'),
  ) as SourceIndex

  const projectScope = buildProjectScope(
    sourceIndex,
    repoPath,
    projectFilter,
    includeGlobal,
  )
  const scopedSourceIndex: SourceIndex = {
    ...sourceIndex,
    sessions: filterSourceSessions(
      sourceIndex.sessions ?? {},
      projectScope.project_ids,
    ),
  }

  const summaryEntries = filterSummaryEntries(
    listSummaryFiles(summaryDir)
      .map((name) => parseSummaryFile(join(summaryDir, name)))
      .filter((entry): entry is LocalSummaryEntry => entry !== null),
    projectScope.project_ids,
  )

  const summaryIndex = indexSummaries(summaryEntries)
  const report = buildReport(
    scopedSourceIndex,
    summaryIndex,
    summaryDir,
    projectScope,
  )

  if (writeReport) {
    writeJsonFile(reportPath, report)
  }

  const plan = writePlan
    ? buildSyncPlan(report, writeReport ? reportPath : null)
    : null
  if (writePlan && plan) {
    writeJsonFile(planPath, plan)
  }

  if (writeLedger) {
    const existingLedger = existsSync(ledgerPath)
      ? (JSON.parse(readFileSync(ledgerPath, 'utf-8')) as Ledger)
      : null
    const ledger = buildLedger(
      report,
      sourceIndex,
      summaryIndex,
      existingLedger,
      processedVersion,
    )
    writeJsonFile(ledgerPath, ledger)
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const pathLines: string[] = []
  if (writeReport) {
    pathLines.push(`Report file: ${reportPath}`)
  }
  if (writePlan) {
    pathLines.push(`Plan file: ${planPath}`)
  }
  if (writeLedger) {
    pathLines.push(`Ledger file: ${ledgerPath}`)
  }
  const prefix = pathLines.length > 0 ? `${pathLines.join('\n')}\n` : ''
  console.log(`${prefix}${renderTextReport(report, limit)}`)
}

run()
