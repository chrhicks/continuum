import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseFrontmatter } from '../../utils/frontmatter'
import { SUMMARY_PREFIX, resolveOpencodeOutputDir } from '../opencode/paths'

const DEFAULT_LIMIT = 5
const SUMMARY_SUFFIX = '.md'
const WORD_PATTERN = /[a-z0-9]+/g

export type RecallSearchMode = 'bm25' | 'semantic' | 'auto'

export type RecallSearchMatch = {
  filePath: string
  title: string | null
  sessionId: string | null
  score: number
  snippet: string | null
}

export type RecallSearchResult = {
  query: string
  mode: 'bm25' | 'semantic'
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
}

type RecallDocument = {
  filePath: string
  title: string | null
  sessionId: string | null
  tokens: string[]
  lines: string[]
  termCounts: Map<string, number>
}

export function searchRecall(options: RecallSearchOptions): RecallSearchResult {
  const query = options.query.trim()
  if (!query) {
    throw new Error('Missing recall search query.')
  }
  const mode = normalizeMode(options.mode)
  const limit = normalizeLimit(options.limit)
  const summaryDir = resolveOpencodeOutputDir(
    process.cwd(),
    options.summaryDir ?? null,
  )

  const documents = loadRecallDocuments(summaryDir)
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    throw new Error('Search query must include searchable terms.')
  }

  if (documents.length === 0) {
    return {
      query,
      mode: mode === 'semantic' ? 'semantic' : 'bm25',
      fallback: false,
      results: [],
      filesSearched: 0,
      summaryDir,
    }
  }

  if (mode === 'bm25') {
    return buildResult(
      query,
      'bm25',
      false,
      buildBm25Matches(documents, queryTokens, limit),
      documents.length,
      summaryDir,
    )
  }

  if (mode === 'semantic') {
    return buildResult(
      query,
      'semantic',
      false,
      buildSemanticMatches(documents, queryTokens, limit),
      documents.length,
      summaryDir,
    )
  }

  const bm25Matches = buildBm25Matches(documents, queryTokens, limit)
  if (bm25Matches.length > 0) {
    return buildResult(
      query,
      'bm25',
      false,
      bm25Matches,
      documents.length,
      summaryDir,
    )
  }

  return buildResult(
    query,
    'semantic',
    true,
    buildSemanticMatches(documents, queryTokens, limit),
    documents.length,
    summaryDir,
  )
}

function buildResult(
  query: string,
  mode: 'bm25' | 'semantic',
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

function loadRecallDocuments(summaryDir: string): RecallDocument[] {
  if (!existsSync(summaryDir)) {
    return []
  }
  const entries = readdirSync(summaryDir)
    .filter((entry) => isSummaryFile(entry))
    .sort()

  const documents: RecallDocument[] = []
  for (const entry of entries) {
    const filePath = join(summaryDir, entry)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter(raw)
      const bodyText = body.trim()
      const title = resolveTitle(frontmatter.title, bodyText)
      const sessionId = readString(frontmatter.session_id)
      const tokens = tokenize(bodyText)
      const lines = bodyText.length > 0 ? bodyText.split('\n') : []
      documents.push({
        filePath: formatPath(filePath),
        title,
        sessionId,
        tokens,
        lines,
        termCounts: countTokens(tokens),
      })
    } catch {
      continue
    }
  }
  return documents
}

function buildBm25Matches(
  documents: RecallDocument[],
  queryTokens: string[],
  limit: number,
): RecallSearchMatch[] {
  const uniqueTokens = Array.from(new Set(queryTokens))
  const documentFrequencies = buildDocumentFrequencies(documents)
  const docCount = documents.length
  const totalTokens = documents.reduce((sum, doc) => sum + doc.tokens.length, 0)
  const avgDocLength = totalTokens > 0 ? totalTokens / docCount : 1
  const k1 = 1.2
  const b = 0.75

  const matches: RecallSearchMatch[] = []
  for (const doc of documents) {
    let score = 0
    for (const token of uniqueTokens) {
      const tf = doc.termCounts.get(token) ?? 0
      if (tf === 0) continue
      const df = documentFrequencies.get(token) ?? 0
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5))
      const denom = tf + k1 * (1 - b + (b * doc.tokens.length) / avgDocLength)
      score += idf * ((tf * (k1 + 1)) / denom)
    }
    if (score > 0) {
      matches.push(buildMatch(doc, score, queryTokens))
    }
  }

  return finalizeMatches(matches, limit)
}

