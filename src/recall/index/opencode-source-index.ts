import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { resolveOpencodeDbPath } from '../opencode/paths'
import { resolveRecallPath } from '../resolve-path'
import type {
  OpencodeMessageStatsRow,
  OpencodePartStatsRow,
  OpencodeProjectIndexRecord,
  OpencodeSessionRow,
  OpencodeSessionStats,
  OpencodeSourceIndex,
  OpencodeSourceIndexEntry,
  OpencodeSourceIndexOptions,
} from './opencode-source-index.types'

export type {
  OpencodeMessageStatsRow,
  OpencodePartStatsRow,
  OpencodeProjectIndexRecord,
  OpencodeSessionRow,
  OpencodeSessionStats,
  OpencodeSourceIndex,
  OpencodeSourceIndexEntry,
  OpencodeSourceIndexOptions,
} from './opencode-source-index.types'
const SOURCE_INDEX_VERSION = 2
const DEFAULT_SOURCE_INDEX_FILE = join(
  'recall',
  'opencode',
  'source-index.json',
)

function toIso(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value).toISOString()
}
function indexBySessionId<T extends { session_id: string }>(
  rows: T[],
): Record<string, T> {
  return Object.fromEntries(rows.map((row) => [row.session_id, row]))
}
function buildSessionStats(
  messageStats: OpencodeMessageStatsRow | null,
  partStats: OpencodePartStatsRow | null,
): OpencodeSessionStats {
  return {
    message_count: messageStats?.message_count ?? 0,
    part_count: partStats?.part_count ?? 0,
    message_latest_ms: messageStats?.message_latest_ms ?? null,
    part_latest_ms: partStats?.part_latest_ms ?? null,
  }
}

export function resolveRecallDataRoot(value?: string | null): string {
  if (value) return resolveRecallPath(value)
  const dataHome = process.env.XDG_DATA_HOME
  return join(dataHome ?? join(homedir(), '.local', 'share'), 'continuum')
}

export function resolveOpencodeSourceIndexFile(
  dataRoot: string,
  value?: string | null,
): string {
  if (value) return resolveRecallPath(value)
  return join(dataRoot, DEFAULT_SOURCE_INDEX_FILE)
}

export function buildOpencodeSessionFingerprint(
  fields: Array<string | number | null>,
): string {
  const payload = fields.map((value) => String(value ?? '')).join('|')
  return createHash('sha256').update(payload).digest('hex')
}

export function buildOpencodeSessionIndexEntry(
  session: OpencodeSessionRow,
  project: OpencodeProjectIndexRecord | null,
  stats: OpencodeSessionStats,
  dbPath: string,
): OpencodeSourceIndexEntry {
  const createdAt = toIso(session.time_created)
  const updatedAt = toIso(session.time_updated)
  const fingerprint = buildOpencodeSessionFingerprint([
    session.id,
    session.project_id,
    session.slug,
    session.title,
    session.directory,
    session.version,
    session.summary_additions,
    session.summary_deletions,
    session.summary_files,
    session.time_created,
    session.time_updated,
    stats.message_count,
    stats.part_count,
    stats.message_latest_ms,
    stats.part_latest_ms,
  ])

  return {
    key: `${session.project_id}:${session.id}`,
    session_id: session.id,
    project_id: session.project_id,
    title: session.title ?? null,
    slug: session.slug ?? null,
    directory: session.directory ?? project?.worktree ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    message_count: stats.message_count,
    part_count: stats.part_count,
    message_latest_mtime_ms: stats.message_latest_ms,
    part_latest_mtime_ms: stats.part_latest_ms,
    session_file: `${dbPath}#session:${session.id}`,
    message_dir: null,
    session_mtime_ms: session.time_updated ?? null,
    fingerprint,
  }
}

