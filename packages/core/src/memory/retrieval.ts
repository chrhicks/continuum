import type { Database } from 'bun:sqlite'
import { ContinuumError } from '../errors'
import {
  lookupPreparedWorkspace,
  prepareWorkspaceResolution,
  registerWorkspaceInTransaction,
  type ResolvedWorkspace,
  type WorkspaceInfo,
} from '../workspaces/workspaces'
import {
  decodeRetrievalCursor,
  encodeRetrievalCursor,
  maximumCursorLength,
  type CursorPosition,
  type CursorScope,
  type RetrievalMode,
} from './retrieval-cursor'
import { readMemoryRecords, type MemoryRecord } from './records'

export type SearchMemoryInput = {
  workspace: string
  query?: string
  tags?: string[]
  kinds?: string[]
  includeHistory?: boolean
  limit?: number
  cursor?: string
}

export type MemorySearchResult = {
  records: MemoryRecord[]
  hasMore: boolean
  nextCursor: string | null
}

export type GetMemoryInput = {
  workspace: string
  ids: string[]
}

export type GetMemoryResult = {
  records: MemoryRecord[]
  missingIds: string[]
}

export type WorkspaceSummaryInput = {
  workspace: string
  limit?: number
}

export type WorkspaceSummaryResult = MemorySearchResult & {
  workspace: WorkspaceInfo
}

type NormalizedSearch = {
  query: string | null
  ftsExpression: string | null
  tags: string[]
  kinds: string[]
  includeHistory: boolean
  limit: number
  cursor: string | null
}

type Candidate = {
  rowid: number
  id: string
  created_at: string
  score?: number
}

const defaultSearchLimit = 20
const defaultSummaryLimit = 10
const maximumPageLimit = 100
const maximumFilterValues = 50
const maximumQueryLength = 2_000
const maximumGetIds = 100

export function searchMemory(
  database: Database,
  input: SearchMemoryInput,
): MemorySearchResult {
  const search = normalizeSearch(input)
  const preparedWorkspace = prepareWorkspaceResolution(input.workspace)

  try {
    return database.transaction(() => {
      const workspace = lookupPreparedWorkspace(database, preparedWorkspace)
      if (!workspace) {
        if (search.cursor) throwUnknownWorkspaceCursor(search)
        return emptySearchResult()
      }
      return readSearchPage(database, workspace.id, search)
    })()
  } catch (cause) {
    throwRetrievalError(cause, 'search memory', input.workspace)
  }
}

export function getMemory(
  database: Database,
  input: GetMemoryInput,
): GetMemoryResult {
  const ids = normalizeIds(input.ids)
  const preparedWorkspace = prepareWorkspaceResolution(input.workspace)

  try {
    return database.transaction(() => {
      const workspace = lookupPreparedWorkspace(database, preparedWorkspace)
      if (!workspace) return { records: [], missingIds: ids }

      const placeholders = ids.map(() => '?').join(', ')
      const rows = database
        .query(
          `SELECT rowid, id
           FROM memory_records
           WHERE workspace_id = ? AND id IN (${placeholders})`,
        )
        .all(workspace.id, ...ids) as Array<{ rowid: number; id: string }>
      const rowById = new Map(rows.map((row) => [row.id, row.rowid]))
      const hydrated = readMemoryRecords(
        database,
        rows.map((row) => row.rowid),
      )
      const records: MemoryRecord[] = []
      const missingIds: string[] = []
      for (const id of ids) {
        const rowid = rowById.get(id)
        const record = rowid === undefined ? undefined : hydrated.get(rowid)
        if (record) records.push(record)
        else missingIds.push(id)
      }
      return { records, missingIds }
    })()
  } catch (cause) {
    throwRetrievalError(cause, 'get memory', input.workspace)
  }
}

export function summarizeWorkspace(
  database: Database,
  input: WorkspaceSummaryInput,
): WorkspaceSummaryResult {
  const limit = normalizeLimit(
    input.limit,
    defaultSummaryLimit,
    'summarize workspace',
  )
  const preparedWorkspace = prepareWorkspaceResolution(input.workspace)
  const search: NormalizedSearch = {
    query: null,
    ftsExpression: null,
    tags: [],
    kinds: [],
    includeHistory: false,
    limit,
    cursor: null,
  }

  try {
    return database
      .transaction(() => {
        const workspace = registerWorkspaceInTransaction(
          database,
          preparedWorkspace,
        )
        const page = readSearchPage(database, workspace.id, search)
        return {
          workspace: publicWorkspaceInfo(workspace),
          ...page,
        }
      })
      .immediate()
  } catch (cause) {
    throwRetrievalError(cause, 'summarize workspace', input.workspace)
  }
}