function buildSemanticMatches(
  documents: RecallDocument[],
  queryTokens: string[],
  limit: number,
): RecallSearchMatch[] {
  const documentFrequencies = buildDocumentFrequencies(documents)
  const docCount = documents.length
  const queryCounts = countTokens(queryTokens)
  const queryWeights = new Map<string, number>()
  let queryNorm = 0

  for (const [token, count] of queryCounts.entries()) {
    const df = documentFrequencies.get(token) ?? 0
    const idf = Math.log((docCount + 1) / (df + 1)) + 1
    const weight = count * idf
    queryWeights.set(token, weight)
    queryNorm += weight * weight
  }

  queryNorm = Math.sqrt(queryNorm)
  const matches: RecallSearchMatch[] = []

  for (const doc of documents) {
    let dot = 0
    let docNorm = 0

    for (const [token, count] of doc.termCounts.entries()) {
      const df = documentFrequencies.get(token) ?? 0
      const idf = Math.log((docCount + 1) / (df + 1)) + 1
      const weight = count * idf
      docNorm += weight * weight
      const queryWeight = queryWeights.get(token)
      if (queryWeight) {
        dot += weight * queryWeight
      }
    }

    docNorm = Math.sqrt(docNorm)
    if (dot === 0 || docNorm === 0 || queryNorm === 0) {
      continue
    }

    const score = dot / (docNorm * queryNorm)
    if (score > 0) {
      matches.push(buildMatch(doc, score, queryTokens))
    }
  }

  return finalizeMatches(matches, limit)
}

function finalizeMatches(
  matches: RecallSearchMatch[],
  limit: number,
): RecallSearchMatch[] {
  return matches
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.filePath.localeCompare(b.filePath)
    })
    .slice(0, limit)
}

function buildMatch(
  doc: RecallDocument,
  score: number,
  queryTokens: string[],
): RecallSearchMatch {
  return {
    filePath: doc.filePath,
    title: doc.title,
    sessionId: doc.sessionId,
    score,
    snippet: formatSnippet(findSnippet(doc.lines, queryTokens)),
  }
}

function findSnippet(lines: string[], queryTokens: string[]): string | null {
  if (lines.length === 0) return null
  const loweredTokens = queryTokens.map((token) => token.toLowerCase())
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const lower = trimmed.toLowerCase()
    if (loweredTokens.some((token) => lower.includes(token))) {
      return trimmed
    }
  }
  const fallback = lines.find((line) => line.trim().length > 0)
  return fallback ? fallback.trim() : null
}

function formatSnippet(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length <= 140) return trimmed
  return `${trimmed.slice(0, 137)}...`
}

function buildDocumentFrequencies(
  documents: RecallDocument[],
): Map<string, number> {
  const frequencies = new Map<string, number>()
  for (const doc of documents) {
    for (const token of new Set(doc.termCounts.keys())) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    }
  }
  return frequencies
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

function tokenize(value: string): string[] {
  const matches = value.toLowerCase().match(WORD_PATTERN)
  if (!matches) return []
  return matches.filter((token) => token.length >= 2)
}

function resolveTitle(rawTitle: unknown, body: string): string | null {
  const frontmatterTitle = readString(rawTitle)
  if (frontmatterTitle) return frontmatterTitle
  const lines = body.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim() || null
    }
  }
  return null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeMode(mode?: RecallSearchMode): RecallSearchMode {
  return mode ?? 'auto'
}

function normalizeLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT
  }
  if (limit <= 0) {
    throw new Error('Limit must be a positive number.')
  }
  return Math.floor(limit)
}

function isSummaryFile(fileName: string): boolean {
  return (
    fileName.startsWith(SUMMARY_PREFIX) && fileName.endsWith(SUMMARY_SUFFIX)
  )
}

function formatPath(filePath: string): string {
  const relativePath = relative(process.cwd(), filePath)
  return relativePath.length > 0 ? relativePath : filePath
}
