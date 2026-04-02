import { countTokens, type RecallDocument } from './recall-search-documents'

export type ScoredDoc = {
  doc: RecallDocument
  score: number
}

export function scoreBm25(
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

export function scoreSemantic(
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

export function combineAutoScores(
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

export function selectSnippet(
  lines: string[],
  queryTokens: string[],
): string | null {
  return formatSnippet(findSnippet(lines, queryTokens))
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

function normalizeScore(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) {
    return 0
  }
  return value / maxValue
}
