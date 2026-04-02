import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseFrontmatter } from '../../utils/frontmatter'
import { getWorkspaceContext } from '../paths'
import { SUMMARY_PREFIX } from '../opencode/paths'

const SUMMARY_SUFFIX = '.md'
const WORD_PATTERN = /[a-z0-9]+/g

export type RecallDocument = {
  filePath: string
  title: string | null
  sessionId: string | null
  createdAt: string | null
  tokens: string[]
  lines: string[]
  termCounts: Map<string, number>
}

export function loadRecallDocuments(
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

export function tokenize(value: string): string[] {
  const matches = value.toLowerCase().match(WORD_PATTERN)
  if (!matches) return []
  return matches.filter((token) => token.length >= 2)
}

export function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
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

function isSummaryFile(fileName: string): boolean {
  return (
    fileName.startsWith(SUMMARY_PREFIX) && fileName.endsWith(SUMMARY_SUFFIX)
  )
}

function formatPath(filePath: string): string {
  const relativePath = relative(getWorkspaceContext().workspaceRoot, filePath)
  return relativePath.length > 0 ? relativePath : filePath
}
