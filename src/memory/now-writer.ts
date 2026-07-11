import { readFileSync, writeFileSync } from 'node:fs'
import { memoryPath } from './paths'
import { parseFrontmatter, replaceFrontmatter } from '../utils/frontmatter'
import { ensureCurrentSessionPath, startSession, endSession } from './session'
import { consolidateNow } from './consolidate'
import { getMemoryConfig } from './config'
import { initMemory } from './init'
import { MemoryLockError, withFileLockAsync } from './lock'

const MAX_LOCK_RETRIES = 3
const LOCK_RETRY_DELAY_MS = 200
const STALE_LOCK_MS = 60_000

function getNowLockPath(): string {
  return memoryPath('.now.lock')
}

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
  await withLock(async () => {
    let currentPath = ensureCurrentSessionPath()

    let content = readFileSync(currentPath, 'utf-8')
    let { frontmatter, keys } = parseFrontmatter(content)
    const config = getMemoryConfig()

    if (shouldRolloverNow(content, frontmatter, config)) {
      endSession()
      await consolidateNow()
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
  initMemory()
  try {
    await withFileLockAsync(getNowLockPath(), async () => action(), {
      retries: MAX_LOCK_RETRIES,
      retryDelayMs: LOCK_RETRY_DELAY_MS,
      staleLockMs: STALE_LOCK_MS,
    })
  } catch (error) {
    if (error instanceof MemoryLockError) {
      throw new Error('NOW file is locked. Try again shortly.')
    }
    throw error
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
