import { searchMemory, type MemorySearchTier } from '../search'
import {
  searchRecall,
  type RecallSearchMode,
  type RecallSearchResult,
} from './recall-search'

export type RetrievalSearchSource = 'memory' | 'recall' | 'all'

export type RetrievalSearchMatch = {
  source: 'memory' | 'recall'
  filePath: string
  tier: Exclude<MemorySearchTier, 'all'> | null
  lineNumber: number | null
  lineText: string | null
  title: string | null
  sessionId: string | null
  score: number | null
  snippet: string | null
}

export type RetrievalSearchResult = {
  query: string
  source: RetrievalSearchSource
  tier: MemorySearchTier
  filesSearched: number
  memoryFilesSearched: number
  recallFilesSearched: number
  recallMode: RecallSearchMode | null
  recallFallback: boolean
  matches: RetrievalSearchMatch[]
}

export type RetrievalSearchOptions = {
  query: string
  source?: RetrievalSearchSource
  tier?: MemorySearchTier
  tags?: string[]
  afterDate?: Date
  recallMode?: RecallSearchMode
  recallSummaryDir?: string
  limit?: number
}

const RECALL_IMPLICIT_TAGS = new Set(['opencode', 'recall'])

export function searchRetrieval(
  options: RetrievalSearchOptions,
): RetrievalSearchResult {
  const source = options.source ?? 'all'
  const tier = options.tier ?? 'all'
  const tags = options.tags ?? []

  const memoryResult =
    source === 'all' || source === 'memory'
      ? searchMemory(options.query, tier, tags, options.afterDate)
      : { matches: [], filesSearched: 0 }

  const shouldSearchRecall =
    (source === 'all' || source === 'recall') && tagsAllowRecall(tags)

  const recallResult: RecallSearchResult = shouldSearchRecall
    ? searchRecall({
        query: options.query,
        mode: options.recallMode,
        summaryDir: options.recallSummaryDir,
        limit: options.limit,
        afterDate: options.afterDate,
      })
    : {
        query: options.query,
        mode: options.recallMode === 'semantic' ? 'semantic' : 'bm25',
        fallback: false,
        results: [],
        filesSearched: 0,
        summaryDir: options.recallSummaryDir ?? '',
      }

  const matches: RetrievalSearchMatch[] = [
    ...memoryResult.matches.map((match) => ({
      source: 'memory' as const,
      filePath: match.filePath,
      tier: resolveTier(match.filePath),
      lineNumber: match.lineNumber,
      lineText: match.lineText,
      title: null,
      sessionId: null,
      score: null,
      snippet: null,
    })),
    ...recallResult.results.map((match) => ({
      source: 'recall' as const,
      filePath: match.filePath,
      tier: null,
      lineNumber: null,
      lineText: null,
      title: match.title,
      sessionId: match.sessionId,
      score: match.score,
      snippet: match.snippet,
    })),
  ]

  const rankedMatches = dedupeAndRankMatches(options.query, matches)

  const limitedMatches =
    options.limit && options.limit > 0
      ? rankedMatches.slice(0, options.limit)
      : rankedMatches

  return {
    query: options.query,
    source,
    tier,
    filesSearched: memoryResult.filesSearched + recallResult.filesSearched,
    memoryFilesSearched: memoryResult.filesSearched,
    recallFilesSearched: recallResult.filesSearched,
    recallMode: shouldSearchRecall ? recallResult.mode : null,
    recallFallback: shouldSearchRecall ? recallResult.fallback : false,
    matches: limitedMatches,
  }
}

function dedupeAndRankMatches(
  query: string,
  matches: RetrievalSearchMatch[],
): RetrievalSearchMatch[] {
  const queryTokens = tokenize(query)
  const deduped = new Map<
    string,
    { match: RetrievalSearchMatch; rank: number }
  >()

  for (const match of matches) {
    const rank = computeRank(match, queryTokens)
    const key = buildDedupeKey(match)
    const existing = deduped.get(key)
    if (
      !existing ||
      rank > existing.rank ||
      preferMatch(match, existing.match)
    ) {
      deduped.set(key, { match, rank })
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => {
      if (right.rank !== left.rank) {
        return right.rank - left.rank
      }
      return left.match.filePath.localeCompare(right.match.filePath)
    })
    .map((entry) => entry.match)
}

function computeRank(
  match: RetrievalSearchMatch,
  queryTokens: string[],
): number {
  if (match.source === 'memory') {
    const tierWeight =
      match.tier === 'RECENT' ? 2.4 : match.tier === 'MEMORY' ? 2.2 : 2.0
    const coverage = tokenCoverage(match.lineText ?? '', queryTokens)
    const headerBoost =
      match.lineText &&
      /^##\s+(Session|Task|Recall Import|OpenCode Session)\b/.test(
        match.lineText,
      )
        ? 0.1
        : 0
    return tierWeight + coverage + headerBoost
  }

  const recallScore = match.score ?? 0
  return (
    1 +
    recallScore +
    tokenCoverage(match.title ?? match.snippet ?? '', queryTokens)
  )
}

function buildDedupeKey(match: RetrievalSearchMatch): string {
  const sessionId = match.sessionId ?? extractStructuredId(match.lineText)
  if (sessionId) {
    return `id:${sessionId}`
  }

  const text = normalizeMatchText(match)
  if (text) {
    return `text:${text}`
  }

  return `file:${match.filePath}:${match.lineNumber ?? 0}`
}

function extractStructuredId(value: string | null): string | null {
  if (!value) {
    return null
  }
  const match = value.match(
    /\b(?:ses[_-][A-Za-z0-9_-]+|tkt[-_][A-Za-z0-9_-]+)\b/,
  )
  return match?.[0] ?? null
}

function normalizeMatchText(match: RetrievalSearchMatch): string {
  const value = [match.title, match.snippet, match.lineText]
    .find((entry) => typeof entry === 'string' && entry.trim().length > 0)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return value ?? ''
}

function preferMatch(
  incoming: RetrievalSearchMatch,
  existing: RetrievalSearchMatch,
): boolean {
  if (incoming.source !== existing.source) {
    return incoming.source === 'memory'
  }
  if (incoming.source === 'memory' && existing.source === 'memory') {
    return (incoming.tier ?? '').localeCompare(existing.tier ?? '') < 0
  }
  return (incoming.score ?? 0) > (existing.score ?? 0)
}

function tokenCoverage(value: string, queryTokens: string[]): number {
  if (!value || queryTokens.length === 0) {
    return 0
  }
  const haystack = value.toLowerCase()
  const hits = queryTokens.filter((token) => haystack.includes(token)).length
  return hits / queryTokens.length
}

function tokenize(value: string): string[] {
  const matches = value.toLowerCase().match(/[a-z0-9]+/g)
  if (!matches) {
    return []
  }
  return Array.from(new Set(matches.filter((token) => token.length >= 2)))
}

function resolveTier(filePath: string): Exclude<MemorySearchTier, 'all'> {
  const fileName = filePath.split('/').pop() ?? ''
  if (/^NOW-.*\.md$/.test(fileName)) {
    return 'NOW'
  }
  if (fileName === 'RECENT.md') {
    return 'RECENT'
  }
  return 'MEMORY'
}

function tagsAllowRecall(tags: string[]): boolean {
  if (tags.length === 0) {
    return true
  }
  return tags.every((tag) => RECALL_IMPLICIT_TAGS.has(tag.trim().toLowerCase()))
}
