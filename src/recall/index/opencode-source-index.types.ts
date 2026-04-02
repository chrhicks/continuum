export type OpencodeSourceIndexOptions = {
  dbPath?: string | null
  dataRoot?: string | null
  indexFile?: string | null
  projectId?: string | null
  sessionId?: string | null
}

export type OpencodeProjectIndexRecord = {
  id: string
  worktree: string | null
}

export type OpencodeSessionRow = {
  id: string
  project_id: string
  slug: string | null
  title: string | null
  directory: string | null
  version: string | null
  summary_additions: number | null
  summary_deletions: number | null
  summary_files: number | null
  time_created: number
  time_updated: number
}

export type OpencodeMessageStatsRow = {
  session_id: string
  message_count: number
  message_latest_ms: number | null
}

export type OpencodePartStatsRow = {
  session_id: string
  part_count: number
  part_latest_ms: number | null
}

export type OpencodeSessionStats = {
  message_count: number
  part_count: number
  message_latest_ms: number | null
  part_latest_ms: number | null
}

export type OpencodeSourceIndexEntry = {
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

export type OpencodeSourceIndex = {
  version: number
  generated_at: string
  storage_root: string
  db_path: string
  data_root: string
  index_file: string
  filters: {
    project_id: string | null
    session_id: string | null
  }
  projects: Record<string, OpencodeProjectIndexRecord>
  sessions: Record<string, OpencodeSourceIndexEntry>
  stats: {
    project_count: number
    session_count: number
  }
}
