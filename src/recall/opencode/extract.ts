import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'

import { resolveOpencodeDbPath, resolveOpencodeOutputDir } from './paths'

export type OpencodeExtractionOptions = {
  dbPath?: string | null
  repoPath?: string | null
  outDir?: string | null
  projectId?: string | null
  sessionId?: string | null
  limit?: number | null
}

export type OpencodeProjectRecord = {
  id: string
  worktree?: string
}

export type OpencodeSessionRecord = {
  id: string
  slug?: string
  version?: string
  projectId?: string
  directory?: string
  title?: string
  parentId?: string
  time?: { created?: number; updated?: number }
}

export type OpencodeMessageSummary = {
  title?: string
}

export type OpencodeMessageRecord = {
  id: string
  sessionId: string
  role: string
  parentId?: string
  time?: { created?: number; completed?: number }
  summary?: OpencodeMessageSummary
}

export type OpencodePartState = {
  status?: string
  time?: { start?: number; end?: number }
}

export type OpencodePartRecord = {
  id: string
  sessionId?: string
  messageId: string
  type: string
  text?: string
  tool?: string
  time?: { start?: number; end?: number }
  state?: OpencodePartState
}

export type OpencodeMessageBlock = {
  message: OpencodeMessageRecord
  parts: OpencodePartRecord[]
}

export type OpencodeSessionBundle = {
  session: OpencodeSessionRecord
  messages: OpencodeMessageRecord[]
  parts: OpencodePartRecord[]
  messageBlocks: OpencodeMessageBlock[]
}

export type OpencodeExtractionResult = {
  dbPath: string
  repoPath: string
  outDir: string
  project: OpencodeProjectRecord
  sessions: OpencodeSessionBundle[]
}

type ProjectRow = {
  id: string
  worktree: string | null
}

type SessionRow = {
  id: string
  project_id: string
  slug: string | null
  title: string | null
  directory: string | null
  version: string | null
  parent_id: string | null
  summary_additions: number | null
  summary_deletions: number | null
  summary_files: number | null
  time_created: number
  time_updated: number
}

type MessageRow = {
  id: string
  session_id: string
  time_created: number
  time_updated: number
  data: string
}

type PartRow = {
  id: string
  message_id: string
  session_id: string
  time_created: number
  time_updated: number
  data: string
}

export function extractOpencodeSessions(
  options: OpencodeExtractionOptions = {},
): OpencodeExtractionResult {
  const repoPath = resolve(options.repoPath ?? process.cwd())
  const dbPath = resolveOpencodeDbPath(options.dbPath)
  const outDir = resolveOpencodeOutputDir(repoPath, options.outDir)

  if (!existsSync(dbPath)) {
    throw new Error(
      `OpenCode sqlite database not found: ${dbPath}. OpenCode 1.2.0+ is required.`,
    )
  }

  const sqlite = new Database(dbPath)
  try {
    const project = selectProject(sqlite, repoPath, options.projectId ?? null)
    const sessions = selectSessions(
      sqlite,
      project.id,
      options.sessionId ?? null,
    )
    const limitedSessions = applyLimit(sessions, options.limit)

    if (options.sessionId && limitedSessions.length === 0) {
      throw new Error(
        `No sessions found for session id ${options.sessionId} under project ${project.id}.`,
      )
    }

    const bundles = limitedSessions.map((session) =>
      loadSessionBundle(sqlite, session),
    )

    return {
      dbPath,
      repoPath,
      outDir,
      project,
      sessions: bundles,
    }
  } finally {
    sqlite.close()
  }
}

function applyLimit(
  sessions: OpencodeSessionRecord[],
  limit?: number | null,
): OpencodeSessionRecord[] {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return sessions.slice(0, limit)
  }
  return sessions
}

function selectProject(
  sqlite: Database,
  repoPath: string,
  projectId: string | null,
): OpencodeProjectRecord {
  const projectRows = sqlite
    .query('SELECT id, worktree FROM project')
    .all() as ProjectRow[]
  const resolvedRepo = resolve(repoPath)
  const projectRow = projectId
    ? (projectRows.find((candidate) => candidate.id === projectId) ?? null)
    : (projectRows.find(
        (candidate) =>
          candidate.worktree && resolve(candidate.worktree) === resolvedRepo,
      ) ?? null)

  if (!projectRow) {
    if (projectId) {
      throw new Error(`No OpenCode project found for id: ${projectId}`)
    }
    throw new Error(`No OpenCode project found for repo: ${resolvedRepo}`)
  }

  return {
    id: projectRow.id,
    worktree: projectRow.worktree ?? undefined,
  }
}

function selectSessions(
  sqlite: Database,
  projectId: string,
  sessionId: string | null,
): OpencodeSessionRecord[] {
  const conditions = ['project_id = ?']
  const params: string[] = [projectId]
  if (sessionId) {
    conditions.push('id = ?')
    params.push(sessionId)
  }
  const where = `WHERE ${conditions.join(' AND ')}`
  const sessionRows = sqlite
    .query(
      `SELECT id, project_id, slug, title, directory, version, parent_id,
        summary_additions, summary_deletions, summary_files,
        time_created, time_updated
      FROM session
      ${where}`,
    )
    .all(...params) as SessionRow[]

  return sessionRows.map(mapSessionRow).sort((left, right) => {
    const timeCompare = compareOptionalNumber(
      left.time?.created,
      right.time?.created,
      'desc',
    )
    if (timeCompare !== 0) return timeCompare
    return left.id.localeCompare(right.id)
  })
}

