import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getWorkspaceContext } from '../paths'
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

type RecallDocument = {
  filePath: string
  title: string | null
  sessionId: string | null
  createdAt: string | null
  tokens: string[]
  lines: string[]
  termCounts: Map<string, number>
}

type ScoredDoc = {
  doc: RecallDocument
  score: number
}

export function searchRecall(options: RecallSearchOptions): RecallSearchResult {
  const query = options.query.trim()
  if (!query) {
    throw new Error('Missing recall search query.')
  }
  const mode = normalizeMode(options.mode)
  const limit = normalizeLimit(options.limit)
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

  if (mode === 'bm25') {
    return buildResult(
      query,
      mode,
      false,
      finalizeMatches(scoreBm25(documents, queryTokens), queryTokens, limit),
      documents.length,
      summaryDir,
    )
  }

  if (mode === 'semantic') {
    return buildResult(
      query,
      mode,
      false,
      finalizeMatches(
        scoreSemantic(documents, queryTokens),
        queryTokens,
        limit,
      ),
      documents.length,
      summaryDir,
    )
  }

  const bm25 = scoreBm25(documents, queryTokens)
  if (bm25.length > 0) {
    return buildResult(
      query,
      'bm25',
      false,
      finalizeMatches(
        combineAutoScores(bm25, scoreSemantic(documents, queryTokens)),
        queryTokens,
        limit,
      ),
      documents.length,
      summaryDir,
    )
  }

  return buildResult(
    query,
    'semantic',
    true,
    finalizeMatches(scoreSemantic(documents, queryTokens), queryTokens, limit),
    documents.length,
    summaryDir,
  )
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

function loadRecallDocuments(
  summaryDir: string,
  afterDate?: Date,
): RecallDocument[] {
  if (!existsSync(summaryDir)) {
    return []
  }
  const entries = readdirSync(summaryDir)
    .filter((entry) => isSummaryFile(entry))
    .sort()

  const byKey = new Map<string, RecallDocument>()
  for (const entry of entries) {
    const filePath = join(summaryDir, entry)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter(raw)
      const bodyText = body.trim()
      const title = resolveTitle(frontmatter.title, bodyText)
      const sessionId = readString(frontmatter.session_id)
      const createdAt = resolveCreatedAt(filePath, frontmatter)
      if (afterDate && createdAt) {
        const createdMs = Date.parse(createdAt)
        if (!Number.isNaN(createdMs) && createdMs < afterDate.getTime()) {
          continue
        }
      }

      const document: RecallDocument = {
        filePath: formatPath(filePath),
        title,
        sessionId,
        createdAt,
        tokens: tokenize(bodyText),
        lines: bodyText.length > 0 ? bodyText.split('\n') : [],
        termCounts: countTokens(tokenize(bodyText)),
      }
      const dedupeKey = sessionId ?? title ?? document.filePath
      const existing = byKey.get(dedupeKey)
      if (!existing || compareDocumentFreshness(document, existing) > 0) {
        byKey.set(dedupeKey, document)
      }
    } catch {
      continue
    }
  }
  return Array.from(byKey.values())
}

function scoreBm25(
  documents: RecallDocument[],
  queryTokens: string[],
): ScoredDoc[] {
  const uniqueTokens = Array.from(new Set(queryTokens))
  const documentFrequencies = buildDocumentFrequencies(documents)
  const docCount = documents.length
  const totalTokens = documents.reduce((sum, doc) => sum + doc.tokens.length, 0)
  const avgDocLength = totalTokens > 0 ? totalTokens / docCount : 1
  const k1 = 1.2
  const b = 0.75

  const matches: ScoredDoc[] = []
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
      matches.push({ doc, score })
    }
  }
  return matches
}

function scoreSemantic(
  documents: RecallDocument[],
  queryTokens: string[],
): ScoredDoc[] {
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
  const matches: ScoredDoc[] = []

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
      matches.push({ doc, score })
    }
  }

  return matches
}

function combineAutoScores(
  bm25: ScoredDoc[],
  semantic: ScoredDoc[],
): ScoredDoc[] {
  const maxBm25 = Math.max(...bm25.map((item) => item.score), 0)
  const maxSemantic = Math.max(...semantic.map((item) => item.score), 0)
  const combined = new Map<string, ScoredDoc>()

  for (const item of bm25) {
    const key = item.doc.sessionId ?? item.doc.filePath
    combined.set(key, {
      doc: item.doc,
      score: normalizeScore(item.score, maxBm25) * 0.75,
    })
  }

  for (const item of semantic) {
    const key = item.doc.sessionId ?? item.doc.filePath
    const existing = combined.get(key)
    const semanticScore = normalizeScore(item.score, maxSemantic) * 0.35
    if (!existing) {
      combined.set(key, { doc: item.doc, score: semanticScore })
      continue
    }
    combined.set(key, {
      doc: existing.doc,
      score: existing.score + semanticScore,
    })
  }

  return Array.from(combined.values())
}

function normalizeScore(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) {
    return 0
  }
  return value / maxValue
}

function finalizeMatches(
  matches: ScoredDoc[],
  queryTokens: string[],
  limit: number,
): RecallSearchMatch[] {
  return dedupeMatches(
    matches
      .map(({ doc, score }) => {
        const snippet = formatSnippet(findSnippet(doc.lines, queryTokens))
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

function compareDocumentFreshness(
  left: RecallDocument,
  right: RecallDocument,
): number {
  const leftMs = left.createdAt
    ? Date.parse(left.createdAt)
    : Number.NEGATIVE_INFINITY
  const rightMs = right.createdAt
    ? Date.parse(right.createdAt)
    : Number.NEGATIVE_INFINITY
  if (leftMs !== rightMs) {
    return leftMs - rightMs
  }
  return right.filePath.localeCompare(left.filePath)
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

function resolveCreatedAt(
  filePath: string,
  frontmatter: Record<string, unknown>,
): string | null {
  const createdAt = readString(frontmatter.created_at)
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) {
    return createdAt
  }
  const updatedAt = readString(frontmatter.updated_at)
  if (updatedAt && !Number.isNaN(Date.parse(updatedAt))) {
    return updatedAt
  }
  try {
    return new Date(statSync(filePath).mtimeMs).toISOString()
  } catch {
    return null
  }
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
  const relativePath = relative(getWorkspaceContext().workspaceRoot, filePath)
  return relativePath.length > 0 ? relativePath : filePath
}
