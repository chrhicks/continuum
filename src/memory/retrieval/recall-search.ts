import { getWorkspaceContext } from '../paths'
import { resolveOpencodeOutputDir } from '../opencode/paths'
import { normalizePositiveLimit } from '../util'
import {
  loadRecallDocuments,
  tokenize,
  type RecallDocument,
} from './recall-search-documents'
import {
  combineAutoScores,
  scoreBm25,
  scoreSemantic,
  selectSnippet,
  type ScoredDoc,
} from './recall-search-ranking'

const DEFAULT_LIMIT = 5
export type RecallSearchMode = 'bm25' | 'semantic' | 'auto'

export type RecallSearchMatch = {
  filePath: string
  title: string | null
  sessionId: string | null
  score: number
  snippet: string | null
  createdAt: string | null
}

export type RecallSearchResult = {
  query: string
  mode: RecallSearchMode
  fallback: boolean
  results: RecallSearchMatch[]
  filesSearched: number
  summaryDir: string
}

export type RecallSearchOptions = {
  query: string
  mode?: RecallSearchMode
  summaryDir?: string
  limit?: number
  afterDate?: Date
}

export function searchRecall(options: RecallSearchOptions): RecallSearchResult {
  const query = options.query.trim()
  if (!query) {
    throw new Error('Missing recall search query.')
  }
  const mode = normalizeMode(options.mode)
  const limit = normalizePositiveLimit(options.limit, {
    defaultValue: DEFAULT_LIMIT,
    zeroAsDefault: true,
  })
  const workspace = getWorkspaceContext()
  const summaryDir = resolveOpencodeOutputDir(
    workspace.workspaceRoot,
    options.summaryDir ?? null,
  )

  const documents = loadRecallDocuments(summaryDir, options.afterDate)
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    throw new Error('Search query must include searchable terms.')
  }

  if (documents.length === 0) {
    return {
      query,
      mode,
      fallback: false,
      results: [],
      filesSearched: 0,
      summaryDir,
    }
  }

  const scored = scoreForMode(mode, documents, queryTokens)
  return buildResult(
    query,
    scored.mode,
    scored.fallback,
    finalizeMatches(scored.matches, queryTokens, limit),
    documents.length,
    summaryDir,
  )
}

function scoreForMode(
  mode: RecallSearchMode,
  documents: RecallDocument[],
  queryTokens: string[],
): { mode: RecallSearchMode; fallback: boolean; matches: ScoredDoc[] } {
  if (mode === 'bm25') {
    return { mode, fallback: false, matches: scoreBm25(documents, queryTokens) }
  }

  if (mode === 'semantic') {
    return {
      mode,
      fallback: false,
      matches: scoreSemantic(documents, queryTokens),
    }
  }

  const bm25 = scoreBm25(documents, queryTokens)
  if (bm25.length > 0) {
    return {
      mode: 'bm25',
      fallback: false,
      matches: combineAutoScores(bm25, scoreSemantic(documents, queryTokens)),
    }
  }

  return {
    mode: 'semantic',
    fallback: true,
    matches: scoreSemantic(documents, queryTokens),
  }
}

function buildResult(
  query: string,
  mode: RecallSearchMode,
  fallback: boolean,
  results: RecallSearchMatch[],
  filesSearched: number,
  summaryDir: string,
): RecallSearchResult {
  return {
    query,
    mode,
    fallback,
    results,
    filesSearched,
    summaryDir,
  }
}

function finalizeMatches(
  matches: ScoredDoc[],
  queryTokens: string[],
  limit: number,
): RecallSearchMatch[] {
  return dedupeMatches(
    matches
      .map(({ doc, score }) => {
        const snippet = selectSnippet(doc.lines, queryTokens)
        const finalScore =
          score +
          titleOverlapBoost(doc.title, queryTokens) +
          recencyBoost(doc.createdAt)
        return buildMatch(doc, finalScore, snippet)
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.filePath.localeCompare(b.filePath)
      }),
  ).slice(0, limit)
}

function dedupeMatches(matches: RecallSearchMatch[]): RecallSearchMatch[] {
  const deduped = new Map<string, RecallSearchMatch>()
  for (const match of matches) {
    const key = match.sessionId ?? `${match.title ?? ''}|${match.filePath}`
    const existing = deduped.get(key)
    if (!existing || match.score > existing.score) {
      deduped.set(key, match)
    }
  }
  return Array.from(deduped.values())
}

function buildMatch(
  doc: RecallDocument,
  score: number,
  snippet: string | null,
): RecallSearchMatch {
  return {
    filePath: doc.filePath,
    title: doc.title,
    sessionId: doc.sessionId,
    score,
    snippet,
    createdAt: doc.createdAt,
  }
}

function titleOverlapBoost(
  title: string | null,
  queryTokens: string[],
): number {
  if (!title) {
    return 0
  }
  const titleTokens = new Set(tokenize(title))
  const overlap = queryTokens.filter((token) => titleTokens.has(token)).length
  return overlap * 0.08
}

function recencyBoost(createdAt: string | null): number {
  if (!createdAt) {
    return 0
  }
  const createdMs = Date.parse(createdAt)
  if (Number.isNaN(createdMs)) {
    return 0
  }
  const ageDays = Math.max(0, (Date.now() - createdMs) / 86_400_000)
  return Math.max(0, 0.15 - Math.min(ageDays / 365, 0.15))
}

function normalizeMode(mode?: RecallSearchMode): RecallSearchMode {
  return mode ?? 'auto'
}
