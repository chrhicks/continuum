import { searchMemory, type MemorySearchTier } from '../search'
import {
  searchRecall,
  type RecallSearchMode,
  type RecallSearchResult,
} from '../../recall/search'

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
  recallMode: 'bm25' | 'semantic' | null
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

  const limitedMatches =
    options.limit && options.limit > 0
      ? matches.slice(0, options.limit)
      : matches

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
