import type {
  OpencodeDiffEntry,
  OpencodeDiffReport,
  OpencodeDiffProjectScope,
  OpencodeDiffStatus,
  OpencodeSourceIndex,
  OpencodeSourceIndexEntry,
  OpencodeSummaryEntry,
  OpencodeSummaryIndex,
} from './opencode-diff-types'
import { getSummaryRecencyMs } from './opencode-summary-index'

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

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
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
