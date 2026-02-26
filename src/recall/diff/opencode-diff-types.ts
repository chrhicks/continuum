import type {
  OpencodeProjectIndexRecord,
  OpencodeSourceIndex,
  OpencodeSourceIndexEntry,
} from '../index/opencode-source-index'

export type {
  OpencodeProjectIndexRecord,
  OpencodeSourceIndex,
  OpencodeSourceIndexEntry,
}

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
