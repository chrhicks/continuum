import { type MemorySearchTier } from '../../../memory/search'
import {
  searchRetrieval,
  type RetrievalSearchSource,
} from '../../../memory/retrieval/search'

type HandleSearchInput = {
  query: string
  source: RetrievalSearchSource
  tier: MemorySearchTier | 'all'
  tags: string[]
  afterDate: Date | null
  mode: 'bm25' | 'semantic' | 'auto'
  limit?: number
  summaryDir?: string
}

export function handleSearch(input: HandleSearchInput): void {
  const result = searchRetrieval({
    query: input.query,
    source: input.source,
    tier: input.tier,
    tags: input.tags,
    afterDate: input.afterDate ?? undefined,
    recallMode: input.mode,
    recallSummaryDir: input.summaryDir,
    limit: input.limit,
  })
  if (result.filesSearched === 0) {
    console.log('No searchable memory or recall files found.')
    return
  }
  if (result.matches.length === 0) {
    console.log(`No matches found for "${input.query}".`)
    console.log(`Files searched: ${result.filesSearched}`)
    return
  }

  const matchLabel = result.matches.length === 1 ? 'match' : 'matches'
  const fileLabel = result.filesSearched === 1 ? 'file' : 'files'
  console.log(
    `Found ${result.matches.length} ${matchLabel} in ${result.filesSearched} ${fileLabel}:`,
  )
  console.log(
    `- Sources: memory=${result.memoryFilesSearched}, recall=${result.recallFilesSearched}`,
  )
  if (result.recallMode) {
    const fallback = result.recallFallback ? ' (fallback)' : ''
    console.log(`- Recall mode: ${result.recallMode}${fallback}`)
  }
  for (const match of result.matches) {
    if (match.source === 'memory') {
      console.log(
        `- [memory/${match.tier}] ${match.filePath}:${match.lineNumber} ${match.lineText}`,
      )
      continue
    }
    const scoreLabel =
      match.score === null ? '' : ` score=${match.score.toFixed(3)}`
    const sessionLabel = match.sessionId ? ` [${match.sessionId}]` : ''
    const titleLabel = match.title ? ` (${match.title})` : ''
    const snippetLabel = match.snippet ? ` - ${match.snippet}` : ''
    console.log(
      `- [recall${scoreLabel}] ${match.filePath}${sessionLabel}${titleLabel}${snippetLabel}`,
    )
  }
}
