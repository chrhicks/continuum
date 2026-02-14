import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

type ProjectRow = {
  id: string
  worktree: string
}

type SessionRow = {
  id: string
  project_id: string
  slug: string
  title: string
  directory: string
  version: string
  summary_additions: number | null
  summary_deletions: number | null
  summary_files: number | null
  time_created: number
  time_updated: number
}

type MessageStatsRow = {
  session_id: string
  message_count: number
  message_latest_ms: number | null
}

type PartStatsRow = {
  session_id: string
  part_count: number
  part_latest_ms: number | null
}

type SessionIndexEntry = {
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
  db_path: string
  data_root: string
  index_file: string
  filters: {
    project_id: string | null
    session_id: string | null
  }
  projects: Record<string, { id: string; worktree: string | null }>
  sessions: Record<string, SessionIndexEntry>
  stats: {
    project_count: number
    session_count: number
  }
}

type SessionStats = {
  message_count: number
  part_count: number
  message_latest_ms: number | null
  part_latest_ms: number | null
}

const args = process.argv.slice(2)
const getFlag = (name: string) => args.includes(name)
const getArgValue = (name: string) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.split('=').slice(1).join('=')
  const index = args.findIndex((arg) => arg === name)
  if (index !== -1 && args[index + 1]) return args[index + 1]
  return null
}

const toIso = (value?: number | null): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value).toISOString()
}

const resolvePath = (value: string | null): string | null => {
  if (!value) return null
  return isAbsolute(value) ? value : resolve(process.cwd(), value)
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

const resolveDbPath = (value: string | null): string => {
  if (value) return resolvePath(value) as string
  const dataHome = process.env.XDG_DATA_HOME
  return join(
    dataHome ?? join(homedir(), '.local', 'share'),
    'opencode',
    'opencode.db',
  )
}

const hashFields = (fields: Array<string | number | null>): string => {
  const payload = fields.map((value) => String(value ?? '')).join('|')
  return createHash('sha256').update(payload).digest('hex')
}

const indexBySessionId = <T extends { session_id: string }>(rows: T[]) => {
  return rows.reduce<Record<string, T>>(
    (acc, row) => ({
      ...acc,
      [row.session_id]: row,
    }),
    {},
  )
}

const buildSessionStats = (
  messageStats: MessageStatsRow | null,
  partStats: PartStatsRow | null,
): SessionStats => {
  return {
    message_count: messageStats?.message_count ?? 0,
    part_count: partStats?.part_count ?? 0,
    message_latest_ms: messageStats?.message_latest_ms ?? null,
    part_latest_ms: partStats?.part_latest_ms ?? null,
  }
}

const buildSessionEntry = (
  session: SessionRow,
  project: { id: string; worktree: string | null } | null,
  stats: SessionStats,
  dbPath: string,
): SessionIndexEntry => {
  const createdAt = toIso(session.time_created)
  const updatedAt = toIso(session.time_updated)
  const fingerprint = hashFields([
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

const run = () => {
  if (getFlag('--help')) {
    console.log('opencode-recall-index-prototype')
    console.log('')
    console.log(
      'Usage: bun run scripts/opencode-recall-index-prototype.ts [options]',
    )
    console.log('')
    console.log('Options:')
    console.log(
      '  --db <path>         OpenCode sqlite database (default: ~/.local/share/opencode/opencode.db)',
    )
    console.log(
      '  --data-root <path>  Continuum data root (default: $XDG_DATA_HOME/continuum)',
    )
    console.log(
      '  --index <path>      Output index file (default: <data-root>/recall/opencode/source-index.json)',
    )
    console.log('  --project <id>      Limit to a single project id')
    console.log('  --session <id>      Limit to a single session id')
    console.log('  --verbose           Print progress details')
    return
  }

  const dbPath = resolveDbPath(getArgValue('--db'))
  const dataRoot = resolveDataRoot(getArgValue('--data-root'))
  const indexFile = resolveIndexFile(getArgValue('--index'), dataRoot)
  const indexDir = resolve(dirname(indexFile))
  const projectFilter = getArgValue('--project')
  const sessionFilter = getArgValue('--session')
  const verbose = getFlag('--verbose')

  if (!existsSync(dbPath)) {
    throw new Error(
      `OpenCode sqlite database not found: ${dbPath}. OpenCode 1.2.0+ is required.`,
    )
  }

  const db = new Database(dbPath)

  const projectRows = db
    .query('SELECT id, worktree FROM project')
    .all() as ProjectRow[]
  const projects = projectRows.reduce<
    Record<string, { id: string; worktree: string | null }>
  >(
    (acc, row) => ({
      ...acc,
      [row.id]: { id: row.id, worktree: row.worktree ?? null },
    }),
    {},
  )

  const sessionConditions: string[] = []
  const sessionParams: string[] = []
  if (projectFilter) {
    sessionConditions.push('project_id = ?')
    sessionParams.push(projectFilter)
  }
  if (sessionFilter) {
    sessionConditions.push('id = ?')
    sessionParams.push(sessionFilter)
  }
  const sessionWhere =
    sessionConditions.length > 0
      ? `WHERE ${sessionConditions.join(' AND ')}`
      : ''

  const sessions = db
    .query(
      `SELECT id, project_id, slug, title, directory, version,
        summary_additions, summary_deletions, summary_files,
        time_created, time_updated
      FROM session
      ${sessionWhere}`,
    )
    .all(sessionParams) as SessionRow[]

  const messageStatsRows = db
    .query(
      'SELECT session_id, COUNT(*) as message_count, MAX(time_updated) as message_latest_ms FROM message GROUP BY session_id',
    )
    .all() as MessageStatsRow[]
  const partStatsRows = db
    .query(
      'SELECT session_id, COUNT(*) as part_count, MAX(time_updated) as part_latest_ms FROM part GROUP BY session_id',
    )
    .all() as PartStatsRow[]

  const messageStatsBySession = indexBySessionId(messageStatsRows)
  const partStatsBySession = indexBySessionId(partStatsRows)

  const entries = sessions.map((session) => {
    const stats = buildSessionStats(
      messageStatsBySession[session.id] ?? null,
      partStatsBySession[session.id] ?? null,
    )
    const entry = buildSessionEntry(
      session,
      projects[session.project_id] ?? null,
      stats,
      dbPath,
    )
    if (verbose) {
      console.log(`Indexed ${entry.key} (${entry.message_count} messages)`)
    }
    return entry
  })

  entries.sort((a, b) => {
    const left = a.created_at ?? ''
    const right = b.created_at ?? ''
    if (left !== right) return right.localeCompare(left)
    return a.key.localeCompare(b.key)
  })

  const sessionsIndex = Object.fromEntries(
    entries.map((entry) => [entry.key, entry]),
  )

  const index: SourceIndex = {
    version: 2,
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

  db.close()

  mkdirSync(indexDir, { recursive: true })
  writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`, 'utf-8')

  console.log(`Source index written: ${indexFile}`)
  console.log(
    `Sessions indexed: ${index.stats.session_count} (projects: ${index.stats.project_count})`,
  )
}

run()
