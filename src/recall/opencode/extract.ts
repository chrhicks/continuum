import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Database } from 'bun:sqlite'

import {
  compareOptionalNumber,
  getPartStart,
  groupByKey,
  mapMessageRow,
  mapPartRow,
  mapSessionRow,
  type MessageRow,
  type OpencodeMessageRecord,
  type OpencodeMessageSummary,
  type OpencodePartRecord,
  type OpencodePartState,
  type OpencodeSessionRecord,
  type PartRow,
  type ProjectRow,
  type SessionRow,
} from './extract-helpers'
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
export type {
  OpencodeSessionRecord,
  OpencodeMessageSummary,
  OpencodeMessageRecord,
  OpencodePartState,
  OpencodePartRecord,
} from './extract-helpers'

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
