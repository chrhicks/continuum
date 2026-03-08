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

export type ProjectRow = {
  id: string
  worktree: string | null
}

export type SessionRow = {
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

export type MessageRow = {
  id: string
  session_id: string
  time_created: number
  time_updated: number
  data: string
}

export type PartRow = {
  id: string
  message_id: string
  session_id: string
  time_created: number
  time_updated: number
  data: string
}

export function mapSessionRow(row: SessionRow): OpencodeSessionRecord {
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

export function mapMessageRow(row: MessageRow): OpencodeMessageRecord {
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

export function mapPartRow(row: PartRow): OpencodePartRecord {
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

export function groupByKey<T>(
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

export function getPartStart(part: OpencodePartRecord): number | null {
  return part.time?.start ?? part.state?.time?.start ?? null
}

export function compareOptionalNumber(
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

function parseJsonData<T>(value: string, context: string): T {
  try {
    return JSON.parse(value) as T
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse ${context}: ${detail}`)
  }
}