function readSearchPage(
  database: Database,
  workspaceId: string,
  search: NormalizedSearch,
): MemorySearchResult {
  const mode: RetrievalMode = search.ftsExpression ? 'fts' : 'chronological'
  const scope = cursorScope(workspaceId, mode, search)
  const position = search.cursor
    ? decodeRetrievalCursor(search.cursor, scope)
    : null
  const candidates = search.ftsExpression
    ? findFtsCandidates(database, workspaceId, search, position)
    : findChronologicalCandidates(database, workspaceId, search, position)
  const hasMore = candidates.length > search.limit
  const pageCandidates = candidates.slice(0, search.limit)
  const recordsByRowid = readMemoryRecords(
    database,
    pageCandidates.map(({ rowid }) => rowid),
  )
  const records = pageCandidates.map(({ rowid }) => {
    const record = recordsByRowid.get(rowid)
    if (!record) {
      throw new ContinuumError({
        code: 'DATABASE_ERROR',
        operation: 'search memory',
        message: 'A selected memory record could not be read.',
      })
    }
    return record
  })
  const last = pageCandidates.at(-1)

  return {
    records,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeRetrievalCursor(scope, candidatePosition(mode, last))
        : null,
  }
}

function findChronologicalCandidates(
  database: Database,
  workspaceId: string,
  search: NormalizedSearch,
  position: CursorPosition | null,
): Candidate[] {
  const { clauses, parameters } = canonicalFilters('r', search)
  const cursor = position?.mode === 'chronological' ? position : null
  if (cursor) {
    clauses.push(`(r.created_at < ? OR (r.created_at = ? AND r.id < ?))`)
    parameters.push(cursor.createdAt, cursor.createdAt, cursor.id)
  }

  return database
    .query(
      `SELECT r.rowid, r.id, r.created_at
       FROM memory_records r
       WHERE r.workspace_id = ?
         AND ${clauses.join('\n         AND ')}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?`,
    )
    .all(workspaceId, ...parameters, search.limit + 1) as Candidate[]
}

