import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_DIR } from './paths'
import { normalizeTags } from './util'
import { parseFrontmatter } from '../utils/frontmatter'

export type MemorySearchTier = 'NOW' | 'RECENT' | 'MEMORY' | 'all'

export type MemorySearchMatch = {
  filePath: string
  lineNumber: number
  lineText: string
}

export type MemorySearchResult = {
  matches: MemorySearchMatch[]
  filesSearched: number
}

export function searchMemory(
  query: string,
  tier: MemorySearchTier = 'all',
  tags: string[] = [],
  afterDate?: Date,
): MemorySearchResult {
  if (!existsSync(MEMORY_DIR)) {
    return { matches: [], filesSearched: 0 }
  }

  const files = listMemoryFiles(tier)
  const normalizedTags = normalizeTags(tags, { trim: true, dropEmpty: true })
  const normalizedQuery = query.toLowerCase()
  const afterMs = afterDate ? afterDate.getTime() : null
  const matches: MemorySearchMatch[] = []
  let filesSearched = 0

  for (const filePath of files) {
    if (!existsSync(filePath)) {
      continue
    }
    const content = readFileSync(filePath, 'utf-8')
    filesSearched += 1
    const { frontmatter } = parseFrontmatter(content)
    if (afterMs !== null) {
      const fileDate = resolveFileDate(filePath, content)
      if (fileDate.getTime() < afterMs) {
        continue
      }
    }
    if (normalizedTags.length > 0) {
      const fileTags = normalizeTags(frontmatter.tags, {
        trim: true,
        dropEmpty: true,
      })
      if (!hasAllTags(fileTags, normalizedTags)) {
        continue
      }
    }
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(normalizedQuery)) {
        matches.push({ filePath, lineNumber: index + 1, lineText: line })
      }
    })
  }

  return { matches, filesSearched }
}

function resolveFileDate(filePath: string, content: string): Date {
  const { frontmatter } = parseFrontmatter(content)
  const fileName = filePath.split('/').pop() ?? ''

  if (frontmatter && typeof frontmatter === 'object') {
    const data = frontmatter as Record<string, unknown>
    const dateField = /^NOW-.*\.md$/.test(fileName)
      ? data.timestamp_start
      : data.consolidation_date
    if (dateField) {
      const parsed = Date.parse(String(dateField))
      if (!Number.isNaN(parsed)) {
        return new Date(parsed)
      }
    }
  }

  const stats = statSync(filePath)
  return stats.mtime
}

function listMemoryFiles(tier: MemorySearchTier): string[] {
  const entries = readdirSync(MEMORY_DIR)
  const allFiles = entries
    .filter((file) => isMemoryFile(file))
    .map((file) => join(MEMORY_DIR, file))

  if (tier === 'all') {
    return allFiles.sort()
  }

  return allFiles.filter((file) => matchesTier(file, tier)).sort()
}

function isMemoryFile(fileName: string): boolean {
  if (fileName === 'RECENT.md' || fileName === 'MEMORY.md') {
    return true
  }
  if (/^NOW-.*\.md$/.test(fileName)) {
    return true
  }
  return /^MEMORY-.*\.md$/.test(fileName)
}

function matchesTier(
  filePath: string,
  tier: Exclude<MemorySearchTier, 'all'>,
): boolean {
  const fileName = filePath.split('/').pop() ?? ''
  if (tier === 'NOW') {
    return /^NOW-.*\.md$/.test(fileName)
  }
  if (tier === 'RECENT') {
    return fileName === 'RECENT.md'
  }
  return fileName === 'MEMORY.md' || /^MEMORY-.*\.md$/.test(fileName)
}

function hasAllTags(fileTags: string[], requiredTags: string[]): boolean {
  return requiredTags.every((tag) => fileTags.includes(tag))
}