function buildSessionFilter(
  projectFilter: string | null,
  sessionFilter: string | null,
): { whereClause: string; params: string[] } {
  const conditions: string[] = []
  const params: string[] = []
  if (projectFilter) {
    conditions.push('project_id = ?')
    params.push(projectFilter)
  }
  if (sessionFilter) {
    conditions.push('id = ?')
    params.push(sessionFilter)
  }
  return {
    whereClause:
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

function queryProjects(
  sqlite: Database,
): Record<string, OpencodeProjectIndexRecord> {
  const projectRows = sqlite
    .query('SELECT id, worktree FROM project')
    .all() as OpencodeProjectIndexRecord[]
  return Object.fromEntries(
    projectRows.map((row) => [
      row.id,
      { id: row.id, worktree: row.worktree ?? null },
    ]),
  ) as Record<string, OpencodeProjectIndexRecord>
}

function querySessions(
  sqlite: Database,
  projectFilter: string | null,
  sessionFilter: string | null,
): OpencodeSessionRow[] {
  const { whereClause, params } = buildSessionFilter(
    projectFilter,
    sessionFilter,
  )
  return sqlite
    .query(
      `SELECT id, project_id, slug, title, directory, version,
      summary_additions, summary_deletions, summary_files,
      time_created, time_updated
      FROM session
      ${whereClause}`,
    )
    .all(...params) as OpencodeSessionRow[]
}

function querySessionStats(sqlite: Database): {
  messageStatsBySession: Record<string, OpencodeMessageStatsRow>
  partStatsBySession: Record<string, OpencodePartStatsRow>
} {
  const messageStatsRows = sqlite
    .query(
      'SELECT session_id, COUNT(*) as message_count, MAX(time_updated) as message_latest_ms FROM message GROUP BY session_id',
    )
    .all() as OpencodeMessageStatsRow[]
  const partStatsRows = sqlite
    .query(
      'SELECT session_id, COUNT(*) as part_count, MAX(time_updated) as part_latest_ms FROM part GROUP BY session_id',
    )
    .all() as OpencodePartStatsRow[]
  return {
    messageStatsBySession: indexBySessionId(messageStatsRows),
    partStatsBySession: indexBySessionId(partStatsRows),
  }
}

export function buildOpencodeSourceIndex(
  options: OpencodeSourceIndexOptions = {},
): OpencodeSourceIndex {
  const dbPath = resolveOpencodeDbPath(options.dbPath)
  if (!existsSync(dbPath)) {
    throw new Error(
      `OpenCode sqlite database not found: ${dbPath}. OpenCode 1.2.0+ is required.`,
    )
  }
  const dataRoot = resolveRecallDataRoot(options.dataRoot)
  const indexFile = resolveOpencodeSourceIndexFile(dataRoot, options.indexFile)
  const projectFilter = options.projectId ?? null
  const sessionFilter = options.sessionId ?? null

  const sqlite = new Database(dbPath)
  try {
    const projects = queryProjects(sqlite)
    const sessions = querySessions(sqlite, projectFilter, sessionFilter)
    const { messageStatsBySession, partStatsBySession } =
      querySessionStats(sqlite)

    const entries = sessions.map((session) =>
      buildOpencodeSessionIndexEntry(
        session,
        projects[session.project_id] ?? null,
        buildSessionStats(
          messageStatsBySession[session.id] ?? null,
          partStatsBySession[session.id] ?? null,
        ),
        dbPath,
      ),
    )

    entries.sort((left, right) => {
      const leftTime = left.created_at ?? ''
      const rightTime = right.created_at ?? ''
      if (leftTime !== rightTime) return rightTime.localeCompare(leftTime)
      return left.key.localeCompare(right.key)
    })

    const sessionsIndex = Object.fromEntries(
      entries.map((entry) => [entry.key, entry]),
    )

    return {
      version: SOURCE_INDEX_VERSION,
      generated_at: new Date().toISOString(),
      storage_root: dirname(dbPath),
      db_path: dbPath,
      data_root: dataRoot,
      index_file: indexFile,
      filters: {
        project_id: projectFilter,
        session_id: sessionFilter,
      },
      projects,
      sessions: sessionsIndex,
      stats: {
        project_count: Object.keys(projects).length,
        session_count: entries.length,
      },
    }
  } finally {
    sqlite.close()
  }
}
