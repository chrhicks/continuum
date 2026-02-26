import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../../utils/frontmatter'
import { SUMMARY_PREFIX } from '../opencode/paths'
import type {
  OpencodeSummaryEntry,
  OpencodeSummaryIndex,
} from './opencode-diff-types'

export function listOpencodeSummaryFiles(summaryDir: string): string[] {
  if (!existsSync(summaryDir)) return []
  return readdirSync(summaryDir)
    .filter(
      (fileName) =>
        fileName.startsWith(SUMMARY_PREFIX) && fileName.endsWith('.md'),
    )
    .sort()
    .map((fileName) => join(summaryDir, fileName))
}

export function parseOpencodeSummaryFile(
  filePath: string,
): OpencodeSummaryEntry | null {
  const content = readFileSync(filePath, 'utf-8')
  const { frontmatter, hasFrontmatter } = parseFrontmatter(content)
  if (!hasFrontmatter) return null

  const sessionId = normalizeString(frontmatter.session_id)
  const projectId = normalizeString(frontmatter.project_id)
  if (!sessionId || !projectId) return null

  const summaryGeneratedAt = normalizeString(frontmatter.summary_generated_at)
  const summaryGeneratedAtMs = parseDateMs(summaryGeneratedAt)
  const summaryModel = normalizeString(frontmatter.summary_model)
  const summaryChunks = normalizeNumber(frontmatter.summary_chunks)
  const stat = statSync(filePath)

  return {
    key: `${projectId}:${sessionId}`,
    session_id: sessionId,
    project_id: projectId,
    summary_path: filePath,
    summary_generated_at: summaryGeneratedAt,
    summary_generated_at_ms: summaryGeneratedAtMs,
    summary_model: summaryModel,
    summary_chunks: summaryChunks,
    summary_mtime_ms: stat.mtimeMs ?? null,
    summary_fingerprint: hashContent(content),
  }
}

export function loadOpencodeSummaryEntries(
  summaryDir: string,
): OpencodeSummaryEntry[] {
  return listOpencodeSummaryFiles(summaryDir)
    .map((filePath) => parseOpencodeSummaryFile(filePath))
    .filter((entry): entry is OpencodeSummaryEntry => entry !== null)
}

export function indexOpencodeSummaryEntries(
  entries: OpencodeSummaryEntry[],
): OpencodeSummaryIndex {
  return entries.reduce<OpencodeSummaryIndex>(
    (acc, entry) => {
      const existing = acc.summaries[entry.key]
      if (!existing) {
        return {
          summaries: { ...acc.summaries, [entry.key]: entry },
          duplicates: acc.duplicates,
        }
      }
      if (isNewerSummary(entry, existing)) {
        return {
          summaries: { ...acc.summaries, [entry.key]: entry },
          duplicates: [
            ...acc.duplicates,
            {
              key: entry.key,
              kept: entry.summary_path,
              dropped: existing.summary_path,
            },
          ],
        }
      }
      return {
        summaries: acc.summaries,
        duplicates: [
          ...acc.duplicates,
          {
            key: entry.key,
            kept: existing.summary_path,
            dropped: entry.summary_path,
          },
        ],
      }
    },
    { summaries: {}, duplicates: [] },
  )
}

export function getSummaryRecencyMs(
  entry: OpencodeSummaryEntry,
): number | null {
  return entry.summary_generated_at_ms ?? entry.summary_mtime_ms ?? null
}

function isNewerSummary(
  next: OpencodeSummaryEntry,
  prev: OpencodeSummaryEntry,
): boolean {
  const nextMs = getSummaryRecencyMs(next)
  const prevMs = getSummaryRecencyMs(prev)
  if (nextMs === null && prevMs === null) return false
  if (nextMs === null) return false
  if (prevMs === null) return true
  return nextMs > prevMs
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
