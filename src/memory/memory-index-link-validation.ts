import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryValidationError } from './validate'

export function validateMemoryIndexLinks(
  indexPath: string,
  memoryDir: string,
): MemoryValidationError[] {
  const content = readFileSync(indexPath, 'utf-8')
  const lines = content.split('\n')
  const errors: MemoryValidationError[] = []
  const linkRegex = /\[[^\]]+\]\((MEMORY-[^#)]+\.md)#([^)]+)\)/g

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    let match: RegExpExecArray | null
    while ((match = linkRegex.exec(line)) !== null) {
      const fileName = match[1]
      const anchor = match[2]
      const targetPath = join(memoryDir, fileName)
      if (!existsSync(targetPath)) {
        errors.push({
          filePath: indexPath,
          lineNumber: i + 1,
          message: `Missing target file for link: ${fileName}`,
        })
        continue
      }
      if (!anchorExists(targetPath, anchor)) {
        errors.push({
          filePath: indexPath,
          lineNumber: i + 1,
          message: `Missing anchor in ${fileName}: #${anchor}`,
        })
      }
    }
  }

  return errors
}

function anchorExists(filePath: string, anchor: string): boolean {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const namePattern = new RegExp(`name=["']${escapeRegex(anchor)}["']`)
  for (const line of lines) {
    if (namePattern.test(line)) {
      return true
    }
  }
  const headingSlugs = extractHeadingSlugs(lines)
  return headingSlugs.has(anchor)
}

function extractHeadingSlugs(lines: string[]): Set<string> {
  const slugs = new Set<string>()
  const counts = new Map<string, number>()
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/)
    if (!match) {
      continue
    }
    const heading = match[2].trim()
    if (!heading) {
      continue
    }
    const base = slugifyHeading(heading)
    if (!base) {
      continue
    }
    const existing = counts.get(base) ?? 0
    const slug = existing === 0 ? base : `${base}-${existing}`
    counts.set(base, existing + 1)
    slugs.add(slug)
  }
  return slugs
}

function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