function loadSessionBundle(
  sqlite: Database,
  session: OpencodeSessionRecord,
): OpencodeSessionBundle {
  const messages = selectMessages(sqlite, session.id)
  const parts = selectParts(sqlite, session.id)
  const partsByMessage = groupByKey(parts, (part) => part.messageId)
  const messageBlocks = messages.map((message) => {
    const messageParts = (partsByMessage[message.id] ?? []).sort((a, b) => {
      const timeCompare = compareOptionalNumber(
        getPartStart(a),
        getPartStart(b),
        'asc',
      )
      if (timeCompare !== 0) return timeCompare
      return a.id.localeCompare(b.id)
    })
    return { message, parts: messageParts }
  })

  return {
    session,
    messages,
    parts,
    messageBlocks,
  }
}

function selectMessages(
  sqlite: Database,
  sessionId: string,
): OpencodeMessageRecord[] {
  const messageRows = sqlite
    .query(
      'SELECT id, session_id, time_created, time_updated, data FROM message WHERE session_id = ?',
    )
    .all(sessionId) as MessageRow[]

  return messageRows.map(mapMessageRow).sort((left, right) => {
    const timeCompare = compareOptionalNumber(
      left.time?.created,
      right.time?.created,
      'asc',
    )
    if (timeCompare !== 0) return timeCompare
    return left.id.localeCompare(right.id)
  })
}

function selectParts(
  sqlite: Database,
  sessionId: string,
): OpencodePartRecord[] {
  const partRows = sqlite
    .query(
      'SELECT id, message_id, session_id, time_created, time_updated, data FROM part WHERE session_id = ?',
    )
    .all(sessionId) as PartRow[]

  return partRows.map(mapPartRow).sort((left, right) => {
    const messageCompare = left.messageId.localeCompare(right.messageId)
    if (messageCompare !== 0) return messageCompare
    const timeCompare = compareOptionalNumber(
      getPartStart(left),
      getPartStart(right),
      'asc',
    )
    if (timeCompare !== 0) return timeCompare
    return left.id.localeCompare(right.id)
  })
}

function parseJsonData<T>(value: string, context: string): T {
  try {
    return JSON.parse(value) as T
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse ${context}: ${detail}`)
  }
}

function mapSessionRow(row: SessionRow): OpencodeSessionRecord {
  return {
    id: row.id,
    slug: row.slug ?? undefined,
    version: row.version ?? undefined,
    projectId: row.project_id,
    directory: row.directory ?? undefined,
    title: row.title ?? undefined,
    parentId: row.parent_id ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function mapMessageRow(row: MessageRow): OpencodeMessageRecord {
  const data = parseJsonData<Record<string, unknown>>(
    row.data,
    `message ${row.id}`,
  )
  const role = typeof data.role === 'string' ? data.role : 'unknown'
  const parentId =
    typeof data.parentID === 'string'
      ? data.parentID
      : typeof data.parent_id === 'string'
        ? data.parent_id
        : undefined
  const summary =
    data.summary && typeof data.summary === 'object'
      ? (data.summary as OpencodeMessageSummary)
      : undefined
  const timeValue =
    data.time && typeof data.time === 'object' ? data.time : null
  const created =
    timeValue && typeof (timeValue as { created?: number }).created === 'number'
      ? (timeValue as { created?: number }).created
      : row.time_created
  const completed =
    timeValue &&
    typeof (timeValue as { completed?: number }).completed === 'number'
      ? (timeValue as { completed?: number }).completed
      : undefined

  return {
    id: row.id,
    sessionId: row.session_id,
    role,
    parentId,
    time: {
      created,
      completed,
    },
    summary,
  }
}

function mapPartRow(row: PartRow): OpencodePartRecord {
  const data = parseJsonData<Record<string, unknown>>(
    row.data,
    `part ${row.id}`,
  )
  const type = typeof data.type === 'string' ? data.type : 'unknown'
  const text = typeof data.text === 'string' ? data.text : undefined
  const tool = typeof data.tool === 'string' ? data.tool : undefined
  const time =
    data.time && typeof data.time === 'object'
      ? (data.time as { start?: number; end?: number })
      : undefined
  const state =
    data.state && typeof data.state === 'object'
      ? (data.state as OpencodePartState)
      : undefined

  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    type,
    text,
    tool,
    time,
    state,
  }
}

function groupByKey<T>(
  items: T[],
  getKey: (item: T) => string,
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = getKey(item)
    if (!acc[key]) {
      acc[key] = []
    }
    acc[key].push(item)
    return acc
  }, {})
}

function getPartStart(part: OpencodePartRecord): number | null {
  return part.time?.start ?? part.state?.time?.start ?? null
}

function compareOptionalNumber(
  left?: number | null,
  right?: number | null,
  order: 'asc' | 'desc' = 'asc',
): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return order === 'asc' ? left - right : right - left
  }
  if (typeof left === 'number') {
    return -1
  }
  if (typeof right === 'number') {
    return 1
  }
  return 0
}
