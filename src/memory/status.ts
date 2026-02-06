import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_DIR, memoryPath } from './paths'
import { getCurrentSessionPath } from './session'

export type MemoryStatus = {
  nowPath: string | null
  nowLines: number
  nowAgeMinutes: number | null
  nowBytes: number | null
  recentLines: number
  lastConsolidation: string | null
  memoryBytes: number | null
}

export function getStatus(): MemoryStatus {
  const nowPath = getCurrentSessionPath()
  let nowLines = 0
  let nowAgeMinutes: number | null = null
  let nowBytes: number | null = null

  if (nowPath && existsSync(nowPath)) {
    const content = readFileSync(nowPath, 'utf-8')
    nowLines = content.split('\n').length
    const stats = statSync(nowPath)
    nowAgeMinutes = Math.round((Date.now() - stats.mtimeMs) / 60000)
    nowBytes = stats.size
  }

  const recentPath = memoryPath('RECENT.md')
  const recentLines = existsSync(recentPath)
    ? readFileSync(recentPath, 'utf-8').split('\n').length
    : 0

  const logPath = memoryPath('consolidation.log')
  const lastConsolidation = existsSync(logPath)
    ? extractLastTimestamp(logPath)
    : null

  const memoryBytes = getDirectorySize(MEMORY_DIR)

  return {
    nowPath,
    nowLines,
    nowAgeMinutes,
    nowBytes,
    recentLines,
    lastConsolidation,
    memoryBytes,
  }
}

function extractLastTimestamp(path: string): string | null {
  const lines = readFileSync(path, 'utf-8').trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (line.startsWith('[') && line.includes(']')) {
      return line.slice(1, line.indexOf(']'))
    }
  }
  return null
}

function getDirectorySize(path: string): number | null {
  if (!existsSync(path)) {
    return null
  }
  let total = 0
  for (const name of readdirSync(path)) {
    const entryPath = join(path, name)
    const stats = statSync(entryPath)
    if (stats.isFile()) {
      total += stats.size
    }
  }
  return total
}
