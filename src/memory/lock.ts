import {
  closeSync,
  existsSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { ensureMemoryDir, memoryPath } from './paths'

export type MemoryLockOptions = {
  retries?: number
  retryDelayMs?: number
  staleLockMs?: number
}

export const MEMORY_LOCK_PATH = memoryPath('.memory.lock')
const DEFAULT_RETRIES = 5
const DEFAULT_RETRY_DELAY_MS = 200
const DEFAULT_STALE_LOCK_MS = 60_000

export function withMemoryLock<T>(
  action: () => T,
  options: MemoryLockOptions = {},
): T {
  ensureMemoryDir()
  const retries = options.retries ?? DEFAULT_RETRIES
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS
  let attempt = 0

  while (attempt < retries) {
    try {
      const descriptor = openSync(MEMORY_LOCK_PATH, 'wx')
      closeSync(descriptor)
      writeFileSync(
        MEMORY_LOCK_PATH,
        JSON.stringify({
          pid: process.pid,
          timestamp: new Date().toISOString(),
        }),
        'utf-8',
      )
      try {
        return action()
      } finally {
        if (existsSync(MEMORY_LOCK_PATH)) {
          unlinkSync(MEMORY_LOCK_PATH)
        }
      }
    } catch {
      if (tryClearStaleLock(staleLockMs)) {
        continue
      }
      attempt += 1
      if (attempt >= retries) {
        throw new Error('Memory operations are locked. Try again shortly.')
      }
      sleep(retryDelayMs)
    }
  }

  throw new Error('Memory operations are locked. Try again shortly.')
}

export async function withMemoryLockAsync<T>(
  action: () => Promise<T>,
  options: MemoryLockOptions = {},
): Promise<T> {
  ensureMemoryDir()
  const retries = options.retries ?? DEFAULT_RETRIES
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS
  let attempt = 0

  while (attempt < retries) {
    try {
      const descriptor = openSync(MEMORY_LOCK_PATH, 'wx')
      closeSync(descriptor)
      writeFileSync(
        MEMORY_LOCK_PATH,
        JSON.stringify({
          pid: process.pid,
          timestamp: new Date().toISOString(),
        }),
        'utf-8',
      )
      try {
        return await action()
      } finally {
        if (existsSync(MEMORY_LOCK_PATH)) {
          unlinkSync(MEMORY_LOCK_PATH)
        }
      }
    } catch {
      if (tryClearStaleLock(staleLockMs)) {
        continue
      }
      attempt += 1
      if (attempt >= retries) {
        throw new Error('Memory operations are locked. Try again shortly.')
      }
      sleep(retryDelayMs)
    }
  }

  throw new Error('Memory operations are locked. Try again shortly.')
}

function tryClearStaleLock(staleLockMs: number): boolean {
  if (!existsSync(MEMORY_LOCK_PATH)) {
    return false
  }
  try {
    const stats = statSync(MEMORY_LOCK_PATH)
    const ageMs = Date.now() - stats.mtimeMs
    if (ageMs <= staleLockMs) {
      return false
    }
    unlinkSync(MEMORY_LOCK_PATH)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): void {
  if (ms <= 0) {
    return
  }
  const buffer = new SharedArrayBuffer(4)
  const view = new Int32Array(buffer)
  Atomics.wait(view, 0, 0, ms)
}
