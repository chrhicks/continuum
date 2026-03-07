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

const DEFAULT_RETRIES = 5
const DEFAULT_RETRY_DELAY_MS = 200
const DEFAULT_STALE_LOCK_MS = 60_000

export function getMemoryLockPath(): string {
  return memoryPath('.memory.lock')
}

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
      const memoryLockPath = getMemoryLockPath()
      const descriptor = openSync(memoryLockPath, 'wx')
      closeSync(descriptor)
      writeFileSync(
        memoryLockPath,
        JSON.stringify({
          pid: process.pid,
          timestamp: new Date().toISOString(),
        }),
        'utf-8',
      )
      try {
        return action()
      } finally {
        if (existsSync(memoryLockPath)) {
          unlinkSync(memoryLockPath)
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
      const memoryLockPath = getMemoryLockPath()
      const descriptor = openSync(memoryLockPath, 'wx')
      closeSync(descriptor)
      writeFileSync(
        memoryLockPath,
        JSON.stringify({
          pid: process.pid,
          timestamp: new Date().toISOString(),
        }),
        'utf-8',
      )
      try {
        return await action()
      } finally {
        if (existsSync(memoryLockPath)) {
          unlinkSync(memoryLockPath)
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
  const memoryLockPath = getMemoryLockPath()
  if (!existsSync(memoryLockPath)) {
    return false
  }
  try {
    const stats = statSync(memoryLockPath)
    const ageMs = Date.now() - stats.mtimeMs
    if (ageMs <= staleLockMs) {
      return false
    }
    unlinkSync(memoryLockPath)
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