function findFtsCandidates(
  database: Database,
  workspaceId: string,
  search: NormalizedSearch,
  position: CursorPosition | null,
): Candidate[] {
  const { clauses, parameters } = canonicalFilters('r', search)
  const cursor = position?.mode === 'fts' ? position : null
  const cursorClause = cursor
    ? `WHERE score > ?
         OR (score = ? AND created_at < ?)
         OR (score = ? AND created_at = ? AND id < ?)`
    : ''
  const cursorParameters = cursor
    ? [
        cursor.score,
        cursor.score,
        cursor.createdAt,
        cursor.score,
        cursor.createdAt,
        cursor.id,
      ]
    : []

  return database
    .query(
      `WITH ranked AS MATERIALIZED (
         SELECT
           r.rowid,
           r.id,
           r.created_at,
           bm25(memory_fts, 1.0, 3.0, 6.0) AS score
         FROM memory_fts
         JOIN memory_records r ON r.rowid = memory_fts.rowid
         WHERE memory_fts MATCH ?
           AND r.workspace_id = ?
           AND ${clauses.join('\n           AND ')}
       )
       SELECT rowid, id, created_at, score
       FROM ranked
       ${cursorClause}
       ORDER BY score ASC, created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(
      search.ftsExpression,
      workspaceId,
      ...parameters,
      ...cursorParameters,
      search.limit + 1,
    ) as Candidate[]
}

function canonicalFilters(
  recordAlias: string,
  search: NormalizedSearch,
): { clauses: string[]; parameters: Array<string | number> } {
  const clauses = ['1 = 1']
  const parameters: Array<string | number> = []

  if (!search.includeHistory) {
    clauses.push(
      `NOT EXISTS (
        SELECT 1 FROM memory_supersessions current
        WHERE current.superseded_record_rowid = ${recordAlias}.rowid
      )`,
    )
  }
  if (search.kinds.length > 0) {
    clauses.push(
      `${recordAlias}.kind IN (${search.kinds.map(() => '?').join(', ')})`,
    )
    parameters.push(...search.kinds)
  }
  if (search.tags.length > 0) {
    clauses.push(
      `${recordAlias}.rowid IN (
        SELECT record_rowid
        FROM memory_record_tags
        WHERE tag IN (${search.tags.map(() => '?').join(', ')})
        GROUP BY record_rowid
        HAVING COUNT(*) = ?
      )`,
    )
    parameters.push(...search.tags, search.tags.length)
  }

  return { clauses, parameters }
}

function normalizeSearch(input: SearchMemoryInput): NormalizedSearch {
  const operation = 'search memory'
  let query: string | null = null
  if (input.query !== undefined) {
    if (typeof input.query !== 'string') {
      throw validationError('Search query must be text.', operation)
    }
    const normalized = input.query.trim().replace(/\s+/gu, ' ').toLowerCase()
    if (normalized.length > maximumQueryLength) {
      throw validationError('Search query is too long.', operation)
    }
    query = normalized && hasFtsToken(normalized) ? normalized : null
  }

  if (
    input.includeHistory !== undefined &&
    typeof input.includeHistory !== 'boolean'
  ) {
    throw validationError('includeHistory must be a boolean.', operation)
  }
  if (input.cursor !== undefined && typeof input.cursor !== 'string') {
    throw validationError('Search cursor must be text.', operation)
  }
  if ((input.cursor?.length ?? 0) > maximumCursorLength) {
    throw validationError('Search cursor is too long.', operation)
  }

  return {
    query,
    ftsExpression: query ? ordinaryTextFtsExpression(query) : null,
    tags: normalizeFilter(input.tags, 'tags', operation),
    kinds: normalizeFilter(input.kinds, 'kinds', operation),
    includeHistory: input.includeHistory ?? false,
    limit: normalizeLimit(input.limit, defaultSearchLimit, operation),
    cursor: input.cursor ?? null,
  }
}

function normalizeFilter(
  values: string[] | undefined,
  name: string,
  operation: string,
): string[] {
  if (values === undefined) return []
  if (!Array.isArray(values)) {
    throw validationError(`Search ${name} must be an array.`, operation)
  }
  const normalized = values.map((value) => {
    if (typeof value !== 'string') {
      throw validationError(`Search ${name} must contain text.`, operation)
    }
    return value.trim().toLowerCase()
  })
  if (normalized.some((value) => !value)) {
    throw validationError(
      `Search ${name} must not contain empty values.`,
      operation,
    )
  }
  const distinct = [...new Set(normalized)].sort()
  if (distinct.length > maximumFilterValues) {
    throw validationError(`Search ${name} contains too many values.`, operation)
  }
  return distinct
}

function normalizeIds(ids: string[]): string[] {
  const operation = 'get memory'
  if (!Array.isArray(ids)) {
    throw validationError('Memory IDs must be an array.', operation)
  }
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of ids) {
    if (typeof value !== 'string') {
      throw validationError('Memory IDs must contain text.', operation)
    }
    const id = value.trim()
    if (!id) throw validationError('Memory IDs must not be empty.', operation)
    if (!seen.has(id)) {
      normalized.push(id)
      seen.add(id)
    }
  }
  if (normalized.length === 0 || normalized.length > maximumGetIds) {
    throw validationError(
      `Get memory requires between 1 and ${maximumGetIds} distinct IDs.`,
      operation,
    )
  }
  return normalized
}

function normalizeLimit(
  value: number | undefined,
  defaultValue: number,
  operation: string,
): number {
  const limit = value ?? defaultValue
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit) {
    throw validationError(
      `Limit must be an integer between 1 and ${maximumPageLimit}.`,
      operation,
    )
  }
  return limit
}

function ordinaryTextFtsExpression(query: string): string {
  return query
    .split(' ')
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(' AND ')
}

function hasFtsToken(query: string): boolean {
  // unicode61 treats ordinary Unicode letters and numbers as token content.
  return /[\p{L}\p{N}\p{Co}]/u.test(query)
}

function cursorScope(
  workspaceId: string,
  mode: RetrievalMode,
  search: NormalizedSearch,
): CursorScope {
  return {
    workspaceId,
    mode,
    query: search.query,
    tags: search.tags,
    kinds: search.kinds,
    includeHistory: search.includeHistory,
  }
}

function candidatePosition(
  mode: RetrievalMode,
  candidate: Candidate,
): CursorPosition {
  if (mode === 'chronological') {
    return {
      mode,
      createdAt: candidate.created_at,
      id: candidate.id,
    }
  }
  if (candidate.score === undefined || !Number.isFinite(candidate.score)) {
    throw new ContinuumError({
      code: 'DATABASE_ERROR',
      operation: 'search memory',
      message: 'A full-text result did not have a valid rank.',
    })
  }
  return {
    mode,
    score: candidate.score,
    createdAt: candidate.created_at,
    id: candidate.id,
  }
}

function throwUnknownWorkspaceCursor(search: NormalizedSearch): never {
  const scope = cursorScope(
    'unknown-workspace',
    search.ftsExpression ? 'fts' : 'chronological',
    search,
  )
  decodeRetrievalCursor(search.cursor as string, scope)
  throw validationError(
    'The search cursor is invalid or does not match this search.',
    'search memory',
  )
}

function publicWorkspaceInfo(workspace: ResolvedWorkspace): WorkspaceInfo {
  return { identity: workspace.identity, aliases: workspace.aliases }
}

function emptySearchResult(): MemorySearchResult {
  return { records: [], hasMore: false, nextCursor: null }
}

function throwRetrievalError(
  cause: unknown,
  operation: string,
  workspacePath: string,
): never {
  if (cause instanceof ContinuumError) throw cause
  throw new ContinuumError({
    code: 'DATABASE_ERROR',
    operation,
    message: `Failed to ${operation}.`,
    context: { workspacePath },
    cause,
  })
}

function validationError(message: string, operation: string): ContinuumError {
  return new ContinuumError({
    code: 'VALIDATION_ERROR',
    operation,
    message,
  })
}
