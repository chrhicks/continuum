import { searchMemory, type MemorySearchTier } from '../search'
import {
  searchRecall,
  type RecallSearchMode,
  type RecallSearchResult,
} from './recall-search'
import { dedupeAndRankMatches, toRetrievalMatches } from './search-ranking'

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
  const { source, tier, tags } = resolveOptions(options)
  const memoryResult = runMemorySearch(options, source, tier, tags)
  const { shouldSearchRecall, recallResult } = runRecallSearch(
    options,
    source,
    tags,
  )
  const matches = buildMatches(memoryResult.matches, recallResult.results)

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

function resolveOptions(options: RetrievalSearchOptions): {
  source: RetrievalSearchSource
  tier: MemorySearchTier
  tags: string[]
} {
  return {
    source: options.source ?? 'all',
    tier: options.tier ?? 'all',
    tags: options.tags ?? [],
  }
}

function runMemorySearch(
  options: RetrievalSearchOptions,
  source: RetrievalSearchSource,
  tier: MemorySearchTier,
  tags: string[],
): ReturnType<typeof searchMemory> {
  if (source === 'all' || source === 'memory') {
    return searchMemory(options.query, tier, tags, options.afterDate)
  }
  return { matches: [], filesSearched: 0 }
}

function runRecallSearch(
  options: RetrievalSearchOptions,
  source: RetrievalSearchSource,
  tags: string[],
): {
  shouldSearchRecall: boolean
  recallResult: RecallSearchResult
} {
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
    : buildEmptyRecallResult(options)
  return { shouldSearchRecall, recallResult }
}

function buildEmptyRecallResult(
  options: RetrievalSearchOptions,
): RecallSearchResult {
  return {
    query: options.query,
    mode: options.recallMode === 'semantic' ? 'semantic' : 'bm25',
    fallback: false,
    results: [],
    filesSearched: 0,
    summaryDir: options.recallSummaryDir ?? '',
  }
}

function buildMatches(
  memoryMatches: ReturnType<typeof searchMemory>['matches'],
  recallMatches: RecallSearchResult['results'],
): RetrievalSearchMatch[] {
  return toRetrievalMatches(memoryMatches, recallMatches)
}

function tagsAllowRecall(tags: string[]): boolean {
  if (tags.length === 0) {
    return true
  }
  return tags.every((tag) => RECALL_IMPLICIT_TAGS.has(tag.trim().toLowerCase()))
}
