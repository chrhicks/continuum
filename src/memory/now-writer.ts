import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { memoryPath } from './paths'
import { parseFrontmatter, replaceFrontmatter } from '../utils/frontmatter'
import { resolveCurrentSessionPath, startSession, endSession } from './session'
import { consolidateNow } from './consolidate'
import { getMemoryConfig } from './config'

const LOCK_FILE = memoryPath('.now.lock')
const MAX_LOCK_RETRIES = 3
const LOCK_RETRY_DELAY_MS = 200
const STALE_LOCK_MS = 60_000

type AppendOptions = {
  tags?: string[]
}

export async function appendUserMessage(
  message: string,
  options: AppendOptions = {},
): Promise<void> {
  await appendEntry(`## User: ${message}`, options)
}

export async function appendAgentMessage(
  message: string,
  options: AppendOptions = {},
): Promise<void> {
  await appendEntry(`## Agent: ${message}`, options)
}

export async function appendToolCall(
  toolName: string,
  summary?: string,
): Promise<void> {
  const details = summary ? ` - ${summary}` : ''
  await appendEntry(`[Tool: ${toolName}${details}]`)
}

async function appendEntry(
  entry: string,
  options: AppendOptions = {},
): Promise<void> {
  const filePath = resolveCurrentSessionPath()
  if (!filePath) {
    throw new Error('No active NOW session found.')
  }

  await withLock(async () => {
    let currentPath = resolveCurrentSessionPath()
    if (!currentPath) {
      throw new Error('No active NOW session found.')
    }

    let content = readFileSync(currentPath, 'utf-8')
    let { frontmatter, keys } = parseFrontmatter(content)
    const config = getMemoryConfig()

    if (shouldRolloverNow(content, frontmatter, config)) {
      endSession()
      consolidateNow()
      currentPath = startSession().filePath
      content = readFileSync(currentPath, 'utf-8')
      ;({ frontmatter, keys } = parseFrontmatter(content))
    }

    const updatedTags = mergeTags(frontmatter.tags, options.tags)
    const updatedFrontmatter = {
      ...frontmatter,
      tags: updatedTags,
    }

    const normalizedEntry = entry.trim()
    const suffix = content.endsWith('\n') ? '' : '\n'
    const updatedBody = `${content}${suffix}\n${normalizedEntry}\n`
    const replaced = replaceFrontmatter(
      updatedBody,
      updatedFrontmatter,
      keys.length ? keys : undefined,
    )
    writeFileSync(currentPath, replaced, 'utf-8')
  })
}

async function withLock(action: () => void | Promise<void>): Promise<void> {
  let attempt = 0
  while (attempt < MAX_LOCK_RETRIES) {
    try {
      const descriptor = openSync(LOCK_FILE, 'wx')
      closeSync(descriptor)
      try {
        await action()
      } finally {
        unlinkSync(LOCK_FILE)
      }
      return
    } catch {
      if (tryClearStaleLock()) {
        continue
      }
      attempt += 1
      if (attempt >= MAX_LOCK_RETRIES) {
        throw new Error('NOW file is locked. Try again shortly.')
      }
      await sleep(LOCK_RETRY_DELAY_MS)
    }
  }
}

function tryClearStaleLock(): boolean {
  if (!existsSync(LOCK_FILE)) {
    return false
  }
  try {
    const stats = statSync(LOCK_FILE)
    const ageMs = Date.now() - stats.mtimeMs
    if (ageMs <= STALE_LOCK_MS) {
      return false
    }
    unlinkSync(LOCK_FILE)
    return true
  } catch {
    return false
  }
}

function mergeTags(current: unknown, incoming?: string[]): string[] {
  const currentTags = Array.isArray(current) ? current.map(String) : []
  const incomingTags = incoming ? incoming.map(String) : []
  const merged = new Set(
    [...currentTags, ...incomingTags].filter((tag) => tag.length > 0),
  )
  return Array.from(merged)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRolloverNow(
  content: string,
  frontmatter: Record<string, unknown>,
  config: ReturnType<typeof getMemoryConfig>,
): boolean {
  const lineCount = content.split('\n').length
  if (lineCount >= config.now_max_lines) {
    return true
  }

  const timestampStart = frontmatter.timestamp_start
    ? String(frontmatter.timestamp_start)
    : null
  if (!timestampStart) {
    return false
  }
  const startedAt = Date.parse(timestampStart)
  if (Number.isNaN(startedAt)) {
    return false
  }
  const ageHours = (Date.now() - startedAt) / (1000 * 60 * 60)
  return ageHours >= config.now_max_hours
}
