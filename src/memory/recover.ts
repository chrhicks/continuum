import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MEMORY_DIR } from './paths'
import { getCurrentSessionPath } from './session'
import { getMemoryConfig } from './config'
import { parseFrontmatter } from '../utils/frontmatter'
import { consolidateNow } from './consolidate'

export type StaleNowFile = {
  filePath: string
  ageHours: number
  timestampStart: string | null
}

export type StaleNowScanResult = {
  thresholdHours: number
  totalNowFiles: number
  staleNowFiles: StaleNowFile[]
}

export type RecoverResult = StaleNowScanResult & {
  recovered: string[]
}

export function scanStaleNowFiles(
  options: { maxHours?: number; memoryDir?: string; nowMs?: number } = {},
): StaleNowScanResult {
  const memoryDir = options.memoryDir ?? MEMORY_DIR
  const nowMs = options.nowMs ?? Date.now()
  const thresholdHours = options.maxHours ?? getMemoryConfig().now_max_hours

  if (!existsSync(memoryDir)) {
    return { thresholdHours, totalNowFiles: 0, staleNowFiles: [] }
  }

  const nowFiles = readdirSync(memoryDir).filter((fileName) =>
    /^NOW-.*\.md$/.test(fileName),
  )
  const currentPath = getCurrentSessionPath()
  const resolvedCurrent = currentPath ? resolve(currentPath) : null
  const staleCandidates: StaleNowFile[] = []

  for (const fileName of nowFiles) {
    const filePath = join(memoryDir, fileName)
    if (resolvedCurrent && resolve(filePath) === resolvedCurrent) {
      continue
    }
    const { timestampStart, startMs } = resolveStartTimestamp(filePath)
    const ageHours = (nowMs - startMs) / (1000 * 60 * 60)
    if (ageHours >= thresholdHours) {
      staleCandidates.push({ filePath, ageHours, timestampStart })
    }
  }

  staleCandidates.sort((a, b) => b.ageHours - a.ageHours)

  return {
    thresholdHours,
    totalNowFiles: nowFiles.length,
    staleNowFiles: staleCandidates,
  }
}

export async function recoverStaleNowFiles(
  options: { maxHours?: number; consolidate?: boolean } = {},
): Promise<RecoverResult> {
  const scan = scanStaleNowFiles({ maxHours: options.maxHours })
  const recovered: string[] = []
  if (options.consolidate) {
    for (const stale of scan.staleNowFiles) {
      await consolidateNow({ nowPath: stale.filePath, skipNowCleanup: true })
      recovered.push(stale.filePath)
    }
  }

  return { ...scan, recovered }
}

function resolveStartTimestamp(filePath: string): {
  timestampStart: string | null
  startMs: number
} {
  const content = readFileSync(filePath, 'utf-8')
  const { frontmatter } = parseFrontmatter(content)
  const raw = frontmatter.timestamp_start
    ? String(frontmatter.timestamp_start)
    : null
  if (raw) {
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) {
      return { timestampStart: raw, startMs: parsed }
    }
  }
  const stats = statSync(filePath)
  return { timestampStart: null, startMs: stats.mtimeMs }
}
