import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MEMORY_DIR } from './paths'
import { getCurrentSessionPath } from './session'

export type MemoryListEntry = {
  filePath: string
  fileName: string
  kind: 'NOW' | 'RECENT' | 'MEMORY'
  sizeBytes: number
  mtimeMs: number
  isCurrent: boolean
}

export function listMemoryEntries(
  options: { memoryDir?: string } = {},
): MemoryListEntry[] {
  const memoryDir = options.memoryDir ?? MEMORY_DIR
  if (!existsSync(memoryDir)) {
    return []
  }

  const entries = readdirSync(memoryDir)
    .filter((fileName) => isMemoryListFile(fileName))
    .map((fileName) => {
      const filePath = join(memoryDir, fileName)
      const stats = statSync(filePath)
      return {
        filePath,
        fileName,
        kind: resolveKind(fileName),
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        isCurrent: false,
      }
    })

  const currentPath = getCurrentSessionPath()
  const resolvedCurrent = currentPath ? resolve(currentPath) : null
  for (const entry of entries) {
    if (resolvedCurrent && resolve(entry.filePath) === resolvedCurrent) {
      entry.isCurrent = true
    }
  }

  return entries.sort((a, b) => {
    const kindDiff = kindOrder(a.kind) - kindOrder(b.kind)
    if (kindDiff !== 0) {
      return kindDiff
    }
    const timeDiff = b.mtimeMs - a.mtimeMs
    if (timeDiff !== 0) {
      return timeDiff
    }
    return a.fileName.localeCompare(b.fileName)
  })
}

function isMemoryListFile(fileName: string): boolean {
  if (fileName === 'RECENT.md' || fileName === 'MEMORY.md') {
    return true
  }
  if (/^NOW-.*\.md$/.test(fileName)) {
    return true
  }
  return /^MEMORY-.*\.md$/.test(fileName)
}

function resolveKind(fileName: string): MemoryListEntry['kind'] {
  if (fileName.startsWith('NOW-')) {
    return 'NOW'
  }
  if (fileName === 'RECENT.md') {
    return 'RECENT'
  }
  return 'MEMORY'
}

function kindOrder(kind: MemoryListEntry['kind']): number {
  if (kind === 'NOW') {
    return 0
  }
  if (kind === 'RECENT') {
    return 1
  }
  return 2
}
